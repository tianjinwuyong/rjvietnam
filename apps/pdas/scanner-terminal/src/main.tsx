import React, { useState, useEffect, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import LifecyclePDA from "./LifecyclePDA";
import SmartRackPDA from "./SmartRackPDA";

const API = "http://10.0.2.2:8080";

type AppMode = "bind" | "lifecycle" | "smartRack";
type Step = "scan_pcba" | "scan_shell" | "done";
type Locale = "zh-CN" | "vi-VN" | "en-US";

interface BindingRecord { id: number; sn_a: string; sn_b: string; bound_at: string; binding_type: string; }
interface State { step: Step; pcba_sn: string | null; shell_sn: string | null; last_error: string | null; last_binding: BindingRecord | null; locale: Locale; t: Record<string, string>; }

const UI_I18N: Record<Locale, { title: string; manual_input: string; bind_btn: string; reset_btn: string; recent: string }> = {
  "zh-CN": { title: "PCBA ↔ 外壳 绑定终端", manual_input: "或手动输入 SN 后回车", bind_btn: "确认绑定", reset_btn: "重新扫码", recent: "最近绑定" },
  "vi-VN":  { title: "PCBA ↔ Vỏ máy  Gán",  manual_input: "Hoặc nhập SN thủ công rồi Enter", bind_btn: "Xác nhận gán", reset_btn: "Quét lại",   recent: "Gán gần đây" },
  "en-US":  { title: "PCBA ↔ Shell Binding", manual_input: "Or type SN manually and press Enter", bind_btn: "Confirm Bind", reset_btn: "Rescan",    recent: "Recent bindings" },
};
const STEP_COLORS: Record<Step, string> = { scan_pcba: "#1a237e", scan_shell: "#1b5e20", done: "#b71c1c" };
const STEP_BG: Record<Step, string> = { scan_pcba: "#e8eaf6", scan_shell: "#e8f5e9", done: "#ffebee" };

function App() {
  const [mode, setMode] = useState<AppMode>("bind");
  const [state, setState] = useState<State | null>(null);
  const [manual, setManual] = useState("");
  const [history, setHistory] = useState<BindingRecord[]>([]);
  const [locale, setLocale] = useState<Locale>("zh-CN");
  const [scanLog, setScanLog] = useState<{time: string; sn: string; step: Step}[]>([]);
  const prevStepRef = useRef<Step>("scan_pcba");
  const prevPcbaRef = useRef<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const connect = useCallback(() => {
    const es = new EventSource(`${API}/api/sse`);
    es.onmessage = (e) => {
      try {
        const data: State = JSON.parse(e.data);
        if (data.step !== undefined) {
          if (data.step !== prevStepRef.current || (data.pcba_sn && data.pcba_sn !== prevPcbaRef.current)) {
            const sn = data.step === "scan_shell" ? data.pcba_sn : (data.step === "scan_pcba" ? null : data.pcba_sn);
            if (sn) setScanLog(l => [{ time: new Date().toLocaleTimeString(), sn, step: data.step }, ...l].slice(0, 20));
            prevPcbaRef.current = data.pcba_sn;
            prevStepRef.current = data.step;
          }
          setState(data);
        }
      } catch {}
    };
    es.onerror = () => {
      es.close(); esRef.current = null;
      if (!pollRef.current) { pollRef.current = setInterval(async () => { try { const r = await fetch(`${API}/api/state`); if (r.ok) setState(await r.json()); } catch {} }, 1000); }
    };
    esRef.current = es;
  }, []);

  useEffect(() => {
    fetch(`${API}/api/state`).then(r => r.json()).then(setState).catch(() => {});
    connect();
    return () => { esRef.current?.close(); if (pollRef.current) clearInterval(pollRef.current); };
  }, [connect]);

  const changeLocale = async (l: Locale) => { setLocale(l); await fetch(`${API}/api/locale`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locale: l }) }); };
  const sendScan = async (sn: string) => { if (!sn.trim()) return; setManual(""); const r = await fetch(`${API}/api/scan`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sn: sn.trim() }) }); const d = await r.json(); if (d.ok && d.step === "done") loadHistory(); };
  const handleManualKey = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") sendScan(manual); };
  const doBind = async () => { const r = await fetch(`${API}/api/bind`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); const d = await r.json(); if (d.ok) loadHistory(); };
  const doReset = async () => { await fetch(`${API}/api/reset`, { method: "POST" }); setManual(""); };
  const loadHistory = async () => { try { const r = await fetch(`${API}/api/state`); const s: State = await r.json(); if (s.last_binding) setHistory(h => [s.last_binding!, ...h].slice(0, 20)); } catch {} };

  const step = state?.step ?? "scan_pcba";
  const prevStepRef2 = useRef<Step>("scan_pcba");
  const t = state?.t ?? {};
  useEffect(() => {
    if (step === "scan_pcba" && prevStepRef2.current !== "scan_pcba") { fetch(`${API}/api/tts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: t.scan_pcba || "请扫码 PCBA" }) }).catch(() => {}); }
    prevStepRef2.current = step;
  }, [step, t, locale]);
  const ui = UI_I18N[locale];
  const color = STEP_COLORS[step];
  const bg = STEP_BG[step];

  return (
    <div style={{ fontFamily: "Arial, sans-serif", minHeight: "100vh", background: "#f5f5f5", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", background: "#212121", borderBottom: "3px solid #4caf50" }}>
        <button onClick={() => setMode("bind")} style={{ flex: 1, padding: "14px", fontSize: 16, fontWeight: 700, border: "none", cursor: "pointer", background: mode === "bind" ? "#4caf50" : "#374151", color: "#fff" }}>SN 绑定</button>
        <button onClick={() => setMode("smartRack")} style={{ flex: 1, padding: "14px", fontSize: 16, fontWeight: 700, border: "none", cursor: "pointer", background: mode === "smartRack" ? "#4caf50" : "#374151", color: "#fff" }}>料架领料</button>
        <button onClick={() => setMode("lifecycle")} style={{ flex: 1, padding: "14px", fontSize: 16, fontWeight: 700, border: "none", cursor: "pointer", background: mode === "lifecycle" ? "#4caf50" : "#374151", color: "#fff" }}>物料有效期</button>
      </div>
      {mode === "smartRack" ? <SmartRackPDA /> : mode === "lifecycle" ? <LifecyclePDA /> : null}
      {mode === "bind" ? (
        <div>
          <header style={{ background: "#212121", color: "#fff", padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 22, fontWeight: 700 }}>{ui.title}</span>
            <div style={{ display: "flex", gap: 8 }}>
              {(["zh-CN", "vi-VN", "en-US"] as Locale[]).map(l => (
                <button key={l} onClick={() => changeLocale(l)} style={{ padding: "6px 14px", borderRadius: 6, border: "none", cursor: "pointer", fontWeight: locale === l ? 700 : 400, background: locale === l ? "#4caf50" : "#616161", color: "#fff", fontSize: 14 }}>
                  {l === "zh-CN" ? "中文" : l === "vi-VN" ? "Tiếng Việt" : "English"}
                </button>
              ))}
            </div>
          </header>
          <main style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 32, gap: 24 }}>
            <div style={{ background: bg, border: `4px solid ${color}`, borderRadius: 24, padding: "48px 64px", textAlign: "center", minWidth: 420, boxShadow: `0 8px 32px ${color}44` }}>
              <div style={{ fontSize: 18, color: "#666", marginBottom: 12 }}>{t.ready ?? ""}</div>
              <div style={{ fontSize: 52, fontWeight: 900, color, lineHeight: 1.2 }}>{t[step] ?? step}</div>
              {state?.pcba_sn ? <div style={{ marginTop: 16, fontSize: 20, color: "#333", background: "#fff", borderRadius: 12, padding: "12px 24px", display: "inline-block" }}><span style={{ color: "#888", fontSize: 14 }}>{t.pcba_sn}：</span><span style={{ fontWeight: 700, letterSpacing: 2 }}>{state.pcba_sn}</span></div> : null}
              {state?.last_error ? <div style={{ marginTop: 16, color: "#c62828", fontWeight: 700, fontSize: 18 }}>{state.last_error}</div> : null}
            </div>
            {step === "done" ? <button onClick={doBind} style={{ fontSize: 28, fontWeight: 900, padding: "20px 80px", borderRadius: 16, border: "none", cursor: "pointer", background: "#c62828", color: "#fff", boxShadow: "0 6px 24px #c6282888", letterSpacing: 2 }}>{t.binding ?? ui.bind_btn}</button> : null}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <input value={manual} onChange={e => setManual(e.target.value)} onKeyDown={handleManualKey} placeholder={t[step] ?? ""} style={{ fontSize: 24, padding: "16px 24px", width: 380, borderRadius: 12, border: `2px solid ${color}`, textAlign: "center", outline: "none" }} autoFocus />
              <span style={{ fontSize: 13, color: "#999" }}>{ui.manual_input}</span>
            </div>
            <button onClick={doReset} style={{ fontSize: 16, padding: "10px 32px", borderRadius: 8, border: "1px solid #999", cursor: "pointer", background: "#fff", color: "#555" }}>{ui.reset_btn}</button>
            {state?.last_binding ? <div style={{ background: "#e8f5e9", border: "2px solid #2e7d32", borderRadius: 12, padding: "16px 32px", textAlign: "center" }}><div style={{ fontSize: 20, color: "#1b5e20", fontWeight: 700 }}>{t.success ?? "绑定成功"}</div><div style={{ fontSize: 14, color: "#333", marginTop: 8 }}><span style={{ color: "#888" }}>{t.pcba_sn}：</span><strong>{state.last_binding.sn_a}</strong> ↔ <span style={{ color: "#888" }}>{t.shell_sn}：</span><strong>{state.last_binding.sn_b}</strong></div></div> : null}
          </main>
          {history.length > 0 ? <section style={{ background: "#fff", borderTop: "1px solid #ddd", padding: "16px 24px" }}><div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12, color: "#333" }}>{ui.recent}</div><div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{history.map(r => <div key={r.id} style={{ display: "flex", gap: 16, fontSize: 14, color: "#555", padding: "6px 12px", background: "#f9f9f9", borderRadius: 6 }}><span style={{ color: "#888", minWidth: 60 }}>#{r.id}</span><span><strong>{r.sn_a}</strong> ↔ <strong>{r.sn_b}</strong></span><span style={{ color: "#aaa", marginLeft: "auto" }}>{new Date(r.bound_at).toLocaleString()}</span></div>)}</div></section> : null}
        </div>
      ) : null}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
