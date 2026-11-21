import { describe, expect, it } from "vitest";
import {
  createAccountStateCache,
  createLoginThrottle,
  createRevocationStore,
} from "../services/api/src/auth/session-tokens";

/** A clock the test moves by hand: none of this logic should need a real sleep. */
function clock(start = 1_700_000_000_000) {
  let now = start;
  return {
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
  };
}

describe("revocation store", () => {
  it("keeps a revoked jti until its own expiry and then forgets it", () => {
    const c = clock();
    const store = createRevocationStore({ now: c.now });
    const exp = Math.floor(c.now() / 1000) + 60;

    expect(store.has("j1")).toBe(false);
    expect(store.add("j1", exp)).toBe(true);
    expect(store.has("j1")).toBe(true);

    c.advance(61_000);
    // The token is dead by `exp` anyway, so remembering it past that only grows
    // the set; `has` must report false and drop the row.
    expect(store.has("j1")).toBe(false);
    expect(store.size).toBe(0);
  });

  it("rejects entries that could never be checked", () => {
    const store = createRevocationStore();
    expect(store.add("", 123)).toBe(false);
    expect(store.add("j2", Number.NaN)).toBe(false);
    expect(store.size).toBe(0);
  });

  it("reports only live entries for persistence", () => {
    const c = clock();
    const store = createRevocationStore({ now: c.now });
    store.add("live", Math.floor(c.now() / 1000) + 60);
    store.add("dead", Math.floor(c.now() / 1000) - 1);

    expect(store.live()).toEqual([{ jti: "live", exp: Math.floor(c.now() / 1000) + 60 }]);
    expect(store.prune()).toBe(1);
  });
});

describe("account state cache", () => {
  it("answers from cache inside the TTL and re-reads after it", async () => {
    const c = clock();
    let calls = 0;
    const cache = createAccountStateCache({
      ttlMs: 60_000,
      now: c.now,
      lookup: async () => {
        calls += 1;
        return "active";
      },
    });

    expect(await cache.get(12)).toBe("active");
    expect(await cache.get(12)).toBe("active");
    expect(calls).toBe(1);

    c.advance(60_001);
    expect(await cache.get(12)).toBe("active");
    expect(calls).toBe(2);
  });

  it("caches a missing user as distinctly as an active one", async () => {
    // A deleted account must not be retried on every request, and must not be
    // confused with `active` (which is what a falsy check would do).
    const cache = createAccountStateCache({ lookup: async () => null });
    expect(await cache.get(99)).toBeNull();
    expect(await cache.get(99)).toBeNull();
    expect(cache.size).toBe(1);
  });

  it("invalidates one user without dropping the rest", async () => {
    const cache = createAccountStateCache({ lookup: async (id: number) => `status-${id}` });
    await cache.get(1);
    await cache.get(2);
    cache.invalidate(1);
    expect(cache.size).toBe(1);
  });
});

describe("login throttle", () => {
  it("blocks a key after maxFailures and reports the wait", () => {
    const c = clock();
    const throttle = createLoginThrottle({ windowMs: 900_000, maxFailures: 5, now: c.now });

    for (let i = 0; i < 4; i += 1) {
      expect(throttle.fail("ip:1")).toBe(false);
      expect(throttle.retryAfter("ip:1")).toBe(0);
    }
    expect(throttle.fail("ip:1")).toBe(true);
    expect(throttle.retryAfter("ip:1")).toBe(900);
  });

  it("frees the key when the window passes", () => {
    const c = clock();
    const throttle = createLoginThrottle({ windowMs: 900_000, maxFailures: 2, now: c.now });
    throttle.fail("ip:1");
    throttle.fail("ip:1");
    expect(throttle.retryAfter("ip:1")).toBeGreaterThan(0);

    c.advance(900_001);
    expect(throttle.retryAfter("ip:1")).toBe(0);
    // A fresh window starts clean rather than carrying the old count.
    expect(throttle.fail("ip:1")).toBe(false);
  });

  it("clears the key on a successful login", () => {
    const throttle = createLoginThrottle({ maxFailures: 2 });
    throttle.fail("user:admin");
    throttle.fail("user:admin");
    expect(throttle.retryAfter("user:admin")).toBeGreaterThan(0);

    throttle.succeed("user:admin");
    expect(throttle.retryAfter("user:admin")).toBe(0);
  });

  it("does not let one key's failures block another", () => {
    const throttle = createLoginThrottle({ maxFailures: 1 });
    throttle.fail("ip:1");
    expect(throttle.retryAfter("ip:1")).toBeGreaterThan(0);
    expect(throttle.retryAfter("ip:2")).toBe(0);
    expect(throttle.retryAfter("user:admin")).toBe(0);
  });
});
