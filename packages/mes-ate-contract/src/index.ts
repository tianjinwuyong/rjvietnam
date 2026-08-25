export const CONTRACT_VERSION = "mes-ate.v1" as const;
export const SOURCES = ["mes", "ict", "fct", "ate"] as const;
export type Source = (typeof SOURCES)[number];
export type TestType = "ict" | "fct" | "ate";
export type Result = "pass" | "fail" | "blocked";

export type Envelope<T = unknown> = {
  contractVersion: typeof CONTRACT_VERSION;
  environment: "staging";
  correlationId: string;
  idempotencyKey: string;
  occurredAt: string;
  source: Source;
  schema: string;
  payload: T;
};

export type TestResult = {
  workOrderId: string;
  unitId: string;
  stationId: string;
  testType: TestType;
  programVersion: string;
  result: Result;
  measurements: Record<string, number>;
  operatorRef: string;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const iso = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/;

export function assertStagingEnvelope<T>(value: unknown): asserts value is Envelope<T> {
  if (!value || typeof value !== "object") throw new ContractError("SCHEMA_INVALID", "envelope must be an object");
  const e = value as Record<string, unknown>;
  if (e.contractVersion !== CONTRACT_VERSION) throw new ContractError("UNSUPPORTED_VERSION", "unsupported contract version");
  if (e.environment !== "staging") throw new ContractError("NON_STAGING_ENVIRONMENT", "staging environment is required");
  if (typeof e.correlationId !== "string" || !uuid.test(e.correlationId)) throw new ContractError("SCHEMA_INVALID", "correlationId must be a UUID");
  if (typeof e.idempotencyKey !== "string" || !e.idempotencyKey.trim()) throw new ContractError("SCHEMA_INVALID", "idempotencyKey is required");
  if (typeof e.occurredAt !== "string" || !iso.test(e.occurredAt)) throw new ContractError("SCHEMA_INVALID", "occurredAt must be UTC RFC3339");
  if (!SOURCES.includes(e.source as Source) || typeof e.schema !== "string" || !e.schema) throw new ContractError("UNAUTHORIZED_SOURCE", "source/schema is not allow-listed");
}

export class ContractError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "ContractError"; }
}

export type CacheEntry<T> = { value: T; lastEventId: string; sourceVersion: number; updatedAt: string; staleAfter: string };
export class StagingCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  upsert(key: string, next: CacheEntry<T>): "updated" | "noop" {
    const prior = this.entries.get(key);
    if (prior && next.sourceVersion <= prior.sourceVersion) return "noop";
    this.entries.set(key, next); return "updated";
  }
  get(key: string) { return this.entries.get(key); }
  size() { return this.entries.size; }
}

export type RetryDecision = { retry: boolean; delayMs: number };
export function retryDecision(status: number, attempt: number, random = 0): RetryDecision {
  const retryable = status === 408 || status === 429 || status >= 500;
  if (!retryable || attempt >= 5) return { retry: false, delayMs: 0 };
  const base = 1000 * (2 ** attempt);
  return { retry: true, delayMs: Math.min(16000, base) + Math.floor(random * 250) };
}

export type DeadLetter = { envelope: Envelope; errorCode: string; attempts: number; correlationId: string };
export function toDeadLetter(envelope: Envelope, errorCode: string, attempts: number): DeadLetter {
  const sanitized = structuredClone(envelope) as Envelope<Record<string, unknown>>;
  const payload = sanitized.payload;
  if (payload && typeof payload === "object") {
    for (const key of Object.keys(payload)) if (/secret|token|password|credential/i.test(key)) delete payload[key];
  }
  return { envelope: sanitized, errorCode, attempts, correlationId: envelope.correlationId };
}

export function assertNoProductionTarget(target: { environment?: string; baseUrl?: string; databasePath?: string; filePath?: string }) {
  if (target.environment !== "staging") throw new ContractError("NON_STAGING_ENVIRONMENT", "production writes are forbidden");
  const joined = [target.baseUrl, target.databasePath, target.filePath].filter(Boolean).join(" ").toLowerCase();
  if (/prod|production|postgres|sqlite|\.xlsx?$/.test(joined)) throw new ContractError("PRODUCTION_TARGET", "production connector target is forbidden");
}
