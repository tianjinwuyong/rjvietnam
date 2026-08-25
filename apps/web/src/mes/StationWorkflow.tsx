import { useState, useEffect, useCallback } from "react";
import {
  ArrowRight,
  X,
  RefreshCw,
  Monitor,
  HardDrive,
} from "lucide-react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import type { TranslationKey } from "../i18n";
import { t } from "../i18n";
import { mesApi, type ProductionLine, type Station, type LineDetail } from "../api/mes";

// ── Types ────────────────────────────────────────────────────────────

type HeartbeatStatus = "alive" | "warning" | "dead";

interface Heartbeat {
  stationCode: string;
  lineCode: string | null;
  lastSeen: string;
  lastOperator: string | null;
  status: HeartbeatStatus;
  elapsedMs: number;
  sequenceOrder: number | null;
}

interface HeartbeatsResponse {
  heartbeats: Heartbeat[];
  byLine: Record<string, { alive: number; warning: number; dead: number }>;
  total: number;
  now: string;
}

// ── Helpers ───────────────────────────────────────────────────────────

function statusColor(s: HeartbeatStatus): string {
  return s === "alive" ? "#16a34a" : s === "warning" ? "#d97706" : "#dc2626";
}

function elapsed(ms: number): string {
  if (ms < 5_000) return "刚刚";
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  return `${Math.floor(ms / 60_000)}m`;
}

// ── Pulse dot ─────────────────────────────────────────────────────────

function PulseDot({ status }: { status: HeartbeatStatus }) {
  const color = statusColor(status);
  return (
    <span
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: color,
        boxShadow: status === "alive" ? `0 0 6px ${color}` : undefined,
        animation: status === "alive" ? "pulse-dot 2s ease-in-out infinite" : undefined,
        flexShrink: 0,
      }}
    />
  );
}

// ── Station Node ──────────────────────────────────────────────────────

interface StationNodeData {
  station: Station;
  heartbeat?: Heartbeat;
}

function StationNode({
  node,
  locale,
  onClick,
}: {
  node: StationNodeData;
  locale: Locale;
  onClick: () => void;
}) {
  const shortKey = locale.replace(/-\w+$/, "") as "zh" | "vi" | "en";
  const nameKey = shortKey === "zh" ? "nameZh" : shortKey === "vi" ? "nameVi" : "nameEn";
  const stationName = (node.station as any)[nameKey] ?? node.station.code;
  const integration: "hardware" | "software" =
    node.station.stationType === "software" ? "software" : "hardware";
  const IntIcon = integration === "hardware" ? HardDrive : Monitor;

  const hb = node.heartbeat;
  const status: HeartbeatStatus = hb?.status ?? "dead";
  const color = statusColor(status);

  return (
    <button
      type="button"
      className="workflow-node"
      style={{ "--node-color": color } as React.CSSProperties}
      onClick={onClick}
    >
      <div className="workflow-node-top">
        <PulseDot status={status} />
        <span className="workflow-node-name">{stationName}</span>
        <IntIcon size={11} style={{ opacity: 0.5 }} />
      </div>

      {hb ? (
        <>
          <div className="workflow-node-meta">{elapsed(hb.elapsedMs)}</div>
          {hb.lastOperator && (
            <div className="workflow-node-operator">{hb.lastOperator}</div>
          )}
        </>
      ) : (
        <div className="workflow-node-meta" style={{ opacity: 0.4 }}>—</div>
      )}

      <div className="workflow-node-bar" style={{ background: color }} />
    </button>
  );
}

// ── Flow Arrow ────────────────────────────────────────────────────────

function FlowArrow() {
  return (
    <div className="workflow-arrow">
      <ArrowRight size={16} style={{ color: "rgba(255,255,255,0.2)" }} />
    </div>
  );
}

// ── Station Detail Modal ──────────────────────────────────────────────

