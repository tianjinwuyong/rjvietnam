// Who may use the station login, and whether the terminal asking for it is a
// station at all.
//
// `/auth/station-login` proves a *station*, not a *person*: the caller sends an
// operator username and a station code and gets a JWT carrying that account's
// whole permission set. That is the design of the floor scanners, and it is only
// tolerable while the accounts it can reach are the ones that stand at a machine.
// An office role that can rewrite access control, HR records or money must come
// through /api/auth/login with a password, so those roles are refused here.
//
// The endpoint is credential-free only while STATION_LOGIN_KEY is unset; once it
// is set the caller must also present `x-station-key`, which is what
// stationKeyFailure() at the bottom of this file compares.

import { createHash, timingSafeEqual } from "node:crypto";

// Permissions that mean "this account is not standing at a machine".
// `smt.loading.approve` and `lifecycle.approve` are deliberately absent: quality,
// warehouse and PMC hold them and do use station logins.
export const STATION_LOGIN_PRIVILEGED_DEFAULT = /^(admin\.|finance\.|hr\.admin$|hr\.salary$|hr\.edit$|\*$)/;

/**
 * @param {{ allowRoles?: string, allowOperators?: string, denyPattern?: RegExp }} [options]
 *   `allowRoles` is the raw STATION_LOGIN_ALLOW_ROLES value (comma-separated role
 *   codes) so the caller can pass the env string straight in; a listed role is
 *   trusted even when its permissions look privileged.
 *   `allowOperators` lists single USERNAMES (STATION_LOGIN_ALLOW_OPERATORS) for the
 *   person whose job genuinely has them standing at a machine while they hold an
 *   office-grade role — an exception per human, not a re-opened role.
 */
export function createStationLoginPolicy({
  allowRoles = "",
  allowOperators = "",
  denyPattern = STATION_LOGIN_PRIVILEGED_DEFAULT,
} = {}) {
  const names = (value) =>
    new Set(
      String(value)
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    );
  const allow = names(allowRoles);
  const operators = names(allowOperators);

  return {
    /** A role explicitly allowed is never asked what it can do. */
    isAllowedRole(roleKey) {
      return allow.has(String(roleKey));
    },
    privilegedPermissions(permissions) {
      return (Array.isArray(permissions) ? permissions : [])
        .map((code) => String(code))
        .filter((code) => denyPattern.test(code));
    },
    /**
     * @param {string} roleKey
     * @param {string[]} permissions the role's permission codes
     * @param {string} [username] the account asking for the session
     * @returns {{ allowed: boolean, reason: string | null, blocked: string[] }}
     */
    check(roleKey, permissions, username) {
      if (this.isAllowedRole(roleKey)) return { allowed: true, reason: null, blocked: [] };
      const blocked = this.privilegedPermissions(permissions);
      if (blocked.length === 0) return { allowed: true, reason: null, blocked: [] };
      if (operators.has(String(username ?? ""))) return { allowed: true, reason: "NAMED_OPERATOR", blocked };
      return { allowed: false, reason: "PRIVILEGED_ROLE", blocked };
    },
  };
}

/**
 * Compare the presented station key with the configured one.
 *
 * Hashes are compared with timingSafeEqual so neither the length of the secret
 * nor the position of its first differing byte shows up in the response time; a
 * plain !== over a shared secret is a byte-at-a-time oracle in theory, and there
 * is no reason to leave it in.
 *
 * @param {string|null|undefined} presented the x-station-key header, if any
 * @param {string|null|undefined} configured the raw STATION_LOGIN_KEY value
 * @returns {null|"STATION_KEY_MISSING"|"STATION_KEY_INVALID"} null when the
 *   request may proceed, the reason it may not otherwise
 */
export function stationKeyFailure(presented, configured) {
  const expected = String(configured ?? "").trim();
  if (!expected) return null; // no station credential configured, nothing to check
  const got = String(presented ?? "").trim();
  if (!got) return "STATION_KEY_MISSING";
  const digest = (value) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(got), digest(expected)) ? null : "STATION_KEY_INVALID";
}
