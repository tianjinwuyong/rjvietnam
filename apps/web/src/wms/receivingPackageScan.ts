export type ReceivingDraftIdentity = {
  materialCode: string;
  lotNo: string;
  purchaseOrder: string;
  supplier: string;
};

export type ReceivingPackageScan = {
  material_code?: unknown;
  lot_no?: unknown;
  poNo?: unknown;
  supplierCode?: unknown;
  supplier_code?: unknown;
};

const value = (input: unknown) => String(input ?? "").trim();

/** Use the scanned supplier label immediately; React state updates are asynchronous. */
export function resolveReceivingPackageIdentity(
  current: ReceivingDraftIdentity,
  scan: ReceivingPackageScan | null,
): ReceivingDraftIdentity {
  if (!scan) return current;
  return {
    materialCode: value(scan.material_code) || current.materialCode,
    lotNo: value(scan.lot_no) || current.lotNo,
    purchaseOrder: value(scan.poNo) || current.purchaseOrder,
    supplier: value(scan.supplierCode) || value(scan.supplier_code) || current.supplier,
  };
}