function StationDetailModal({
  node,
  locale,
  onClose,
}: {
  node: StationNodeData;
  locale: Locale;
  onClose: () => void;
}) {
  const shortKey = locale.replace(/-\w+$/, "") as "zh" | "vi" | "en";
  const nameKey = shortKey === "zh" ? "nameZh" : shortKey === "vi" ? "nameVi" : "nameEn";
  const stationName = (node.station as any)[nameKey] ?? node.station.code;
  const hb = node.heartbeat;
  const status: HeartbeatStatus = hb?.status ?? "dead";

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="station-detail-panel" onClick={(e) => e.stopPropagation()}>
        <div className="station-detail-header">
          <div>
            <h3>{stationName}</h3>
            <p className="station-detail-section">{node.station.stationType}</p>
          </div>
          <button type="button" className="modal-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="station-detail-body">
          <div className="station-detail-row">
            <span>Code</span>
            <strong>{node.station.code}</strong>
          </div>
          <div className="station-detail-row">
            <span>{t("common.status" as TranslationKey, locale)}</span>
            <strong style={{ color: statusColor(status) }}>
              {status === "alive" ? t("mes.heartbeat.alive" as TranslationKey, locale)
                : status === "warning" ? t("mes.heartbeat.warning" as TranslationKey, locale)
                : t("mes.heartbeat.dead" as TranslationKey, locale)}
            </strong>
          </div>
          {hb && (
            <>
              <div className="station-detail-row">
                <span>{t("mes.heartbeat.lastSeen" as TranslationKey, locale)}</span>
                <strong>{new Date(hb.lastSeen).toLocaleString(locale)}</strong>
              </div>
              <div className="station-detail-row">
                <span>{t("mes.heartbeat.elapsed" as TranslationKey, locale)}</span>
                <strong>{elapsed(hb.elapsedMs)}</strong>
              </div>
              {hb.lastOperator && (
                <div className="station-detail-row">
                  <span>{t("mes.heartbeat.operator" as TranslationKey, locale)}</span>
                  <strong>{hb.lastOperator}</strong>
                </div>
              )}
              <div className="station-detail-row">
                <span>{t("mes.heartbeat.line" as TranslationKey, locale)}</span>
                <strong>{hb.lineCode ?? "—"}</strong>
              </div>
            </>
          )}
          <div className="station-detail-row">
            <span>{t("mes.station.requiredScan" as TranslationKey, locale)}</span>
            <strong>{node.station.requiredScan ? t("common.yes" as TranslationKey, locale) : t("common.no" as TranslationKey, locale)}</strong>
          </div>
          <div className="station-detail-row">
            <span>{t("mes.station.sequence" as TranslationKey, locale)}</span>
            <strong>{node.station.sequenceOrder ?? "—"}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────

const CSS = `
@keyframes pulse-dot { 0%,100%{opacity:1} 50%{opacity:0.25} }

.workflow-container {
  overflow-x: auto;
  padding: 16px 0 24px;
}

.workflow-line-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

.workflow-line-info {
  display: flex;
  gap: 16px;
  align-items: center;
}

.workflow-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
}

.workflow-nodes-row {
  display: flex;
  align-items: center;
  gap: 0;
  overflow-x: auto;
  padding: 8px 4px;
}

.workflow-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 10px 14px 0;
  background: rgba(255,255,255,0.05);
  border: 2px solid var(--node-color, rgba(255,255,255,0.15));
  border-radius: 10px;
  min-width: 90px;
  max-width: 120px;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
  position: relative;
  flex-shrink: 0;
  font-family: inherit;
  color: inherit;
}

.workflow-node:hover {
  background: rgba(255,255,255,0.1);
}

.workflow-node-top {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 100%;
}

.workflow-node-name {
  font-size: 11px;
  font-weight: 700;
  color: #f1f5f9;
  text-align: center;
  flex: 1;
  overflow: hidden;
  textOverflow: ellipsis;
  white-space: nowrap;
  letter-spacing: 0.02em;
}

.workflow-node-meta {
  font-size: 10px;
  color: rgba(255,255,255,0.5);
  text-align: center;
}

.workflow-node-operator {
  font-size: 9px;
  color: rgba(255,255,255,0.35);
  text-align: center;
  overflow: hidden;
  textOverflow: ellipsis;
  whiteSpace: nowrap;
  max-width: 90px;
}

.workflow-node-bar {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 3px;
  border-radius: 0 0 8px 8px;
}

.workflow-arrow {
  display: flex;
  align-items: center;
  padding: 0 4px;
  flex-shrink: 0;
}

.workflow-summary {
  display: flex;
  gap: 20px;
  align-items: center;
  margin-bottom: 12px;
  font-size: 12px;
  flex-wrap: wrap;
}

.workflow-summary-alive { color: #16a34a; font-weight: 700; }
.workflow-summary-warn  { color: #d97706; font-weight: 700; }
.workflow-summary-dead  { color: #dc2626; font-weight: 700; }

.workflow-empty {
  text-align: center;
  color: rgba(255,255,255,0.25);
  padding: 48px 0;
  font-size: 13px;
}
`;

export function StationWorkflow({ locale }: { locale: Locale }) {
  const [lines, setLines] = useState<ProductionLine[]>([]);
  const [selectedLineCode, setSelectedLineCode] = useState<string>("");
  const [lineDetail, setLineDetail] = useState<LineDetail | null>(null);
  const [heartbeats, setHeartbeats] = useState<HeartbeatsResponse | null>(null);
  const [detailNode, setDetailNode] = useState<StationNodeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchLines = useCallback(async () => {
    try {
      const res = await mesApi.getLines();
      const rows = res.items;
      setLines(rows);
      if (rows.length > 0 && !selectedLineCode) {
        setSelectedLineCode(rows[0].lineCode);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchLineDetail = useCallback(async (lineCode: string) => {
    if (!lineCode) return;
    setLoading(true);
    try {
      const detail = await mesApi.getLine(lineCode);
      setLineDetail(detail);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchHeartbeats = useCallback(async () => {
    try {
      const r = await fetch("/mes/heartbeats");
      if (!r.ok) return;
      const json: any = await r.json();
      setHeartbeats(json.data ?? json);
    } catch { /* ignore */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchLines(); }, [fetchLines]);

  useEffect(() => {
    if (selectedLineCode) fetchLineDetail(selectedLineCode);
  }, [selectedLineCode, fetchLineDetail]);

  useEffect(() => {
    fetchHeartbeats();
    const iv = setInterval(fetchHeartbeats, 30_000);
    return () => clearInterval(iv);
  }, [fetchHeartbeats]);

  const hbs = heartbeats?.heartbeats ?? [];
  const shortKey = locale.replace(/-\w+$/, "") as "zh" | "vi" | "en";
  const nameKey = shortKey === "zh" ? "nameZh" : shortKey === "vi" ? "nameVi" : "nameEn";

  const lineLabel = (line: ProductionLine) =>
    (line as any)[nameKey] ?? line.nameZh ?? line.lineCode;

  const aliveCount = selectedLineCode
    ? hbs.filter(h => h.lineCode === selectedLineCode && h.status === "alive").length
    : 0;
  const warnCount = selectedLineCode
    ? hbs.filter(h => h.lineCode === selectedLineCode && h.status === "warning").length
    : 0;
  const deadCount = selectedLineCode
    ? hbs.filter(h => h.lineCode === selectedLineCode && h.status === "dead").length
    : 0;

  function hbForStation(code: string): Heartbeat | undefined {
    return hbs.find(h => h.stationCode === code);
  }

  const stations = lineDetail?.stations ?? [];
  const sortedStations = [...stations].sort(
    (a, b) => (a.sequenceOrder ?? 99) - (b.sequenceOrder ?? 99)
  );

  return (
    <>
      <style>{CSS}</style>
      <div className="screen-stack">
        {/* Line selector */}
        <div className="surface-panel">
          <div className="section-header">
            <div>
              <h2>{t("mes.stationWorkflow.title" as TranslationKey, locale)}</h2>
              <p>{t("mes.stationWorkflow.subtitle" as TranslationKey, locale)}</p>
            </div>
          </div>
          <div className="toolbar" style={{ marginTop: 12, flexWrap: "wrap" }}>
            {lines.map((line) => (
              <button
                key={line.lineCode}
                type="button"
                className={`action-button ${selectedLineCode === line.lineCode ? "active" : ""}`}
                style={{
                  background:
                    selectedLineCode === line.lineCode ? "var(--info)" : "var(--nav)",
                }}
                onClick={() => setSelectedLineCode(line.lineCode)}
              >
                {lineLabel(line)}
              </button>
            ))}
          </div>

          {selectedLineCode && (
            <div className="workflow-summary">
              <span className="workflow-summary-alive">● {aliveCount} {t("mes.heartbeat.alive" as TranslationKey, locale)}</span>
              <span className="workflow-summary-warn">● {warnCount} {t("mes.heartbeat.warning" as TranslationKey, locale)}</span>
              <span className="workflow-summary-dead">● {deadCount} {t("mes.heartbeat.dead" as TranslationKey, locale)}</span>
              {heartbeats?.now && (
                <span style={{ marginLeft: "auto", opacity: 0.4, fontSize: 11 }}>
                  {new Date(heartbeats.now).toLocaleTimeString(locale)}
                </span>
              )}
              <button
                type="button"
                onClick={() => { fetchLineDetail(selectedLineCode); fetchHeartbeats(); }}
                style={{
                  background: "none",
                  border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: 4,
                  padding: "2px 8px",
                  cursor: "pointer",
                  color: "rgba(255,255,255,0.5)",
                  fontSize: 11,
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <RefreshCw size={11} /> {t("common.refresh" as TranslationKey, locale)}
              </button>
            </div>
          )}
        </div>

        {/* Workflow nodes */}
        <div className="surface-panel">
          <div className="section-header">
            <div>
              <h2>{t("mes.stationWorkflow.flow" as TranslationKey, locale)}</h2>
              <p>
                {lineDetail
                  ? `${lineLabel(lineDetail.line)}${
                      lineDetail.currentRun
                        ? ` — ${t("common.workOrder" as TranslationKey, locale)}: ${lineDetail.currentRun.workOrderCode}`
                        : ""
                    }`
                  : "—"}
              </p>
            </div>
          </div>

          {error && !lineDetail && (
            <div style={{ padding: 12, color: "#fca5a5", background: "rgba(220,38,38,0.12)", borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
              {t("common.loadError" as TranslationKey, locale)}: {error}
            </div>
          )}

          {!loading && sortedStations.length === 0 && (
            <div className="workflow-empty">
              {t("common.noData" as TranslationKey, locale)}
            </div>
          )}

          {loading && (
            <div className="workflow-empty">
              {t("common.loading" as TranslationKey, locale)}…
            </div>
          )}

          {sortedStations.length > 0 && (
            <div className="workflow-container">
              <div className="workflow-nodes-row">
                {sortedStations.map((station, idx) => {
                  const node: StationNodeData = {
                    station,
                    heartbeat: hbForStation(station.code),
                  };
                  return (
                    <div key={station.code} style={{ display: "flex", alignItems: "center" }}>
                      <StationNode
                        node={node}
                        locale={locale}
                        onClick={() => setDetailNode(node)}
                      />
                      {idx < sortedStations.length - 1 && <FlowArrow />}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Legend */}
          <div style={{ display: "flex", gap: 20, fontSize: 11, opacity: 0.6, marginTop: 8 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <HardDrive size={11} /> {t("mes.integration.hardware" as TranslationKey, locale)}
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <Monitor size={11} /> {t("mes.integration.software" as TranslationKey, locale)}
            </span>
          </div>
        </div>
      </div>

      {detailNode && (
        <StationDetailModal
          node={detailNode}
          locale={locale}
          onClose={() => setDetailNode(null)}
        />
      )}
    </>
  );
}
