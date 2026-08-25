import type { PdaAction, PdaActionResult, PdaContext, PdaPlugin } from "../contracts";

export interface MaterialUsageFact {
  machineCode: string;
  channelCode: string;
  feederCode: string;
  materialCode: string;
  quantityUsed: number;
  unit: string;
  productIdentifier?: string;
  occurredAt: string;
}

export interface MaterialUsageMes {
  report(input: MaterialUsageFact & {
    processDomain: string;
    stationCode: string;
    deviceId: string;
    hostIp: string;
    operatorId: string;
    workOrderCode: string;
    idempotencyKey: string;
    traceId: string;
  }): Promise<{ usageEventId: string; code: string; remainingQuantity?: number }>;
}

export function createMaterialUsagePlugin(mes: MaterialUsageMes, requiredDomain = "manual-line"): PdaPlugin {
  return {
    id: "material-usage",
    version: "1.0.0",
    actions: ["material-usage.report"],
    async execute(action: PdaAction, context: Readonly<PdaContext>): Promise<PdaActionResult> {
      const fact = action.payload as Partial<MaterialUsageFact>;
      if (context.lineDomain !== requiredDomain) {
        return { ok: false, decision: "REJECT", code: "PROCESS_DOMAIN_MISMATCH", messageKey: "pda.usage.domainMismatch", data: { expected: requiredDomain, actual: context.lineDomain }, traceId: action.traceId! };
      }
      if (!context.operatorId || !context.workOrderCode || !action.idempotencyKey) {
        return { ok: false, decision: "HOLD", code: "USAGE_CONTEXT_INCOMPLETE", messageKey: "pda.usage.contextIncomplete", traceId: action.traceId! };
      }
      const quantityUsed = Number(fact.quantityUsed);
      if (!fact.machineCode || !fact.channelCode || !fact.feederCode || !fact.materialCode || !Number.isFinite(quantityUsed) || quantityUsed <= 0 || !fact.unit) {
        return { ok: false, decision: "REJECT", code: "INVALID_USAGE_FACT", messageKey: "pda.usage.invalid", traceId: action.traceId! };
      }
      try {
        const response = await mes.report({
          machineCode: fact.machineCode,
          channelCode: fact.channelCode,
          feederCode: fact.feederCode,
          materialCode: fact.materialCode,
          quantityUsed,
          unit: fact.unit,
          productIdentifier: fact.productIdentifier,
          occurredAt: fact.occurredAt ?? new Date().toISOString(),
          processDomain: context.lineDomain,
          stationCode: context.stationCode,
          deviceId: context.deviceId,
          hostIp: context.hostIp,
          operatorId: context.operatorId,
          workOrderCode: context.workOrderCode,
          idempotencyKey: action.idempotencyKey,
          traceId: action.traceId!,
        });
        return { ok: true, decision: "COMPLETED", code: response.code, messageKey: "pda.usage.reported", data: response, traceId: action.traceId! };
      } catch {
        return { ok: false, decision: "HOLD", code: "USAGE_REPORT_UNAVAILABLE", messageKey: "pda.usage.unavailable", retryable: true, traceId: action.traceId! };
      }
    },
    health: () => ({ status: "healthy", details: { requiredDomain } }),
  };
}
