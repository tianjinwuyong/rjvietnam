// ── Customer Service MVP business rules ────────────────────────────
// Pure functions over RmaRequest / ServiceTicket shapes.
// Pattern follows packages/business-rules/src/finance.ts.

export type SlaResult = "ok" | "warning" | "breached";

export type SlaHours = {
  // Hours to first response
  responseHours: number;
  // Hours to resolution
  resolutionHours: number;
};

export type TicketPriority = "low" | "normal" | "high" | "urgent";

const PRIORITY_RESPONSE_HOURS: Record<TicketPriority, number> = {
  urgent: 1,
  high: 4,
  normal: 24,
  low: 72,
};

const PRIORITY_RESOLUTION_HOURS: Record<TicketPriority, number> = {
  urgent: 8,
  high: 24,
  normal: 72,
  low: 168,
};

/**
 * Get SLA targets (hours) for a given priority.
 * Falls back to 'normal' for unknown priorities.
 */
export function getSlaForPriority(priority: TicketPriority): SlaHours {
  const known: TicketPriority[] = ["urgent", "high", "normal", "low"];
  const p = (known as string[]).includes(priority) ? priority : "normal";
  return {
    responseHours: PRIORITY_RESPONSE_HOURS[p],
    resolutionHours: PRIORITY_RESOLUTION_HOURS[p],
  };
}

/**
 * Compute SLA status given a ticket that was opened at openedAt and (optionally) responded at firstResponseAt.
 * Compares against the priority's response and resolution targets.
 * Threshold (default 0.8): if >80% of resolution time has elapsed without resolution, 'warning'.
 */
export function computeSlaStatus(
  ticket: { priority: TicketPriority; openedAt: string; firstResponseAt?: string; resolvedAt?: string },
  asOfDate: string,
  warningThreshold = 0.8,
): SlaResult {
  const sla = getSlaForPriority(ticket.priority);
  const opened = Date.parse(ticket.openedAt);
  const ref = Date.parse(asOfDate);
  if (Number.isNaN(opened) || Number.isNaN(ref)) return "ok";
  const elapsedHours = (ref - opened) / (1000 * 60 * 60);
  // If resolved, we're fine regardless of timing
  if (ticket.resolvedAt) return "ok";
  // First response check
  if (!ticket.firstResponseAt && elapsedHours > sla.responseHours) return "breached";
  // Resolution window
  if (elapsedHours >= sla.resolutionHours) return "breached";
  if (elapsedHours >= sla.resolutionHours * warningThreshold) return "warning";
  return "ok";
}

/**
 * Validate that a complaint ticket can spawn an RMA.
 * Rules:
 *  - ticket category must be 'complaint' or 'quality_issue'
 *  - ticket must reference a customer
 */
export function canCreateRmaFromComplaint(
  ticket: { category: string; customerCode: string; status: string },
): { ok: boolean; error?: string } {
  const validCategories = ["complaint", "quality_issue", "defect_report"];
  if (!validCategories.includes(ticket.category)) {
    return { ok: false, error: `ticket category '${ticket.category}' cannot trigger RMA` };
  }
  if (!ticket.customerCode) {
    return { ok: false, error: "ticket missing customer" };
  }
  if (ticket.status === "closed") {
    return { ok: false, error: "ticket is already closed" };
  }
  return { ok: true };
}

/**
 * Validate that a complaint can be linked to a quality inspection record.
 * Rules:
 *  - both IDs present
 *  - no duplicate (caller should check)
 */
export function canLinkComplaintToQuality(
  complaintId: string,
  inspectionId: string,
): { ok: boolean; error?: string } {
  if (!complaintId) return { ok: false, error: "complaintId required" };
  if (!inspectionId) return { ok: false, error: "inspectionId required" };
  return { ok: true };
}

/**
 * Compute average resolution time in hours across a set of resolved tickets.
 * Tickets without resolvedAt are skipped.
 * Returns 0 when no tickets have been resolved.
 */
export function averageResolutionHours(
  tickets: Array<{ openedAt: string; resolvedAt?: string }>,
): number {
  const resolved = tickets.filter((t) => t.resolvedAt);
  if (resolved.length === 0) return 0;
  const totalHours = resolved.reduce((sum, t) => {
    const start = Date.parse(t.openedAt);
    const end = Date.parse(t.resolvedAt!);
    if (Number.isNaN(start) || Number.isNaN(end)) return sum;
    return sum + (end - start) / (1000 * 60 * 60);
  }, 0);
  return Math.round((totalHours / resolved.length) * 100) / 100;
}