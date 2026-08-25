import type { PdaAction, PdaActionResult, PdaContext, PdaPlugin } from "../contracts";

export interface ScannerPolicy {
  normalize?: (raw: string) => string;
  pattern?: RegExp;
  duplicateWindowMs?: number;
  now?: () => number;
  duplicateCheck?: (request: { normalizedValue: string; context: Readonly<PdaContext>; traceId: string }) => Promise<boolean>;
  ngCheck?: (request: { normalizedValue: string; context: Readonly<PdaContext>; traceId: string }) => Promise<{ blocked: boolean; code?: string; data?: unknown }>;
}

export function createScannerPlugin(policy: ScannerPolicy = {}): PdaPlugin {
  const recent = new Map<string, number>();
  const pending = new Map<string, { rawValue: string; normalizedValue: string }>();
  const now = policy.now ?? Date.now;
  const duplicateWindowMs = policy.duplicateWindowMs ?? 800;
  const normalize = policy.normalize ?? normalizeInternationalScan;

  async function capture(action: PdaAction, context: Readonly<PdaContext>, rawValue: string): Promise<PdaActionResult> {
    const normalizedValue = normalize(rawValue);
    if (policy.pattern) policy.pattern.lastIndex = 0;
    if (!normalizedValue || (policy.pattern && !policy.pattern.test(normalizedValue))) {
      return { ok: false, decision: "REJECT", code: "INVALID_SCAN", messageKey: "pda.scanner.invalid", traceId: action.traceId! };
    }

    const timestamp = now();
    const previous = recent.get(normalizedValue);
    if (previous !== undefined && timestamp - previous < duplicateWindowMs) {
      return { ok: false, decision: "HOLD", code: "DUPLICATE_SCAN", messageKey: "pda.scanner.duplicate", data: { rawValue, normalizedValue, source: "local-window" }, traceId: action.traceId! };
    }

    try {
      if (policy.duplicateCheck && await policy.duplicateCheck({ normalizedValue, context, traceId: action.traceId! })) {
        return { ok: false, decision: "HOLD", code: "DUPLICATE_SCAN", messageKey: "pda.scanner.duplicate", data: { rawValue, normalizedValue, source: "mes" }, traceId: action.traceId! };
      }
      if (policy.ngCheck) {
        const ng = await policy.ngCheck({ normalizedValue, context, traceId: action.traceId! });
        if (ng.blocked) {
          return { ok: false, decision: "REJECT", code: ng.code ?? "NG_SCAN_BLOCKED", messageKey: "pda.scanner.ngBlocked", data: { rawValue, normalizedValue, ...asRecord(ng.data) }, traceId: action.traceId! };
        }
      }
    } catch {
      pending.set(normalizedValue, { rawValue, normalizedValue });
      return { ok: false, decision: "HOLD", code: "SCANNER_GATE_UNAVAILABLE", messageKey: "pda.scanner.gateUnavailable", retryable: true, data: { rawValue, normalizedValue }, traceId: action.traceId! };
    }

    recent.set(normalizedValue, timestamp);
    pending.delete(normalizedValue);
    return { ok: true, decision: "CAPTURED", code: "SCAN_CAPTURED", messageKey: "pda.scanner.captured", data: { rawValue, normalizedValue }, traceId: action.traceId! };
  }

  return {
    id: "scanner",
    version: "1.1.0",
    actions: ["scanner.scan", "scanner.recover"],
    async execute(action: PdaAction, context: Readonly<PdaContext>): Promise<PdaActionResult> {
      const payload = (action.payload ?? {}) as { rawValue?: unknown; normalizedValue?: unknown };
      if (action.type !== "scanner.scan" && action.type !== "scanner.recover") {
        return { ok: false, decision: "REJECT", code: "UNSUPPORTED_ACTION", messageKey: "pda.scanner.unsupportedAction", traceId: action.traceId! };
      }
      if (action.type === "scanner.recover") {
        const normalized = normalize(String(payload.normalizedValue ?? payload.rawValue ?? ""));
        const saved = pending.get(normalized);
        if (!saved) return { ok: false, decision: "HOLD", code: "NO_PENDING_SCAN", messageKey: "pda.scanner.noPending", retryable: false, traceId: action.traceId! };
        return capture(action, context, saved.rawValue);
      }
      const rawValue = typeof payload.rawValue === "string" ? payload.rawValue : String(payload.rawValue ?? "");
      return capture(action, context, rawValue);
    },
    health: () => ({ status: "healthy", details: { duplicateWindowMs, pendingRecovery: pending.size } }),
  };
}

/** Locale-safe scan normalization: keeps non-Latin identifiers while removing scanner framing noise. */
export function normalizeInternationalScan(value: string): string {
  return value.normalize("NFKC").replace(/[\u0000-\u001F\u007F\uFEFF]/g, "").trim().replace(/\s+/g, " ").toLocaleUpperCase("en-US");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}
