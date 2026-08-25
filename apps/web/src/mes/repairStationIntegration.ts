export type RepairStationCommandType =
  | "REPAIR_STARTED"
  | "MATERIAL_USAGE_RECORDED"
  | "QMS_EVIDENCE_ATTACHED"
  | "RETEST_REQUESTED";

export interface RepairStationContext {
  mes: { available: boolean; workOrder?: Record<string, unknown> | null; events?: unknown[] };
  wms: { available: boolean; lots: Array<Record<string, unknown>> };
  qms: { available: boolean; case?: Record<string, unknown> | null; evidence?: unknown[] };
}

export interface RepairStationCommand {
  eventId: string;
  authority: "MES";
  type: RepairStationCommandType;
  stationCode: string;
  sn: string;
  workOrderNo?: string;
  operator: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

export function normalizeRepairStationContext(input: Partial<RepairStationContext> | null | undefined): RepairStationContext {
  return {
    mes: {
      available: Boolean(input?.mes?.available),
      workOrder: input?.mes?.workOrder ?? null,
      events: Array.isArray(input?.mes?.events) ? input.mes.events : [],
    },
    wms: {
      available: Boolean(input?.wms?.available),
      lots: Array.isArray(input?.wms?.lots) ? input.wms.lots : [],
    },
    qms: {
      available: Boolean(input?.qms?.available),
      case: input?.qms?.case ?? null,
      evidence: Array.isArray(input?.qms?.evidence) ? input.qms.evidence : [],
    },
  };
}

export function validateMaterialUsage(input: { materialCode?: string; lotNo?: string; quantity?: number }) {
  if (!input.materialCode?.trim()) return { valid: false as const, error: "material code is required" };
  if (!input.lotNo?.trim()) return { valid: false as const, error: "material lot is required" };
  if (!Number.isFinite(input.quantity) || Number(input.quantity) <= 0) {
    return { valid: false as const, error: "quantity must be greater than zero" };
  }
  return { valid: true as const };
}

export function buildRepairStationCommand(input: Omit<RepairStationCommand, "eventId" | "authority" | "occurredAt">): RepairStationCommand {
  const stationCode = input.stationCode.trim();
  const sn = input.sn.trim();
  const operator = input.operator.trim();
  if (!stationCode || !sn || !operator) throw new Error("stationCode, sn and operator are required");
  return {
    ...input,
    eventId: `repair-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    authority: "MES",
    occurredAt: new Date().toISOString(),
    stationCode,
    sn,
    operator,
  };
}
