/**
 * W-G1 D1: pure helpers for the Human Takeover Dashboard.
 * Design contract: NODE4-WG4-DESIGN-SPEC-001.md section 9.
 *
 * No React, no DOM, no I/O, no endpoints. All data is supplied via props.
 * Provenance fields are OPTIONAL and must never be inferred from `status`
 * (see section 9.2): the backend does not persist them yet.
 */

export interface TakeoverAuditEntry {
  at: string;
  actor: string;
  action: string;
}

export interface TakeoverItem {
  id: string;
  recordType: string;
  recordNo: string;
  status: string;
  submittedAt?: string;
  createdByType?: "HUMAN" | "AGENT" | "SYSTEM" | null;
  createdById?: string | null;
  agentKey?: string | null;
  agentScope?: string | null;
  payload?: unknown;
  audit?: TakeoverAuditEntry[];
}

export const TAKEOVER_STATUSES = [
  "PENDING_HUMAN_APPROVAL",
  "AGENT_PROCESSING",
  "APPROVED",
  "REJECTED",
] as const;

export const TAKEOVER_ACTOR_TYPES = ["HUMAN", "AGENT", "SYSTEM"] as const;

export interface TakeoverFilter {
  /** "ALL" or one of TAKEOVER_STATUSES. */
  status?: string;
  /** "ALL" or one of TAKEOVER_ACTOR_TYPES. Missing provenance never matches a specific type. */
  createdByType?: string;
  /** Case-insensitive match over recordNo / recordType / agentKey. */
  query?: string;
  /** Inclusive YYYY-MM-DD bounds. */
  from?: string;
  to?: string;
}

export const DEFAULT_TAKEOVER_FILTER: TakeoverFilter = {
  status: "PENDING_HUMAN_APPROVAL",
  createdByType: "ALL",
  query: "",
};

function day(value?: string): string {
  return value ? value.slice(0, 10) : "";
}

/** Deterministic filter + sort. Undated records always sink to the bottom. */
export function filterTakeoverItems(
  items: readonly TakeoverItem[],
  filter: TakeoverFilter = DEFAULT_TAKEOVER_FILTER,
): TakeoverItem[] {
  const status = filter.status && filter.status !== "ALL" ? filter.status : null;
  const actorType = filter.createdByType && filter.createdByType !== "ALL"
    ? filter.createdByType
    : null;
  const query = (filter.query ?? "").trim().toLowerCase();

  const rows = items.filter((item) => {
    if (status && item.status !== status) return false;
    if (actorType && item.createdByType !== actorType) return false;
    if (query) {
      const haystack = [item.recordNo, item.recordType, item.agentKey]
        .filter((v): v is string => typeof v === "string")
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    const d = day(item.submittedAt);
    if (filter.from && (!d || d < filter.from)) return false;
    if (filter.to && (!d || d > filter.to)) return false;
    return true;
  });

  return rows.sort((a, b) => {
    const ad = a.submittedAt ?? "";
    const bd = b.submittedAt ?? "";
    if (ad === bd) return a.id.localeCompare(b.id);
    if (!ad) return 1;
    if (!bd) return -1;
    return ad < bd ? 1 : -1;
  });
}

export interface TakeoverPage {
  rows: TakeoverItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Clamps page into range; never returns an out-of-bounds page. */
export function paginateTakeoverItems(
  rows: readonly TakeoverItem[],
  page = 1,
  pageSize = 20,
): TakeoverPage {
  const size = Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : 20;
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const safePage = Math.min(Math.max(1, Math.floor(page) || 1), totalPages);
  return {
    rows: rows.slice((safePage - 1) * size, safePage * size),
    page: safePage,
    pageSize: size,
    total,
    totalPages,
  };
}

/**
 * Display value for an optional provenance field. Returns "" when absent so
 * the caller renders a muted placeholder. NEVER derives a value from status,
 * agent key, or any other field.
 */
export function provenanceCell(value: string | null | undefined): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export interface SelectionSummary {
  preview: string[];
  remaining: number;
}

/** For the bulk-confirmation modal: at most `limit` labels, plus an overflow count. */
export function summarizeSelection(labels: readonly string[], limit = 10): SelectionSummary {
  const safeLimit = Math.max(1, Math.floor(limit));
  return {
    preview: labels.slice(0, safeLimit),
    remaining: Math.max(0, labels.length - safeLimit),
  };
}

/** Read-only JSON rendering for the audit row; never returns HTML. */
export function formatPayload(payload: unknown): string {
  if (payload === undefined || payload === null) return "";
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}
