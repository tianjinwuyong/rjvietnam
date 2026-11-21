// 工单推送列表（含推送状态 + 单张/批量推送 + 预览）
// 嫁接自 D:\rj\repos\MES-ruijing web 页「工单下发 WMS」的 mo/list 段
import { useState } from "react";
import type { Locale } from "../../../../../../packages/shared-types/src/factory";
import { t } from "../../i18n";
import { itfApi, type MoListResult, type MoPreview } from "../api";

const th: React.CSSProperties = { textAlign: "left", padding: "6px 10px", fontSize: 12, color: "#64748b", borderBottom: "1px solid var(--border, #e2e8f0)", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "6px 10px", fontSize: 13, borderBottom: "1px solid var(--border, #f1f5f9)", whiteSpace: "nowrap" };
const btn: React.CSSProperties = {
  padding: "3px 10px", borderRadius: 8, border: "1px solid var(--border, #cbd5e1)",
  background: "transparent", cursor: "pointer", fontSize: 12, marginRight: 6,
};

export function MoPushTable({ locale }: { locale: Locale }) {
  const [data, setData] = useState<MoListResult | null>(null);
  const [keyword, setKeyword] = useState("");
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [preview, setPreview] = useState<MoPreview | null>(null);

  const load = async (page = 1) => {
    setBusy("load");
    try {
      const d = await itfApi.moList({ page, size: 50, open: onlyOpen ? "1" : "0", po: keyword, line: keyword });
      setData(d);
    } catch (ex) {
      setMsg(ex instanceof Error ? ex.message : String(ex));
    } finally { setBusy(""); }
  };

  const pushOne = async (moNo: string, force = false) => {
    setBusy(moNo); setMsg("");
    try {
      const res = await itfApi.pushOne(moNo, force);
      setMsg((res as { msg?: string } | null)?.msg || t("itf.push_done", locale));
      await load(data?.page || 1);
    } catch (ex) {
      setMsg(ex instanceof Error ? ex.message : String(ex));
    } finally { setBusy(""); }
  };

  const pushAll = async () => {
    if (!window.confirm(t("itf.push_all_confirm", locale))) return;
    setBusy("all"); setMsg("");
    try {
      const r = await itfApi.pushAll(50);
      setMsg(`${t("itf.push_done", locale)}: ${r.ok} / ${r.fail}` +
        (r.detail[0] ? ` — ${r.detail[0].mo_no}: ${r.detail[0].msg}` : ""));
      await load(data?.page || 1);
    } catch (ex) {
      setMsg(ex instanceof Error ? ex.message : String(ex));
    } finally { setBusy(""); }
  };

  const doPreview = async (moNo: string) => {
    setBusy("preview-" + moNo);
    try { setPreview(await itfApi.preview(moNo)); }
    catch (ex) { setMsg(ex instanceof Error ? ex.message : String(ex)); }
    finally { setBusy(""); }
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
        <input value={keyword} onChange={e => setKeyword(e.target.value)}
          placeholder={t("itf.search_ph", locale)}
          style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border, #cbd5e1)", fontSize: 13 }} />
        <label style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={onlyOpen} onChange={e => setOnlyOpen(e.target.checked)} />
          {t("itf.only_open", locale)}
        </label>
        <button style={btn} onClick={() => load(1)}>{t("itf.search", locale)}</button>
        <button style={btn} disabled={busy !== ""} onClick={pushAll}>{t("itf.push_all", locale)}</button>
        {msg ? <span style={{ fontSize: 12, color: "#64748b" }}>{msg}</span> : null}
      </div>

      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={th}>MO</th>
            <th style={th}>{t("itf.product", locale)}</th>
            <th style={th}>{t("itf.plan_qty", locale)}</th>
            <th style={th}>{t("itf.line", locale)}</th>
            <th style={th}>{t("itf.status", locale)}</th>
            <th style={th}>{t("itf.issue", locale)}</th>
            <th style={th}>{t("itf.push_state", locale)}</th>
            <th style={th}></th>
          </tr>
        </thead>
        <tbody>
          {(data?.items || []).map(m => (
            <tr key={m.moNo}>
              <td style={td}><code>{m.moNo}</code></td>
              <td style={td}>{m.productCode} {m.productName}</td>
              <td style={td}>{m.planQty}</td>
              <td style={td}>{m.lineCode}</td>
              <td style={td}>{m.status}</td>
              <td style={td}>{m.issueCount ? `${m.issueNo} (${m.issueStatus})` : "—"}</td>
              <td style={td}>
                {m.push
                  ? <span style={{ color: m.push.ok ? "#16a34a" : "#dc2626" }}>
                      {m.push.ok ? "✓" : "✗"} {m.push.at}{m.push.tries > 1 ? ` ×${m.push.tries}` : ""}
                    </span>
                  : <span style={{ color: "#94a3b8" }}>—</span>}
              </td>
              <td style={td}>
                <button style={btn} disabled={busy !== ""} onClick={() => pushOne(m.moNo)}>{t("itf.push", locale)}</button>
                <button style={btn} disabled={busy !== ""} onClick={() => pushOne(m.moNo, true)}>{t("itf.push_force", locale)}</button>
                <button style={btn} disabled={busy !== ""} onClick={() => doPreview(m.moNo)}>{t("itf.preview", locale)}</button>
              </td>
            </tr>
          ))}
          {!data?.items.length ? (
            <tr><td style={{ ...td, textAlign: "center", color: "#94a3b8" }} colSpan={8}>
              {busy === "load" ? t("loading", locale) : t("itf.empty", locale)}
            </td></tr>
          ) : null}
        </tbody>
      </table>

      {data && data.total > data.pageSize ? (
        <div style={{ marginTop: 8, fontSize: 13 }}>
          <button style={btn} disabled={data.page <= 1} onClick={() => load(data.page - 1)}>←</button>
          <span style={{ margin: "0 8px" }}>{data.page} / {Math.ceil(data.total / data.pageSize)} · {data.total}</span>
          <button style={btn} disabled={!data.hasMore} onClick={() => load(data.page + 1)}>→</button>
        </div>
      ) : null}

      {preview ? (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}
          onClick={() => setPreview(null)}>
          <pre style={{ background: "var(--bg, #fff)", color: "inherit", padding: 16, borderRadius: 12, maxHeight: "70vh", overflow: "auto", fontSize: 12, maxWidth: "80vw" }}>
            {JSON.stringify(preview, null, 2)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
