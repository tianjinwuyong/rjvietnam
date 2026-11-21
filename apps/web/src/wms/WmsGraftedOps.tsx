import { useEffect, useState } from "react";
import { API_BASE, apiClient, authHeaders } from "../api/client";
import type { Locale } from "../../../../packages/shared-types/src/factory";

/**
 * 移植作业台：把运行中 WMS 的 IQC 判定 / 领料审批拣料接收 / 盘点确认 /
 * 库存汇总导出 / 有效期延期 的**动作**接到 SMT。
 * 数据源：镜像表 rjvn_*（IQC、领料）+ SMT 库存表（盘点、库存、有效期）。
 * 端点见 services/api/src/routes/wms-graft.js。
 */

type Tab = "iqc" | "picking" | "count" | "stock" | "expiry";

interface IqcLot {
  id: string; lotNo: string; materialCode: string | null; materialName: string | null;
  unit: string | null; totalQty: string | number | null; batchNo: string | null;
  receiptDate: string | null; status: string;
}
interface IqcItem {
  id: string; itemName: string; standard: string | null; unit: string | null;
  measuredValue: string | null; isPass: boolean | null; sectionType: string | null;
}
interface IqcDetail extends IqcLot { items: IqcItem[]; draft: unknown }

interface PickOrder {
  id: string; pickingNo: string; workOrderNo: string | null; status: string;
  totalQty: string | number; workSection: string | null;
  items: { id: string; materialCode: string | null; materialName: string | null; unit: string | null;
    pickQty: string | number; actualQty: string | number | null; receivedQty: string | number | null }[];
}
interface CountSession { id: number; sessionCode: string; status: string; locationCode: string | null; variance: string | number | null }
interface CountItem { id: number; materialCode: string; systemQty: string | number; countedQty: string | number | null; variance: string | number | null }
interface CountReportItem extends CountItem { variancePct: string | number | null }
interface CountReport { overThreshold: number; items: CountReportItem[] }
interface StockRow { materialCode: string; materialName: string; unit: string; lotCount: number; totalQty: string | number; reservedQty: string | number }
interface ExpiryByMaterial { materialCode: string; materialName: string; lotCount: number; expiredLots: number; d7Lots: number; d30Lots: number; soonestExpiry: string | null }

const box: React.CSSProperties = { border: "1px solid var(--border)", borderRadius: 8, padding: 12, background: "var(--surface)" };
const btn = (active = false): React.CSSProperties => ({
  padding: "4px 12px", borderRadius: 6, cursor: "pointer", fontSize: 13,
  border: "1px solid var(--border)", background: active ? "var(--accent)" : "transparent",
  color: active ? "#fff" : "var(--fg)",
});
const cell: React.CSSProperties = { padding: "6px 10px", borderBottom: "1px solid var(--border)", fontSize: 13 };

