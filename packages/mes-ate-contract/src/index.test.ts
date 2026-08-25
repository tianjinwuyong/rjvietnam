import { describe, expect, it } from "vitest";
import { assertNoProductionTarget, assertStagingEnvelope, ContractError, retryDecision, StagingCache } from "./index";

const envelope = {
  contractVersion: "mes-ate.v1" as const,
  environment: "staging" as const,
  correlationId: "123e4567-e89b-12d3-a456-426614174000",
  idempotencyKey: "idem-staging-001",
  occurredAt: "2026-08-25T00:00:00Z",
  source: "ict" as const,
  schema: "ict.result.v1",
  payload: { unitId: "UNIT-STAGING-001" },
};

describe("MES/ATE staging contract", () => {
  it("accepts a valid staging envelope and rejects production environments", () => {
    expect(() => assertStagingEnvelope(envelope)).not.toThrow();
    expect(() => assertStagingEnvelope({ ...envelope, environment: "production" })).toThrowError(ContractError);
    expect(() => assertNoProductionTarget({ environment: "staging", baseUrl: "https://mes-staging.local" })).not.toThrow();
    expect(() => assertNoProductionTarget({ environment: "production" })).toThrowError("production writes are forbidden");
  });

  it("deduplicates stale cache events and caps retry backoff", () => {
    const cache = new StagingCache<string>();
    const entry = { value: "PASS", lastEventId: "evt-1", sourceVersion: 2, updatedAt: envelope.occurredAt, staleAfter: "2026-08-25T01:00:00Z" };
    expect(cache.upsert("UNIT-STAGING-001", entry)).toBe("updated");
    expect(cache.upsert("UNIT-STAGING-001", { ...entry, sourceVersion: 1 })).toBe("noop");
    expect(retryDecision(503, 4, 0)).toEqual({ retry: true, delayMs: 16000 });
    expect(retryDecision(400, 0)).toEqual({ retry: false, delayMs: 0 });
  });
});
