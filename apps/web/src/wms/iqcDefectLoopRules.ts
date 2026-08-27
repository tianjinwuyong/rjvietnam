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
