/**
 * W-G1 D1: Human Takeover Dashboard — WMS-style presentational primitive.
 * Design contract: NODE4-WG4-DESIGN-SPEC-001.md sections 9-10.
 *
 * USER DIRECTIVE (18:08 GMT+7): "we use wms frontend styles and logic type for
 * all the system". This component therefore follows apps/web/src/wms/* exactly:
 *   - classes: screen-stack / surface-panel / section-header / toolbar / input /
 *     table-shell / action-button / badge badge-* / modal-overlay
 *   - logic: useState filters, plain filter(), Record<string, ...> maps,
 *     0-based page + LIMIT (WmsIncoming.tsx), t() i18n, inline style tweaks
 *   - no parallel `takeover-*` stylesheet
 *
 * IMPORTANT / NOT A WORKING APPROVAL FLOW
 *  - Props-driven only. No endpoint, no fetch, no fabricated provenance.
 *  - `actionsEnabled` defaults to false: there is no backend approve/reject
 *    endpoint and no persisted `approval_state` yet.
 *  - Provenance is displayed when supplied and shown as "not recorded" when
 *    absent. It is NEVER inferred from `status`.
 *  - NOT routed in App.tsx; wiring needs a backend contract + explicit user go.
 */
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Search, ShieldAlert, X } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { AgentStateBadge } from "./AgentStateBadge";
import {
  TAKEOVER_ACTOR_TYPES,
  TAKEOVER_STATUSES,
  filterTakeoverItems,
  formatPayload,
  paginateTakeoverItems,
  provenanceCell,
  summarizeSelection,
  type TakeoverFilter,
  type TakeoverItem,
} from "./takeoverPresentation";

export interface HumanTakeoverQueueProps {
  items: TakeoverItem[];
  locale?: Locale;
  loading?: boolean;
  error?: string | null;
  /** Disabled by default — see the header note above. */
  actionsEnabled?: boolean;
  pageSize?: number;
  onApprove?: (id: string) => void;
  onReject?: (id: string, reason: string) => void;
  onBulkApprove?: (ids: string[]) => void;
  onRetry?: () => void;
}

const LIMIT = 20;

/** WMS convention: a small Record map instead of a bespoke styling system. */
const PROVENANCE_BADGE: Record<string, string> = {
  HUMAN: "badge-info",
  AGENT: "badge-warning",
  SYSTEM: "badge-muted",
};

