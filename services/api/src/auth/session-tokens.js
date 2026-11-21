// Session-token state that has to outlive a single request: the revoked-jti set,
// the per-account status cache and the login throttle.
//
// These are pure state machines with an injected clock so they can be tested
// without a database, a token or a sleep. `services/api/server.js` owns the
// PostgreSQL side and the HTTP shapes.

/**
 * Revoked token ids, keyed by `jti`.
 *
 * `exp` is the token's own expiry in epoch seconds, which is also when the entry
 * stops mattering: a revoked token that has expired is already dead by `exp`, so
 * keeping the entry would only grow the set forever.
 */
export function createRevocationStore({ now = Date.now } = {}) {
  const entries = new Map();
  const isExpired = (expSeconds) => expSeconds * 1000 <= now();

  return {
    add(jti, expSeconds) {
      if (!jti || !Number.isFinite(Number(expSeconds))) return false;
      entries.set(String(jti), Number(expSeconds));
      return true;
    },
    has(jti) {
      if (!jti) return false;
      const exp = entries.get(String(jti));
      if (exp === undefined) return false;
      if (isExpired(exp)) {
        entries.delete(String(jti));
        return false;
      }
      return true;
    },
    prune() {
      for (const [jti, exp] of entries) if (isExpired(exp)) entries.delete(jti);
      return entries.size;
    },
    /** Live entries only, for persisting what a restart has to remember. */
    live() {
      const out = [];
      for (const [jti, exp] of entries) if (!isExpired(exp)) out.push({ jti, exp });
      return out;
    },
    get size() {
      return entries.size;
    },
  };
}

/**
 * Per-user account status with a TTL, because the JWT gate runs on every request
 * and the alternative is a `SELECT status FROM users` on all ~1.5k routes.
 *
 * A `null` status means the user row is gone -- distinct from `active`, and both
 * are cached: re-creating a deleted user takes far longer than one TTL.
 *
 * @param {{ ttlMs?: number, now?: () => number, lookup: (userId: any) => Promise<string | null> }} options
 */
export function createAccountStateCache({ ttlMs = 60_000, lookup, now = Date.now }) {
  if (typeof lookup !== "function") throw new TypeError("createAccountStateCache requires lookup(userId)");

  const entries = new Map();
  return {
    async get(userId) {
      const key = String(userId);
      const cached = entries.get(key);
      if (cached && now() - cached.at < ttlMs) return cached.status;
      const status = await lookup(userId);
      entries.set(key, { status, at: now() });
      return status;
    },
    invalidate(userId) {
      entries.delete(String(userId));
    },
    clear() {
      entries.clear();
    },
    get size() {
      return entries.size;
    },
  };
}

/**
 * Failed-login throttle: N failures inside a window block that key for the whole
 * window. A successful login clears the key, so one fat-fingered operator does
 * not lock the next person on the same station tablet.
 */
export function createLoginThrottle({ windowMs = 15 * 60_000, maxFailures = 5, now = Date.now } = {}) {
  const buckets = new Map();

  const read = (key) => {
    const bucket = buckets.get(key);
    if (!bucket) return null;
    if (bucket.blockedUntil > 0) {
      if (bucket.blockedUntil > now()) return bucket;
      buckets.delete(key);
      return null;
    }
    if (now() - bucket.firstAt >= windowMs) {
      buckets.delete(key);
      return null;
    }
    return bucket;
  };

  return {
    /** Seconds to wait, or 0 when the key is not blocked. */
    retryAfter(key) {
      const bucket = read(key);
      if (!bucket || bucket.blockedUntil <= 0) return 0;
      return Math.max(1, Math.ceil((bucket.blockedUntil - now()) / 1000));
    },
    fail(key) {
      const bucket = read(key) ?? { count: 0, firstAt: now(), blockedUntil: 0 };
      bucket.count += 1;
      if (bucket.count >= maxFailures) {
        bucket.blockedUntil = now() + windowMs;
      }
      buckets.set(key, bucket);
      return bucket.blockedUntil > 0;
    },
    succeed(key) {
      buckets.delete(key);
    },
    prune() {
      for (const key of [...buckets.keys()]) read(key);
      return buckets.size;
    },
    get size() {
      return buckets.size;
    },
  };
}
