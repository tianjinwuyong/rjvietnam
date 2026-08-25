import { useEffect, useMemo, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { mesApi } from "../api/mes";

type Policy = { code: string; appliesTo?: string[]; action?: { retestLimit?: number; route?: string; afterLimit?: string }; mesSupervision?: { required?: boolean } };

const COPY: Record<Locale, Record<string, string>> = {
  "zh-CN": { title: "NG 管理中心", sub: "MES 统一配置 NG 路由、维修路径和工站复测次数。Agent 只执行 MES 已发布策略。", source: "配置来源", policies: "NG 策略", station: "适用工站", limit: "最大复测次数", route: "维修/返回路线", reason: "变更原因", save: "保存草稿", submit: "提交审批", approve: "批准", publish: "发布", version: "版本", status: "状态", refresh: "刷新", locked: "只有授权 MES 用户可以修改；已发布版本不可覆盖。", loaded: "已读取 MES 配置", no: "暂无配置", error: "操作失败" },
  "vi-VN": { title: "Trung tâm quản lý NG", sub: "MES cấu hình tuyến NG, sửa chữa và số lần kiểm tra lại; Agent chỉ thực thi chính sách đã phát hành.", source: "Nguồn cấu hình", policies: "Chính sách NG", station: "Trạm áp dụng", limit: "Số lần kiểm tra lại tối đa", route: "Tuyến sửa chữa/trả về", reason: "Lý do thay đổi", save: "Lưu bản nháp", submit: "Gửi phê duyệt", approve: "Phê duyệt", publish: "Phát hành", version: "Phiên bản", status: "Trạng thái", refresh: "Làm mới", locked: "Chỉ người dùng MES được ủy quyền mới được sửa; phiên bản đã phát hành không thể ghi đè.", loaded: "Đã tải cấu hình MES", no: "Chưa có cấu hình", error: "Thao tác thất bại" },
  "en-US": { title: "NG Management Center", sub: "MES owns NG routing, repair paths, and per-station retest limits. Agents only execute the published policy.", source: "Configuration source", policies: "NG policies", station: "Applies to stations", limit: "Maximum retests", route: "Repair/return route", reason: "Change reason", save: "Save draft", submit: "Submit approval", approve: "Approve", publish: "Publish", version: "Version", status: "Status", refresh: "Refresh", locked: "Only authorized MES users may edit; published versions are immutable.", loaded: "MES configuration loaded", no: "No configuration", error: "Operation failed" },
};

const stationLabel = (policy: Policy) => (policy.appliesTo ?? []).join(", ") || "—";

export function NgManagementPage({ locale }: { locale: Locale }) {
  const c = COPY[locale];
  const [config, setConfig] = useState<any>(null);
  const [records, setRecords] = useState<any[]>([]);
  const [selectedCode, setSelectedCode] = useState("");
  const [limit, setLimit] = useState(2);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const policies: Policy[] = config?.ngPolicies ?? [];
  const selected = useMemo(() => policies.find((p) => p.code === selectedCode), [policies, selectedCode]);

  async function load() {
    setBusy(true); setMessage("");
    try {
      const [bootstrap, list] = await Promise.all([mesApi.getNgRouteConfigurationBootstrap(), mesApi.getNgRouteConfigurations()]);
      setConfig(bootstrap.configuration);
      setRecords(list.items ?? []);
      const first = (bootstrap.configuration.ngPolicies ?? [])[0] as Policy | undefined;
      setSelectedCode(first?.code ?? ""); setLimit(Number(first?.action?.retestLimit ?? 2));
      setMessage(c.loaded);
    } catch (error) { setMessage(`${c.error}: ${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, []);

  function choose(code: string) {
    setSelectedCode(code);
    const p = policies.find((item) => item.code === code);
    setLimit(Number(p?.action?.retestLimit ?? 2));
  }

  async function saveDraft() {
    if (!config || !selected || !reason.trim()) return;
    const next = structuredClone(config);
    const p = (next.ngPolicies as Policy[]).find((item) => item.code === selectedCode);
    if (p) p.action = { ...(p.action ?? {}), retestLimit: Math.max(0, Math.floor(limit)) };
    next.configuration = { ...(next.configuration ?? {}), revision: `MES-NG-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}`, status: "DRAFT" };
    setBusy(true); setMessage("");
    try { await mesApi.createNgRouteConfiguration(next, reason.trim()); setMessage(c.save); await load(); }
    catch (error) { setMessage(`${c.error}: ${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  }

  async function transition(id: number, action: "submit" | "approve" | "publish") {
    if (!reason.trim()) return;
    setBusy(true); setMessage("");
    try {
      if (action === "submit") await mesApi.submitNgRouteConfiguration(id, reason.trim());
      if (action === "approve") await mesApi.approveNgRouteConfiguration(id, reason.trim());
      if (action === "publish") await mesApi.publishNgRouteConfiguration(id, reason.trim());
      setMessage(action.toUpperCase()); await load();
    } catch (error) { setMessage(`${c.error}: ${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  }

  return <div className="screen-stack">
    <section className="surface-panel">
      <div className="section-header"><div><div style={{ color: "var(--danger)", fontSize: 11, fontWeight: 800 }}>MES / NG GOVERNANCE</div><h2>{c.title}</h2><p>{c.sub}</p></div><button onClick={() => void load()} disabled={busy}>{c.refresh}</button></div>
      <div style={{ padding: 12, border: "1px solid var(--warn)", borderRadius: 8, color: "var(--warn)" }}>{c.locked}</div>
      {config?.configuration?.ngClosedLoopDefaults && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10, padding: 10, border: "1px solid var(--border)", borderRadius: 8, color: "var(--muted)", fontSize: 12 }}><strong style={{ color: "var(--text)" }}>Manual-line defaults</strong><span>quantity ≥ {config.configuration.ngClosedLoopDefaults.quantityThreshold}</span><span>time ≥ {config.configuration.ngClosedLoopDefaults.timeThresholdMinutes} min</span><span>max retests {config.configuration.ngClosedLoopDefaults.maxRetests}</span><span>trigger {config.configuration.ngClosedLoopDefaults.triggerMode}</span><span>MES managed</span><span>immutable history</span></div>}
      {message && <div role="status" style={{ marginTop: 10, color: message.startsWith(c.error) ? "var(--danger)" : "var(--ok)" }}>{message}</div>}
    </section>
    <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, .8fr) minmax(420px, 1.5fr)", gap: 12 }}>
      <section className="surface-panel"><h3>{c.policies}</h3>{policies.length === 0 && <p>{c.no}</p>}{policies.map((policy) => <button key={policy.code} onClick={() => choose(policy.code)} style={{ display: "block", width: "100%", textAlign: "left", padding: 10, marginBottom: 6, border: "1px solid var(--border)", background: selectedCode === policy.code ? "rgba(56,189,248,.14)" : "transparent", color: "var(--text)" }}><strong>{policy.code}</strong><small style={{ display: "block", color: "var(--muted)" }}>{stationLabel(policy)} · {Number(policy.action?.retestLimit ?? 0)} {c.limit}</small></button>)}</section>
      <section className="surface-panel"><h3>{selected?.code ?? c.policies}</h3>{selected && <><label>{c.station}<input value={stationLabel(selected)} readOnly /></label><label>{c.limit}<input type="number" min={0} max={20} value={limit} onChange={(e) => setLimit(Number(e.target.value))} /></label><label>{c.route}<input value={selected.action?.route ?? ""} readOnly /></label><label>{c.reason}<textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></label><button className="action-button" disabled={busy || !reason.trim()} onClick={() => void saveDraft()}>{c.save}</button></>}{!selected && <p>{c.no}</p>}</section>
    </div>
    <section className="surface-panel"><h3>{c.version}</h3>{records.length === 0 ? <p>{c.no}</p> : <div className="table-shell"><table><thead><tr><th>{c.version}</th><th>{c.status}</th><th>{c.reason}</th><th>Actions</th></tr></thead><tbody>{records.map((record) => <tr key={record.id}><td>{record.revision}</td><td>{record.status}</td><td>{record.change_reason}</td><td style={{ display: "flex", gap: 6 }}>{record.status === "DRAFT" && <button onClick={() => void transition(record.id, "submit")}>{c.submit}</button>}{record.status === "PENDING_APPROVAL" && <button onClick={() => void transition(record.id, "approve")}>{c.approve}</button>}{record.status === "APPROVED" && <button onClick={() => void transition(record.id, "publish")}>{c.publish}</button>}</td></tr>)}</tbody></table></div>}</section>
  </div>;
}
