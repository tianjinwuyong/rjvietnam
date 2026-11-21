export const QR_SOURCE_TYPES = ["PO_RECEIPT", "LINE_RETURN", "REWORK_RETURN", "SUBCONTRACT_RETURN"] as const;
export type QrSourceType = (typeof QR_SOURCE_TYPES)[number];

export function isQrSourceType(value: string): value is QrSourceType {
  return (QR_SOURCE_TYPES as readonly string[]).includes(value);
}

export function nextAfterIqc(result: "PASS" | "FAIL") {
  return result === "PASS" ? "FINISHED_GOODS" : "DEFECT_WAREHOUSE";
}

export function nextAfterMrb(decision: "REWORK" | "SCRAP" | "VENDOR_RETURN") {
  return decision === "REWORK" ? "QR_RECEIVING" : decision === "SCRAP" ? "SCRAP" : "SUPPLIER_RETURN";
}

export type InspectionLevel = "NORMAL" | "TIGHTENED" | "REDUCED" | "EXEMPT" | "SUSPENDED";
export type InspectionResult = "PASS" | "FAIL";
export type InspectionLevelCounters = {
  normalWindowBatches: number;
  normalWindowRejects: number;
  normalConsecutiveAccepts: number;
  tightenedAccepts: number;
  tightenedRejects: number;
  reducedAccepts: number;
};

export const INITIAL_INSPECTION_LEVEL_COUNTERS: InspectionLevelCounters = {
  normalWindowBatches: 0, normalWindowRejects: 0, normalConsecutiveAccepts: 0, tightenedAccepts: 0,
  tightenedRejects: 0, reducedAccepts: 0,
};

export type InspectionLevelEvent =
  | { type: "RESULT"; result: InspectionResult }
  | { type: "SUPPLIER_IMPROVEMENT_CONFIRMED" }
  | { type: "ABNORMAL_RETURN_TO_NORMAL" }
  | { type: "EXEMPT_APPROVED" };

export type InspectionLevelTransition = {
  level: InspectionLevel;
  counters: InspectionLevelCounters;
  transition: string | null;
  manual: boolean;
};

export function advanceInspectionLevel(
  level: InspectionLevel,
  counters: InspectionLevelCounters = INITIAL_INSPECTION_LEVEL_COUNTERS,
  event: InspectionLevelEvent,
): InspectionLevelTransition {
  const next = { ...counters };
  if (event.type === "SUPPLIER_IMPROVEMENT_CONFIRMED") {
    if (level !== "SUSPENDED") return { level, counters: next, transition: null, manual: true };
    return { level: "TIGHTENED", counters: { ...INITIAL_INSPECTION_LEVEL_COUNTERS }, transition: "SUSPENDED_TO_TIGHTENED", manual: true };
  }
  if (event.type === "ABNORMAL_RETURN_TO_NORMAL") {
    if (level !== "REDUCED" && level !== "EXEMPT") return { level, counters: next, transition: null, manual: true };
    return { level: "NORMAL", counters: { ...INITIAL_INSPECTION_LEVEL_COUNTERS }, transition: `${level}_TO_NORMAL_ABNORMAL`, manual: true };
  }
  if (event.type === "EXEMPT_APPROVED") {
    if (level !== "REDUCED" || next.reducedAccepts < 10) return { level, counters: next, transition: null, manual: true };
    return { level: "EXEMPT", counters: { ...INITIAL_INSPECTION_LEVEL_COUNTERS }, transition: "REDUCED_TO_EXEMPT", manual: true };
  }

  if (level === "NORMAL") {
    next.normalWindowBatches += 1;
    if (event.result === "FAIL") { next.normalWindowRejects += 1; next.normalConsecutiveAccepts = 0; }
    else next.normalConsecutiveAccepts += 1;
    if (next.normalWindowRejects >= 2) {
      return { level: "TIGHTENED", counters: { ...INITIAL_INSPECTION_LEVEL_COUNTERS }, transition: "NORMAL_TO_TIGHTENED", manual: false };
    }
    if (event.result === "PASS" && next.normalConsecutiveAccepts >= 10) {
      return { level: "REDUCED", counters: { ...INITIAL_INSPECTION_LEVEL_COUNTERS }, transition: "NORMAL_TO_REDUCED", manual: false };
    }
    if (next.normalWindowBatches >= 5) { next.normalWindowBatches = 0; next.normalWindowRejects = 0; }
    return { level, counters: next, transition: null, manual: false };
  }
  if (level === "TIGHTENED") {
    if (event.result === "PASS") next.tightenedAccepts += 1;
    else { next.tightenedAccepts = 0; next.tightenedRejects += 1; }
    if (next.tightenedRejects >= 5) return { level: "SUSPENDED", counters: { ...INITIAL_INSPECTION_LEVEL_COUNTERS }, transition: "TIGHTENED_TO_SUSPENDED", manual: false };
    if (next.tightenedAccepts >= 5) return { level: "NORMAL", counters: { ...INITIAL_INSPECTION_LEVEL_COUNTERS }, transition: "TIGHTENED_TO_NORMAL", manual: false };
    return { level, counters: next, transition: null, manual: false };
  }
  if (level === "REDUCED") {
    if (event.result === "FAIL") return { level: "NORMAL", counters: { ...INITIAL_INSPECTION_LEVEL_COUNTERS }, transition: "REDUCED_TO_NORMAL_REJECT", manual: false };
    next.reducedAccepts += 1;
    return { level, counters: next, transition: null, manual: false };
  }
  return { level, counters: next, transition: null, manual: false };
}
