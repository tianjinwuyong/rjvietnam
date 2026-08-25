import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronRight, Clock3, Factory, PackageCheck, RefreshCw, ScanLine, ShieldCheck } from "lucide-react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { t } from "../i18n";
import { authStorage } from "../api/client";
import { MaterialLoadingWorkflow } from "./MaterialLoadingWorkflow";
import { SmtLoadingApprovalQueue } from "./SmtLoadingApprovalQueue";

type LoadingStatus = "NOT_SCHEDULED" | "EARLY" | "ON_TIME" | "LATE";
type WorkOrder = { workOrderCode: string; status: string; plannedQty: number; completedQty: number; actualConsumedQty?: number; estimatedProductionRatePerMinute?: number; rateSource?: string; productCode: string; productNameZh?: string; lineCode: string; plannedStartAt?: string | null; plannedFinishAt?: string | null; loadingTimeStatus: LoadingStatus; materialCount: number; boundMaterialCount: number; materials: Array<{ materialCode: string; requiredQty: number; availableQty: number; projectedQty: number; actualConsumedQty?: number; actualConsumptionRatePerMinute?: number; supplySafe: boolean; bound: boolean }> };
type DailyPlan = { id: number; planDate: string; lineCode: string; workOrderCode: string; plannedStartAt: string; plannedFinishAt?: string | null; requiredPdaCount: number; status: string; plannedMaterialCount: number; completedMaterialCount: number; activePdaCount: number; loadingStatus: string };
type StationKpi = { workingHoursToday: number; stoppedHoursToday: number; availabilityPct: number; source: string };

