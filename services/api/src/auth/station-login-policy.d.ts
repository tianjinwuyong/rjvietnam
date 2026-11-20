// Types for station-login-policy.js, so tests and checkJs consumers see the policy
// without importing an untyped .js module (TS7016). Same convention as
// session-tokens.d.ts.

export interface StationLoginPolicyOptions {
  /** Raw STATION_LOGIN_ALLOW_ROLES value: comma-separated role codes. */
  allowRoles?: string;
  /** Raw STATION_LOGIN_ALLOW_OPERATORS value: comma-separated usernames. */
  allowOperators?: string;
  /** Permission codes that mark an account as "not standing at a machine". */
  denyPattern?: RegExp;
}

export interface StationLoginDecision {
  allowed: boolean;
  /** null when allowed by role or by having nothing privileged; NAMED_OPERATOR
   *  when the username exception carried it; PRIVILEGED_ROLE when refused. */
  reason: string | null;
  /** The privileged permission codes that caused the decision. */
  blocked: string[];
}

export interface StationLoginPolicy {
  isAllowedRole(roleKey: string): boolean;
  privilegedPermissions(permissions: readonly string[] | null | undefined): string[];
  check(roleKey: string, permissions: readonly string[] | null | undefined, username?: string): StationLoginDecision;
}

export declare const STATION_LOGIN_PRIVILEGED_DEFAULT: RegExp;

export declare function createStationLoginPolicy(
  options?: StationLoginPolicyOptions,
): StationLoginPolicy;
