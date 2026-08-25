import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Factory, RefreshCw, Save } from "lucide-react";
import { mesApi } from "../api";

type Assignment = {
  id: number; lineCode: string; machineCode: string; channelCode: string;
  slotNo: string; feederCode: string; materialCode: string; workOrderCode?: string;
  status: string;
};

const empty = { lineCode: "L001", machineCode: "", channelCode: "", slotNo: "", feederCode: "", materialCode: "", workOrderCode: "" };

export function FeederPreparationMapping() {
  const [rows, setRows] = useState<Assignment[]>([]);
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const load = async () => {
    setBusy(true); setMessage("");
    try { const r = await mesApi.getMaterialFeederAssignments({ status: "active" }); setRows(r.items ?? []); }
    catch (e) { setMessage(e instanceof Error ? e.message : "MES mapping load failed"); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, []);
  const set = (key: keyof typeof empty, value: string) => setForm((x) => ({ ...x, [key]: value }));
  const save = async () => {
    if (Object.entries(form).some(([k, v]) => k !== "workOrderCode" && !v.trim())) { setMessage("Complete the exact line, machine, channel, slot, feeder and material fields."); return; }
    setBusy(true); setMessage("");
    try { await mesApi.createMaterialFeederAssignment(form); setForm(empty); setMessage("MES assignment registered. PDA may now load only this tuple."); await load(); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Assignment rejected"); setBusy(false); }
  };
  return <div className="screen-stack">
    <div className="surface-panel">
      <div className="section-header"><div><h2><Factory size={20} /> Feeder Preparation Mapping</h2><p>MES-controlled exact binding: material → machine → channel → slot → feeder.</p></div><button type="button" onClick={() => void load()} disabled={busy}><RefreshCw size={15} /> Refresh</button></div>
      <div className="notice warning"><AlertTriangle size={16} /> PDA cannot select alternatives. A feeder must be registered and mapped here before loading.</div>
      {message && <div className="notice">{message}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginTop: 16 }}>
        {(Object.keys(form) as (keyof typeof empty)[]).map((key) => <label key={key} style={{ fontSize: 12, fontWeight: 700 }}>{key === "workOrderCode" ? "WO (optional)" : key}<input value={form[key]} onChange={(e) => set(key, e.target.value)} placeholder={key} /></label>)}
      </div>
      <button type="button" className="action-button" onClick={() => void save()} disabled={busy} style={{ marginTop: 14 }}><Save size={15} /> Register exact assignment</button>
    </div>
    <div className="surface-panel"><div className="section-header"><h3>Registered preparation bindings</h3><span className="badge badge-info">{rows.length} active</span></div>
      <div className="table-wrap"><table><thead><tr><th>Material</th><th>Machine</th><th>Channel</th><th>Slot</th><th>Feeder</th><th>Line / WO</th><th>Status</th></tr></thead><tbody>{rows.map((r) => <tr key={r.id}><td><strong>{r.materialCode}</strong></td><td>{r.machineCode}</td><td>{r.channelCode}</td><td>{r.slotNo}</td><td>{r.feederCode}</td><td>{r.lineCode}{r.workOrderCode ? ` / ${r.workOrderCode}` : ""}</td><td><span className="badge badge-ok"><CheckCircle2 size={13} /> {r.status}</span></td></tr>)}{!rows.length && <tr><td colSpan={7} style={{ padding: 28, textAlign: "center" }}>No exact assignments registered yet.</td></tr>}</tbody></table></div>
    </div>
  </div>;
}
