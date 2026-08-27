import { useState } from "react";
import { CheckCircle, RefreshCw, Scan, Smartphone, UploadCloud } from "lucide-react";

const sampleRows = [
  { boxQr: "BOX-RJ-260827-00482", material: "IC-DRAM-8G", batch: "LOT-260826-A17", status: "开封中 · 正常", remaining: "45h 20m", state: "synced" },
  { boxQr: "BOX-RJ-260827-00483", material: "QFN-48-CTRL", batch: "LOT-260826-Q09", status: "即将到期", remaining: "4h 05m", state: "pending" },
  { boxQr: "BOX-RJ-260824-00423", material: "LED-2835-WW", batch: "LOT-260824-L11", status: "超时 / 待处置", remaining: "已超时", state: "blocked" },
];

export function MsPdaSyncPage() {
  const [boxQr, setBoxQr] = useState("");
  const [lastSync, setLastSync] = useState("2026-08-27 09:50:12");
  const [message, setMessage] = useState("");
  const syncOne = () => { if (!boxQr.trim()) return; setMessage(`已将 ${boxQr.trim()} 加入PDA同步队列`); setLastSync(new Date().toLocaleString("zh-CN")); };
  return <section className="surface-panel">
    <div className="section-header" style={{ marginBottom: 16 }}><div><h3 style={{ margin: 0 }}><Smartphone size={16} style={{ marginRight: 7, verticalAlign: "middle" }} />PDA同步</h3><p style={{ margin: "4px 0 0", fontSize: 12 }}>将箱级MSD标签、开封状态、剩余寿命和位置同步到PDA。</p></div><span className="badge badge-ok"><CheckCircle size={12} /> PDA在线</span></div>
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}><div style={{ display: "flex", alignItems: "center", gap: 8, flex: "1 1 360px" }}><Scan size={16} color="var(--muted)" /><input className="form-input" value={boxQr} onChange={e => setBoxQr(e.target.value)} onKeyDown={e => e.key === "Enter" && syncOne()} placeholder="扫描或输入箱QR，例如 BOX-RJ-260827-00482" aria-label="箱QR" /></div><button className="btn-primary" onClick={syncOne}><UploadCloud size={14} /> 同步到PDA</button><button className="btn-ghost" onClick={() => setMessage("")}><RefreshCw size={14} /> 刷新</button></div>
    {message && <div style={{ padding: "9px 12px", marginBottom: 12, borderRadius: 6, background: "rgba(34,197,94,0.1)", color: "var(--ok)", fontSize: 12 }}>{message}</div>}
    <div className="table-shell" style={{ overflowX: "auto" }}><table><thead><tr><th>箱QR</th><th>物料</th><th>批次</th><th>MSD状态</th><th>剩余寿命</th><th>同步状态</th></tr></thead><tbody>{sampleRows.map(row => <tr key={row.boxQr}><td><code style={{ fontSize: 10 }}>{row.boxQr}</code></td><td><strong>{row.material}</strong></td><td><code style={{ fontSize: 10 }}>{row.batch}</code></td><td>{row.status}</td><td><strong style={{ color: row.state === "blocked" ? "var(--danger)" : row.state === "pending" ? "#f59e0b" : "var(--ok)" }}>{row.remaining}</strong></td><td>{row.state === "synced" ? <span className="badge badge-ok">已同步</span> : row.state === "pending" ? <span className="badge badge-warning">待同步</span> : <span className="badge badge-danger">禁止同步</span>}</td></tr>)}</tbody></table></div>
    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, color: "var(--muted)", fontSize: 11 }}><span>同步内容：箱QR、SN、批次、数量、MSL、开封/封箱时间、剩余Floor Life、位置、状态</span><span>最后同步：{lastSync}</span></div>
  </section>;
}
