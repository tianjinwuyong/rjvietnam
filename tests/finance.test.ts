import { describe, expect, it } from "vitest";
import {
  buildArAging,
  calculateWorkOrderCost,
  computeInvoiceBalance,
  recordPayment,
  type FinanceInvoiceSummaryInput,
} from "../packages/business-rules/src/finance";

const today = "2026-06-19";

const sampleInvoice = (
  overrides: Partial<FinanceInvoiceSummaryInput> = {},
): FinanceInvoiceSummaryInput => ({
  invoiceId: "inv-001",
  partyCode: "CUST-001",
  invoiceNo: "AR-2026-001",
  totalAmount: 1000,
  paidAmount: 0,
  balanceAmount: 1000,
  currency: "USD",
  dueDate: "2026-07-01",
  status: "open",
  ...overrides,
});

describe("finance — computeInvoiceBalance", () => {
  it("returns paid status when fully paid", () => {
    expect(computeInvoiceBalance(1000, 1000, "2026-07-01", today)).toEqual({
      paid: 1000,
      balance: 0,
      status: "paid",
    });
  });

  it("returns partial status when partially paid", () => {
    expect(computeInvoiceBalance(1000, 400, "2026-07-01", today)).toEqual({
      paid: 400,
      balance: 600,
      status: "partial",
    });
  });

  it("returns voided when totalAmount is zero or negative", () => {
    expect(computeInvoiceBalance(0, 0, "2026-07-01", today)).toEqual({
      paid: 0,
      balance: 0,
      status: "voided",
    });
    expect(computeInvoiceBalance(-100, 0, "2026-07-01", today)).toEqual({
      paid: 0,
      balance: 0,
      status: "voided",
    });
  });

  it("returns overdue when dueDate is past and balance > 0", () => {
    expect(computeInvoiceBalance(1000, 0, "2026-05-01", today).status).toBe("overdue");
  });

  it("clamps paidAmount to [0, totalAmount]", () => {
    expect(computeInvoiceBalance(1000, 1500, "2026-07-01", today)).toEqual({
      paid: 1000,
      balance: 0,
      status: "paid",
    });
    expect(computeInvoiceBalance(1000, -50, "2026-07-01", today)).toEqual({
      paid: 0,
      balance: 1000,
      status: "open",
    });
  });
});

describe("finance — recordPayment", () => {
  it("applies a happy-path payment and updates status", () => {
    const inv = sampleInvoice();
    const updated = recordPayment(inv, { invoiceId: inv.invoiceId, amount: 400, currency: "USD", paidAt: today }, today);
    expect(updated.paidAmount).toBe(400);
    expect(updated.balanceAmount).toBe(600);
    expect(updated.status).toBe("partial");
    // input not mutated
    expect(inv.paidAmount).toBe(0);
    expect(inv.balanceAmount).toBe(1000);
  });

  it("throws on currency mismatch", () => {
    const inv = sampleInvoice();
    expect(() =>
      recordPayment(inv, { invoiceId: inv.invoiceId, amount: 100, currency: "VND", paidAt: today }),
    ).toThrow(/currency/);
  });

  it("throws when payment would overpay", () => {
    const inv = sampleInvoice({ paidAmount: 800, balanceAmount: 200 });
    expect(() =>
      recordPayment(inv, { invoiceId: inv.invoiceId, amount: 300, currency: "USD", paidAt: today }),
    ).toThrow(/exceeds/);
  });

  it("throws on non-positive amount", () => {
    const inv = sampleInvoice();
    expect(() =>
      recordPayment(inv, { invoiceId: inv.invoiceId, amount: 0, currency: "USD", paidAt: today }),
    ).toThrow(/greater than 0/);
  });

  it("fully settles invoice when payment equals balance", () => {
    const inv = sampleInvoice({ paidAmount: 700, balanceAmount: 300 });
    const updated = recordPayment(inv, { invoiceId: inv.invoiceId, amount: 300, currency: "USD", paidAt: today }, today);
    expect(updated.status).toBe("paid");
    expect(updated.balanceAmount).toBe(0);
  });
});

describe("finance — buildArAging", () => {
  it("buckets invoices across all 4 windows", () => {
    const invoices: FinanceInvoiceSummaryInput[] = [
      sampleInvoice({ invoiceId: "a", balanceAmount: 100, dueDate: "2026-06-25", status: "open" }),      // 6 days past → 0-30
      sampleInvoice({ invoiceId: "b", balanceAmount: 200, dueDate: "2026-05-10", status: "open" }),      // 40 days past → 31-60
      sampleInvoice({ invoiceId: "c", balanceAmount: 300, dueDate: "2026-04-01", status: "open" }),      // 79 days past → 61-90
      sampleInvoice({ invoiceId: "d", balanceAmount: 400, dueDate: "2026-01-01", status: "open" }),      // 169 days past → over_90
      sampleInvoice({ invoiceId: "e", balanceAmount: 500, dueDate: "2026-06-15", status: "paid" }),     // skipped
      sampleInvoice({ invoiceId: "f", balanceAmount: 600, dueDate: "2026-06-15", status: "voided" }),   // skipped
    ];
    expect(buildArAging(invoices, today)).toEqual({
      "0-30": 100,
      "31-60": 200,
      "61-90": 300,
      over_90: 400,
    });
  });

  it("returns all zeros on empty input", () => {
    expect(buildArAging([], today)).toEqual({ "0-30": 0, "31-60": 0, "61-90": 0, over_90: 0 });
  });

  it("places future-due invoices in the 0-30 bucket", () => {
    const invoices = [sampleInvoice({ balanceAmount: 999, dueDate: "2026-12-31", status: "open" })];
    expect(buildArAging(invoices, today)).toEqual({ "0-30": 999, "31-60": 0, "61-90": 0, over_90: 0 });
  });
});

describe("finance — calculateWorkOrderCost", () => {
  it("sums qty × unitCost across material lines", () => {
    const result = calculateWorkOrderCost([
      { qty: 10, unitCost: 2.5 },
      { qty: 4, unitCost: 12.3456 },
    ]);
    expect(result.materialCost).toBe(74.3824); // 25 + 49.3824
    expect(result.laborCost).toBe(0);
    expect(result.overheadCost).toBe(0);
    expect(result.totalCost).toBe(74.3824);
  });

  it("returns all zeros on empty material lines", () => {
    expect(calculateWorkOrderCost([])).toEqual({
      materialCost: 0,
      laborCost: 0,
      overheadCost: 0,
      totalCost: 0,
    });
  });

  it("ignores NaN values gracefully", () => {
    const result = calculateWorkOrderCost([
      { qty: 3, unitCost: 10 },
      { qty: Number.NaN, unitCost: 5 },
      { qty: 2, unitCost: Number.NaN },
    ]);
    expect(result.materialCost).toBe(30);
  });
});