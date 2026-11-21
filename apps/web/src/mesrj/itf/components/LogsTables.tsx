// 被拉取日志 / 推送状态 / WMS 发料回写记录 三张表
// 嫁接自 D:\rj\repos\MES-ruijing web 页「工单下发 WMS」的 logs/writebacks 段
import { useEffect, useState } from "react";
import type { Locale } from "../../../../../../packages/shared-types/src/factory";
import { t } from "../../i18n";
import { itfApi, type LogRow, type WritebackRow } from "../api";

const th: React.CSSProperties = { textAlign: "left", padding: "6px 10px", fontSize: 12, color: "#64748b", borderBottom: "1px solid var(--border, #e2e8f0)", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "6px 10px", fontSize: 13, borderBottom: "1px solid var(--border, #f1f5f9)", whiteSpace: "nowrap" };

export function LogsTable({ locale }: { locale: Locale }) {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [push, setPush] = useState<{ mo_no: string; at: string; ok: number; tries: number; msg: string }[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    itfApi.logs(200)
      .then(d => { setRows(d.rows || []); setPush(d.push || []); })
      .catch(ex => setErr(ex instanceof Error ? ex.message : String(ex)));
  }, []);

  if (err) return <div style={{ color: "#b91c1c", fontSize: 13 }}>{err}</div>;

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div>
        <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>{t("itf.pull_logs", locale)}</h3>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead><tr>
            <th style={th}>{t("itf.time", locale)}</th><th style={th}>action</th>
            <th style={th}>MO</th><th style={th}>IP</th><th style={th}>ok</th>
            <th style={th}>rows</th><th style={th}>msg</th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td style={td}>{r.at}</td><td style={td}>{r.action}</td>
                <td style={td}>{r.mo_no || "—"}</td><td style={td}>{r.client_ip}</td>
                <td style={{ ...td, color: r.ok ? "#16a34a" : "#dc2626" }}>{r.ok ? "✓" : "✗"}</td>
                <td style={td}>{r.rows}</td><td style={{ ...td, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis" }}>{r.msg}</td>
              </tr>
            ))}
            {!rows.length ? <tr><td style={{ ...td, color: "#94a3b8" }} colSpan={7}>{t("itf.empty", locale)}</td></tr> : null}
          </tbody>
        </table>
      </div>

      <div>
        <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>{t("itf.push_state", locale)}</h3>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead><tr>
            <th style={th}>MO</th><th style={th}>{t("itf.time", locale)}</th>
            <th style={th}>ok</th><th style={th}>tries</th><th style={th}>msg</th>
          </tr></thead>
          <tbody>
            {push.map(r => (
              <tr key={r.mo_no}>
                <td style={td}><code>{r.mo_no}</code></td><td style={td}>{r.at}</td>
                <td style={{ ...td, color: r.ok ? "#16a34a" : "#dc2626" }}>{r.ok ? "✓" : "✗"}</td>
                <td style={td}>{r.tries}</td><td style={{ ...td, maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis" }}>{r.msg}</td>
              </tr>
            ))}
            {!push.length ? <tr><td style={{ ...td, color: "#94a3b8" }} colSpan={5}>{t("itf.empty", locale)}</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function WritebackTable({ locale }: { locale: Locale }) {
  const [rows, setRows] = useState<WritebackRow[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    itfApi.writebacks(200)
      .then(d => setRows(d.rows || []))
      .catch(ex => setErr(ex instanceof Error ? ex.message : String(ex)));
  }, []);

  if (err) return <div style={{ color: "#b91c1c", fontSize: 13 }}>{err}</div>;

  const appliedLabel = (v: number) =>
    v === 1 ? <span style={{ color: "#16a34a" }}>✓</span>
      : v === -1 ? <span style={{ color: "#dc2626" }}>✗ apply</span>
      : <span style={{ color: "#94a3b8" }}>—</span>;

  return (
    <table style={{ borderCollapse: "collapse", width: "100%" }}>
      <thead><tr>
        <th style={th}>{t("itf.time", locale)}</th><th style={th}>{t("itf.issue_no", locale)}</th>
        <th style={th}>MO</th><th style={th}>WMS</th><th style={th}>{t("itf.section", locale)}</th>
        <th style={th}>{t("itf.by", locale)}</th><th style={th}>items</th>
        <th style={th}>{t("itf.total_qty", locale)}</th><th style={th}>{t("itf.applied", locale)}</th>
      </tr></thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.id}>
            <td style={td}>{r.created_at}</td>
            <td style={td}><code>{r.issue_no}</code></td>
            <td style={td}>{r.mo_no}</td>
            <td style={td}>{r.wms_picking_no}</td>
            <td style={td}>{r.work_section}</td>
            <td style={td}>{r.issued_by_name}</td>
            <td style={td}>{r.item_count}</td>
            <td style={td}>{r.total_qty}</td>
            <td style={td}>{appliedLabel(r.applied)}</td>
          </tr>
        ))}
        {!rows.length ? <tr><td style={{ ...td, color: "#94a3b8" }} colSpan={9}>{t("itf.empty", locale)}</td></tr> : null}
      </tbody>
    </table>
  );
}
