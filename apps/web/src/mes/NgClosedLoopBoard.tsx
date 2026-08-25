import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Bell, CheckCircle2, ClipboardList, PackageCheck, RefreshCw, Save, Settings, ShieldCheck, Wrench } from "lucide-react";

type Locale = "zh-CN" | "en-US" | "vi-VN";
type TriggerMode = "ANY" | "ALL";
type StageState = "done" | "active" | "waiting";

type StationProfile = {
  stationCode: string;
  stationName: string;
  quantityThreshold: number;
  timeThresholdMinutes: number;
  maxRetests: number;
  triggerMode: TriggerMode;
  returnStation: string;
  enabled: boolean;
};

const STATION_PROFILES: StationProfile[] = [
  { stationCode: "manu_ict", stationName: "ICT", quantityThreshold: 10, timeThresholdMinutes: 30, maxRetests: 2, triggerMode: "ANY", returnStation: "manu_ict", enabled: true },
  { stationCode: "manu_fct", stationName: "FCT", quantityThreshold: 10, timeThresholdMinutes: 30, maxRetests: 2, triggerMode: "ANY", returnStation: "manu_fct", enabled: true },
  { stationCode: "manu_depanel", stationName: "Depanel", quantityThreshold: 15, timeThresholdMinutes: 60, maxRetests: 1, triggerMode: "ANY", returnStation: "manu_depanel", enabled: true },
  { stationCode: "manu_rework", stationName: "Repair station", quantityThreshold: 10, timeThresholdMinutes: 30, maxRetests: 3, triggerMode: "ANY", returnStation: "manu_ict", enabled: true },
];

const stages: Array<{ key: string; title: string; owner: string; state: StageState }> = [
  { key: "source", title: "Source station", owner: "ICT / FCT / Depanel", state: "done" },
  { key: "mes", title: "MES route gate", owner: "MES controller", state: "done" },
  { key: "bucket", title: "QR bucket handover", owner: "Team Leader PDA", state: "active" },
  { key: "repair", title: "Repair work order", owner: "Repair station", state: "waiting" },
  { key: "retest", title: "Authorized retest", owner: "ICT / FCT / Aging", state: "waiting" },
  { key: "close", title: "Return / disposition", owner: "MES + QC", state: "waiting" },
];

const COPY: Record<Locale, Record<string, string>> = {
  "zh-CN": {
    title: "NG 闭环控制中心", sub: "MES 主控 · 工站采集事实 · PDA 执行交接", open: "待处理", pickup: "待取件", andon: "安灯", history: "不可覆盖历史", refresh: "刷新", settings: "工站配置", save: "保存本地草稿", reset: "恢复默认", draft: "本地草稿，不改变 MES 策略", published: "MES 已发布策略", quantity: "数量阈值", minutes: "时间阈值（分钟）", retests: "最大复测次数", trigger: "触发模式", returnStation: "返回工站", enabled: "启用闭环", source: "配置来源", pickupTitle: "取件队列", andonTitle: "安灯与反馈", timeline: "案例时间线", no: "没有新的异常", authority: "MES 决策，工站只执行", saved: "本地配置草稿已保存", resetDone: "已恢复默认配置", unique: "当前工站专属配置", shared: "所有工站共享组件" },
  "vi-VN": {
    title: "Trung tâm vòng kín NG", sub: "MES điều khiển · Trạm ghi nhận · PDA bàn giao", open: "Đang mở", pickup: "Chờ nhận", andon: "Andon", history: "Lịch sử bất biến", refresh: "Làm mới", settings: "Cấu hình trạm", save: "Lưu bản nháp cục bộ", reset: "Khôi phục mặc định", draft: "Bản nháp cục bộ, chưa thay đổi chính sách MES", published: "Chính sách MES đã phát hành", quantity: "Ngưỡng số lượng", minutes: "Ngưỡng thời gian (phút)", retests: "Số lần kiểm tra lại tối đa", trigger: "Chế độ kích hoạt", returnStation: "Trạm trả về", enabled: "Bật vòng kín", source: "Nguồn cấu hình", pickupTitle: "Hàng đợi nhận", andonTitle: "Andon và phản hồi", timeline: "Dòng thời gian", no: "Không có bất thường mới", authority: "MES quyết định, trạm chỉ thực thi", saved: "Đã lưu bản nháp cục bộ", resetDone: "Đã khôi phục mặc định", unique: "Cấu hình riêng của trạm", shared: "Thành phần dùng chung cho mọi trạm" },
  "en-US": {
    title: "NG Closed-Loop Control", sub: "MES controls · Stations capture facts · PDA executes handover", open: "Open", pickup: "Pickup", andon: "Andon", history: "Immutable history", refresh: "Refresh", settings: "Station settings", save: "Save local draft", reset: "Reset defaults", draft: "Local draft only; MES policy is unchanged", published: "MES published policy", quantity: "Quantity threshold", minutes: "Time threshold (minutes)", retests: "Maximum retests", trigger: "Trigger mode", returnStation: "Return station", enabled: "Enable closed loop", source: "Configuration source", pickupTitle: "Pickup queue", andonTitle: "Andon & feedback", timeline: "Case timeline", no: "No new exceptions", authority: "MES decides; stations execute", saved: "Local configuration draft saved", resetDone: "Defaults restored", unique: "Unique station profile", shared: "Shared component for every station" },
};

