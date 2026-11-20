// Who is allowed to use the credential-free station login.
//
// `/auth/station-login` proves a *station*, not a *person*: the caller sends an
// operator username and a station code and gets a JWT carrying that account's
// whole permission set. That is the design of the floor scanners, and it is only
// tolerable while the accounts it can reach are the ones that stand at a machine.
// An office role that can rewrite access control, HR records or money must come
// through /api/auth/login with a password, so those roles are refused here.

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
