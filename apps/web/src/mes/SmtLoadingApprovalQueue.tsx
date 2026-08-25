import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Clock3, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { apiClient } from "../api/client";

const required = ["MES", "PMC", "IQC", "WMS", "ENGINEERING", "PRODUCTION", "PLANT_MANAGER"];
type Approval = { approvalCode: string; decision: "PENDING" | "APPROVED" | "REJECTED"; approver?: string; reason?: string; decidedAt?: string };
type Item = { bindingId: number; sessionId: number; workOrderCode: string; lineCode: string; machineCode: string; slotNo: string; feederCode: string; materialCode: string; materialSn: string; lotNo?: string; quantity: number; boundAt?: string; approvals: Approval[]; allApproved: boolean };

export function SmtLoadingApprovalQueue({ locale }: { locale: Locale }) {
  const zh = locale.startsWith("zh");
  const [items, setItems] = useState<Item[]>([]);
  const [lineCode, setLineCode] = useState("L001");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setBusy(true); setError("");
    try { const data = await apiClient.get<{ items: Item[] }>(`/api/smt/loading/approval-queue?lineCode=${encodeURIComponent(lineCode)}`); setItems(data.items || []); }
    catch (e) { setError(e instanceof Error ? e.message : "Approval queue unavailable"); }
    finally { setBusy(false); }
  }, [lineCode]);
  useEffect(() => { void load(); }, [load]);

  async function decide(item: Item, approvalCode: string, decision: "APPROVED" | "REJECTED") {
    const reason = decision === "REJECTED" ? window.prompt(zh ? "请输入拒绝原因" : "Reason for rejection")?.trim() : "";
    if (decision === "REJECTED" && !reason) return;
    setBusy(true); setError("");
    try {
      await apiClient.post(`/api/smt/loading/items/${item.bindingId}/approval`, { approvalCode, decision, reason });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Approval failed"); setBusy(false); }
  }

  const decisionLabel = (value: Approval["decision"]) => value === "APPROVED" ? (zh ? "已通过" : "Approved") : value === "REJECTED" ? (zh ? "已拒绝" : "Rejected") : (zh ? "待审批" : "Pending");
  return <section className="surface-panel" style={{ padding: 20 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div><h3 style={{ margin: 0 }}><ShieldCheck size={20} style={{ verticalAlign: "-4px", marginRight: 8 }} />{zh ? "逐项物料部门审批" : "Item-by-item material approvals"}</h3><p style={{ margin: "7px 0 0", color: "var(--muted)" }}>{zh ? "每个物料 SN/批次都必须完成全部部门审批，完成后才允许 MES 放行。" : "Every material SN/lot must pass every department before MES release."}</p></div>
      <div style={{ display: "flex", gap: 8 }}><input value={lineCode} onChange={e => setLineCode(e.target.value.toUpperCase())} style={{ width: 80 }} aria-label="Line" /><button type="button" className="action-button" onClick={() => void load()} disabled={busy}><RefreshCw size={14} />{zh ? "刷新" : "Refresh"}</button></div>
    </div>
    {error && <div className="badge badge-danger" style={{ padding: 10, marginTop: 14 }}>{error}</div>}
    <div style={{ overflowX: "auto", marginTop: 16 }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}><thead><tr style={{ textAlign: "left", background: "var(--surface-2)" }}>{[zh ? "工单/物料" : "WO / material", zh ? "机台/槽位" : "Machine / slot", zh ? "审批链" : "Approval chain", zh ? "状态" : "Status"].map(h => <th key={h} style={{ padding: 10 }}>{h}</th>)}</tr></thead><tbody>{items.map(item => <tr key={item.bindingId} style={{ borderBottom: "1px solid var(--border)" }}><td style={{ padding: 10 }}><strong>{item.workOrderCode}</strong><div>{item.materialCode} · {item.materialSn}</div><small style={{ color: "var(--muted)" }}>{item.lotNo || "-"}</small></td><td style={{ padding: 10 }}>{item.machineCode} · {item.slotNo}<div style={{ color: "var(--muted)" }}>{item.feederCode}</div></td><td style={{ padding: 10 }}><div style={{ display: "flex", gap: 6, flexWrap: "wrap", maxWidth: 620 }}>{required.map(code => { const a = item.approvals.find(x => x.approvalCode === code); const state = a?.decision || "PENDING"; return <span key={code} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 6px", borderRadius: 6, background: state === "APPROVED" ? "var(--ok-bg)" : state === "REJECTED" ? "rgba(190,58,58,.1)" : "var(--surface-2)", color: state === "APPROVED" ? "var(--ok)" : state === "REJECTED" ? "var(--danger)" : "var(--muted)" }}>{state === "APPROVED" ? <CheckCircle2 size={12} /> : state === "REJECTED" ? <XCircle size={12} /> : <Clock3 size={12} />}{code}{state === "PENDING" && <><button type="button" onClick={() => void decide(item, code, "APPROVED")} disabled={busy} style={{ border: 0, background: "transparent", color: "inherit", cursor: "pointer", padding: 0 }} aria-label={`${code} approve`}>✓</button><button type="button" onClick={() => void decide(item, code, "REJECTED")} disabled={busy} style={{ border: 0, background: "transparent", color: "inherit", cursor: "pointer", padding: 0 }} aria-label={`${code} reject`}>×</button></>}</span>; })}</div></td><td style={{ padding: 10 }}><span className={`badge ${item.allApproved ? "badge-ok" : "badge-warning"}`}>{item.allApproved ? (zh ? "可放行" : "Ready") : (zh ? "审批未完成" : "Pending")}</span></td></tr>)}</tbody></table></div>
    {!items.length && !busy && <div className="placeholder-view" style={{ padding: 30 }}>{zh ? "当前没有已绑定物料项" : "No active material items"}</div>}
  </section>;
}
