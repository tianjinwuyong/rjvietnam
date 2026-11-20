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

export type StationKeyFailure = null | "STATION_KEY_MISSING" | "STATION_KEY_INVALID";

/** null when the request may proceed; the reason it may not otherwise. */
export declare function stationKeyFailure(
  presented: string | null | undefined,
  configured: string | null | undefined,
): StationKeyFailure;

/** True while a missing station key is still forgiven. */
export declare function stationKeyGraceIsOpen(
  flagUntil: string | null | undefined,
  now?: () => number,
): boolean;

/** Maps a stationKeyFailure result to the failure to act on. */
export declare function stationKeyGrace(
  flagUntil: string | null | undefined,
  now?: () => number,
): (failure: StationKeyFailure) => StationKeyFailure;

export interface UnprovisionedReporter {
  /** true when this was the first sighting of that terminal key */
  note(key: string): boolean;
  seen(): string[];
}

export declare function createUnprovisionedReporter(
  report: (key: string) => void,
): UnprovisionedReporter;
