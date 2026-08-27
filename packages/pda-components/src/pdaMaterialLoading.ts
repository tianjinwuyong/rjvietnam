export type PdaMaterialLoadInput = {
  operatorBadge?: unknown;
  materialSn?: unknown;
  lotNo?: unknown;
  materialCode?: unknown;
  qty?: unknown;
  sourceLocationCode?: unknown;
  destinationLocationCode?: unknown;
  workOrderCode?: unknown;
  machineCode?: unknown;
  channelCode?: unknown;
  feederCode?: unknown;
  slotNo?: unknown;
  idempotencyKey?: unknown;
};

export function normalizePdaMaterialLoad(input: PdaMaterialLoadInput) {
  const text = (value: unknown) => String(value ?? "").trim().toUpperCase();
  const qty = Number(input.qty);
  return {
    operatorBadge: text(input.operatorBadge), materialSn: text(input.materialSn), lotNo: text(input.lotNo),
    materialCode: text(input.materialCode), qty, sourceLocationCode: text(input.sourceLocationCode),
    destinationLocationCode: text(input.destinationLocationCode), workOrderCode: text(input.workOrderCode),
    machineCode: text(input.machineCode), channelCode: text(input.channelCode), feederCode: text(input.feederCode),
    slotNo: text(input.slotNo), idempotencyKey: text(input.idempotencyKey),
  };
}

export function validatePdaMaterialLoad(input: PdaMaterialLoadInput): string[] {
  const value = normalizePdaMaterialLoad(input);
  const errors: string[] = [];
  for (const field of ["operatorBadge", "materialSn", "workOrderCode", "machineCode", "channelCode", "feederCode", "slotNo", "sourceLocationCode", "destinationLocationCode", "idempotencyKey"] as const) {
    if (!value[field]) errors.push(`${field} required`);
  }
  if (!value.materialSn && !value.lotNo) errors.push("materialSn or lotNo required");
  if (!value.materialCode) errors.push("materialCode required");
  if (!Number.isFinite(value.qty) || value.qty <= 0) errors.push("qty must be a positive number");
  if (value.sourceLocationCode && value.destinationLocationCode && value.sourceLocationCode === value.destinationLocationCode) errors.push("source and destination locations must differ");
  return errors;
}
