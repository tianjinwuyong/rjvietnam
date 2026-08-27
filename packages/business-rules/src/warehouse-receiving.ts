import type { InventoryAction, IqcStatus } from "../../shared-types/src/factory";

export type ReceivingQcDecision = "PENDING" | "HOLD" | "PASS" | "FAIL";

export interface InboundReceivingDraft {
  scanValue: string;
  materialCode: string;
  lotNo: string;
  quantity: number;
  unit?: string;
  supplierCode?: string;
  qcDecision: ReceivingQcDecision;
  locationCode?: string;
  operator: string;
}

export interface ReceivingValidationResult {
  ok: boolean;
  errors: string[];
}

/** Shared boundary validation for browser PDA, scanner terminal and API workers. */
export function validateInboundReceiving(draft: InboundReceivingDraft): ReceivingValidationResult {
  const errors: string[] = [];
  if (!draft.scanValue.trim()) errors.push("scanValue is required");
  if (!draft.materialCode.trim()) errors.push("materialCode is required");
  if (!draft.lotNo.trim()) errors.push("lotNo is required");
  if (!Number.isFinite(draft.quantity) || draft.quantity <= 0) errors.push("quantity must be greater than 0");
  if (!draft.operator.trim()) errors.push("operator is required");
  if (!["PENDING", "HOLD", "PASS", "FAIL"].includes(draft.qcDecision)) errors.push("qcDecision is invalid");
  if (draft.qcDecision === "PASS" && !draft.locationCode?.trim()) errors.push("PASS requires locationCode");
  return { ok: errors.length === 0, errors };
}

/** Derive the authoritative lot and ledger state from the receiving QC decision. */
export function receivingState(decision: ReceivingQcDecision): {
  iqcStatus: IqcStatus;
  inventoryAction: InventoryAction;
  canPutAway: boolean;
} {
  switch (decision) {
    case "PASS": return { iqcStatus: "released", inventoryAction: "IQC_RELEASE", canPutAway: true };
    case "FAIL": return { iqcStatus: "rejected", inventoryAction: "IQC_REJECT", canPutAway: false };
    case "HOLD": return { iqcStatus: "hold", inventoryAction: "IQC_HOLD", canPutAway: false };
    default: return { iqcStatus: "pending", inventoryAction: "RECEIVE", canPutAway: false };
  }
}

export function receivingActions(draft: InboundReceivingDraft): InventoryAction[] {
  const validation = validateInboundReceiving(draft);
  if (!validation.ok) return [];
  const state = receivingState(draft.qcDecision);
  return state.canPutAway ? ["RECEIVE", "IQC_RELEASE", "PUT_AWAY"] : state.inventoryAction === "RECEIVE" ? ["RECEIVE"] : ["RECEIVE", state.inventoryAction];
}
