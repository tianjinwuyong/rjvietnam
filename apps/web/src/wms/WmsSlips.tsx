import { useEffect, useRef, useState } from "react";
import { FileText, PackageCheck, Truck, RefreshCw } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { wmsApi, type CollectOrderLine } from "../api/wms";

export interface CollectSlipRow {
  id: number;
  slipNo: string;
  workOrderCode: string;
  lineCode?: string | null;
  status: string;
  domain?: string | null;
  raisedBy?: string | null;
  raisedAt: string;
  collectedBy?: string | null;
  collectedAt?: string | null;
  lineCount: number;
  doneLines: number;
  issuedLines: number;
  acceptedBy?: string | null;
  acceptedAt?: string | null;
  pickers?: string | null;
}

export interface AcceptSlipRow {
  id: number;
  slipNo: string;
  workOrderCode: string;
  receivedBy?: string | null;
  itemCount: number;
  receivedAt: string;
  notes?: string | null;
  lineSummary?: string | null;
  items?: Array<{ materialCode?: string | null; qty?: number | string | null; lotNo?: string | null }>;
  collectNo?: string | null;
}

export interface PickingStatusRow {
  id: number;
  collectNo: string;
  workOrderCode: string;
  lineCode?: string | null;
  collectStatus: string;
  collector?: string | null;
  totalLines: number;
  readyToPick: number;
  acceptedLines: number;
  lastPickingBy?: string | null;
  lastPickingAt?: string | null;
  acceptCount: number;
  readyNotices: number;
  pickingStatus: "COLLECTING" | "IN_PROGRESS" | "DONE";
}

export interface ShortageRow {
  lineId: number;
  lineNo: number;
  materialCode: string;
  qty?: number | string | null;
  lotNo?: string | null;
  locationCode?: string | null;
  locationQr?: string | null;
  markedBy?: string | null;
  markedAt?: string | null;
  workOrderCode: string;
  slipNo: string;
  taskStatus?: string | null;
}

export interface LiveFeedRow {
  at?: string | null;
  by?: string | null;
  status: string;
  slipNo: string;
  workOrderCode: string;
  materialCode: string;
  qty?: number | string | null;
  lotNo?: string | null;
  locationQr?: string | null;
}

export interface LiveActiveRow {
  id: number;
  slipNo: string;
  workOrderCode: string;
  status: string;
  collector?: string | null;
  totalLines: number;
  doneLines: number;
  lastAt?: string | null;
  pickers?: string | null;
}

function fmtTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("zh-CN", { hour12: false });
}

function domainBadge(domain?: string | null) {
  const d = String(domain ?? "").toUpperCase();
  const label =
    d === "SMT" ? "SMT贴片" : d === "MANUAL" ? "手动·插料" : d === "AUTO" ? "自动线" : d === "PACKAGING" ? "包装" : d === "AUX" ? "辅料" : "";
  if (!label) return null;
  const color = d === "SMT" ? "#2563eb" : d === "MANUAL" ? "#16a34a" : d === "AUTO" ? "#7c3aed" : "#94a3b8";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "1px 7px",
        borderRadius: 10,
        fontSize: 11,
        color: "#fff",
        background: color,
        marginRight: 6,
      }}
    >
      {label}
    </span>
  );
}

function statusPill(status: string) {
  const map: Record<string, { text: string; color: string; bg: string }> = {
    OPEN: { text: "收集中", color: "#b45309", bg: "#fef3c7" },
    PARTIAL: { text: "部分已收", color: "#b45309", bg: "#fef3c7" },
    COLLECTED: { text: "已集齐·可发", color: "#15803d", bg: "#dcfce7" },
    ISSUED: { text: "已发出", color: "#1d4ed8", bg: "#dbeafe" },
    ACCEPTED: { text: "验收完成", color: "#b91c1c", bg: "#fee2e2" },
    NO_MATERIAL: { text: "缺料", color: "#b91c1c", bg: "#fee2e2" },
  };
  const m = map[status] ?? { text: status, color: "#475569", bg: "#e2e8f0" };
  return (
    <span style={{ display: "inline-block", padding: "2px 9px", borderRadius: 10, fontSize: 11, color: m.color, background: m.bg }}>
      {m.text}
    </span>
  );
}

