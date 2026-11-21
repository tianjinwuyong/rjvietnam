// MES-ruijing W9 前端 —— 员工资质（CRUD 由 GenericList 驱动）+ 工程变更 ECN/PCN
// 后端路由（services/api/src/routes/mesrj.js）：
//   GET  /emp/overview | /emp/check | /emp/exam/entry | /emp/exam/import
//   POST /emp/login | /emp/logout | /emp/duty | /emp/auth | /emp/auth/revoke
//   GET  /emp/auth/list
//   GET  /ecn/meta | /ecn/list | /ecn/:ecn_no
//   POST /ecn/create | /ecn/:ecn_no/update | /ecn/:ecn_no/evaluate
//   POST /ecn/:ecn_no/items ; DEL /ecn/item/:item_id ; POST /ecn/item/:item_id/done
//   POST /ecn/:ecn_no/submit | /ecn/:ecn_no/approve | /ecn/:ecn_no/effective
//   POST /ecn/:ecn_no/fai | /ecn/:ecn_no/close | /ecn/:ecn_no/cancel | /ecn/:ecn_no/customer
//   GET  /ecn/pass-warn
import { useCallback, useEffect, useRef, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { mesrjApi, MesrjApiError } from "./api";
import { t } from "./i18n";

const box = { border: "1px solid var(--border, #e2e8f0)", borderRadius: 10, padding: 14, marginBottom: 14 } as const;
const inp = { padding: "6px 8px", marginRight: 6, border: "1px solid var(--border, #e2e8f0)", borderRadius: 6 } as const;
const btn = { padding: "6px 12px", marginRight: 6, borderRadius: 6, border: "1px solid var(--border, #e2e8f0)", background: "#fff", cursor: "pointer" } as const;
const btnPrim = { ...btn, background: "#2563eb", color: "#fff", borderColor: "#2563eb" } as const;
const rowStyle = (st: string) => {
  const c: Record<string, string> = {
    草稿: "#6b7280", "待审批": "#6366f1", "已批准": "#7c3aed", "执行中": "#2563eb",
    "待验证": "#d97706", "已关闭": "#15803d", "已拒绝": "#b91c1c", "已取消": "#9ca3af",
  };
  return { color: c[st] || "#374151", fontWeight: 600 };
};
function Err({ msg }: { msg: string }) {
  if (!msg) return null;
  return <div style={{ color: "#b91c1c", padding: "6px 0", fontSize: 13, whiteSpace: "pre-wrap" }}>{msg}</div>;
}
function Ok({ msg }: { msg: string }) {
  if (!msg) return null;
  return <div style={{ color: "#15803d", padding: "6px 0", fontSize: 13, whiteSpace: "pre-wrap" }}>{msg}</div>;
}
async function call<T>(fn: () => Promise<T>): Promise<[T | null, string]> {
  try { return [await fn(), ""]; }
  catch (ex) { return [null, ex instanceof MesrjApiError ? ex.message : String(ex)]; }
}

interface EcNRow {
  ecn_no: string; ecn_type: string; title: string; product_code: string; product_model: string;
  old_material: string; new_material: string; status: string; risk_level: string;
  owner: string; dept: string; effectivity: string; need_fai: number; need_customer: number;
  block_pass: number; created_at: string; impact_verdict: string; open_mo_count: number;
  wip_qty: number; old_stock: number;
}

export function EcNView({ locale }: { locale: Locale }) {
  const [rows, setRows] = useState<EcNRow[]>([]);
  const [stats, setStats] = useState<Record<string, unknown>>({});
  const [kw, setKw] = useState("");
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [sel, setSel] = useState<EcNRow | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const loading = useRef(false);

  const load = useCallback(async () => {
    loading.current = true;
    try {
      const [d, e] = await call(() => mesrjApi.get<{ rows: EcNRow[]; stats: Record<string, unknown> }>(
        "/ecn/list", { kw, status, type, limit: 200 }));
      if (e || !d) { setErr(e || "未返回数据"); return; }
      setRows(d.rows); setStats(d.stats); setErr("");
    } finally { loading.current = false; }
  }, [kw, status, type]);

  useEffect(() => { void load(); }, [load]);

  const types = ["ECN", "PCN", "DEV"];
  const statuses = ["草稿", "待审批", "已批准", "执行中", "待验证", "已关闭", "已拒绝", "已取消", "未完结"];

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 10 }}>{t("menu.qlt.ecn", locale)}</div>
      <Ok msg={msg} /><Err msg={err} />
      <div style={{ display: "flex", gap: 10, alignItems: "end", marginBottom: 10, flexWrap: "wrap" }}>
        <input {...inp} placeholder={t("ecn.ecn_no", locale)} value={kw}
          onChange={ev => { setKw(ev.target.value); void load(); }} />
        <select value={status} onChange={ev => { setStatus(ev.target.value); void load(); }} style={inp}>
          <option value="">{t("ecn.status", locale)}</option>
          {statuses.map(s => <option key={s} value={s}>{t(`status.${s}`, locale)}</option>)}
        </select>
        <select value={type} onChange={ev => { setType(ev.target.value); void load(); }} style={inp}>
          <option value="">{t("ecn.ecn_type", locale)}</option>
          {types.map(tp => <option key={tp} value={tp}>{tp}</option>)}
        </select>
        <button {...btnPrim} disabled={loading.current} onClick={void load}>
          {t("common.new", locale)}
        </button>
      </div>
      <div style={box}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "2px solid var(--border, #e2e8f0)" }}>
              <th style={{ padding: "8px 6px" }}>{t("ecn.ecn_no", locale)}</th>
              <th style={{ padding: "8px 6px" }}>{t("ecn.title", locale)}</th>
              <th style={{ padding: "8px 6px", width: 70 }}>{t("ecn.ecn_type", locale)}</th>
              <th style={{ padding: "8px 6px", width: 120 }}>{t("ecn.product_code", locale)}</th>
              <th style={{ padding: "8px 6px" }}>{t("ecn.old_material", locale)} → {t("ecn.new_material", locale)}</th>
              <th style={{ padding: "8px 6px", width: 90 }}>{t("ecn.status", locale)}</th>
              <th style={{ padding: "8px 6px", width: 70 }}>{t("ecn.risk_level", locale)}</th>
              <th style={{ padding: "8px 6px", width: 120 }}>{t("ecn.created_at", locale)}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.ecn_no} style={{ cursor: "pointer", borderBottom: "1px solid var(--border, #e2e8f0)" }}
                onClick={() => setSel(sel?.ecn_no === r.ecn_no ? null : r)}>
                <td style={{ padding: "7px 6px", fontWeight: 600 }}>{r.ecn_no}</td>
                <td style={{ padding: "7px 6px" }}>{r.title}</td>
                <td style={{ padding: "7px 6px" }}>{r.ecn_type}</td>
                <td style={{ padding: "7px 6px" }}>{r.product_code}</td>
                <td style={{ padding: "7px 6px" }}>{r.old_material || "—"} → {r.new_material || "—"}</td>
                <td style={{ padding: "7px 6px", ...rowStyle(r.status) }}>{t(`status.${r.status}`, locale)}</td>
                <td style={{ padding: "7px 6px" }}>{r.risk_level}</td>
                <td style={{ padding: "7px 6px", color: "#6b7280" }}>{r.created_at}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={8} style={{ padding: 10, color: "#6b7280" }}>{t("common.loadFail", locale) || "暂无数据"}</td></tr>}
          </tbody>
        </table>
      </div>
      {stats && (
        <div style={{ fontSize: 12, color: "#6b7280", marginTop: 8 }}>
          {`${t("ecn.open_mo_count", locale)}: ${stats.open}  ·  ${t("menu.ecn.submit", locale)}: ${stats.pending_approve}  ·  ${t("status.执行中", locale)}: ${stats.executing}  ·  ${t("status.待验证", locale)}: ${stats.verifying}  ·  ${t("ecn.overdue", locale)}: ${stats.overdue}  ·  ${t("ecn.new_in_range", locale)}: ${stats.new_in_range}`}
        </div>
      )}
      {sel && <div style={{ marginTop: 14, ...box }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>{sel.ecn_no} — {sel.title}</div>
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
          {t("ecn.status", locale)}: {t(`status.${sel.status}`, locale)}  ·  {t("ecn.risk_level", locale)}: {sel.risk_level}  ·
          {t("ecn.owner", locale)}: {sel.owner}  ·  {t("ecn.dept", locale)}: {sel.dept}
        </div>
        <div style={{ marginBottom: 8 }}>{sel.impact_verdict || t("ecn.impact_verdict", locale)}</div>
        <div style={{ marginBottom: 8 }}>
          <button {...btn} disabled={loading.current || sel.status !== "待审批"} onClick={async () => {
            const [d, e] = await call(() => mesrjApi.post<{ msg?: string }>(`/ecn/${sel.ecn_no}/submit`));
            if (e) setErr(e); else { setMsg(d?.msg || "已提交"); setSel(null); void load(); }
          }}>{t("menu.ecn.submit", locale)}</button>
          <button {...btn} disabled={loading.current || sel.status !== "待审批"} onClick={async () => {
            const ok = window.confirm("确定驳回？");
            if (!ok) return;
            const [d, e] = await call(() => mesrjApi.post<{ msg?: string }>(`/ecn/${sel.ecn_no}/approve`, { ok: false, opinion: "" }));
            if (e) setErr(e); else { setMsg(d?.msg || "已驳回"); setSel(null); void load(); }
          }}>{t("menu.ecn.approve", locale)}</button>
          <button {...btn} disabled={loading.current || !["已批准", "执行中", "待验证"].includes(sel.status)} onClick={async () => {
            const [d, e] = await call(() => mesrjApi.post<{ msg?: string }>(`/ecn/${sel.ecn_no}/fai`, { result: "OK", note: "" }));
            if (e) setErr(e); else { setMsg(d?.msg || "FAI 已记录"); setSel(null); void load(); }
          }}>{t("menu.ecn.fai", locale)}</button>
          <button {...btn} disabled={loading.current || sel.status === "已关闭"} onClick={async () => {
            const [d, e] = await call(() => mesrjApi.post<{ msg?: string }>(`/ecn/${sel.ecn_no}/close`, { note: "" }));
            if (e) setErr(e); else { setMsg(d?.msg || "已关闭"); setSel(null); void load(); }
          }}>{t("menu.ecn.close", locale)}</button>
          <button {...btn} disabled={loading.current || ["已关闭", "已取消"].includes(sel.status)} onClick={async () => {
            const note = window.prompt("作废原因（执行中必填）", "");
            if (note === null) return;
            const [d, e] = await call(() => mesrjApi.post<{ msg?: string }>(`/ecn/${sel.ecn_no}/cancel`, { note: note || "" }));
            if (e) setErr(e); else { setMsg(d?.msg || "已作废"); setSel(null); void load(); }
          }}>{t("menu.ecn.cancel", locale)}</button>
        </div>
      </div>}
    </div>
  );
}