async function read<T>(path: string): Promise<T> {
  const token = authStorage.getToken();
  const response = await fetch(path, { headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) throw new Error(body?.error?.message ?? body?.message ?? body?.error ?? `HTTP ${response.status}`);
  return (body.data ?? body) as T;
}

function dateTime(value: string | null | undefined, locale: Locale) {
  return value ? new Date(value).toLocaleString(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : t("mes.smtLoading.notSet", locale);
}

const statusClass = (status: LoadingStatus) => status === "LATE" ? "badge-danger" : status === "ON_TIME" ? "badge-ok" : "badge-warning";

export function SmtMaterialLoadingPage({ locale }: { locale: Locale }) {
  const [lineCode, setLineCode] = useState("L001");
  const lineOptions = [
    { code: "L001", label: "SMT" },
    { code: "L002", label: "AUTO LINE" },
    { code: "L004", label: "MANUAL LINE" },
  ];
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [active, setActive] = useState<"plan" | "loading" | "unlock" | "approval">("plan");
  const [selectedLine, setSelectedLine] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [dailyPlans, setDailyPlans] = useState<DailyPlan[]>([]);
  const [forecastDate, setForecastDate] = useState(new Date().toISOString().slice(0, 10));
  const [forecastStart, setForecastStart] = useState("08:00");
  const [forecastFinish, setForecastFinish] = useState("10:00");
  const [forecastWo, setForecastWo] = useState("");
  const [forecastPdas, setForecastPdas] = useState("1");
  const [forecastMessage, setForecastMessage] = useState("");
  const [morningStart, setMorningStart] = useState("08:00");
  const [morningLeadMinutes, setMorningLeadMinutes] = useState("30");
  const [morningMessage, setMorningMessage] = useState("");
  const [stationKpi, setStationKpi] = useState<StationKpi | null>(null);
  const [actualRate, setActualRate] = useState("12");
  const [idleMinutes, setIdleMinutes] = useState("0");
  const [emergencyWo, setEmergencyWo] = useState("");
  const [replanMessage, setReplanMessage] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [nextOrders, nextPlans, lineView] = await Promise.all([
        read<WorkOrder[]>(`/api/smt/loading/work-orders?lineCode=${encodeURIComponent(lineCode)}`),
        read<DailyPlan[]>(`/api/smt/loading/daily-plans?from=${forecastDate}&to=${forecastDate}&lineCode=${encodeURIComponent(lineCode)}`),
        read<{ stationKpi?: StationKpi }>(`/mes/lines/${encodeURIComponent(lineCode)}`)
      ]);
      setOrders(nextOrders); setDailyPlans(nextPlans); setStationKpi(lineView.stationKpi ?? null);
      setMessage("");
    }
    catch (error) { setMessage(error instanceof Error ? error.message : t("mes.smtLoading.loadFailed", locale)); }
    finally { setBusy(false); }
  }, [lineCode, locale, forecastDate]);
  useEffect(() => { void load(); }, [load]);

  async function saveForecast(publish: boolean) {
    const wo = forecastWo || orders[0]?.workOrderCode;
    if (!wo) { setForecastMessage("请选择工单"); return; }
    setBusy(true); setForecastMessage("");
    try {
        const token = authStorage.getToken();
        const response = await fetch("/api/smt/loading/daily-plans", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ planDate: forecastDate, lineCode, workOrderCode: wo, plannedStartAt: `${forecastDate}T${forecastStart}:00`, plannedFinishAt: `${forecastDate}T${forecastFinish}:00`, requiredPdaCount: Number(forecastPdas), createdBy: "PMC" }) });
        const body = await response.json(); if (!response.ok) throw new Error(body?.error?.message || "保存失败");
        const id = body?.data?.id;
        if (publish && id) await fetch(`/api/smt/loading/daily-plans/${id}/publish`, { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {} });
        setForecastMessage(publish ? "上料预报已发布到 MES/PDA" : "上料预报已保存");
        void load();
      } catch (error) { setForecastMessage(error instanceof Error ? error.message : "保存失败"); }
    finally { setBusy(false); }
  }

  async function createMorningPreparation() {
    const wo = forecastWo || orders[0]?.workOrderCode;
    if (!wo) { setMorningMessage("请先选择 MES 工单"); return; }
    const lead = Math.max(1, Number(morningLeadMinutes) || 30);
    const machineStart = new Date(`${forecastDate}T${morningStart}:00`);
    if (Number.isNaN(machineStart.getTime())) { setMorningMessage("请输入有效的开机时间"); return; }
    const preparationStart = new Date(machineStart.getTime() - lead * 60 * 1000);
    setBusy(true); setMorningMessage("");
    try {
      const response = await fetch("/api/smt/loading/daily-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(authStorage.getToken() ? { Authorization: `Bearer ${authStorage.getToken()}` } : {}) },
        body: JSON.stringify({
          planDate: forecastDate,
          lineCode,
          workOrderCode: wo,
          plannedStartAt: preparationStart.toISOString(),
          plannedFinishAt: machineStart.toISOString(),
          requiredPdaCount: Number(forecastPdas),
          createdBy: "MES-MORNING-STARTUP",
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message || "早班备料计划创建失败");
      const id = body?.data?.id;
      if (id) {
        const token = authStorage.getToken();
        const publish = await fetch(`/api/smt/loading/daily-plans/${id}/publish`, { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {} });
        if (!publish.ok) {
          const publishBody = await publish.json().catch(() => ({}));
          throw new Error(publishBody?.error?.message || "早班备料计划发布失败");
        }
      }
      setMorningMessage(`早班备料已发布：${preparationStart.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} 开始，${morningStart} 开机`);
      void load();
    } catch (error) {
      setMorningMessage(error instanceof Error ? error.message : "早班备料计划创建失败");
    } finally { setBusy(false); }
  }

  function recalculateProductionPlan() {
    const rate = Math.max(0.1, Number(actualRate) || 12);
    const idle = Math.max(0, Number(idleMinutes) || 0);
    const emergency = emergencyWo.trim();
    if (!dailyPlans.length) { setReplanMessage("当前没有可重排的生产计划"); return; }
    const ordered = [...dailyPlans].sort((a, b) => new Date(a.plannedStartAt).getTime() - new Date(b.plannedStartAt).getTime());
    const first = ordered[0];
    const baselineMinutes = Math.max(1, first.plannedMaterialCount || 1);
    const rateShift = Math.round((baselineMinutes / rate) * 10) / 10;
    let cursor = new Date(first.plannedStartAt).getTime() + idle * 60_000;
    const next = ordered.map((plan, index) => {
      const duration = Math.max(15, Math.round((plan.plannedMaterialCount || 1) / rate * 60_000));
      const start = new Date(cursor);
      const finish = new Date(cursor + duration);
      cursor = finish.getTime();
      return { ...plan, plannedStartAt: start.toISOString(), plannedFinishAt: finish.toISOString(), status: index === 0 ? "CURRENT_WINDOW" : plan.status };
    });
    if (emergency && !next.some(plan => plan.workOrderCode === emergency)) {
      const emergencyPlan: DailyPlan = { ...next[0], id: -Date.now(), workOrderCode: emergency, status: "EMERGENCY", plannedStartAt: new Date().toISOString(), plannedFinishAt: new Date(Date.now() + 30 * 60_000).toISOString() };
      next.unshift(emergencyPlan);
    }
    setDailyPlans(next);
    setReplanMessage(`计划已按实际速度 ${rate}/分钟、停机 ${idle} 分钟${emergency ? `、紧急 WO ${emergency} ` : " "}重新计算；当前只开放第一个 WO。`);
  }

  if (selectedLine) return <MaterialLoadingWorkflow locale={locale} lineCode={selectedLine} onBack={() => { setSelectedLine(null); void load(); }} />;

  const onTime = orders.filter(order => order.loadingTimeStatus === "ON_TIME").length;
  const blocked = orders.filter(order => order.materials.some(material => !material.supplySafe)).length;
  const loaded = orders.reduce((sum, order) => sum + order.boundMaterialCount, 0);
  const nextOrder = orders.find(order => order.materials.some(material => !material.bound)) ?? orders[0];
  const planReady = orders.length > 0;
  const supplyReady = planReady && orders.every(order => order.materials.length > 0 && order.materials.every(material => material.supplySafe));
  const qualityReady = supplyReady;
  const mesReady = planReady && orders.some(order => order.loadingTimeStatus === "ON_TIME" || order.loadingTimeStatus === "EARLY");
  const approvalLabels = locale.startsWith("zh")
    ? { tab: "审批关卡", title: "SMT上料审批关卡", hint: "PMC完成调查后，WMS和IQC/QMS必须确认，MES才可向PDA发放上料许可。", pmc: "PMC调查完成", wms: "WMS物料确认", iqc: "IQC/QMS质量放行", mes: "MES发放工单", pass: "已通过", wait: "待确认", issue: "向MES发放OK", blocked: "条件未满足，禁止发放", note: "此页面只显示MES实时关卡；拒绝或冻结会阻止PDA上料。" }
    : locale.startsWith("vi")
      ? { tab: "Phê duyệt", title: "Cổng phê duyệt nạp SMT", hint: "PMC phải hoàn tất điều tra, WMS và IQC/QMS xác nhận trước khi MES cấp phép cho PDA.", pmc: "PMC hoàn tất điều tra", wms: "WMS xác nhận vật liệu", iqc: "IQC/QMS phát hành chất lượng", mes: "MES phát hành lệnh", pass: "Đạt", wait: "Chờ xác nhận", issue: "Phát hành OK cho MES", blocked: "Chưa đủ điều kiện", note: "Trang này chỉ hiển thị cổng thời gian thực của MES; từ chối hoặc giữ lô sẽ chặn PDA." }
      : { tab: "Approval gates", title: "SMT loading approval gates", hint: "PMC investigation must finish, then WMS and IQC/QMS must confirm before MES issues the PDA loading permission.", pmc: "PMC investigation complete", wms: "WMS material confirmed", iqc: "IQC/QMS quality released", mes: "MES WO issued", pass: "Passed", wait: "Waiting", issue: "Issue OK to MES", blocked: "Conditions incomplete", note: "This page displays live MES gates; a rejection or hold blocks the PDA." };
  const approvalGates = [{ label: approvalLabels.pmc, ok: planReady }, { label: approvalLabels.wms, ok: supplyReady }, { label: approvalLabels.iqc, ok: qualityReady }, { label: approvalLabels.mes, ok: mesReady }];
  const approvalReady = approvalGates.every(gate => gate.ok);

  return <div className="screen-stack" style={{ gap: 16 }}>
    <section className="surface-panel" style={{ padding: 22, background: "linear-gradient(135deg, var(--nav), #10283f)", color: "white", border: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, opacity: .8, fontSize: 12, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase" }}><Factory size={15} /> ALL LINES / MATERIAL CONTROL</div>
          <h2 style={{ margin: "8px 0 4px", fontSize: 30, color: "white" }}>{t("mes.smtLoading.title", locale)}</h2>
          <p style={{ margin: 0, opacity: .78 }}>{t("mes.smtLoading.subtitle", locale)}</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label style={{ fontSize: 12, opacity: .75 }}>产线 / LINE</label>
          <select value={lineCode} onChange={e => setLineCode(e.target.value)} aria-label="产线 / LINE" style={{ width: 150, background: "rgba(255,255,255,.12)", border: "1px solid rgba(255,255,255,.25)", color: "white" }}>
            {lineOptions.map(line => <option key={line.code} value={line.code}>{line.label} · {line.code}</option>)}
          </select>
          <button type="button" className="action-button" onClick={() => void load()} disabled={busy} style={{ background: "white", color: "var(--nav)", border: 0 }}><RefreshCw size={14} />{t("common.refresh", locale)}</button>
        </div>
      </div>
      {stationKpi && <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(120px, 1fr))", gap: 10, marginTop: 14 }}>
        <div style={{ padding: 10, borderRadius: 8, background: "rgba(255,255,255,.11)" }}><div style={{ opacity: .7, fontSize: 12 }}>今日平均工作小时</div><strong style={{ fontSize: 22 }}>{stationKpi.workingHoursToday}</strong></div>
        <div style={{ padding: 10, borderRadius: 8, background: "rgba(255,255,255,.11)" }}><div style={{ opacity: .7, fontSize: 12 }}>今日平均停机小时</div><strong style={{ fontSize: 22 }}>{stationKpi.stoppedHoursToday}</strong></div>
        <div style={{ padding: 10, borderRadius: 8, background: "rgba(255,255,255,.11)" }}><div style={{ opacity: .7, fontSize: 12 }}>运行率</div><strong style={{ fontSize: 22 }}>{stationKpi.availabilityPct}%</strong></div>
      </div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(110px, 1fr))", gap: 10, marginTop: 24 }}>
        {[{ label: t("mes.smtLoading.workOrders", locale), value: orders.length, icon: <Factory size={18} /> }, { label: t("mes.smtLoading.onTime", locale), value: onTime, icon: <Clock3 size={18} /> }, { label: t("mes.smtLoading.bound", locale), value: loaded, icon: <PackageCheck size={18} /> }, { label: t("mes.smtLoading.blocked", locale), value: blocked, icon: <AlertTriangle size={18} /> }].map(item => <div key={item.label} style={{ padding: "12px 14px", borderRadius: 10, background: "rgba(255,255,255,.11)" }}><div style={{ display: "flex", justifyContent: "space-between", opacity: .7, fontSize: 12 }}>{item.label}{item.icon}</div><strong style={{ display: "block", fontSize: 25, marginTop: 5 }}>{item.value}</strong></div>)}
      </div>
    </section>

    {message && <div className="badge badge-danger" style={{ padding: 12 }}>{message}</div>}

    <section className="surface-panel" style={{ padding: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(120px, 1fr))", gap: 10 }}>
        {[{ label: t("mes.smtLoading.pmcGate", locale), ok: planReady, hint: t("mes.smtLoading.planTab", locale) }, { label: t("mes.smtLoading.wmsGate", locale), ok: supplyReady, hint: t("mes.smtLoading.materials", locale) }, { label: t("mes.smtLoading.qmsGate", locale), ok: qualityReady, hint: t("mes.smtLoading.readiness", locale) }, { label: t("mes.smtLoading.mesGate", locale), ok: mesReady, hint: t("mes.smtLoading.loadingTab", locale) }].map(gate => <div key={gate.label} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 9, background: gate.ok ? "var(--ok-bg)" : "var(--surface-2)", border: `1px solid ${gate.ok ? "rgba(11,122,83,.22)" : "var(--border)"}` }}><div style={{ color: gate.ok ? "var(--ok)" : "var(--muted)" }}>{gate.ok ? <CheckCircle2 size={19} /> : <Clock3 size={19} />}</div><div><strong style={{ display: "block", fontSize: 13 }}>{gate.label}</strong><span style={{ color: "var(--muted)", fontSize: 11 }}>{gate.hint}</span></div></div>)}
      </div>
    </section>

    <div className="mes-secondary-nav" role="tablist" style={{ alignSelf: "flex-start" }}>
      <button className={active === "plan" ? "active" : ""} onClick={() => setActive("plan")}>{t("mes.smtLoading.planTab", locale)}</button>
      <button className={active === "loading" ? "active" : ""} onClick={() => setActive("loading")}>{t("mes.smtLoading.loadingTab", locale)}</button>
      <button className={active === "unlock" ? "active" : ""} onClick={() => setActive("unlock")}>{t("mes.smtLoading.unlockTab", locale)}</button>
      <button className={active === "approval" ? "active" : ""} onClick={() => setActive("approval")}>{approvalLabels.tab}</button>
    </div>

    {active === "approval" && <SmtLoadingApprovalQueue locale={locale} />}
    {false && <section className="surface-panel" style={{ padding: 20, maxWidth: 900 }}>
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start", marginBottom: 18 }}><div style={{ color: "var(--nav)" }}><ShieldCheck size={30} /></div><div><h3 style={{ margin: 0 }}>{approvalLabels.title}</h3><p style={{ margin: "6px 0 0", color: "var(--muted)" }}>{approvalLabels.hint}</p></div></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(150px, 1fr))", gap: 12 }}>
        {approvalGates.map(gate => <div key={gate.label} style={{ padding: 15, borderRadius: 10, border: `1px solid ${gate.ok ? "rgba(11,122,83,.25)" : "var(--border)"}`, background: gate.ok ? "var(--ok-bg)" : "var(--surface-2)" }}><div style={{ color: gate.ok ? "var(--ok)" : "var(--muted)", marginBottom: 10 }}>{gate.ok ? <CheckCircle2 size={23} /> : <Clock3 size={23} />}</div><strong style={{ display: "block", minHeight: 38 }}>{gate.label}</strong><span className={`badge ${gate.ok ? "badge-ok" : "badge-warning"}`} style={{ marginTop: 10 }}>{gate.ok ? approvalLabels.pass : approvalLabels.wait}</span></div>)}
      </div>
      <div className="badge badge-info" style={{ padding: 12, marginTop: 18 }}>{approvalLabels.note}</div>
      <button type="button" className="action-button action-button-primary" disabled={!approvalReady} style={{ marginTop: 18, opacity: approvalReady ? 1 : .55 }} onClick={() => setMessage(approvalReady ? "MES release must be completed by the authorized PMC/MES release action." : approvalLabels.blocked)}><ShieldCheck size={16} />{approvalLabels.issue}</button>
      {!approvalReady && <div style={{ color: "var(--danger)", fontSize: 12, marginTop: 8 }}>{approvalLabels.blocked}</div>}
    </section>}

    {active === "plan" && <>
      <section className="surface-panel" style={{ padding: 20, border: "1px solid rgba(245, 158, 11, .35)", background: "linear-gradient(135deg, rgba(245,158,11,.08), var(--surface))" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div>
            <h3 style={{ margin: 0 }}>早班开机备料 / Morning startup preparation</h3>
            <p style={{ margin: "6px 0 0", color: "var(--muted)" }}>MES 根据工单和 BOM 提前打开备料窗口；发布后 PDA 按机器、通道、飞达和物料逐项执行。</p>
          </div>
          <span className="badge badge-warning">MES → PDA</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(120px, 1fr))", gap: 8, marginTop: 14, alignItems: "end" }}>
          <label>备料日期<input type="date" value={forecastDate} onChange={e => setForecastDate(e.target.value)} /></label>
          <label>机器开机时间<input type="time" value={morningStart} onChange={e => setMorningStart(e.target.value)} /></label>
          <label>提前备料分钟<input type="number" min={1} value={morningLeadMinutes} onChange={e => setMorningLeadMinutes(e.target.value)} /></label>
          <label>MES 工单<select value={forecastWo || orders[0]?.workOrderCode || ""} onChange={e => setForecastWo(e.target.value)}>{orders.map(o => <option key={o.workOrderCode} value={o.workOrderCode}>{o.workOrderCode}</option>)}</select></label>
          <button type="button" className="action-button action-button-primary" disabled={busy || !orders.length} onClick={() => void createMorningPreparation()}><PackageCheck size={16} />发布早班备料</button>
        </div>
        {morningMessage && <div className="badge badge-info" style={{ marginTop: 10, padding: 8 }}>{morningMessage}</div>}
      </section>
      <section className="surface-panel" style={{ padding: 20, border: "1px solid rgba(19,101,178,.25)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div><h3 style={{ margin: 0 }}>上料预报 / Daily loading forecast</h3><p style={{ margin: "5px 0 0", color: "var(--muted)" }}>PMC 安排每日时间；发布后 MES 下发到 PDA，并实时显示完成进度。</p></div>
          <span className="badge badge-info">MES → PDA</span>
        </div>
        <div className="badge badge-info" style={{ display: "block", marginTop: 10, padding: 10 }}>计算规则：产品/分钟 = 生产数量 ÷ 生产分钟数；物料/分钟 = 产品/分钟 × BOM 单台用量。手动线无实际产出时，使用已发布计划模拟，并标记为模拟值。</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(100px, 1fr))", gap: 8, marginTop: 14 }}>
          <label>日期<input type="date" value={forecastDate} onChange={e => setForecastDate(e.target.value)} /></label>
          <label>工单<select value={forecastWo || orders[0]?.workOrderCode || ""} onChange={e => setForecastWo(e.target.value)}>{orders.map(o => <option key={o.workOrderCode} value={o.workOrderCode}>{o.workOrderCode}</option>)}</select></label>
          <label>开始<input type="time" value={forecastStart} onChange={e => setForecastStart(e.target.value)} /></label>
          <label>结束<input type="time" value={forecastFinish} onChange={e => setForecastFinish(e.target.value)} /></label>
          <label>PDA 数量<input type="number" min={1} value={forecastPdas} onChange={e => setForecastPdas(e.target.value)} /></label>
          <div style={{ display: "flex", gap: 6, alignItems: "end" }}><button type="button" className="action-button" disabled={busy} onClick={() => void saveForecast(false)}>保存</button><button type="button" className="action-button action-button-primary" disabled={busy} onClick={() => void saveForecast(true)}>发布</button></div>
        </div>
        {forecastMessage && <div className="badge badge-info" style={{ marginTop: 10, padding: 8 }}>{forecastMessage}</div>}
        <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
          {dailyPlans.map(plan => <div key={plan.id} style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr 1fr 1fr 1fr", gap: 8, padding: 10, border: "1px solid var(--border)", borderRadius: 8 }}><strong>{plan.planDate} · {plan.lineCode}</strong><span>WO {plan.workOrderCode}</span><span>{new Date(plan.plannedStartAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}–{plan.plannedFinishAt ? new Date(plan.plannedFinishAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</span><span>{plan.completedMaterialCount}/{plan.plannedMaterialCount} 已完成</span><span>PDA {plan.activePdaCount}/{plan.requiredPdaCount}</span><span className={`badge ${plan.status === "PUBLISHED" ? "badge-ok" : "badge-warning"}`}>{plan.status} · {plan.loadingStatus}</span></div>)}
          {!dailyPlans.length && <span style={{ color: "var(--muted)", fontSize: 13 }}>当天暂无上料预报</span>}
          <div style={{ marginTop: 16, padding: 14, border: "1px solid rgba(19,101,178,.25)", borderRadius: 10, background: "rgba(19,101,178,.04)" }}>
            <strong>动态生产计划 / Dynamic production plan</strong>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(120px, 1fr))", gap: 8, marginTop: 10, alignItems: "end" }}>
              <label>实际速度（件/分钟）<input type="number" min={0.1} value={actualRate} onChange={e => setActualRate(e.target.value)} /></label>
              <label>停机时间（分钟）<input type="number" min={0} value={idleMinutes} onChange={e => setIdleMinutes(e.target.value)} /></label>
              <label>紧急 WO（可选）<input value={emergencyWo} onChange={e => setEmergencyWo(e.target.value)} placeholder="WO-EMERGENCY" /></label>
              <button type="button" className="action-button action-button-primary" onClick={recalculateProductionPlan}>按实际情况重排</button>
            </div>
            {replanMessage && <div className="badge badge-info" style={{ marginTop: 10, padding: 8 }}>{replanMessage}</div>}
          </div>
        </div>
      </section>
      <section className="surface-panel" style={{ padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", marginBottom: 16 }}><div><h3 style={{ margin: 0 }}>{t("mes.smtLoading.planTitle", locale)}</h3><p style={{ margin: "5px 0 0", color: "var(--muted)" }}>{t("mes.smtLoading.planHint", locale)}</p></div>{nextOrder && <button type="button" className="action-button action-button-primary" onClick={() => { setSelectedLine(nextOrder.lineCode); setActive("loading"); }}><ScanLine size={16} />{t("mes.smtLoading.openLoading", locale)}<ChevronRight size={15} /></button>}</div>
        <div style={{ display: "grid", gap: 10 }}>{orders.map(order => { const ready = order.materials.length > 0 && order.materials.every(material => material.supplySafe); return <div key={order.workOrderCode} style={{ display: "grid", gridTemplateColumns: "minmax(170px, 1.4fr) minmax(130px, 1fr) minmax(180px, 1.2fr) minmax(140px, 1fr) minmax(100px, .7fr) auto", gap: 12, alignItems: "center", padding: 14, border: "1px solid var(--border)", borderRadius: 10, background: ready ? "var(--surface)" : "rgba(190, 58, 58, .035)" }}><div><strong>{order.workOrderCode}</strong><div style={{ color: "var(--muted)", fontSize: 12, marginTop: 3 }}>{order.productCode} · {order.lineCode}</div></div><div><span className={`badge ${statusClass(order.loadingTimeStatus)}`}>{t(`mes.smtLoading.time.${order.loadingTimeStatus}`, locale)}</span><div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>{dateTime(order.plannedStartAt, locale)}</div></div><div><strong>实际消耗：{order.actualConsumedQty ?? 0}</strong><div style={{ color: "var(--muted)", fontSize: 12, marginTop: 3 }}>生产速度：{order.estimatedProductionRatePerMinute ?? 0} 产品/分钟 · {order.rateSource === "MANUAL_PLAN_SIMULATION" ? "计划模拟" : "MES实际"}</div><div style={{ color: "var(--muted)", fontSize: 11, marginTop: 3 }}>{order.materials.slice(0, 3).map(material => `${material.materialCode} 实际${material.actualConsumedQty ?? 0}，${material.actualConsumptionRatePerMinute ?? 0}/分钟`).join("；")}</div></div><div><strong>{order.boundMaterialCount} / {order.materialCount}</strong><div style={{ color: "var(--muted)", fontSize: 12, marginTop: 3 }}>{t("mes.smtLoading.materials", locale)}</div></div><div style={{ color: ready ? "var(--ok)" : "var(--danger)", fontWeight: 700, fontSize: 13 }}>{ready ? <><CheckCircle2 size={15} /> {t("mes.smtLoading.ready", locale)}</> : <><AlertTriangle size={15} /> {t("mes.smtLoading.blocked", locale)}</>}</div><button type="button" className="icon-button" aria-label={t("mes.smtLoading.open", locale)} onClick={() => { setSelectedLine(order.lineCode); setActive("loading"); }}><ChevronRight size={18} /></button></div>; })}</div>
        {!orders.length && <div className="placeholder-view">{t("mes.smtLoading.empty", locale)}</div>}
      </section>
    </>}

    {active === "loading" && <section className="surface-panel" style={{ padding: 24, textAlign: "center", maxWidth: 620 }}><div style={{ width: 64, height: 64, margin: "0 auto 14px", display: "grid", placeItems: "center", borderRadius: 18, background: "rgba(19, 101, 178, .12)", color: "var(--nav)" }}><ScanLine size={30} /></div><h3 style={{ margin: 0 }}>{t("mes.smtLoading.loadingTitle", locale)}</h3><p style={{ color: "var(--muted)", maxWidth: 450, margin: "8px auto 18px" }}>{t("mes.smtLoading.loadingHint", locale)}</p><button type="button" className="action-button action-button-primary" onClick={() => setSelectedLine(nextOrder?.lineCode ?? lineCode)}><PackageCheck size={16} />{t("mes.smtLoading.openLoading", locale)}<ChevronRight size={15} /></button></section>}
    {active === "unlock" && <section className="surface-panel" style={{ padding: 24, maxWidth: 720 }}><div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}><div style={{ color: "var(--nav)" }}><ShieldCheck size={30} /></div><div><h3 style={{ margin: 0 }}>{t("mes.smtLoading.unlockTitle", locale)}</h3><p style={{ color: "var(--muted)", margin: "8px 0 14px" }}>{t("mes.smtLoading.unlockHint", locale)}</p><div className="badge badge-info" style={{ padding: 10 }}>{t("mes.smtLoading.unlockRule", locale)}</div><div style={{ marginTop: 18 }}><button type="button" className="action-button action-button-primary" onClick={() => setSelectedLine(nextOrder?.lineCode ?? lineCode)}><ShieldCheck size={16} />{t("mes.smtLoading.openUnlock", locale)}<ChevronRight size={15} /></button></div></div></div></section>}
  </div>;
}
