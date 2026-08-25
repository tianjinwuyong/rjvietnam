// ── Sales MVP business rules ────────────────────────────────────────
// Pure functions over SalesQuote / SalesQuoteLine / SalesOrder shapes.
// Pattern follows packages/business-rules/src/finance.ts.

export type SalesQuoteLineInput = {
  productCode: string;
  qty: number;
  unitPrice: number;
};

export type SalesQuoteInput = {
  customerCode: string;
  validUntil: string;
  lines: SalesQuoteLineInput[];
};

export type ConvertResult = {
  ok: boolean;
  error?: string;
};

export function calculateQuoteTotal(lines: SalesQuoteLineInput[]): number {
  return round4(
    lines.reduce((sum, l) => {
      const q = Number.isFinite(l.qty) ? l.qty : 0;
      const p = Number.isFinite(l.unitPrice) ? l.unitPrice : 0;
      return sum + q * p;
    }, 0),
  );
}

export function isQuoteExpiringSoon(
  validUntil: string,
  asOfDate: string,
  daysAhead = 7,
): boolean {
  const due = Date.parse(validUntil + "T00:00:00Z");
  const ref = Date.parse(asOfDate + "T00:00:00Z");
  if (Number.isNaN(due) || Number.isNaN(ref)) return false;
  const diffDays = Math.floor((due - ref) / (1000 * 60 * 60 * 24));
  return diffDays >= 0 && diffDays <= daysAhead;
}

/**
 * Validate that a quote can be converted to a sales order.
 * Rules:
 *  - at least one line
 *  - all qtys > 0
 *  - all unit prices >= 0
 *  - quote not in 'rejected' or 'expired' state
 */
export function canConvertQuoteToSo(
  quote: { status: string; lines: SalesQuoteLineInput[] },
): ConvertResult {
  if (!quote.lines || quote.lines.length === 0) {
    return { ok: false, error: "quote has no lines" };
  }
  for (const [i, l] of quote.lines.entries()) {
    if (!Number.isFinite(l.qty) || l.qty <= 0) {
      return { ok: false, error: `line ${i + 1}: qty must be > 0` };
    }
    if (!Number.isFinite(l.unitPrice) || l.unitPrice < 0) {
      return { ok: false, error: `line ${i + 1}: unitPrice must be >= 0` };
    }
    if (!l.productCode || typeof l.productCode !== "string") {
      return { ok: false, error: `line ${i + 1}: missing productCode` };
    }
  }
  if (quote.status === "rejected" || quote.status === "expired") {
    return { ok: false, error: `cannot convert quote in state '${quote.status}'` };
  }
  return { ok: true };
}

/**
 * Validate that an SO line can be linked to a work order.
 * Rules:
 *  - fulfilledQty cannot exceed qty
 *  - plannedDelivery must be ISO date string
 */
export function canLinkSoToWorkOrder(
  orderLine: { qty: number; fulfilledQty: number; plannedDelivery: string },
  workOrder: { status: string },
): ConvertResult {
  if (orderLine.fulfilledQty > orderLine.qty) {
    return { ok: false, error: "fulfilledQty exceeds qty" };
  }
  if (Number.isNaN(Date.parse(orderLine.plannedDelivery + "T00:00:00Z"))) {
    return { ok: false, error: "plannedDelivery is not a valid date" };
  }
  if (workOrder.status === "closed" || workOrder.status === "voided") {
    return { ok: false, error: `cannot link to work order in state '${workOrder.status}'` };
  }
  return { ok: true };
}

export function calculateFulfilledPercent(
  totalQty: number,
  fulfilledQty: number,
): number {
  if (!Number.isFinite(totalQty) || totalQty <= 0) return 0;
  const pct = (fulfilledQty / totalQty) * 100;
  return Math.max(0, Math.min(100, round4(pct)));
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}