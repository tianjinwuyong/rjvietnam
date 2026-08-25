export type InventoryAction =
  "RECEIVE" |
    "IQC_RELEASE" |
    "PUT_AWAY" |
    "RESERVE" |
    "PICK" |
    "ISSUE_TO_LINE" |
    "RETURN_FROM_LINE" |
    "SCRAP" |
    "ADJUST" |
    "TRANSFER" |        // Added: Internal location-to-location transfer
    "IQC_HOLD" |       // Added: For moving lot into hold status during IQC
    "MOVE_TO_QUARANTINE" | // Added: General movement to isolation/quarantine areas
    "VENDOR_RETURN";    // Added: Return to supplier for damage/expired material

export type InventoryTransactionDraft = {
  action: InventoryAction;
  materialLotId: string;
  quantity: number;
  fromLocationCode?: string;
  toLocationCode?: string;
  workOrderCode?: string;
  operator: string;
};

const VALID_INVENTORY_ACTIONS: readonly InventoryAction[] = [
  "RECEIVE", "IQC_RELEASE", "PUT_AWAY", "RESERVE", "PICK", "ISSUE_TO_LINE",
  "RETURN_FROM_LINE", "SCRAP", "ADJUST", "TRANSFER", "IQC_HOLD",
  "MOVE_TO_QUARANTINE", "VENDOR_RETURN",
];

export function validateInventoryTransaction(tx: InventoryTransactionDraft): string[] {
  const errors: string[] = [];

  if (!VALID_INVENTORY_ACTIONS.includes(tx.action)) errors.push("unsupported inventory action");
  if (!tx.materialLotId?.trim()) errors.push("materialLotId is required");
  if (!tx.operator?.trim()) errors.push("operator is required");
  if (!Number.isFinite(tx.quantity) || tx.quantity <= 0) errors.push("quantity must be greater than 0");
  if (["RESERVE", "PICK", "ISSUE_TO_LINE"].includes(tx.action) && !tx.workOrderCode?.trim()) {
    errors.push(`${tx.action} requires workOrderCode`);
  }
  if (tx.action === "PUT_AWAY" && !tx.toLocationCode?.trim()) {
    errors.push("PUT_AWAY requires toLocationCode");
  }
  if (tx.action === "TRANSFER") {
    if (!tx.fromLocationCode?.trim()) errors.push("TRANSFER requires fromLocationCode");
    if (!tx.toLocationCode?.trim()) errors.push("TRANSFER requires toLocationCode");
  }
  if (["IQC_HOLD", "MOVE_TO_QUARANTINE", "VENDOR_RETURN"].includes(tx.action) && !tx.toLocationCode?.trim()) {
    errors.push(`${tx.action} requires toLocationCode`);
  }

  return errors;
}
