// MES-ruijing W16 前端 —— 镭雕发码台账（源 web/pages.js「镭雕发码记录」页 + api/exec.py laser 段）
// 后端（services/api/src/routes/mesrj.js）：
//   GET  /exec/laser/{panel,panels,next-seq,cur-mo,code-health,machines}
//   POST /exec/laser/{cur-mo,backfill,machines}
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
  if (!rows.length) return <div style={{ color: "#94a3b8", fontSize: 13 }}>No data</div>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            {header.map(([k, label]) => (
              <th key={k} style={{ padding: "6px 8px", borderBottom: "1px solid var(--border, #e2e8f0)", textAlign: "left" }}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
              {header.map(([k]) => <td key={k} style={{ padding: "5px 8px" }}>{String(r[k] ?? "")}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface CurMo { mo_no: string; issued: number; mo?: Record<string, unknown> | null }
interface Panels { rows: Record<string, unknown>[]; total: number }
interface Health { mo_no: string; status: string; plan_qty: number; issued: number; filed: number;
  built: number; gap_fill: number; gap_prod: number; pending: string[] }
interface Machine { id: number; machine_no: string; ip: string; line_code: string; enabled: number; remark: string }

export function LaserView({ locale }: { locale: Locale }) {
  const [curMo, setCurMo] = useState<CurMo | null>(null);
  const [moNo, setMoNo] = useState("");
  const [panels, setPanels] = useState<Panels | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [mForm, setMForm] = useState({ machine_no: "", ip: "", line_code: "", remark: "" });
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    try {
      setCurMo(await mesrjApi.get<CurMo>("/exec/laser/cur-mo"));
      setMachines(await mesrjApi.get<Machine[]>("/exec/laser/machines"));
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const loadPanels = async (mo = moNo) => {
    if (!mo) return;
    setErr("");
    try { setPanels(await mesrjApi.get<Panels>("/exec/laser/panels", { mo_no: mo, size: 100 })); }
    catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
  };
  const loadHealth = async (mo = moNo) => {
    if (!mo) return;
    setErr("");
    try { setHealth(await mesrjApi.get<Health>("/exec/laser/code-health", { mo_no: mo })); }
    catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
  };

  const setCurrent = async () => {
    if (!moNo) return;
    setErr("");
    try {
      const r = await mesrjApi.post<{ mo_no: string; panel_size: number; product_model: string }>("/exec/laser/cur-mo", { mo_no: moNo });
      setMsg(`${t("laser.msg.mo", locale)} ${r.mo_no}（${r.product_model}，${r.panel_size} 块/版）`);
      await load();
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
  };

  const backfill = async () => {
    if (!moNo) return;
    setErr("");
    try {
      const r = await mesrjApi.post<{ filled: number; skipped: number }>("/exec/laser/backfill", { mo_no: moNo });
      setMsg(`${t("laser.msg.backfill", locale)}：${r.filled}，跳过 ${r.skipped}`);
      await loadPanels(); await loadHealth();
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
  };

  const saveMachine = async () => {
    setErr("");
    try {
      await mesrjApi.post("/exec/laser/machines", mForm);
      setMForm({ machine_no: "", ip: "", line_code: "", remark: "" });
      setMsg(t("common.save", locale));
      await load();
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
  };
  const delMachine = async (id: number) => {
    try {
      await mesrjApi.del(`/exec/laser/machines/${id}`);
      await load();
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
  };

  return (
    <div>
      <div style={box}>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 12, color: "#64748b" }}>{t("laser.field.mo", locale)}</div>
            <input value={moNo} onChange={e => setMoNo(e.target.value)} style={{ ...inp, width: 200 }} />
          </div>
          <button onClick={setCurrent}>{t("laser.btn.setMo", locale)}</button>
          <button onClick={() => loadPanels(curMo?.mo_no || moNo)}>{t("laser.btn.panels", locale)}</button>
          <button onClick={() => loadHealth(curMo?.mo_no || moNo)}>{t("laser.btn.health", locale)}</button>
          <button onClick={backfill}>{t("laser.btn.backfill", locale)}</button>
          {curMo ? (
            <span style={{ fontSize: 12, color: "#475569" }}>
              {t("laser.field.current", locale)} {curMo.mo_no} · {t("laser.field.issued", locale)} {curMo.issued}
            </span>
          ) : null}
        </div>
        <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 8 }}>
          {t("laser.hint.server", locale)}
        </div>
        <Err msg={err} />
        <Ok msg={msg} />
      </div>

      {health ? (
        <div style={box}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{t("laser.title.health", locale)}</div>
          <div style={{ fontSize: 12, lineHeight: 1.8 }}>
            {t("laser.field.issued", locale)} <b>{health.issued}</b> · {t("laser.field.filed", locale)} <b>{health.filed}</b>
            {" · "}{t("laser.field.built", locale)} <b>{health.built}</b>
            {" · "}{t("laser.field.gapFill", locale)} <b>{health.gap_fill}</b>
            {" · "}{t("laser.field.gapProd", locale)} <b>{health.gap_prod}</b>
            {health.pending.length ? ` · ${health.pending.length} ${t("laser.field.pending", locale)}` : ""}
          </div>
        </div>
      ) : null}

      <div style={box}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{t("laser.title.panels", locale)}</div>
        <Table
          header={[
            ["sn", t("sn.field.sn", locale)], ["mo_no", t("sn.field.mo_no", locale)],
            ["machine_no", t("laser.field.machine", locale)], ["panel_no", t("laser.field.panelNo", locale)],
            ["panel_pos", t("laser.field.panelPos", locale)], ["status", t("field.status", locale)],
            ["created_at", t("sn.field.created_at", locale)],
          ]}
          rows={panels?.rows || []}
        />
      </div>

      <div style={box}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{t("laser.title.machines", locale)}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          <input value={mForm.machine_no} onChange={e => setMForm({ ...mForm, machine_no: e.target.value })}
            placeholder={t("laser.field.machine", locale)} style={inp} />
          <input value={mForm.ip} onChange={e => setMForm({ ...mForm, ip: e.target.value })}
            placeholder="IP" style={inp} />
          <input value={mForm.line_code} onChange={e => setMForm({ ...mForm, line_code: e.target.value })}
            placeholder={t("laser.field.line", locale)} style={inp} />
          <input value={mForm.remark} onChange={e => setMForm({ ...mForm, remark: e.target.value })}
            placeholder={t("dwell.field.remark", locale)} style={inp} />
          <button onClick={saveMachine}>{t("common.add", locale)}</button>
        </div>
        <Table
          header={[
            ["machine_no", t("laser.field.machine", locale)], ["ip", "IP"],
            ["line_code", t("laser.field.line", locale)], ["enabled", t("dwell.field.enabled", locale)],
            ["remark", t("dwell.field.remark", locale)],
          ]}
          rows={machines as unknown as Record<string, unknown>[]}
        />
        <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap", fontSize: 12 }}>
          {machines.map(m => (
            <span key={m.id}>
              {m.machine_no}@{m.ip}{" "}
              <a href="#" onClick={e => { e.preventDefault(); delMachine(m.id); }} style={{ color: "#b91c1c" }}>
                {t("common.delete", locale)}
              </a>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}