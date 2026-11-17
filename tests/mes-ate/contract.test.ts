import { describe, expect, it } from "vitest";
import { assertNoProductionTarget, assertStagingEnvelope, ContractError, retryDecision, StagingCache, toDeadLetter } from "../../packages/mes-ate-contract/src/index";

const envelope = (overrides = {}) => ({ contractVersion: "mes-ate.v1", environment: "staging", correlationId: "11111111-1111-4111-8111-111111111111", idempotencyKey: "STG-wo-1-test-1", occurredAt: "2026-08-25T06:00:00Z", source: "ict", schema: "test.completed", payload: { unitId: "STG-UNIT-1", token: "redact-me" }, ...overrides });

describe("MES/ICT/FCT/ATE staging contract", () => {
  it.each(["mes", "ict", "fct", "ate"])("accepts source %s", source => expect(() => assertStagingEnvelope({ ...envelope(), source })).not.toThrow());
  it("rejects production and malformed envelopes", () => {
    expect(() => assertStagingEnvelope(envelope({ environment: "production" }))).toThrowError(ContractError);
    expect(() => assertStagingEnvelope(envelope({ source: "unknown" }))).toThrowError(ContractError);
  });
  it("rejects whitespace-only idempotency keys", () => {
    expect(() => assertStagingEnvelope(envelope({ idempotencyKey: "   " }))).toThrowError(ContractError);
  });
  it("upserts only newer cache versions and suppresses duplicates/out-of-order events", () => {
    const cache = new StagingCache<{ state: string }>();
    const entry = (version: number) => ({ value: { state: "started" }, lastEventId: `STG-E-${version}`, sourceVersion: version, updatedAt: "2026-08-25T06:00:00Z", staleAfter: "2026-08-25T07:00:00Z" });
    expect(cache.upsert("staging:unit:STG-UNIT-1", entry(2))).toBe("updated");
    expect(cache.upsert("staging:unit:STG-UNIT-1", entry(2))).toBe("noop");
    expect(cache.upsert("staging:unit:STG-UNIT-1", entry(1))).toBe("noop");
    expect(cache.size()).toBe(1);
  });
  it("retries transport/server failures only, max five attempts", () => {
    expect(retryDecision(503, 0).retry).toBe(true);
    expect(retryDecision(429, 4).retry).toBe(true);
    expect(retryDecision(400, 0).retry).toBe(false);
    expect(retryDecision(503, 5).retry).toBe(false);
  });
  it("creates redacted dead letters and blocks production writes", () => {
    const dlq = toDeadLetter(envelope(), "TIMEOUT", 5);
    expect(dlq.envelope.payload).toEqual({ unitId: "STG-UNIT-1" });
    expect(() => assertNoProductionTarget({ environment: "production", baseUrl: "https://mes.example" })).toThrow();
    expect(() => assertNoProductionTarget({ environment: "staging", databasePath: "C:/prod/data.db" })).toThrow();
    expect(() => assertNoProductionTarget({ environment: "staging", baseUrl: "http://127.0.0.1:4100" })).not.toThrow();
  });
});