function Feedback({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return <div style={{ margin: "8px 0", fontSize: 13, color: msg.ok ? "var(--success)" : "var(--error)" }}>{msg.text}</div>;
}

export function WmsGraftedOps({ locale }: { locale: Locale }) {
  const [tab, setTab] = useState<Tab>("iqc");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const say = (ok: boolean, text: string) => setMsg({ ok, text });
  const zh = locale !== "en-US" && locale !== "vi-VN";

  // ── IQC ──
  const [lots, setLots] = useState<IqcLot[]>([]);
  const [detail, setDetail] = useState<IqcDetail | null>(null);
  const [measured, setMeasured] = useState<Record<string, string>>({});

  const loadIqc = () => apiClient.get<{ items: IqcLot[] }>("/api/wms/iqc/pending", { limit: 100 })
    .then((r) => setLots(r.items ?? []))
    .catch((e) => say(false, String(e?.message ?? e)));

  const openLot = async (id: string) => {
    try {
      const r = await apiClient.get<IqcDetail>(`/api/wms/iqc/lot/${id}`);
      setDetail(r);
      setMeasured({});
    } catch (e) { say(false, String(e instanceof Error ? e.message : e)); }
  };

  const judge = async (result: "pass" | "fail" | "exempt") => {
    if (!detail) return;
    try {
      const body = result === "exempt"
        ? { reason: zh ? "作业台免检确认" : "Exempt by console" }
        : { result, items: detail.items.map((i) => ({ id: i.id, measuredValue: measured[i.id] ?? i.measuredValue ?? "", isPass: result === "pass" })) };
      const path = result === "exempt" ? "exempt-confirm" : "judge";
      await apiClient.post(`/api/wms/iqc/lot/${detail.id}/${path}`, body);
      say(true, `${detail.lotNo} → ${result}`);
      setDetail(null);
      await loadIqc();
    } catch (e) { say(false, String(e instanceof Error ? e.message : e)); }
  };

  // ── 领料 ──
  const [orders, setOrders] = useState<PickOrder[]>([]);
  const loadPicks = () => apiClient.get<{ items: PickOrder[] }>("/api/wms/picking-orders")
    .then((r) => setOrders(r.items ?? []))
    .catch((e) => say(false, String(e?.message ?? e)));

  const pickAction = async (o: PickOrder, kind: "approve" | "pick" | "receive") => {
    try {
      const body = kind === "approve" ? { approved: true }
        : kind === "pick"
          ? { items: o.items.map((i) => ({ id: i.id, actualQty: Number(i.pickQty) })) }
          : { items: o.items.map((i) => ({ id: i.id, receivedQty: Number(i.actualQty ?? i.pickQty) })) };
      await apiClient.post(`/api/wms/picking-orders/${o.id}/${kind}`, body);
      say(true, `${o.pickingNo} ${kind} ok`);
      await loadPicks();
    } catch (e) { say(false, String(e instanceof Error ? e.message : e)); }
  };

  // ── 盘点 ──
  const [sessions, setSessions] = useState<CountSession[]>([]);
  const [activeSession, setActiveSession] = useState<CountSession | null>(null);
  const [countItems, setCountItems] = useState<CountItem[]>([]);
  const [report, setReport] = useState<CountReport | null>(null);

  const loadSessions = () => apiClient.get<{ items: CountSession[] }>("/api/wms/count/open", { limit: 50 })
    .then((r) => setSessions(r.items ?? []))
    .catch((e) => say(false, String(e?.message ?? e)));

  const openSession = async (s: CountSession) => {
    try {
      const r = await apiClient.get<{ items: CountItem[] }>(`/api/wms/count-sessions/${s.id}/items`);
      setCountItems(r.items ?? []);
      const rep = await apiClient.get<CountReport>(`/api/wms/count-sessions/${s.id}/report`);
      setReport(rep);
      setActiveSession(s);
    } catch (e) { say(false, String(e instanceof Error ? e.message : e)); }
  };

  const adjust = async (it: CountItem, qty: number) => {
    if (!activeSession) return;
    try {
      await apiClient.post(`/api/wms/count-sessions/${activeSession.id}/item/${it.id}/adjust`, { countedQty: qty });
      await openSession(activeSession);
    } catch (e) { say(false, String(e instanceof Error ? e.message : e)); }
  };

  const sessionAction = async (kind: "confirm-result" | "approve" | "cancel" | "unlock") => {
    if (!activeSession) return;
    try {
      await apiClient.post(`/api/wms/count-sessions/${activeSession.id}/${kind}`, {});
      say(true, `${activeSession.sessionCode} ${kind} ok`);
      setActiveSession(null); setReport(null);
      await loadSessions();
    } catch (e) { say(false, String(e instanceof Error ? e.message : e)); }
  };

  // ── 库存汇总 ──
  const [stock, setStock] = useState<StockRow[]>([]);
  const [stockMeta, setStockMeta] = useState<{ total: number; totalQty: number } | null>(null);
  const [q, setQ] = useState("");
  const loadStock = () => apiClient.get<StockRow[]>("/api/wms/inventory/stock-summary", { q })
    .then((r) => {
      const rows = r ?? [];
      setStock(rows);
      setStockMeta({ total: rows.length, totalQty: rows.reduce((a, b) => a + Number(b.totalQty || 0), 0) });
    })
    .catch((e) => say(false, String(e?.message ?? e)));

  const exportStock = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/wms/inventory/stock-summary/export`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "stock-summary.csv"; a.click();
      URL.revokeObjectURL(url);
      say(true, zh ? "已导出 stock-summary.csv" : "stock-summary.csv saved");
    } catch (e) {
      say(false, String(e instanceof Error ? e.message : e));
    }
  };

  // ── 有效期 ──
  const [expiry, setExpiry] = useState<ExpiryByMaterial[]>([]);
  const [extLot, setExtLot] = useState("");
  const [extDate, setExtDate] = useState("");
  const loadExpiry = () => apiClient.get<ExpiryByMaterial[]>("/api/wms/inventory-expiry/by-material")
    .then((r) => setExpiry(r ?? []))
    .catch((e) => say(false, String(e?.message ?? e)));

  const extend = async () => {
    if (!extLot || !extDate) return say(false, zh ? "需要批次号与新有效期" : "lotNo + newExpiry required");
    try {
      await apiClient.post("/api/wms/inventory-expiry/extend-by-batch", { lotNo: extLot, newExpiry: extDate });
      say(true, `${extLot} → ${extDate}`);
      setExtLot(""); setExtDate("");
      await loadExpiry();
    } catch (e) { say(false, String(e instanceof Error ? e.message : e)); }
  };

  useEffect(() => { loadIqc(); loadPicks(); loadSessions(); loadStock(); loadExpiry(); }, []);

  const tabs: [Tab, string][] = [
    ["iqc", zh ? "IQC 检验" : "IQC"],
    ["picking", zh ? "领料" : "Picking"],
    ["count", zh ? "盘点" : "Count"],
    ["stock", zh ? "库存汇总" : "Stock"],
    ["expiry", zh ? "有效期" : "Expiry"],
  ];

  return (
    <div style={{ padding: 16, color: "var(--fg)" }}>
      <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>{zh ? "移植作业台" : "Grafted WMS Console"}</h2>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
        {zh ? "IQC 判定 / 领料审批拣料接收 / 盘点确认 / 库存导出 / 有效期延期 —— 全部落到真实数据表"
            : "IQC judge · picking approve/pick/receive · count confirm · stock export · expiry extension"}
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {tabs.map(([k, label]) => (
          <button key={k} style={btn(tab === k)} onClick={() => { setTab(k); setMsg(null); }}>{label}</button>
        ))}
      </div>
      <Feedback msg={msg} />

      {tab === "iqc" && (
        <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 12 }}>
          <div style={box}>
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 6 }}>{zh ? `待检 ${lots.length}` : `Pending ${lots.length}`}</div>
            {lots.map((l) => (
              <div key={l.id} onClick={() => openLot(l.id)}
                   style={{ ...cell, cursor: "pointer", background: detail?.id === l.id ? "var(--surface-2, transparent)" : undefined }}>
                <div style={{ fontWeight: 600 }}>{l.lotNo}</div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>{l.materialCode} · {l.totalQty} {l.unit ?? ""}</div>
              </div>
            ))}
            {!lots.length && <div style={{ fontSize: 13, color: "var(--muted)" }}>{zh ? "无待检批次" : "No pending lots"}</div>}
          </div>
          <div style={box}>
            {!detail && <div style={{ fontSize: 13, color: "var(--muted)" }}>{zh ? "选择左侧批次录入检验结果" : "Pick a lot to inspect"}</div>}
            {detail && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{detail.lotNo}</div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>
                      {detail.materialCode} {detail.materialName} · {detail.totalQty} {detail.unit} · {detail.status}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button style={btn()} onClick={() => judge("pass")}>{zh ? "合格" : "Pass"}</button>
                    <button style={btn()} onClick={() => judge("fail")}>{zh ? "不合格" : "Fail"}</button>
                    <button style={btn()} onClick={() => judge("exempt")}>{zh ? "免检" : "Exempt"}</button>
                  </div>
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr>
                    <th style={cell}>{zh ? "项目" : "Item"}</th><th style={cell}>{zh ? "标准" : "Std"}</th>
                    <th style={cell}>{zh ? "实测值" : "Measured"}</th><th style={cell}>{zh ? "结果" : "Result"}</th>
                  </tr></thead>
                  <tbody>
                    {detail.items.map((i) => (
                      <tr key={i.id}>
                        <td style={cell}>{i.itemName}</td>
                        <td style={cell}>{i.standard ?? "-"}</td>
                        <td style={cell}>
                          <input value={measured[i.id] ?? i.measuredValue ?? ""} onChange={(e) => setMeasured((m) => ({ ...m, [i.id]: e.target.value }))}
                                 style={{ width: 120, padding: 4, background: "transparent", color: "var(--fg)", border: "1px solid var(--border)", borderRadius: 4 }} />
                        </td>
                        <td style={cell}>{i.isPass === null ? "-" : i.isPass ? "OK" : "NG"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!detail.items.length && <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 8 }}>{zh ? "该批次无检验项（可从模板补）" : "No inspection items"}</div>}
              </>
            )}
          </div>
        </div>
      )}

      {tab === "picking" && (
        <div style={box}>
          <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 6 }}>{zh ? `领料单 ${orders.length}` : `Orders ${orders.length}`}</div>
          {orders.map((o) => (
            <div key={o.id} style={{ borderBottom: "1px solid var(--border)", padding: "8px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <span style={{ fontWeight: 600 }}>{o.pickingNo}</span>
                  <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: 8 }}>
                    {o.workOrderNo ?? "-"} · {o.workSection ?? ""} · {o.status} · {o.totalQty}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button style={btn()} onClick={() => pickAction(o, "approve")}>{zh ? "审批" : "Approve"}</button>
                  <button style={btn()} onClick={() => pickAction(o, "pick")}>{zh ? "拣料" : "Pick"}</button>
                  <button style={btn()} onClick={() => pickAction(o, "receive")}>{zh ? "接收" : "Receive"}</button>
                </div>
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                {o.items.map((i) => `${i.materialCode} ${i.materialName ?? ""} 要求 ${i.pickQty} / 实拣 ${i.actualQty ?? "-"} / 实收 ${i.receivedQty ?? "-"}`).join("；")}
              </div>
            </div>
          ))}
          {!orders.length && <div style={{ fontSize: 13, color: "var(--muted)" }}>{zh ? "无领料单" : "No picking orders"}</div>}
        </div>
      )}

      {tab === "count" && (
        <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 12 }}>
          <div style={box}>
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 6 }}>{zh ? `进行中盘点 ${sessions.length}` : `Open ${sessions.length}`}</div>
            {sessions.map((s) => (
              <div key={s.id} onClick={() => openSession(s)} style={{ ...cell, cursor: "pointer" }}>
                <div style={{ fontWeight: 600 }}>{s.sessionCode}</div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>{s.locationCode ?? "-"} · {s.status}</div>
              </div>
            ))}
            {!sessions.length && <div style={{ fontSize: 13, color: "var(--muted)" }}>{zh ? "无进行中盘点" : "No open sessions"}</div>}
          </div>
          <div style={box}>
            {!activeSession && <div style={{ fontSize: 13, color: "var(--muted)" }}>{zh ? "选择左侧盘点单" : "Pick a session"}</div>}
            {activeSession && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ fontWeight: 600 }}>{activeSession.sessionCode}</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button style={btn()} onClick={() => sessionAction("confirm-result")}>{zh ? "确认结果" : "Confirm"}</button>
                    <button style={btn()} onClick={() => sessionAction("approve")}>{zh ? "审批" : "Approve"}</button>
                    <button style={btn()} onClick={() => sessionAction("unlock")}>{zh ? "解锁" : "Unlock"}</button>
                    <button style={btn()} onClick={() => sessionAction("cancel")}>{zh ? "取消" : "Cancel"}</button>
                  </div>
                </div>
                {report && <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
                  {zh ? `差异超阈值 ${report.overThreshold} 项` : `${report.overThreshold} item(s) over threshold`}
                </div>}
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr>
                    <th style={cell}>{zh ? "物料" : "Material"}</th><th style={cell}>{zh ? "账面" : "System"}</th>
                    <th style={cell}>{zh ? "实盘" : "Counted"}</th><th style={cell}>{zh ? "差异" : "Variance"}</th>
                    <th style={cell}>{zh ? "录数" : "Enter"}</th>
                  </tr></thead>
                  <tbody>
                    {countItems.map((it) => (
                      <tr key={it.id}>
                        <td style={cell}>{it.materialCode}</td>
                        <td style={cell}>{it.systemQty}</td>
                        <td style={cell}>{it.countedQty ?? "-"}</td>
                        <td style={cell}>{it.variance ?? "-"}</td>
                        <td style={cell}>
                          <input defaultValue={String(it.countedQty ?? "")} type="number" min={0}
                                 onBlur={(e) => { const v = Number(e.target.value); if (e.target.value !== "" && v !== Number(it.countedQty)) adjust(it, v); }}
                                 style={{ width: 90, padding: 4, background: "transparent", color: "var(--fg)", border: "1px solid var(--border)", borderRadius: 4 }} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </div>
      )}

      {tab === "stock" && (
        <div style={box}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={zh ? "物料编码/名称" : "code/name"}
                   style={{ padding: 6, background: "transparent", color: "var(--fg)", border: "1px solid var(--border)", borderRadius: 6, width: 240 }} />
            <button style={btn()} onClick={loadStock}>{zh ? "查询" : "Search"}</button>
            <button style={btn()} onClick={exportStock}>{zh ? "导出 CSV" : "Export CSV"}</button>
            {stockMeta && <span style={{ fontSize: 12, color: "var(--muted)" }}>{zh ? `${stockMeta.total} 种物料 · 合计 ${stockMeta.totalQty}` : `${stockMeta.total} materials · ${stockMeta.totalQty}`}</span>}
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={cell}>{zh ? "编码" : "Code"}</th><th style={cell}>{zh ? "名称" : "Name"}</th>
              <th style={cell}>{zh ? "单位" : "UOM"}</th><th style={cell}>{zh ? "批次" : "Lots"}</th>
              <th style={cell}>{zh ? "库存" : "Qty"}</th><th style={cell}>{zh ? "预留" : "Reserved"}</th>
            </tr></thead>
            <tbody>
              {stock.slice(0, 200).map((s) => (
                <tr key={s.materialCode}>
                  <td style={cell}>{s.materialCode}</td><td style={cell}>{s.materialName}</td>
                  <td style={cell}>{s.unit}</td><td style={cell}>{s.lotCount}</td>
                  <td style={cell}>{s.totalQty}</td><td style={cell}>{s.reservedQty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "expiry" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 12 }}>
          <div style={box}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                <th style={cell}>{zh ? "编码" : "Code"}</th><th style={cell}>{zh ? "名称" : "Name"}</th>
                <th style={cell}>{zh ? "批次" : "Lots"}</th><th style={cell}>{zh ? "已过期" : "Expired"}</th>
                <th style={cell}>≤7d</th><th style={cell}>≤30d</th><th style={cell}>{zh ? "最近到期" : "Soonest"}</th>
              </tr></thead>
              <tbody>
                {expiry.map((e) => (
                  <tr key={e.materialCode}>
                    <td style={cell}>{e.materialCode}</td><td style={cell}>{e.materialName}</td>
                    <td style={cell}>{e.lotCount}</td><td style={{ ...cell, color: e.expiredLots ? "var(--error)" : undefined }}>{e.expiredLots}</td>
                    <td style={cell}>{e.d7Lots}</td><td style={cell}>{e.d30Lots}</td>
                    <td style={cell}>{e.soonestExpiry ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={box}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>{zh ? "按批次延期" : "Extend by batch"}</div>
            <input value={extLot} onChange={(e) => setExtLot(e.target.value)} placeholder={zh ? "批次号" : "lot no"}
                   style={{ width: "100%", padding: 6, marginBottom: 8, background: "transparent", color: "var(--fg)", border: "1px solid var(--border)", borderRadius: 6 }} />
            <input value={extDate} onChange={(e) => setExtDate(e.target.value)} type="date"
                   style={{ width: "100%", padding: 6, marginBottom: 8, background: "transparent", color: "var(--fg)", border: "1px solid var(--border)", borderRadius: 6 }} />
            <button style={btn(true)} onClick={extend}>{zh ? "延期" : "Extend"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