const copyFor = (locale: Locale) => COPY[locale] ?? COPY["en-US"];

export function NgClosedLoopBoard({ locale }: { locale: Locale }) {
  const copy = copyFor(locale);
  const [profiles, setProfiles] = useState(STATION_PROFILES);
  const [selectedStation, setSelectedStation] = useState(STATION_PROFILES[0].stationCode);
  const [message, setMessage] = useState("");
  const [selectedWorkOrder, setSelectedWorkOrder] = useState("WO-20260807-0042");
  const profile = profiles.find((item) => item.stationCode === selectedStation) ?? STATION_PROFILES[0];

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("manual-line-ng-station-profiles");
      if (saved) setProfiles(JSON.parse(saved) as StationProfile[]);
    } catch { /* retain safe defaults */ }
  }, []);

  const metrics = useMemo(() => [[copy.open, "12", "#f59e0b"], [copy.pickup, "3", "#38bdf8"], [copy.andon, "1", "#ef4444"], [copy.history, "100%", "#4ade80"]] as const, [copy]);

  function updateProfile<K extends keyof StationProfile>(key: K, value: StationProfile[K]) {
    setProfiles((current) => current.map((item) => item.stationCode === selectedStation ? { ...item, [key]: value } : item));
  }

  function saveDraft() {
    window.localStorage.setItem("manual-line-ng-station-profiles", JSON.stringify(profiles));
    setMessage(copy.saved);
  }

  function resetDefaults() {
    setProfiles(STATION_PROFILES);
    window.localStorage.removeItem("manual-line-ng-station-profiles");
    setMessage(copy.resetDone);
  }

  return <div className="screen-stack" style={{ gap: 16 }}>
    <section className="surface-panel" style={{ borderTop: "3px solid #f97316" }}>
      <div className="section-header"><div><h1 style={{ margin: 0 }}>{copy.title}</h1><p style={{ margin: "6px 0 0", color: "var(--muted)" }}>{copy.sub}</p></div><button type="button" onClick={() => setMessage(copy.refresh)}><RefreshCw size={15} /> {copy.refresh}</button></div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}><span className="badge badge-success"><ShieldCheck size={13} /> {copy.authority}</span><span className="badge badge-info">{copy.shared}</span><span className="badge badge-warning">MANUAL_LINE · MES</span></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 10, marginTop: 14 }}>{metrics.map(([label, value, color]) => <div key={label} style={{ padding: 14, border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface-2)" }}><div style={{ color, fontSize: 24, fontWeight: 800 }}>{value}</div><div style={{ color: "var(--muted)", fontSize: 12 }}>{label}</div></div>)}</div>
    </section>

    <section className="surface-panel"><div className="section-header"><div><h2 style={{ margin: 0 }}><Settings size={18} /> {copy.settings}</h2><p style={{ margin: "6px 0 0", color: "var(--muted)" }}>{copy.unique}</p></div><div style={{ display: "flex", gap: 8 }}><button type="button" onClick={resetDefaults}>{copy.reset}</button><button className="action-button" type="button" onClick={saveDraft}><Save size={15} /> {copy.save}</button></div></div><div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 10, marginTop: 12 }}><label>Station<select value={selectedStation} onChange={(event) => setSelectedStation(event.target.value)}>{profiles.map((item) => <option key={item.stationCode} value={item.stationCode}>{item.stationName} · {item.stationCode}</option>)}</select></label><label>{copy.quantity}<input type="number" min={1} value={profile.quantityThreshold} onChange={(event) => updateProfile("quantityThreshold", Math.max(1, Number(event.target.value)))} /></label><label>{copy.minutes}<input type="number" min={1} value={profile.timeThresholdMinutes} onChange={(event) => updateProfile("timeThresholdMinutes", Math.max(1, Number(event.target.value)))} /></label><label>{copy.retests}<input type="number" min={0} max={20} value={profile.maxRetests} onChange={(event) => updateProfile("maxRetests", Math.max(0, Number(event.target.value)))} /></label><label>{copy.trigger}<select value={profile.triggerMode} onChange={(event) => updateProfile("triggerMode", event.target.value as TriggerMode)}><option value="ANY">ANY</option><option value="ALL">ALL</option></select></label><label>{copy.returnStation}<select value={profile.returnStation} onChange={(event) => updateProfile("returnStation", event.target.value)}>{profiles.map((item) => <option key={item.stationCode} value={item.stationCode}>{item.stationName}</option>)}</select></label><label style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 24 }}><input type="checkbox" checked={profile.enabled} onChange={(event) => updateProfile("enabled", event.target.checked)} /> {copy.enabled}</label><div style={{ alignSelf: "end", color: "var(--muted)", fontSize: 12 }}>{copy.draft}<br />{copy.source}: {copy.published}</div></div>{message && <div role="status" style={{ marginTop: 10, color: "var(--ok)" }}>{message}</div>}</section>

    <section className="surface-panel"><div className="section-header"><div><h2 style={{ margin: 0 }}>Lifecycle path</h2><p style={{ margin: "6px 0 0", color: "var(--muted)" }}>Every transition is MES-authorized and returns command feedback.</p></div><span className="badge badge-warning">{profile.stationName} · {profile.maxRetests} retests</span></div><div style={{ display: "grid", gridTemplateColumns: "repeat(6,minmax(130px,1fr))", gap: 8, overflowX: "auto", marginTop: 14 }}>{stages.map((stage, index) => <div key={stage.key} style={{ minWidth: 130, position: "relative" }}><button type="button" onClick={() => setMessage(`${stage.title}: ${stage.owner}`)} style={{ width: "100%", textAlign: "left", padding: 12, borderRadius: 10, border: `1px solid ${stage.state === "active" ? "#f59e0b" : "var(--border)"}`, background: stage.state === "active" ? "#422006" : "var(--surface-2)", color: "inherit" }}><div style={{ color: stage.state === "done" ? "#4ade80" : stage.state === "active" ? "#fbbf24" : "var(--muted)", fontSize: 11, fontWeight: 800 }}>{stage.state.toUpperCase()}</div><strong style={{ display: "block", marginTop: 7 }}>{stage.title}</strong><small style={{ display: "block", color: "var(--muted)", marginTop: 5 }}>{stage.owner}</small></button>{index < stages.length - 1 && <ArrowRight aria-hidden="true" size={16} style={{ position: "absolute", right: -13, top: 32, color: "var(--muted)" }} />}</div>)}</div></section>

    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.2fr) minmax(320px,.8fr)", gap: 16 }}>
      <section className="surface-panel"><div className="section-header"><div><h2 style={{ margin: 0 }}><PackageCheck size={18} /> {copy.pickupTitle}</h2><p style={{ margin: "6px 0 0", color: "var(--muted)" }}>One announcement → station display + Team Leader PDA + MES Kanban.</p></div><button type="button" onClick={() => setMessage(copy.published)}>MES policy</button></div>{["WO-20260807-0042", "WO-20260807-0038", "WO-20260807-0034"].map((workOrder, index) => <button type="button" key={workOrder} onClick={() => setSelectedWorkOrder(workOrder)} style={{ display: "flex", width: "100%", textAlign: "left", justifyContent: "space-between", gap: 12, alignItems: "center", padding: 13, marginTop: 9, borderRadius: 9, border: `1px solid ${selectedWorkOrder === workOrder ? "#38bdf8" : "var(--border)"}`, background: selectedWorkOrder === workOrder ? "#082f49" : "var(--surface-2)", color: "inherit" }}><span><strong>{workOrder}</strong><small style={{ display: "block", color: "var(--muted)", marginTop: 4 }}>BKT-00{42 - index * 4} · {8 - index * 2} SN · {profile.stationName} → REPAIR</small></span><span className="badge badge-warning">{index === 0 ? "READY_FOR_PICKUP" : "WAITING"}</span></button>)}</section>
      <section className="surface-panel"><div className="section-header"><div><h2 style={{ margin: 0 }}><AlertTriangle size={18} /> {copy.andonTitle}</h2><p style={{ margin: "6px 0 0", color: "var(--muted)" }}>Missing feedback escalates by MES policy.</p></div></div><div style={{ display: "grid", gap: 9, marginTop: 12 }}>{[["L1_LINE", "Pickup acknowledgement overdue", "Team Leader PDA", "#f59e0b"], ["L2_SUPERVISOR", "Quantity / SN mismatch", "QC supervisor", "#ef4444"]].map(([level, text, owner, color]) => <div key={level} style={{ borderLeft: `4px solid ${color}`, padding: "10px 12px", background: "var(--surface-2)", borderRadius: 6 }}><strong style={{ color }}>{level}</strong><div style={{ marginTop: 4 }}>{text}</div><small style={{ color: "var(--muted)" }}>Owner: {owner}</small></div>)}</div><div role="status" style={{ marginTop: 12, color: "var(--muted)", fontSize: 12 }}>{message || copy.no}</div></section>
    </div>

    <section className="surface-panel"><div className="section-header"><div><h2 style={{ margin: 0 }}><ClipboardList size={18} /> {copy.timeline} - {selectedWorkOrder}</h2><p style={{ margin: "6px 0 0", color: "var(--muted)" }}>Facts, commands, feedback, and decisions stay append-only.</p></div><span className="badge badge-success"><CheckCircle2 size={13} /> command feedback required</span></div><div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(140px,1fr))", gap: 8, marginTop: 14 }}>{[["10:02", "NG_CONFIRMED", "ICT"], ["10:04", "REPAIR_ORDER_CREATED", "MES"], ["10:08", "NG_PICKUP_ANNOUNCEMENT", "REPAIR"], ["10:11", "CLAIMED", "TEAM_LEADER_PDA"], ["WAIT", "REPAIR_RECEIVED", "WAITING"]].map(([time, event, actor]) => <div key={event} style={{ padding: 11, border: "1px solid var(--border)", borderRadius: 8 }}><small style={{ color: "var(--muted)" }}>{time}</small><strong style={{ display: "block", marginTop: 5, fontSize: 12 }}>{event}</strong><small style={{ color: "var(--muted)" }}>{actor}</small></div>)}</div></section>
  </div>;
}
