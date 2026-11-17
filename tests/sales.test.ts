import { describe, expect, it } from "vitest";
import {
  calculateFulfilledPercent,
  calculateQuoteTotal,
  canConvertQuoteToSo,
  canLinkSoToWorkOrder,
  isQuoteExpiringSoon,
} from "../packages/business-rules/src/sales";

describe("sales — calculateQuoteTotal", () => {
  it("sums qty × unitPrice across lines", () => {
    expect(calculateQuoteTotal([
      { productCode: "P1", qty: 10, unitPrice: 25 },
      { productCode: "P2", qty: 4, unitPrice: 12.5 },
    ])).toBe(300); // 250 + 50
  });

  it("returns 0 on empty lines", () => {
    expect(calculateQuoteTotal([])).toBe(0);
  });

  it("ignores NaN quantities gracefully", () => {
    expect(calculateQuoteTotal([
      { productCode: "P1", qty: 5, unitPrice: 10 },
      { productCode: "P2", qty: Number.NaN, unitPrice: 99 },
    ])).toBe(50);
  });
});

describe("sales — isQuoteExpiringSoon", () => {
  const today = "2026-06-19";
  it("returns true when validUntil is within window", () => {
    expect(isQuoteExpiringSoon("2026-06-22", today, 7)).toBe(true);   // 3 days
    expect(isQuoteExpiringSoon("2026-06-26", today, 7)).toBe(true);   // 7 days
  });
  it("returns false when more than window days away", () => {
    expect(isQuoteExpiringSoon("2026-07-01", today, 7)).toBe(false);  // 12 days
  });
  it("returns false when already expired", () => {
    expect(isQuoteExpiringSoon("2026-06-15", today, 7)).toBe(false);  // -4 days
  });
});

describe("sales — canConvertQuoteToSo", () => {
  it("accepts a valid draft quote with positive lines", () => {
    const r = canConvertQuoteToSo({
      status: "draft",
      lines: [{ productCode: "P1", qty: 10, unitPrice: 5 }],
    });
    expect(r.ok).toBe(true);
  });

  it("rejects empty quote", () => {
    expect(canConvertQuoteToSo({ status: "draft", lines: [] }).ok).toBe(false);
  });

  it("rejects non-positive qty", () => {
    expect(canConvertQuoteToSo({
      status: "draft",
      lines: [{ productCode: "P1", qty: 0, unitPrice: 5 }],
    }).ok).toBe(false);
  });

  it("rejects negative unit price", () => {
    expect(canConvertQuoteToSo({
      status: "draft",
      lines: [{ productCode: "P1", qty: 5, unitPrice: -1 }],
    }).ok).toBe(false);
  });

  it("rejects rejected/expired quotes", () => {
    expect(canConvertQuoteToSo({ status: "rejected", lines: [{ productCode: "P", qty: 1, unitPrice: 1 }] }).ok).toBe(false);
    expect(canConvertQuoteToSo({ status: "expired", lines: [{ productCode: "P", qty: 1, unitPrice: 1 }] }).ok).toBe(false);
  });

  it("accepts accepted and sent quotes", () => {
    expect(canConvertQuoteToSo({ status: "accepted", lines: [{ productCode: "P", qty: 1, unitPrice: 1 }] }).ok).toBe(true);
    expect(canConvertQuoteToSo({ status: "sent", lines: [{ productCode: "P", qty: 1, unitPrice: 1 }] }).ok).toBe(true);
  });
});

describe("sales — canLinkSoToWorkOrder", () => {
  it("accepts a valid link", () => {
    expect(canLinkSoToWorkOrder(
      { qty: 100, fulfilledQty: 30, plannedDelivery: "2026-07-01" },
      { status: "released" },
    ).ok).toBe(true);
  });

  it("rejects if fulfilled > qty", () => {
    expect(canLinkSoToWorkOrder(
      { qty: 100, fulfilledQty: 150, plannedDelivery: "2026-07-01" },
      { status: "running" },
    ).ok).toBe(false);
  });

  it("rejects closed/voided work orders", () => {
    expect(canLinkSoToWorkOrder(
      { qty: 100, fulfilledQty: 50, plannedDelivery: "2026-07-01" },
      { status: "closed" },
    ).ok).toBe(false);
  });

  it("rejects bad date", () => {
    expect(canLinkSoToWorkOrder(
      { qty: 100, fulfilledQty: 50, plannedDelivery: "not-a-date" },
      { status: "running" },
    ).ok).toBe(false);
  });
});

describe("sales — calculateFulfilledPercent", () => {
  it("computes percentage and clamps to [0, 100]", () => {
    expect(calculateFulfilledPercent(100, 25)).toBe(25);
    expect(calculateFulfilledPercent(100, 100)).toBe(100);
    expect(calculateFulfilledPercent(100, 200)).toBe(100); // clamped
    expect(calculateFulfilledPercent(100, 0)).toBe(0);
  });

  it("returns 0 for invalid total", () => {
    expect(calculateFulfilledPercent(0, 5)).toBe(0);
    expect(calculateFulfilledPercent(-1, 5)).toBe(0);
    expect(calculateFulfilledPercent(Number.NaN, 5)).toBe(0);
  });
});