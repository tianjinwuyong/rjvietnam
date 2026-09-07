import { useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { apiClient } from "../api/client";

export function IqcVirtualEmployeeDock({ locale: _locale }: { locale: Locale }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Array<{ role: string; text: string }>>([]);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    const question = input.trim(); if (!question || busy) return;
    setInput(""); setMessages(items => [...items, { role: "user", text: question }, { role: "assistant", text: "已收到指令。我正在读取当前页面、ACTIVE IQC Excel 和相关批次数据…" }]); setBusy(true);
    try {
      const request = apiClient.post<any>("/qms/iqc/virtual-employee/advice", { question, pageContext: document.body.innerText.slice(0, 5000), realResults: [] });
      const result: any = await Promise.race([request, new Promise((_, reject) => window.setTimeout(() => reject(new Error("IQC-VIRTUAL-01：模型暂时没有响应，系统未执行任何检验放行。")), 5000))]);
      const output = result.item?.output || result.output || result.data?.output || result;
      setMessages(items => [...items, { role: "assistant", text: typeof output === "string" ? output : output.summary || output.nextAction || JSON.stringify(output) }]);
    } catch (error) { setMessages(items => [...items, { role: "assistant", text: error instanceof Error ? error.message : String(error) }]); }
    finally { setBusy(false); }
  };
  return <div style={{ position: "fixed", right: 18, bottom: 18, zIndex: 1000 }}><button type="button" className="btn btn-primary" onClick={() => setOpen(value => !value)}>IQC-VIRTUAL-01</button>{open && <div style={{ position: "absolute", right: 0, bottom: 48, width: 360, maxWidth: "calc(100vw - 36px)", background: "#fff", border: "1px solid #c7d2fe", borderRadius: 12, boxShadow: "0 12px 35px rgba(15,23,42,.25)" }}><div style={{ padding: "10px 12px", background: "#312e81", color: "#fff", borderRadius: "12px 12px 0 0", display: "flex", justifyContent: "space-between" }}><strong>IQC-VIRTUAL-01</strong><button type="button" onClick={() => setOpen(false)}>×</button></div><div style={{ padding: 10, maxHeight: 260, overflow: "auto" }}>{messages.length === 0 && <div style={{ color: "#64748b", fontSize: 12 }}>我会读取当前页面的 IQC 表格、ACTIVE Excel 和真实结果。</div>}{messages.map((message, index) => <div key={index} style={{ textAlign: message.role === "user" ? "right" : "left", margin: "6px 0" }}><span style={{ display: "inline-block", padding: "6px 8px", borderRadius: 8, background: message.role === "user" ? "#dbeafe" : "#f1f5f9", fontSize: 12 }}>{message.text}</span></div>)}{busy && <div style={{ color: "#64748b", fontSize: 12 }}>正在处理…</div>}</div><div style={{ display: "flex", gap: 6, padding: 10, borderTop: "1px solid #e2e8f0" }}><input value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === "Enter") void send(); }} placeholder="给 IQC-VIRTUAL-01 工作指令" style={{ flex: 1 }} /><button type="button" className="btn btn-primary" onClick={() => void send()} disabled={busy}>发送</button></div></div>}</div>;
}
