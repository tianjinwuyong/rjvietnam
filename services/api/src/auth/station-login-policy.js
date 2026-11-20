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
 * @param {{ allowRoles?: string, denyPattern?: RegExp }} [options]
 *   `allowRoles` is the raw STATION_LOGIN_ALLOW_ROLES value (comma-separated role
 *   codes) so the caller can pass the env string straight in; an listed role is
 *   trusted even when its permissions look privileged.
 */
export function createStationLoginPolicy({ allowRoles = "", denyPattern = STATION_LOGIN_PRIVILEGED_DEFAULT } = {}) {
  const allow = new Set(
    String(allowRoles)
      .split(",")
      .map((code) => code.trim())
      .filter(Boolean),
  );

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
     * @returns {{ allowed: boolean, reason: string | null, blocked: string[] }}
     */
    check(roleKey, permissions) {
      if (this.isAllowedRole(roleKey)) return { allowed: true, reason: null, blocked: [] };
      const blocked = this.privilegedPermissions(permissions);
      if (blocked.length === 0) return { allowed: true, reason: null, blocked: [] };
      return { allowed: false, reason: "PRIVILEGED_ROLE", blocked };
    },
  };
}
