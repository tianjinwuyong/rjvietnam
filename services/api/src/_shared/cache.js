/**
 * Simple in-memory TTL cache.
 * No external dependencies — uses a Map with expiry timestamps.
 * Thread-safe for single-process Node.js.
 *
 * Usage:
 *   import { TtlCache } from "./_shared/cache.js";
 *   const cache = new TtlCache(30_000); // 30s TTL
 *   cache.set("key", data);
 *   const val = cache.get("key"); // undefined if expired or missing
 */

export class TtlCache {
  /**
   * @param {number} ttlMs — default TTL in milliseconds per entry
   * @param {number} maxSize — max entries before LRU eviction (default 1000)
   */
  constructor(ttlMs = 30_000, maxSize = 1000) {
    this._ttl = ttlMs;
    this._max = maxSize;
    this._store = new Map(); // key → { value, expiresAt }
  }

  /** Get a value, returns undefined if missing or expired */
  get(key) {
    const entry = this._store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this._store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /** Set a value with optional custom TTL */
  set(key, value, ttlMs = this._ttl) {
    // Evict oldest if at capacity
    if (this._store.size >= this._max) {
      const oldest = this._store.keys().next().value;
      this._store.delete(oldest);
    }
    this._store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  /** Delete a key */
  delete(key) {
    this._store.delete(key);
  }

  /** Clear all entries */
  clear() {
    this._store.clear();
  }

  /** Number of live (non-expired) entries */
  get size() {
    let live = 0;
    const now = Date.now();
    for (const entry of this._store.values()) {
      if (now <= entry.expiresAt) live++;
    }
    return live;
  }
}
