// ── Finance MVP business rules ──────────────────────────────────────
// Pure functions operating on simple shapes (no DB, no Date.now).
// Pattern follows packages/business-rules/src/inventory.ts.

export type InvoiceStatus = "open" | "partial" | "paid" | "overdue" | "voided";

export type AgingBucket = "0-30" | "31-60" | "61-90" | "over_90";

export type FinanceInvoiceSummaryInput = {
  invoiceId: string;
  partyCode: string;
  invoiceNo: string;
  totalAmount: number;
  paidAmount: number;
  balanceAmount: number;
  currency: string;
  dueDate: string;       // ISO yyyy-mm-dd
  status: InvoiceStatus;
};

export type PaymentInput = {
  invoiceId: string;
  amount: number;
  currency: string;
  paidAt: string;
};

export type BalanceResult = {
  paid: number;
  balance: number;
  status: InvoiceStatus;
};

export type AgingResult = Record<AgingBucket, number>;

export type CostLine = { qty: number; unitCost: number };

export type CostBreakdown = {
  materialCost: number;
  laborCost: number;
  overheadCost: number;
  totalCost: number;
};

/**
 * Compute the paid/balance/status for an invoice.
 *
 * Rules:
 *  - voided if totalAmount <= 0
 *  - paid if balance <= 0 (with small epsilon for float drift)
 *  - partial if paid > 0 and balance > 0
 *  - overdue if dueDate < asOfDate and balance > 0
 *  - else open
 */
export function computeInvoiceBalance(
  totalAmount: number,
  paidAmount: number,
  dueDate: string,
  asOfDate?: string,
): BalanceResult {
  if (totalAmount <= 0) {
    return { paid: 0, balance: 0, status: "voided" };
  }
  const paid = Math.max(0, Math.min(paidAmount, totalAmount));
  const balance = Math.max(0, round4(totalAmount - paid));
  let status: InvoiceStatus;
  if (balance <= 0.0001) {
    status = "paid";
  } else if (paid > 0) {
    status = "partial";
  } else if (dueDate < (asOfDate ?? "9999-99-99")) {
    status = "overdue";
  } else {
    status = "open";
  }
  return { paid: round4(paid), balance, status };
}

/**
 * Apply a payment to an invoice, returning a NEW invoice object (input is not mutated).
 *
 * Throws:
 *  - if payment.amount <= 0
 *  - if payment.currency !== invoice.currency
 *  - if payment.amount > invoice.balanceAmount (would overpay)
 */
export function recordPayment(
  invoice: FinanceInvoiceSummaryInput,
  payment: PaymentInput,
  asOfDate?: string,
): FinanceInvoiceSummaryInput {
  if (payment.amount <= 0) {
    throw new Error("payment amount must be greater than 0");
  }
  if (payment.currency !== invoice.currency) {
    throw new Error(
      `payment currency ${payment.currency} does not match invoice currency ${invoice.currency}`,
    );
  }
  if (payment.amount > invoice.balanceAmount + 0.0001) {
    throw new Error(
      `payment amount ${payment.amount} exceeds remaining balance ${invoice.balanceAmount}`,
    );
  }
  const newPaid = round4(invoice.paidAmount + payment.amount);
  const result = computeInvoiceBalance(
    invoice.totalAmount,
    newPaid,
    invoice.dueDate,
    asOfDate,
  );
  return {
    ...invoice,
    paidAmount: result.paid,
    balanceAmount: result.balance,
    status: result.status,
  };
}

/**
 * Bucket outstanding (non-paid) invoice balances into aging windows
 * relative to dueDate, using asOfDate as today.
 *
 * Negative daysPastDue (not yet due) goes to "0-30".
 */
export function buildArAging(
  invoices: FinanceInvoiceSummaryInput[],
  asOfDate: string,
): AgingResult {
  const buckets: AgingResult = { "0-30": 0, "31-60": 0, "61-90": 0, over_90: 0 };
  for (const inv of invoices) {
    if (inv.status === "paid" || inv.status === "voided") continue;
    const daysPast = daysBetween(inv.dueDate, asOfDate);
    if (daysPast <= 30) buckets["0-30"] += inv.balanceAmount;
    else if (daysPast <= 60) buckets["31-60"] += inv.balanceAmount;
    else if (daysPast <= 90) buckets["61-90"] += inv.balanceAmount;
    else buckets.over_90 += inv.balanceAmount;
  }
  return {
    "0-30": round4(buckets["0-30"]),
    "31-60": round4(buckets["31-60"]),
    "61-90": round4(buckets["61-90"]),
    over_90: round4(buckets.over_90),
  };
}

/**
 * MVP work order cost: material cost is the sum of (qty * unitCost).
 * Labor and overhead are not yet modelled.
 */
export function calculateWorkOrderCost(materialLines: CostLine[]): CostBreakdown {
  const materialCost = materialLines.reduce(
    (sum, l) => sum + (Number.isFinite(l.qty) ? l.qty : 0) * (Number.isFinite(l.unitCost) ? l.unitCost : 0),
    0,
  );
  const laborCost = 0;
  const overheadCost = 0;
  return {
    materialCost: round4(materialCost),
    laborCost: round4(laborCost),
    overheadCost: round4(overheadCost),
    totalCost: round4(materialCost + laborCost + overheadCost),
  };
}

// ── helpers ──────────────────────────────────────────────────────────

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso + "T00:00:00Z");
  const to = Date.parse(toIso + "T00:00:00Z");
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.floor((to - from) / (1000 * 60 * 60 * 24));
}