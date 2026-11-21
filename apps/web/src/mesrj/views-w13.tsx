// MES-ruijing W13 前端 —— 时效（Dwell Time）管控（源 web/pages.js「时效超期」页 + api/dwell.py）
// 路由（后端 services/api/src/routes/mesrj.js）：
//   GET  /dwell/rules       规则清单
//   GET  /dwell/meta        下拉选项
//   POST /dwell/rule/save   新增 / 修改
//   POST /dwell/rule/delete 删除
//   GET  /dwell/overdue     超期清单（days 默认 7）
//   POST /dwell/scan        立即扫描（写预警中心）
//   GET  /dwell/check       单颗 SN 时效体检
import { useCallback, useEffect, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { mesrjApi } from "./api";
import { t } from "./i18n";

const box = { border: "1px solid var(--border, #e2e8f0)", borderRadius: 10, padding: 14, marginBottom: 14 } as const;
const inp = { padding: "6px 8px", marginRight: 6 } as const;

function Err({ msg }: { msg: string }) {
  if (!msg) return null;
  return <div style={{ color: "#b91c1c", padding: "6px 0", fontSize: 13, whiteSpace: "pre-wrap" }}>{msg}</div>;
}
function Ok({ msg }: { msg: string }) {
  if (!msg) return null;
  return <div style={{ color: "#15803d", padding: "6px 0", fontSize: 13, whiteSpace: "pre-wrap" }}>{msg}</div>;
}
function Table({ header, rows }: { header: [string, string][]; rows: Record<string, unknown>[] }) {
  if (rows.length === 0) return <div style={{ color: "#94a3b8", fontSize: 13 }}>No data</div>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            {header.map(([key, label]) => (
              <th key={key} style={{ padding: "6px 8px", borderBottom: "1px solid var(--border, #e2e8f0)", textAlign: "left" }}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
              {header.map(([key]) => <td key={key} style={{ padding: "5px 8px" }}>{String(r[key] ?? "")}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface RuleRow {
  id: number; rule_name: string; from_key: string; to_key: string; max_hours: number;
  action: string; enabled: number; remark: string; from_name?: string; to_name?: string;
}
interface Meta {
  processes: { key: string; name: string }[];
  types: { key: string; name: string; process_code: string }[];
  stations: { key: string; name: string }[];
}
interface Overdue {
  total: number; serious: number; truncated: boolean;
  items: Record<string, unknown>[];
  by_station: { station: string; qty: number }[];
}

export function DwellView({ locale }: { locale: Locale }) {
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  // 表单：id=0 表示新增
  const [form, setForm] = useState({ id: 0, rule_name: "", from_key: "", to_key: "", max_hours: "2", action: "预警", enabled: 1, remark: "" });

  const [days, setDays] = useState("7");
  const [overdue, setOverdue] = useState<Overdue | null>(null);
  const [sn, setSn] = useState("");
  const [gaps, setGaps] = useState<Record<string, unknown>[] | null>(null);

  const loadRules = useCallback(async () => {
    setBusy(true);
    try { setRules(await mesrjApi.get<RuleRow[]>("/dwell/rules")); }
    catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => {
    loadRules();
    mesrjApi.get<Meta>("/dwell/meta").then(setMeta).catch(() => setMeta(null));
  }, [loadRules]);

  const reloadOverdue = async () => {
    setBusy(true); setErr(""); setMsg("");
    try { setOverdue(await mesrjApi.get<Overdue>("/dwell/overdue", { days })); }
    catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
    finally { setBusy(false); }
  };

  const save = async () => {
    setErr(""); setMsg("");
    try {
      await mesrjApi.post("/dwell/rule/save", {
        ...form, max_hours: Number(form.max_hours || 0), enabled: form.enabled ? 1 : 0,
      });
      setMsg(t("dwell.msg.saved", locale));
      setForm({ id: 0, rule_name: "", from_key: "", to_key: "", max_hours: "2", action: "预警", enabled: 1, remark: "" });
      await loadRules();
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
  };

  const remove = async (id: number) => {
    setErr(""); setMsg("");
    try {
      await mesrjApi.post("/dwell/rule/delete", { id });
      setMsg(t("dwell.msg.deleted", locale));
      await loadRules();
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
  };

  const scan = async () => {
    setBusy(true); setErr(""); setMsg("");
    try {
      const r = await mesrjApi.post<{ total: number }>("/dwell/scan", { days: Number(days || 7) });
      setMsg(`${t("dwell.msg.scanned", locale)}：${r.total}`);
      await reloadOverdue();
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
    finally { setBusy(false); }
  };

  const checkSn = async () => {
    if (!sn) return;
    setErr(""); setMsg(""); setGaps(null);
    try {
      const r = await mesrjApi.get<{ sn: string; gaps: Record<string, unknown>[]; msg?: string }>("/dwell/check", { sn });
      setGaps(r.gaps); if (r.msg) setMsg(r.msg);
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
  };

  // 可选的键：工位编码 / 工序:类型 / 类型 / 工序（与后端匹配粒度一致，从精确到宽泛）
  const keyOptions: { key: string; name: string }[] = [];
  if (meta) {
    for (const s of meta.stations) keyOptions.push({ key: s.key, name: s.name });
    for (const ty of meta.types) keyOptions.push({ key: `${ty.process_code}:${ty.key}`, name: `${ty.process_code} 段 · ${ty.key}` });
    for (const ty of meta.types) keyOptions.push({ key: ty.key, name: `${ty.name}（工位类型）` });
    for (const p of meta.processes) keyOptions.push({ key: p.key, name: `${p.name}（整段）` });
  }

  return (
    <div>
      <div style={box}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{t("dwell.title.rules", locale)}</div>
        <Err msg={err} />
        <Ok msg={msg} />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "flex-end", marginBottom: 10 }}>
          <input value={form.rule_name} onChange={e => setForm({ ...form, rule_name: e.target.value })}
            placeholder={t("dwell.field.ruleName", locale)} style={{ ...inp, width: 180 }} />
          <select value={form.from_key} onChange={e => setForm({ ...form, from_key: e.target.value })} style={inp}>
            <option value="">{t("dwell.field.from", locale)}</option>
            {keyOptions.map(o => <option key={`f-${o.key}`} value={o.key}>{o.name}</option>)}
          </select>
          <span style={{ margin: "0 4px" }}>→</span>
          <select value={form.to_key} onChange={e => setForm({ ...form, to_key: e.target.value })} style={inp}>
            <option value="">{t("dwell.field.to", locale)}</option>
            {keyOptions.map(o => <option key={`t-${o.key}`} value={o.key}>{o.name}</option>)}
          </select>
          <input value={form.max_hours} onChange={e => setForm({ ...form, max_hours: e.target.value })}
            placeholder="H" style={{ ...inp, width: 70 }} />
          <select value={form.action} onChange={e => setForm({ ...form, action: e.target.value })} style={inp}>
            <option value="预警">{t("dwell.action.warn", locale)}</option>
            <option value="拦截">{t("dwell.action.block", locale)}</option>
          </select>
          <label style={{ fontSize: 12 }}>
            <input type="checkbox" checked={!!form.enabled}
              onChange={e => setForm({ ...form, enabled: e.target.checked ? 1 : 0 })} /> {t("dwell.field.enabled", locale)}
          </label>
          <input value={form.remark} onChange={e => setForm({ ...form, remark: e.target.value })}
            placeholder={t("dwell.field.remark", locale)} style={{ ...inp, width: 200 }} />
          <button onClick={save} disabled={busy}>{form.id ? t("common.save", locale) : t("common.add", locale)}</button>
          {form.id ? (
            <button onClick={() => setForm({ id: 0, rule_name: "", from_key: "", to_key: "", max_hours: "2", action: "预警", enabled: 1, remark: "" })}>
              {t("common.cancel", locale)}
            </button>
          ) : null}
        </div>
        <Table
          header={[
            ["rule_name", t("dwell.field.ruleName", locale)],
            ["from_name", t("dwell.field.from", locale)],
            ["to_name", t("dwell.field.to", locale)],
            ["max_hours", t("dwell.field.maxHours", locale)],
            ["action", t("dwell.field.action", locale)],
            ["enabled", t("dwell.field.enabled", locale)],
            ["remark", t("dwell.field.remark", locale)],
          ]}
          rows={rules.map(r => ({ ...r, enabled: r.enabled ? "✓" : "" }))}
        />
        <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
          {rules.map(r => (
            <span key={r.id} style={{ fontSize: 12 }}>
              <a href="#" onClick={e => {
                e.preventDefault();
                setForm({
                  id: r.id, rule_name: r.rule_name || "", from_key: r.from_key || "", to_key: r.to_key || "",
                  max_hours: String(r.max_hours ?? 0), action: r.action || "预警",
                  enabled: Number(r.enabled || 0) ? 1 : 0, remark: r.remark || "",
                });
              }}>{r.id}</a>{" "}
              <a href="#" onClick={e => { e.preventDefault(); remove(r.id); }} style={{ color: "#b91c1c" }}>
                {t("common.delete", locale)}
              </a>
            </span>
          ))}
        </div>
      </div>

      <div style={box}>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{t("dwell.title.overdue", locale)}</div>
          <input value={days} onChange={e => setDays(e.target.value)} style={{ ...inp, width: 70 }} />
          <button onClick={reloadOverdue} disabled={busy}>{t("snlist.search", locale)}</button>
          <button onClick={scan} disabled={busy}>{t("dwell.btn.scan", locale)}</button>
          {overdue ? (
            <span style={{ fontSize: 12, color: "#64748b" }}>
              {t("dwell.field.total", locale)} {overdue.total} · {t("dwell.field.serious", locale)} {overdue.serious}
              {overdue.truncated ? ` · ${t("dwell.field.truncated", locale)}` : ""}
            </span>
          ) : null}
        </div>
        <Table
          header={[
            ["sn", t("sn.field.sn", locale)],
            ["mo_no", t("sn.field.mo_no", locale)],
            ["station_name", t("station.field.station_name", locale)],
            ["pass_time", t("dwell.field.passTime", locale)],
            ["hours", t("dwell.field.hours", locale)],
            ["max_hours", t("dwell.field.maxHours", locale)],
            ["over", t("dwell.field.over", locale)],
            ["rule_name", t("dwell.field.ruleName", locale)],
            ["action", t("dwell.field.action", locale)],
          ]}
          rows={overdue?.items || []}
        />
      </div>

      <div style={box}>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{t("dwell.title.check", locale)}</div>
          <input value={sn} onChange={e => setSn(e.target.value)} placeholder={t("sn.field.sn", locale)} style={{ ...inp, width: 220 }} />
          <button onClick={checkSn}>{t("snlist.search", locale)}</button>
        </div>
        {gaps ? (
          <Table
            header={[
              ["from", t("dwell.field.from", locale)],
              ["to", t("dwell.field.to", locale)],
              ["hours", t("dwell.field.hours", locale)],
              ["max_hours", t("dwell.field.maxHours", locale)],
              ["over", t("dwell.field.over", locale)],
              ["rule_name", t("dwell.field.ruleName", locale)],
              ["action", t("dwell.field.action", locale)],
            ]}
            rows={gaps}
          />
        ) : null}
      </div>
    </div>
  );
}