function pickingPill(status: string) {
  const map: Record<string, { text: string; color: string; bg: string }> = {
    COLLECTING: { text: "仓库集料中", color: "#b45309", bg: "#fef3c7" },
    IN_PROGRESS: { text: "产线收料中", color: "#1d4ed8", bg: "#dbeafe" },
    DONE: { text: "收料完成", color: "#15803d", bg: "#dcfce7" },
  };
  const m = map[status] ?? { text: status, color: "#475569", bg: "#e2e8f0" };
  return (
    <span style={{ display: "inline-block", padding: "2px 9px", borderRadius: 10, fontSize: 11, color: m.color, background: m.bg }}>
      {m.text}
    </span>
  );
}

export function WmsSlips({ locale }: { locale: Locale }) {
  const [tab, setTab] = useState<"collect" | "accept" | "picking" | "shortage" | "live">("collect");
  const [collects, setCollects] = useState<CollectSlipRow[]>([]);
  const [accepts, setAccepts] = useState<AcceptSlipRow[]>([]);
  const [picking, setPicking] = useState<PickingStatusRow[]>([]);
  const [shortages, setShortages] = useState<ShortageRow[]>([]);
  const [liveFeed, setLiveFeed] = useState<LiveFeedRow[]>([]);
  const [liveActive, setLiveActive] = useState<LiveActiveRow[]>([]);
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Detail drawer: type is the tab it belongs to; collect rows lazy-load lines.
  const [detail, setDetail] = useState<{ type: "collect" | "accept"; slip: CollectSlipRow | AcceptSlipRow; lines?: CollectOrderLine[] } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [acceptingId, setAcceptingId] = useState<number | null>(null);

  const load = (wo?: string, quiet?: boolean) => {
    if (!quiet) {
      setLoading(true);
    }
    setError(null);
    wmsApi
      .getSlips(wo)
      .then((res: { collectOrders?: CollectSlipRow[]; acceptances?: AcceptSlipRow[] }) => {
        setCollects(res.collectOrders ?? []);
        setAccepts(res.acceptances ?? []);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    wmsApi
      .getPickingStatus(wo)
      .then((res: { items?: PickingStatusRow[] }) => setPicking(res.items ?? []))
      .catch(() => setPicking([]));
    wmsApi
      .getShortages()
      .then((res: { items?: ShortageRow[] }) => setShortages(res.items ?? []))
      .catch(() => setShortages([]));
    wmsApi
      .getCollectActivity(30)
      .then((res: { feed?: LiveFeedRow[]; active?: LiveActiveRow[] }) => {
        setLiveFeed(res.feed ?? []);
        setLiveActive(res.active ?? []);
      })
      .catch(() => {
        setLiveFeed([]);
        setLiveActive([]);
      });
  };

  // WMS-side acceptance: finishes the WO material flow. Terminal action —
  // only offered when no PENDING lines remain (server re-checks too).
  const confirmAcceptance = async (slip: CollectSlipRow, e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    if (!window.confirm(`确认验收 ${slip.slipNo}？验收后该工单发料流程结束。`)) return;
    setAcceptingId(slip.id);
    setError(null);
    try {
      await wmsApi.acceptCollectOrder(slip.id);
      const qq = query.trim();
      load(qq || undefined, true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAcceptingId(null);
    }
  };

  // 缺料应急处理：handled -> line requeued to PENDING.
  const resolveShortage = async (row: ShortageRow, e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    if (!window.confirm(`确认 ${row.materialCode} 缺料已处理？该行将回到待集料。`)) return;
    setResolvingId(row.lineId);
    setError(null);
    try {
      await wmsApi.resolveShortage(row.lineId);
      const qq = query.trim();
      load(qq || undefined, true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setResolvingId(null);
    }
  };

  const openCollectDetail = async (slip: CollectSlipRow) => {
    setDetailLoading(true);
    setDetail({ type: "collect", slip, lines: [] });
    try {
      const res = await wmsApi.getCollectOrder(slip.workOrderCode);
      setDetail({ type: "collect", slip, lines: res.items ?? [] });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDetailLoading(false);
    }
  };

  const openAcceptDetail = (slip: AcceptSlipRow) => {
    setDetail({ type: "accept", slip });
  };

  const queryRef = useRef("");
  queryRef.current = query;

  useEffect(() => {
    load();
    // Live announcement feed: PDA picking completion lands on this page.
    const timer = setInterval(() => {
      const qq = queryRef.current.trim();
      load(qq || undefined, true);
    }, 15000);
    return () => clearInterval(timer);
  }, []);

  const q = query.trim().toLowerCase();
  const fCollects = collects.filter(
    (s) => !q || s.slipNo.toLowerCase().includes(q) || s.workOrderCode.toLowerCase().includes(q) || (s.collectedBy ?? "").toLowerCase().includes(q),
  );
  const fAccepts = accepts.filter(
    (s) => !q || s.slipNo.toLowerCase().includes(q) || s.workOrderCode.toLowerCase().includes(q) || (s.receivedBy ?? "").toLowerCase().includes(q),
  );
  const fPicking = picking.filter(
    (s) => !q || s.collectNo.toLowerCase().includes(q) || s.workOrderCode.toLowerCase().includes(q) || (s.lastPickingBy ?? "").toLowerCase().includes(q),
  );
  const fShortages = shortages.filter(
    (s) => !q || s.slipNo.toLowerCase().includes(q) || s.workOrderCode.toLowerCase().includes(q) || s.materialCode.toLowerCase().includes(q) || (s.markedBy ?? "").toLowerCase().includes(q),
  );

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("wms.slipsTitle", locale)}</h2>
            <p>
              {t("wms.slipsSubtitle", locale)} · 记录发料人（集料）与收料人（产线接料）及时间
            </p>
          </div>
          <div className="toolbar">
            <div className="scan-input" style={{ maxWidth: 260 }}>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("wms.slipsSearch", locale)}
              />
            </div>
            <a
              className="action-button"
              href="/wms-flow/material-issue.html"
              target="_blank"
              rel="noreferrer"
              title="打开物料发料/收料流程总览图（可点击节点）"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none" }}
            >
              <FileText size={14} /> {t("wms.slipsFlow", locale)}
            </a>
            <button
              type="button"
              className="action-button"
              title="刷新"
              onClick={() => load()}
              disabled={loading}
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        <div className="toolbar" style={{ margin: "10px 0" }}>
          <button
            type="button"
            className="action-button"
            style={{ background: tab === "collect" ? "var(--nav)" : "transparent", border: "1px solid var(--border)" }}
            onClick={() => setTab("collect")}
          >
            <PackageCheck size={14} /> 发料单（仓库集料） ({collects.length})
          </button>
          <button
            type="button"
            className="action-button"
            style={{ background: tab === "accept" ? "var(--nav)" : "transparent", border: "1px solid var(--border)" }}
            onClick={() => setTab("accept")}
          >
            <Truck size={14} /> 收料单（产线接料） ({accepts.length})
          </button>
          <button
            type="button"
            className="action-button"
            style={{ background: tab === "picking" ? "var(--nav)" : "transparent", border: "1px solid var(--border)" }}
            onClick={() => setTab("picking")}
          >
            <PackageCheck size={14} /> 收料 PDA 状态 ({picking.length})
          </button>
          <button
            type="button"
            className="action-button"
            style={{ background: tab === "shortage" ? "var(--nav)" : "transparent", border: "1px solid var(--border)" }}
            onClick={() => setTab("shortage")}
          >
            <PackageCheck size={14} /> 缺料应急 ({shortages.length})
          </button>
          <button
            type="button"
            className="action-button"
            style={{ background: tab === "live" ? "var(--nav)" : "transparent", border: "1px solid var(--border)" }}
            onClick={() => setTab("live")}
          >
            <RefreshCw size={14} /> 集料实时
          </button>
        </div>

        {error && (
          <div style={{ padding: "10px 14px", borderRadius: 6, background: "#fef2f2", color: "#b91c1c", marginBottom: 10, fontSize: 13 }}>
            {error}
          </div>
        )}

        {loading ? (
          <div className="placeholder-view">加载中…</div>
        ) : tab === "collect" ? (
          fCollects.length === 0 ? (
            <div className="empty-state">{t("common.noData", locale)}</div>
          ) : (
            <div className="table-shell">
              <table>
                <thead>
                  <tr>
                    <th>发料单号</th>
                    <th>工单</th>
                    <th>状态</th>
                    <th>工段</th>
                    <th>进度</th>
                    <th>发料人（集料）</th>
                    <th>发料时间</th>
                    <th>建单人</th>
                  </tr>
                </thead>
                <tbody>
                  {fCollects.map((s) => (
                    <tr
                      key={s.id}
                      onClick={() => void openCollectDetail(s)}
                      title="点击查看明细"
                      style={{ cursor: "pointer" }}
                    >
                      <td><code style={{ fontSize: 12 }}>{s.slipNo}</code></td>
                      <td>
                        <strong>{s.workOrderCode}</strong>
                        {s.lineCode ? <span style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>{s.lineCode}</span> : null}
                      </td>
                      <td>{statusPill(s.status)}</td>
                      <td>{domainBadge(s.domain) ?? "—"}</td>
                      <td>
                        {s.doneLines}/{s.lineCount} 已收
                        {s.issuedLines > 0 ? <span style={{ display: "block", fontSize: 12, color: "#1d4ed8" }}>{s.issuedLines} 行已发出</span> : null}
                        {s.status === "ACCEPTED" || s.acceptedBy ? (
                          <span style={{ display: "block", fontSize: 11, color: "#b91c1c" }}>
                            验收 {s.acceptedBy ?? ""} · {fmtTime(s.acceptedAt)}
                          </span>
                        ) : s.lineCount > 0 && s.doneLines + s.issuedLines >= s.lineCount ? (
                          <button
                            type="button"
                            className="action-button"
                            disabled={acceptingId === s.id}
                            onClick={(e) => void confirmAcceptance(s, e)}
                            style={{ marginTop: 4, fontSize: 12, padding: "3px 10px" }}
                          >
                            {acceptingId === s.id ? "验收中…" : "✓ 确认验收"}
                          </button>
                        ) : null}
                      </td>
                      <td>
                        <strong>{s.collectedBy ?? "—"}</strong>
                        {s.collectedAt ? <span style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>{fmtTime(s.collectedAt)}</span> : null}
                        {s.pickers && s.pickers !== (s.collectedBy ?? "") ? (
                          <span style={{ display: "block", fontSize: 11, color: "#1d4ed8" }}>签收: {s.pickers}</span>
                        ) : null}
                      </td>
                      <td>{fmtTime(s.collectedAt ?? s.raisedAt)}</td>
                      <td>{s.raisedBy ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
          ) : tab === "accept" ? (
          fAccepts.length === 0 ? (
            <div className="empty-state">{t("common.noData", locale)}</div>
          ) : (
            <div className="table-shell">
              <table>
                <thead>
                  <tr>
                    <th>收料单号</th>
                    <th>工单</th>
                    <th>对应发料单</th>
                    <th>料行摘要</th>
                    <th>料行数</th>
                    <th>收料人（产线）</th>
                    <th>收料时间</th>
                    <th>备注</th>
                  </tr>
                </thead>
                <tbody>
                  {fAccepts.map((s) => (
                    <tr
                      key={s.id}
                      onClick={() => openAcceptDetail(s)}
                      title="点击查看明细"
                      style={{ cursor: "pointer" }}
                    >
                      <td><code style={{ fontSize: 12 }}>{s.slipNo}</code></td>
                      <td><strong>{s.workOrderCode}</strong></td>
                      <td>
                        {s.collectNo ? (
                          <code style={{ fontSize: 11, color: "#1d4ed8" }}>{s.collectNo}</code>
                        ) : (
                          "—"
                        )}
                      </td>
                    <td>
                      {s.lineSummary ? (
                        <span style={{ fontSize: 12, color: "var(--muted)", display: "block", maxWidth: 420, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.lineSummary}>
                          {s.lineSummary}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{s.itemCount}</td>
                    <td>
                      <strong>{s.receivedBy ?? "—"}</strong>
                    </td>
                    <td>{fmtTime(s.receivedAt)}</td>
                    <td>{s.notes ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )
          ) : tab === "picking" ? (
          fPicking.length === 0 ? (
            <div className="empty-state">{t("common.noData", locale)}</div>
          ) : (
            <div className="table-shell">
              <table>
                <thead>
                  <tr>
                    <th>工单</th>
                    <th>发料单（仓库）</th>
                    <th>库房集料</th>
                    <th>产线收料</th>
                    <th>收料状态</th>
                    <th>最近收料 PDA</th>
                    <th>签收次数</th>
                    <th>待收通知</th>
                  </tr>
                </thead>
              <tbody>
                {fPicking.map((s) => (
                  <tr
                    key={s.id}
                    onClick={() =>
                      void openCollectDetail({
                        id: s.id,
                        slipNo: s.collectNo,
                        workOrderCode: s.workOrderCode,
                        status: s.collectStatus,
                        lineCode: s.lineCode ?? null,
                        collectedBy: s.collector ?? null,
                        collectedAt: null,
                        raisedAt: "",
                        lineCount: s.totalLines,
                        doneLines: s.readyToPick,
                        issuedLines: s.acceptedLines,
                      } as CollectSlipRow)
                    }
                    title="点击查看对应发料单明细"
                    style={{ cursor: "pointer" }}
                  >
                    <td>
                      <strong>{s.workOrderCode}</strong>
                      {s.lineCode ? <span style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>{s.lineCode}</span> : null}
                    </td>
                    <td>
                      <code style={{ fontSize: 12 }}>{s.collectNo}</code>
                      {s.collector ? <span style={{ display: "block", fontSize: 11, color: "var(--muted)" }}>集料 {s.collector}</span> : null}
                    </td>
                    <td>
                      {s.readyToPick}/{s.totalLines}
                      {s.collectStatus ? <span style={{ display: "block", fontSize: 11, color: "var(--muted)" }}>{s.collectStatus}</span> : null}
                    </td>
                    <td>
                      <strong style={{ color: s.acceptedLines > 0 ? "#1d4ed8" : "var(--muted)" }}>
                        {s.acceptedLines}/{s.readyToPick}
                      </strong>
                      <span style={{ display: "block", fontSize: 11, color: "var(--muted)" }}>已签收行</span>
                    </td>
                    <td>{pickingPill(s.pickingStatus)}</td>
                    <td>
                      {s.lastPickingBy ? (
                        <>
                          <strong>{s.lastPickingBy}</strong>
                          <span style={{ display: "block", fontSize: 11, color: "var(--muted)" }}>{fmtTime(s.lastPickingAt)}</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{s.acceptCount > 0 ? `${s.acceptCount} 次` : "—"}</td>
                    <td>{s.readyNotices > 0 ? `${s.readyNotices} 条` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )
        ) : tab === "shortage" ? (
          fShortages.length === 0 ? (
            <div className="empty-state">暂无缺料 ✓</div>
          ) : (
            <div className="table-shell">
              <table>
                <thead>
                  <tr>
                    <th>工单</th>
                    <th>发料单</th>
                    <th>缺料料号</th>
                    <th>缺料数量</th>
                    <th>库位</th>
                    <th>上报人/时间</th>
                    <th>处理</th>
                  </tr>
                </thead>
                <tbody>
                  {fShortages.map((s) => (
                    <tr key={s.lineId}>
                      <td><strong>{s.workOrderCode}</strong></td>
                      <td><code style={{ fontSize: 12 }}>{s.slipNo}</code></td>
                      <td>
                        <strong style={{ color: "#b91c1c" }}>{s.materialCode}</strong>
                        {s.lotNo ? <span style={{ display: "block", fontSize: 11, color: "var(--muted)" }}>Lot: {s.lotNo}</span> : null}
                      </td>
                      <td><strong>{Number(s.qty).toLocaleString()}</strong></td>
                      <td><code style={{ fontSize: 11 }}>{s.locationQr || s.locationCode || "—"}</code></td>
                      <td>
                        <strong>{s.markedBy ?? "—"}</strong>
                        <span style={{ display: "block", fontSize: 11, color: "var(--muted)" }}>{fmtTime(s.markedAt)}</span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="action-button"
                          disabled={resolvingId === s.lineId}
                          onClick={(e) => void resolveShortage(s, e)}
                          style={{ fontSize: 12, padding: "3px 10px" }}
                        >
                          {resolvingId === s.lineId ? "处理中…" : "✓ 已处理"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>进行中发料单</th>
                  <th>工单</th>
                  <th>状态</th>
                  <th>进度（已集/总数）</th>
                  <th>集料 PDA</th>
                  <th>最近动作</th>
                </tr>
              </thead>
              <tbody>
                {liveActive.map((s) => (
                  <tr key={s.id}>
                    <td><code style={{ fontSize: 12 }}>{s.slipNo}</code></td>
                    <td><strong>{s.workOrderCode}</strong></td>
                    <td>{statusPill(s.status)}</td>
                    <td>
                      <strong style={{ color: "#1d4ed8" }}>{s.doneLines}/{s.totalLines}</strong>
                    </td>
                    <td>
                      <strong>{s.collector ?? "—"}</strong>
                      {s.pickers && s.pickers !== (s.collector ?? "") ? (
                        <span style={{ display: "block", fontSize: 11, color: "#1d4ed8" }}>{s.pickers}</span>
                      ) : null}
                    </td>
                    <td>{fmtTime(s.lastAt)}</td>
                  </tr>
                ))}
                {liveActive.length === 0 && (
                  <tr><td colSpan={6} style={{ color: "var(--muted)", fontSize: 12 }}>暂无进行中发料单</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {liveFeed.length > 0 && tab === "live" && (
          <div className="table-shell" style={{ marginTop: 12 }}>
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>集料 PDA</th>
                  <th>工单 / 发料单</th>
                  <th>物料</th>
                  <th>数量</th>
                  <th>动作</th>
                </tr>
              </thead>
              <tbody>
                {liveFeed.map((f, i) => (
                  <tr key={`${f.slipNo}-${f.materialCode}-${i}`}>
                    <td style={{ fontSize: 12 }}>{fmtTime(f.at)}</td>
                    <td><strong>{f.by ?? "—"}</strong></td>
                    <td>
                      <strong>{f.workOrderCode}</strong>
                      <span style={{ display: "block", fontSize: 11, color: "var(--muted)" }}>{f.slipNo}</span>
                    </td>
                    <td>
                      <strong>{f.materialCode}</strong>
                      {f.locationQr ? <span style={{ display: "block", fontSize: 11, color: "var(--muted)" }}>{f.locationQr}</span> : null}
                    </td>
                    <td>{f.qty ?? "—"}</td>
                    <td>{statusPill(f.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Detail drawer ── */}
        {detail && (
          <div
            style={{
              position: "fixed", inset: 0, zIndex: 9999, display: "grid", placeItems: "center",
              padding: 24, background: "rgba(15,23,42,.72)",
            }}
            onClick={() => setDetail(null)}
          >
            <section
              className="surface-panel"
              onClick={(e) => e.stopPropagation()}
              style={{ width: "min(960px, 94vw)", maxHeight: "88vh", overflow: "auto", display: "block" }}
            >
              <div className="section-header">
                <div>
                  <h2 style={{ margin: 0 }}>
                    {detail.type === "collect" ? "发料单明细" : "收料单明细"} · {(detail.slip as any).slipNo}
                  </h2>
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--muted)" }}>
                    工单 {(detail.slip as any).workOrderCode}
                    {detail.type === "collect"
                      ? ` · ${statusPill((detail.slip as CollectSlipRow).status)} 发料人(集料): ${(detail.slip as CollectSlipRow).collectedBy ?? "—"} · 领料签收: ${(detail.slip as CollectSlipRow).pickers || (detail.slip as CollectSlipRow).collectedBy || "—"}`
                      : ` · 收料人: ${(detail.slip as AcceptSlipRow).receivedBy ?? "—"} · ${fmtTime((detail.slip as AcceptSlipRow).receivedAt)}`}
                  </p>
                </div>
                <div className="toolbar">
                  <button type="button" className="action-button" onClick={() => setDetail(null)}>
                    ✕ 关闭
                  </button>
                </div>
              </div>

              {detailLoading ? (
                <div className="placeholder-view">加载明细…</div>
              ) : detail.type === "collect" ? (
                <div className="table-shell">
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>物料</th>
                        <th>Lot</th>
                        <th>库位</th>
                        <th>数量</th>
                        <th>工段</th>
                        <th>状态</th>
                        <th>分配给</th>
                        <th>操作人</th>
                        <th>时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(detail.lines ?? []).map((l, i) => (
                        <tr key={l.id}>
                          <td>{i + 1}</td>
                          <td>
                            <strong>{l.materialCode}</strong>
                            <span style={{ display: "block", fontSize: 11, color: "var(--muted)" }}>
                              {(l.materialName && (l.materialName.zh || l.materialName.en || l.materialName.vi)) || ""}
                            </span>
                          </td>
                          <td>{l.lotNo ?? "—"}</td>
                          <td><code style={{ fontSize: 11 }}>{l.locationQr || l.locationCode || "—"}</code></td>
                          <td>{Number(l.requiredQty).toLocaleString()}</td>
                          <td>{domainBadge(l.processDomain) ?? "—"}</td>
                          <td>
                            {l.status === "ISSUED" ? (
                              <span style={{ color: "#1d4ed8", fontSize: 12 }}>已发出</span>
                            ) : l.status === "COLLECTED" ? (
                              <span style={{ color: "#15803d", fontSize: 12 }}>已集齐·可发</span>
                            ) : (
                              <span style={{ color: "#b45309", fontSize: 12 }}>待收</span>
                            )}
                          </td>
                          <td>{l.assignedTo ?? "—"}</td>
                          <td>{l.collectedBy ?? "—"}</td>
                          <td>{fmtTime(l.collectedAt ?? null)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="table-shell">
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>物料</th>
                        <th>批次</th>
                        <th>数量</th>
                      </tr>
                    </thead>
                    <tbody>
                      {((detail.slip as AcceptSlipRow).items ?? []).map((it, i) => (
                        <tr key={i}>
                          <td>{i + 1}</td>
                          <td><strong>{it.materialCode ?? "—"}</strong></td>
                          <td>{it.lotNo ?? "—"}</td>
                          <td>{it.qty ?? "—"}</td>
                        </tr>
                      ))}
                      {!((detail.slip as AcceptSlipRow).items ?? []).length && (
                        <tr><td colSpan={4} style={{ color: "var(--muted)", fontSize: 12 }}>
                          {(detail.slip as AcceptSlipRow).lineSummary ?? "无行明细"}
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}
      </section>
    </div>
  );
}
