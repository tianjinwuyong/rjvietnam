// Types for session-tokens.js, so tests and checkJs consumers see the factories
// without importing an untyped .js module (TS7016). Same convention as
// src/mesrj/legacy-paths.d.ts.

export interface RevocationEntry {
  jti: string;
  exp: number;
}

export interface RevocationStore {
  add(jti: string, expSeconds: number): boolean;
  has(jti: string | null | undefined): boolean;
  prune(): number;
  /** Live (not yet expired) entries, for persisting what a restart must keep. */
  live(): RevocationEntry[];
  readonly size: number;
}
export interface AccountStateCacheOptions<TUserId = unknown> {
  ttlMs?: number;
  now?: () => number;
  lookup: (userId: TUserId) => Promise<string | null>;
}

export interface AccountStateCache {
  get(userId: unknown): Promise<string | null>;
  invalidate(userId: unknown): void;
  clear(): void;
  readonly size: number;
}

export interface LoginThrottleOptions {
  windowMs?: number;
  maxFailures?: number;
  now?: () => number;
}

export interface LoginThrottle {
  /** Seconds to wait, or 0 when the key is not blocked. */
  retryAfter(key: string): number;
  /** Records a failure, returns true when this one crossed the threshold. */
  fail(key: string): boolean;
  succeed(key: string): void;
  prune(): number;
  readonly size: number;
}

export function createRevocationStore(options?: { now?: () => number }): RevocationStore;
export function createAccountStateCache<TUserId = unknown>(
  options: AccountStateCacheOptions<TUserId>,
): AccountStateCache;
export function createLoginThrottle(options?: LoginThrottleOptions): LoginThrottle;