export function HumanTakeoverQueue({
  items,
  locale = "zh-CN",
  loading = false,
  error = null,
  actionsEnabled = false,
  pageSize = LIMIT,
  onApprove,
  onReject,
  onBulkApprove,
  onRetry,
}: HumanTakeoverQueueProps) {
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("PENDING_HUMAN_APPROVAL");
  const [actorFilter, setActorFilter] = useState("");
  const [page, setPage] = useState(0); // 0-based, same as WmsIncoming.tsx
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [bulkOpen, setBulkOpen] = useState(false);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);

  const query: TakeoverFilter = {
    status: statusFilter || "ALL",
    createdByType: actorFilter || "ALL",
    query: filter,
  };
  const filtered = filterTakeoverItems(items, query);
  const result = paginateTakeoverItems(filtered, page + 1, pageSize);
  const selectedIds = Object.keys(selected).filter((id) => selected[id]);
  const selectedRows = items.filter((item) => selectedIds.includes(item.id));
  const summary = summarizeSelection(selectedRows.map((item) => item.recordNo));

  useEffect(() => {
    if (page + 1 > result.totalPages) setPage(result.totalPages - 1);
  }, [page, result.totalPages]);

  const unknown = t("agentState.provenanceUnknown", locale);
  const actionsHint = actionsEnabled ? undefined : t("agentState.actionsUnavailable", locale);
  const isFiltered = Boolean(filter) || Boolean(actorFilter) || statusFilter !== "ALL";

  const toggleSelected = (id: string) =>
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));

  const dialogKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      setBulkOpen(false);
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const nodes = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled])"),
    );
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (loading) {
    return (
      <div className="screen-stack">
        <section className="surface-panel">
          <div className="section-header">
            <div><h2>{t("agentState.humanApprovalQueue", locale)}</h2></div>
          </div>
          <div className="table-shell">
            <div style={{ padding: 16, color: "var(--muted)" }}>{t("common.loading", locale)}</div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("agentState.humanApprovalQueue", locale)}</h2>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--muted)" }}>
              {actionsEnabled ? "" : t("agentState.actionsUnavailable", locale)}
            </p>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            {filtered.length} / {items.length}
          </div>
        </div>
        <div className="toolbar">
          <input
            className="input"
            placeholder={t("agentState.searchPlaceholder", locale)}
            value={filter}
            onChange={(e) => { setFilter(e.target.value); setPage(0); }}
            style={{ maxWidth: 240 }}
          />
          <select
            className="input"
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
            style={{ maxWidth: 220 }}
          >
            <option value="">{t("agentState.filterAll", locale)}</option>
            {TAKEOVER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select
            className="input"
            value={actorFilter}
            onChange={(e) => { setActorFilter(e.target.value); setPage(0); }}
            style={{ maxWidth: 160 }}
          >
            <option value="">{t("agentState.filterAll", locale)}</option>
            {TAKEOVER_ACTOR_TYPES.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          {filter && (
            <button className="action-button" onClick={() => { setFilter(""); setPage(0); }} title="Clear">
              <X size={14} /> Clear
            </button>
          )}
          <button
            className="action-button"
            disabled={!actionsEnabled || selectedIds.length === 0}
            title={actionsHint}
            onClick={() => setBulkOpen(true)}
          >
            <ShieldAlert size={14} /> {t("agentState.bulkApprove", locale)} ({selectedIds.length})
          </button>
        </div>
      </section>

      <section className="surface-panel">
        <div className="section-header"><h3>{t("agentState.statusLabel", locale)}</h3></div>
        {error ? (
          <div role="alert" style={{ padding: 16, color: "var(--danger)" }}>
            {error || t("agentState.loadError", locale)}
            <button className="action-button" style={{ marginLeft: 12 }} onClick={() => onRetry?.()}>
              {t("agentState.retry", locale)}
            </button>
          </div>
        ) : items.length === 0 ? (
          <div style={{ padding: 16, color: "var(--muted)" }}>{t("agentState.emptyQueue", locale)}</div>
        ) : result.rows.length === 0 ? (
          <div style={{ padding: 16, color: "var(--muted)" }}>
            {t("agentState.emptyFiltered", locale)}
            {isFiltered && (
              <button
                className="action-button"
                style={{ marginLeft: 12 }}
                onClick={() => { setFilter(""); setStatusFilter("ALL"); setActorFilter(""); setPage(0); }}
              >
                {t("agentState.clearFilters", locale)}
              </button>
            )}
          </div>
        ) : (
          <div className="table-shell"><table>
            <thead><tr>
              <th aria-label={t("agentState.selectedCount", locale)} />
              <th>{t("agentState.recordNo", locale)}</th>
              <th>{t("agentState.recordType", locale)}</th>
              <th>{t("agentState.statusLabel", locale)}</th>
              <th>{t("agentState.provenanceLabel", locale)}</th>
              <th>{t("agentState.submittedAt", locale)}</th>
              <th>{t("agentState.auditTrail", locale)}</th>
              <th />
            </tr></thead>
            <tbody>
              {result.rows.map((item) => {
                const canAct = actionsEnabled && item.status === "PENDING_HUMAN_APPROVAL";
                const byType = provenanceCell(item.createdByType);
                const byId = provenanceCell(item.createdById);
                const agentKey = provenanceCell(item.agentKey);
                return [
                  <tr key={item.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`${t("agentState.selectedCount", locale)} ${item.recordNo}`}
                        checked={Boolean(selected[item.id])}
                        onChange={() => toggleSelected(item.id)}
                      />
                    </td>
                    <td>{item.recordNo}</td>
                    <td>{item.recordType}</td>
                    <td><AgentStateBadge status={item.status} locale={locale} extended /></td>
                    <td style={{ fontSize: 12 }}>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                        {byType
                          ? <span className={`badge ${PROVENANCE_BADGE[byType] ?? "badge-muted"}`}>{byType}</span>
                          : <span style={{ color: "var(--muted)" }}>{unknown}</span>}
                        <span title={byId || undefined}>{byId || "—"}</span>
                        <span style={{ color: "var(--muted)" }} title={agentKey || undefined}>{agentKey || "—"}</span>
                      </div>
                    </td>
                    <td>{item.submittedAt || "—"}</td>
                    <td>
                      <button
                        aria-expanded={expandedId === item.id}
                        onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                      >
                        {t("agentState.auditTrail", locale)}
                      </button>
                    </td>
                    <td>
                      <button disabled={!canAct} title={actionsHint} onClick={() => onApprove?.(item.id)}>
                        {t("agentState.approve", locale)}
                      </button>
                      <button
                        disabled={!canAct}
                        title={actionsHint}
                        onClick={() => { setRejectId(item.id); setRejectReason(""); }}
                      >
                        {t("agentState.reject", locale)}
                      </button>
                      {rejectId === item.id && (
                        <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                          <input
                            className="input"
                            aria-label={t("agentState.rejectReason", locale)}
                            placeholder={t("agentState.rejectReason", locale)}
                            value={rejectReason}
                            onChange={(e) => setRejectReason(e.target.value)}
                          />
                          <button
                            disabled={!rejectReason.trim()}
                            onClick={() => { onReject?.(item.id, rejectReason.trim()); setRejectId(null); }}
                          >
                            {t("agentState.confirm", locale)}
                          </button>
                          <button onClick={() => setRejectId(null)}>{t("agentState.cancel", locale)}</button>
                        </div>
                      )}
                    </td>
                  </tr>,
                  expandedId === item.id ? (
                    <tr key={`${item.id}-audit`}><td colSpan={8}>
                      <h4 style={{ margin: "8px 0" }}>{t("agentState.auditTrail", locale)}</h4>
                      <pre style={{ maxHeight: 240, overflow: "auto", background: "var(--surface-2)", padding: 10, borderRadius: 6 }}>
                        {formatPayload(item.payload) || t("agentState.originalPayload", locale)}
                      </pre>
                      {item.audit?.length ? (
                        <ul style={{ fontSize: 12, color: "var(--muted)" }}>
                          {item.audit.map((entry, i) => (
                            <li key={i}><time>{entry.at}</time> · {entry.actor} · {entry.action}</li>
                          ))}
                        </ul>
                      ) : <p style={{ fontSize: 12, color: "var(--muted)" }}>{t("agentState.noAudit", locale)}</p>}
                    </td></tr>
                  ) : null,
                ];
              })}
            </tbody>
          </table></div>
        )}
        {result.total > 0 && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", padding: 12 }}>
            <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              {t("agentState.prevPage", locale)}
            </button>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              {page + 1} / {result.totalPages} · {result.total}
            </span>
            <button disabled={(page + 1) * result.pageSize >= result.total} onClick={() => setPage((p) => p + 1)}>
              {t("agentState.nextPage", locale)}
            </button>
          </div>
        )}
      </section>

      {bulkOpen && (
        <div className="modal-overlay" onClick={() => setBulkOpen(false)}>
          <div
            ref={dialogRef}
            className="surface-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="takeover-bulk-title"
            onKeyDown={dialogKey}
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 480, width: "90vw", boxShadow: "0 8px 32px rgba(0,0,0,.18)" }}
          >
            <div className="section-header">
              <h3 id="takeover-bulk-title">{t("agentState.bulkConfirmTitle", locale)}</h3>
              <button className="modal-close" onClick={() => setBulkOpen(false)} aria-label={t("agentState.cancel", locale)}>
                <X size={16} />
              </button>
            </div>
            <div style={{ padding: "12px 0" }}>
              <p>{t("agentState.bulkConfirmBody", locale)}</p>
              <ul style={{ fontSize: 12, color: "var(--muted)", maxHeight: 160, overflow: "auto" }}>
                {summary.preview.map((label) => <li key={label}>{label}</li>)}
                {summary.remaining > 0 && <li>… {summary.remaining} {t("agentState.andMore", locale)}</li>}
              </ul>
              <p style={{ fontSize: 12, color: "var(--danger)" }}>{t("agentState.noUndo", locale)}</p>
            </div>
            <div className="toolbar" style={{ justifyContent: "flex-end" }}>
              <button onClick={() => setBulkOpen(false)}>{t("agentState.cancel", locale)}</button>
              <button
                className="action-button"
                autoFocus
                onClick={() => {
                  onBulkApprove?.(selectedIds);
                  setBulkOpen(false);
                  setSelected({});
                }}
              >
                <Search size={14} /> {t("agentState.confirm", locale)} ({selectedIds.length})
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default HumanTakeoverQueue;
