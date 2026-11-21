export const WAREHOUSE_INVENTORY_EMPLOYEE_ID = 'WMS-INVENTORY-VIRTUAL-01';
export const WAREHOUSE_SAFETY_REPORT_RECIPIENTS = Object.freeze([
  'PURCHASING-VIRTUAL-01',
  'PMC-VIRTUAL-01',
  'OPS-SUPERVISOR-VIRTUAL-01',
]);

export function classifySafetyStock({ availableQty, minStockQty, safetyStockQty }) {
  const available = Number(availableQty || 0);
  const minimum = Number(minStockQty || 0);
  const safety = Math.max(minimum, Number(safetyStockQty || 0));
  if (available <= 0 && safety > 0) return 'P3';
  if (minimum > 0 && available <= minimum) return 'P3';
  if (safety > 0 && available <= safety) return 'P2';
  return 'P1';
}

export function safetyReportTaskKey(recipientId, bucket) {
  return `SAFETY_STOCK_REPORT:${bucket}:${String(recipientId).toUpperCase()}`;
}
