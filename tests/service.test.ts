import { describe, expect, it } from "vitest";
import {
  averageResolutionHours,
  canCreateRmaFromComplaint,
  canLinkComplaintToQuality,
  computeSlaStatus,
  getSlaForPriority,
} from "../packages/business-rules/src/service";

describe("service — getSlaForPriority", () => {
  it("returns tight SLA for urgent", () => {
    expect(getSlaForPriority("urgent")).toEqual({ responseHours: 1, resolutionHours: 8 });
  });

  it("returns loose SLA for low", () => {
    expect(getSlaForPriority("low")).toEqual({ responseHours: 72, resolutionHours: 168 });
  });

  it("falls back to normal for unknown", () => {
    const sla = getSlaForPriority("nonsense" as unknown as "low");
    expect(sla.responseHours).toBe(24);
    expect(sla.resolutionHours).toBe(72);
  });
});

describe("service — computeSlaStatus", () => {
  const ticketOpened = "2026-06-19T08:00:00Z";
  it("returns ok when within response window", () => {
    const r = computeSlaStatus({ priority: "high", openedAt: ticketOpened }, "2026-06-19T10:00:00Z");
    expect(r).toBe("ok"); // 2h elapsed, high=4h response
  });

  it("returns breached when first response overdue", () => {
    const r = computeSlaStatus({ priority: "urgent", openedAt: ticketOpened }, "2026-06-19T15:00:00Z");
    expect(r).toBe("breached"); // 7h elapsed, urgent=1h response
  });

  it("returns ok after resolution", () => {
    const r = computeSlaStatus({
      priority: "low",
      openedAt: ticketOpened,
      resolvedAt: "2026-06-20T08:00:00Z",
    }, "2026-06-25T00:00:00Z");
    expect(r).toBe("ok");
  });

  it("returns warning when approaching resolution deadline", () => {
    // low priority = 168h resolution, 72h response. ~86% of 168h elapsed.
    // Provide firstResponseAt so the response-time check doesn't fire before resolution check.
    const opened = "2026-06-13T00:00:00Z";
    const r = computeSlaStatus(
      { priority: "low", openedAt: opened, firstResponseAt: "2026-06-13T01:00:00Z" },
      "2026-06-19T00:00:00Z",
      0.8,
    );
    expect(r).toBe("warning"); // 6 days = 144h = ~86% of 168h
  });

  it("returns breached at full resolution deadline", () => {
    const opened = "2026-06-12T00:00:00Z";
    const r = computeSlaStatus({ priority: "low", openedAt: opened, firstResponseAt: "2026-06-12T01:00:00Z" }, "2026-06-19T00:00:00Z");
    expect(r).toBe("breached");
  });
});

describe("service — canCreateRmaFromComplaint", () => {
  it("accepts complaint ticket", () => {
    expect(canCreateRmaFromComplaint({
      category: "complaint", customerCode: "CUST-001", status: "open",
    }).ok).toBe(true);
  });

  it("accepts quality_issue and defect_report", () => {
    expect(canCreateRmaFromComplaint({ category: "quality_issue", customerCode: "C", status: "in_progress" }).ok).toBe(true);
    expect(canCreateRmaFromComplaint({ category: "defect_report", customerCode: "C", status: "open" }).ok).toBe(true);
  });

  it("rejects non-complaint categories", () => {
    expect(canCreateRmaFromComplaint({ category: "billing", customerCode: "C", status: "open" }).ok).toBe(false);
  });

  it("rejects closed tickets", () => {
    expect(canCreateRmaFromComplaint({ category: "complaint", customerCode: "C", status: "closed" }).ok).toBe(false);
  });

  it("rejects missing customer", () => {
    expect(canCreateRmaFromComplaint({ category: "complaint", customerCode: "", status: "open" }).ok).toBe(false);
  });
});

describe("service — canLinkComplaintToQuality", () => {
  it("accepts both IDs", () => {
    expect(canLinkComplaintToQuality("c-1", "q-1").ok).toBe(true);
  });

  it("rejects missing IDs", () => {
    expect(canLinkComplaintToQuality("", "q-1").ok).toBe(false);
    expect(canLinkComplaintToQuality("c-1", "").ok).toBe(false);
  });
});

describe("service — averageResolutionHours", () => {
  it("returns 0 on empty list", () => {
    expect(averageResolutionHours([])).toBe(0);
  });

  it("skips unresolved tickets", () => {
    expect(averageResolutionHours([
      { openedAt: "2026-06-19T00:00:00Z" }, // no resolvedAt
      { openedAt: "2026-06-19T00:00:00Z", resolvedAt: "2026-06-19T02:00:00Z" },
    ])).toBe(2);
  });

  it("averages hours across multiple resolved", () => {
    const result = averageResolutionHours([
      { openedAt: "2026-06-19T00:00:00Z", resolvedAt: "2026-06-19T04:00:00Z" }, // 4h
      { openedAt: "2026-06-19T00:00:00Z", resolvedAt: "2026-06-19T10:00:00Z" }, // 10h
    ]);
    expect(result).toBe(7);
  });
});