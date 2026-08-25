import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowRight, Check, CheckCircle2, CircleDashed, ClipboardCheck,
  Factory, FileCheck2, PackageCheck, RefreshCw, Send, ShieldCheck, XCircle,
} from "lucide-react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import {
  pmcApi,
  type PmcClosedLoopDashboard,
  type PmcClosedLoopPlan,
  type PmcPlanReviewResult,
  type PmcPlanReviewType,
} from "../api";

type ReviewStage = {
  number: number;
  icon: typeof ClipboardCheck;
  title: string;
  owner: string;
  description: string;
  evidence: string;
  reviews: PmcPlanReviewType[];
};

const copy = {
  "zh-CN": {
    title: "PMC 生产放行闭环",
    subtitle: "计划评审 → 产能 → MRP → WMS 齐套 → 质量工程 → 审批放行",
    refresh: "刷新最新状态",
    plans: "计划包",
    pendingPlans: "待闭环计划",
    blocked: "阻断项",
    ready: "可放行",
    released: "已发布 MES",
    selectPlan: "选择一个计划包查看门禁",
    noPlan: "暂无主生产计划",
    qty: "计划数量",
    line: "产线",
    window: "计划窗口",
    owner: "责任部门",
    evidence: "要求证据",
    conclusion: "评审结论",
    evidenceRef: "证据编号 / 单据引用",
    notePlaceholder: "写明结论、风险及需要跟进的动作",
    evidencePlaceholder: "例如 CAP-2026-0729-01",
    pass: "通过",
    warning: "有条件通过",
    fail: "不通过",
    saveReview: "记录评审",
    reReview: "重新评审",
    saving: "处理中…",
    pending: "待评审",
    approvalTitle: "必要审批",
    approvalHint: "前五个环节全部完成且无失败项后，开放 PMC 经理和生产经理审批。",
    pmcManager: "PMC 经理",
    productionManager: "生产经理",
    approve: "批准",
    reject: "驳回",
    approved: "已批准",
    rejected: "已驳回",
    workOrder: "工单绑定与齐套确认",
    workOrderCode: "工单号",
    kitReady: "WMS 已完成备料并确认齐套",
    bind: "绑定工单",
    release: "发布到 MES",
    releaseReady: "所有门禁已通过，可正式发布到 MES。",
    releaseBlocked: "发布被阻断",
    audit: "所有评审、审批、绑定和发布动作均保留操作人及时间。",
    status: "状态",
    complete: "完成",
    incomplete: "未完成",
    actor: "当前操作人",
    success: "操作成功，闭环状态已刷新。",
    stage1: "PMC 计划评审",
    stage1Owner: "PMC",
    stage1Desc: "确认需求来源、交期、BOM 版本、成本边界及计划窗口。",
    stage1Evidence: "客户 PO / 需求单、有效 BOM、交期与成本影响",
    stage2: "生产能力评审",
    stage2Owner: "生产部",
    stage2Desc: "核对产线负荷、班次、人力、换线和设备可用性。",
    stage2Evidence: "产能负荷表、换线计划、设备与人员可用记录",
    stage3: "物料需求计算",
    stage3Owner: "PMC / 采购",
    stage3Desc: "按有效 BOM、损耗率和在库/在途数量完成 MRP 净需求计算。",
    stage3Evidence: "MRP 运算批次、短缺清单、到料承诺",
    stage4: "WMS 备料和齐套确认",
    stage4Owner: "WMS",
    stage4Desc: "确认库存已锁定、批次合格、关键料可追溯且可按时发料。",
    stage4Evidence: "备料单、齐套率、IQC 放行批次、库位锁定记录",
    stage5: "质量及工程条件确认",
    stage5Owner: "质量 / 工程",
    stage5Desc: "确认工艺文件、首件要求、质量冻结、ECN 与替代料均受控。",
    stage5Evidence: "SOP/工艺版本、首件计划、质量放行、ECN/替代料批准",
  },
  "en-US": {
    title: "PMC Production Release Loop",
    subtitle: "Plan review → Capacity → MRP → WMS kit → Quality & engineering → Approval",
    refresh: "Refresh current status", plans: "Plan packages", pendingPlans: "Open plans",
    blocked: "Blocking items", ready: "Ready to release", released: "Released to MES",
    selectPlan: "Select a plan package to inspect its gates", noPlan: "No master plans",
    qty: "Planned quantity", line: "Line", window: "Planning window", owner: "Owner",
    evidence: "Required evidence", conclusion: "Review conclusion", evidenceRef: "Evidence / document reference",
    notePlaceholder: "State the conclusion, risks, and required follow-up",
    evidencePlaceholder: "e.g. CAP-2026-0729-01", pass: "Pass", warning: "Conditional",
    fail: "Fail", saveReview: "Record review", reReview: "Review again", saving: "Processing…",
    pending: "Pending", approvalTitle: "Required approvals",
    approvalHint: "PMC and Production Manager approvals unlock after the first five stages are complete with no failures.",
    pmcManager: "PMC Manager", productionManager: "Production Manager", approve: "Approve",
    reject: "Reject", approved: "Approved", rejected: "Rejected", workOrder: "Work order binding and kit confirmation",
    workOrderCode: "Work order code", kitReady: "WMS has prepared and confirmed the complete kit",
    bind: "Bind work order", release: "Release to MES",
    releaseReady: "Every gate passed. The plan can now be released to MES.",
    releaseBlocked: "Release is blocked", audit: "Every review, approval, binding, and release action is audited.",
    status: "Status", complete: "Complete", incomplete: "Incomplete", actor: "Current actor",
    success: "Action completed and loop status refreshed.",
    stage1: "PMC plan review", stage1Owner: "PMC",
    stage1Desc: "Validate demand, due date, BOM revision, cost boundary, and planning window.",
    stage1Evidence: "Customer PO/demand, effective BOM, delivery and cost impact",
    stage2: "Capacity review", stage2Owner: "Production",
    stage2Desc: "Check line load, shifts, labor, changeover, and equipment availability.",
    stage2Evidence: "Capacity load, changeover plan, equipment and labor availability",
    stage3: "Material requirements", stage3Owner: "PMC / Procurement",
    stage3Desc: "Run net MRP from effective BOM, loss, on-hand, and inbound supply.",
    stage3Evidence: "MRP run, shortage list, committed arrival dates",
    stage4: "WMS preparation and kit", stage4Owner: "WMS",
    stage4Desc: "Confirm reserved stock, released lots, traceability, and on-time issue.",
    stage4Evidence: "Pick list, kit rate, IQC release, location reservation",
    stage5: "Quality and engineering", stage5Owner: "Quality / Engineering",
    stage5Desc: "Confirm process documents, first article, quality holds, ECN, and substitutes.",
    stage5Evidence: "SOP version, FAI plan, quality release, ECN/substitute approval",
  },
  "vi-VN": {
    title: "Vòng khép kín phát hành sản xuất PMC",
    subtitle: "Duyệt kế hoạch → Năng lực → MRP → WMS đủ bộ → Chất lượng/kỹ thuật → Phê duyệt",
    refresh: "Làm mới trạng thái", plans: "Gói kế hoạch", pendingPlans: "Kế hoạch chưa đóng",
    blocked: "Mục chặn", ready: "Sẵn sàng phát hành", released: "Đã phát hành MES",
    selectPlan: "Chọn gói kế hoạch để xem các cổng kiểm soát", noPlan: "Chưa có kế hoạch chính",
    qty: "Số lượng kế hoạch", line: "Chuyền", window: "Cửa sổ kế hoạch", owner: "Bộ phận phụ trách",
    evidence: "Bằng chứng yêu cầu", conclusion: "Kết luận đánh giá", evidenceRef: "Mã bằng chứng / chứng từ",
    notePlaceholder: "Ghi kết luận, rủi ro và hành động cần theo dõi",
    evidencePlaceholder: "Ví dụ CAP-2026-0729-01", pass: "Đạt", warning: "Đạt có điều kiện",
    fail: "Không đạt", saveReview: "Ghi đánh giá", reReview: "Đánh giá lại", saving: "Đang xử lý…",
    pending: "Chờ đánh giá", approvalTitle: "Phê duyệt bắt buộc",
    approvalHint: "Chỉ mở phê duyệt PMC và Sản xuất khi năm bước đầu hoàn tất và không có mục thất bại.",
    pmcManager: "Trưởng PMC", productionManager: "Trưởng sản xuất", approve: "Phê duyệt",
    reject: "Từ chối", approved: "Đã duyệt", rejected: "Đã từ chối",
    workOrder: "Liên kết lệnh và xác nhận đủ bộ", workOrderCode: "Mã lệnh sản xuất",
    kitReady: "WMS đã chuẩn bị và xác nhận đủ bộ", bind: "Liên kết lệnh", release: "Phát hành sang MES",
    releaseReady: "Tất cả cổng đã đạt. Có thể phát hành chính thức sang MES.",
    releaseBlocked: "Đang bị chặn", audit: "Mọi đánh giá, phê duyệt, liên kết và phát hành đều được lưu vết.",
    status: "Trạng thái", complete: "Hoàn tất", incomplete: "Chưa hoàn tất", actor: "Người thao tác",
    success: "Thao tác thành công, trạng thái đã được làm mới.",
    stage1: "Đánh giá kế hoạch PMC", stage1Owner: "PMC",
    stage1Desc: "Xác nhận nguồn nhu cầu, ngày giao, phiên bản BOM, giới hạn chi phí và lịch.",
    stage1Evidence: "PO/nhu cầu, BOM hiệu lực, ảnh hưởng giao hàng và chi phí",
    stage2: "Đánh giá năng lực", stage2Owner: "Sản xuất",
    stage2Desc: "Kiểm tra tải chuyền, ca, nhân lực, đổi chuyền và thiết bị.",
    stage2Evidence: "Bảng tải, kế hoạch đổi chuyền, tình trạng thiết bị và nhân lực",
    stage3: "Tính nhu cầu vật liệu", stage3Owner: "PMC / Mua hàng",
    stage3Desc: "Tính MRP ròng theo BOM, hao hụt, tồn kho và hàng đang về.",
    stage3Evidence: "Lần chạy MRP, danh sách thiếu, cam kết ngày về",
    stage4: "WMS chuẩn bị và đủ bộ", stage4Owner: "WMS",
    stage4Desc: "Xác nhận tồn đã giữ, lô đạt IQC, truy xuất được và cấp đúng hạn.",
    stage4Evidence: "Phiếu chuẩn bị, tỷ lệ đủ bộ, lô IQC, vị trí đã giữ",
    stage5: "Điều kiện chất lượng/kỹ thuật", stage5Owner: "Chất lượng / Kỹ thuật",
    stage5Desc: "Xác nhận SOP, mẫu đầu, đóng băng chất lượng, ECN và vật liệu thay thế.",
    stage5Evidence: "Phiên bản SOP, kế hoạch FAI, giải phóng chất lượng, duyệt ECN/thay thế",
  },
} as const;

const reviewLabels: Record<PmcPlanReviewType, Record<Locale, string>> = {
  DELIVERY: { "zh-CN": "交期与计划窗口", "en-US": "Delivery window", "vi-VN": "Cửa sổ giao hàng" },
  COST: { "zh-CN": "成本边界", "en-US": "Cost boundary", "vi-VN": "Giới hạn chi phí" },
  CAPACITY: { "zh-CN": "产能负荷", "en-US": "Capacity load", "vi-VN": "Tải năng lực" },
  MATERIAL: { "zh-CN": "MRP 净需求", "en-US": "Net MRP", "vi-VN": "MRP ròng" },
  BOM: { "zh-CN": "BOM 与齐套可行性", "en-US": "BOM and kit feasibility", "vi-VN": "BOM và khả năng đủ bộ" },
  QUALITY: { "zh-CN": "质量与工程条件", "en-US": "Quality and engineering", "vi-VN": "Chất lượng và kỹ thuật" },
};

function stages(locale: Locale): ReviewStage[] {
  const t = copy[locale];
  return [
    { number: 1, icon: ClipboardCheck, title: t.stage1, owner: t.stage1Owner, description: t.stage1Desc, evidence: t.stage1Evidence, reviews: ["DELIVERY", "COST"] },
    { number: 2, icon: Factory, title: t.stage2, owner: t.stage2Owner, description: t.stage2Desc, evidence: t.stage2Evidence, reviews: ["CAPACITY"] },
    { number: 3, icon: FileCheck2, title: t.stage3, owner: t.stage3Owner, description: t.stage3Desc, evidence: t.stage3Evidence, reviews: ["MATERIAL"] },
    { number: 4, icon: PackageCheck, title: t.stage4, owner: t.stage4Owner, description: t.stage4Desc, evidence: t.stage4Evidence, reviews: ["BOM"] },
    { number: 5, icon: ShieldCheck, title: t.stage5, owner: t.stage5Owner, description: t.stage5Desc, evidence: t.stage5Evidence, reviews: ["QUALITY"] },
  ];
}

function resultTone(result?: PmcPlanReviewResult) {
  if (result === "PASS") return "pass";
  if (result === "WARNING") return "warning";
  if (result === "FAIL") return "fail";
  return "pending";
}

export function PmcClosedLoop({ locale }: { locale: Locale }) {
  const t = copy[locale];
  const [data, setData] = useState<PmcClosedLoopDashboard | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [result, setResult] = useState<PmcPlanReviewResult>("PASS");
  const [conclusion, setConclusion] = useState("");
  const [evidenceRef, setEvidenceRef] = useState("");
  const [workOrderCode, setWorkOrderCode] = useState("");
  const [kitReady, setKitReady] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const actor = "PMC_CN_01";

  const load = useCallback(async () => {
    try {
      const next = await pmcApi.getClosedLoopDashboard();
      setData(next);
      setSelectedId((current) => current && next.plans.some((plan) => plan.id === current)
        ? current
        : next.plans[0]?.id ?? null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selected = data?.plans.find((plan) => plan.id === selectedId) ?? null;
  const stageList = useMemo(() => stages(locale), [locale]);
  const reviewMap = useMemo(
    () => new Map(selected?.reviews.map((review) => [review.reviewType, review]) ?? []),
    [selected],
  );
  const allReviewsPresent = selected
    ? (["DELIVERY", "COST", "CAPACITY", "MATERIAL", "BOM", "QUALITY"] as PmcPlanReviewType[])
      .every((type) => reviewMap.has(type))
    : false;
  const failedReviews = selected?.reviews.filter((review) => review.result === "FAIL").length ?? 0;
  const approvalsComplete = selected
    ? (["PMC_MANAGER", "PRODUCTION_MANAGER"] as const)
      .every((role) => selected.approvals.some((approval) => approval.role === role && approval.decision === "APPROVE"))
    : false;
  const readyToRelease = selected?.status === "KIT_READY" && allReviewsPresent && failedReviews === 0 && approvalsComplete;
  const openPlans = data?.plans.filter((plan) => !["CLOSED", "CANCELLED", "RELEASED_TO_MES"].includes(plan.status)).length ?? 0;
  const blockedPlans = data?.plans.filter((plan) => plan.reviews.some((review) => review.result === "FAIL")).length ?? 0;
  const readyPlans = data?.plans.filter((plan) => plan.status === "KIT_READY").length ?? 0;
  const releasedPlans = data?.plans.filter((plan) => plan.status === "RELEASED_TO_MES").length ?? 0;

  async function run(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    setMessage("");
    try {
      await action();
      setMessage(t.success);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  async function saveStage(stage: ReviewStage) {
    if (!selected || !conclusion.trim() || !evidenceRef.trim()) return;
    await run(`stage-${stage.number}`, async () => {
      for (const reviewType of stage.reviews) {
        await pmcApi.reviewPlan(selected.id, {
          reviewType, result,
          detail: { conclusion: conclusion.trim(), evidenceRef: evidenceRef.trim() },
          actor,
        });
      }
      setConclusion("");
      setEvidenceRef("");
    });
  }

  function stageResult(stage: ReviewStage): PmcPlanReviewResult | undefined {
    const values = stage.reviews.map((type) => reviewMap.get(type)?.result);
    if (values.some((value) => value === "FAIL")) return "FAIL";
    if (values.some((value) => value === "WARNING")) return "WARNING";
    if (values.every((value) => value === "PASS")) return "PASS";
    return undefined;
  }

  return (
    <div className="pmc-loop">
      <section className="pmc-loop-hero">
        <div>
          <div className="pmc-loop-eyebrow"><ShieldCheck size={15} /> CONTROLLED RELEASE</div>
          <h2>{t.title}</h2>
          <p>{t.subtitle}</p>
        </div>
        <button type="button" title={t.refresh} onClick={() => void load()}>
          <RefreshCw size={16} /> {t.refresh}
        </button>
      </section>

      <section className="pmc-loop-metrics" aria-label={t.status}>
        {[
          { label: t.pendingPlans, value: openPlans, Icon: CircleDashed, tone: "neutral" },
          { label: t.blocked, value: blockedPlans, Icon: XCircle, tone: "danger" },
          { label: t.ready, value: readyPlans, Icon: CheckCircle2, tone: "success" },
          { label: t.released, value: releasedPlans, Icon: Send, tone: "accent" },
        ].map(({ label, value, Icon, tone }) => (
          <article className={`pmc-loop-metric ${tone}`} key={label}>
            <Icon size={20} /><div><span>{label}</span><strong>{value}</strong></div>
          </article>
        ))}
      </section>

      <section className="pmc-loop-layout">
        <aside className="pmc-loop-plans">
          <div className="pmc-loop-panel-title"><span>{t.plans}</span><strong>{data?.plans.length ?? 0}</strong></div>
          {data?.plans.length ? data.plans.map((plan) => {
            const complete = plan.reviews.length >= 6;
            const hasFailure = plan.reviews.some((review) => review.result === "FAIL");
            return (
              <button
                type="button"
                title={`${plan.plan_no} · ${plan.product_code}`}
                className={selectedId === plan.id ? "active" : ""}
                key={plan.id}
                onClick={() => setSelectedId(plan.id)}
              >
                <div><strong>{plan.plan_no}</strong><span>{plan.product_code}</span></div>
                <small>{plan.planned_qty.toLocaleString()} · {plan.priority_code}</small>
                <div className="pmc-loop-plan-progress">
                  <i style={{ width: `${Math.min(100, (plan.reviews.length / 6) * 100)}%` }} />
                </div>
                <em className={hasFailure ? "fail" : complete ? "pass" : "pending"}>
                  {hasFailure ? t.blocked : complete ? t.complete : `${plan.reviews.length}/6`}
                </em>
              </button>
            );
          }) : <div className="pmc-loop-empty">{t.noPlan}</div>}
        </aside>

        <main className="pmc-loop-main">
          {!selected ? <div className="pmc-loop-empty">{t.selectPlan}</div> : (
            <>
              <section className="pmc-loop-plan-head">
                <div>
                  <span>{selected.plan_no}</span>
                  <h3>{selected.product_code} · {selected.product_name}</h3>
                </div>
                <div className="pmc-loop-plan-facts">
                  <span><small>{t.qty}</small><strong>{selected.planned_qty.toLocaleString()}</strong></span>
                  <span><small>{t.line}</small><strong>{selected.line_name || "—"}</strong></span>
                  <span><small>{t.window}</small><strong>{new Date(selected.planned_start_at).toLocaleDateString(locale)} → {new Date(selected.planned_finish_at).toLocaleDateString(locale)}</strong></span>
                  <span><small>{t.status}</small><strong>{selected.status}</strong></span>
                </div>
              </section>

              {message && <div className={`pmc-loop-message ${message === t.success ? "success" : "danger"}`}>{message}</div>}

              <div className="pmc-loop-stages">
                {stageList.map((stage, index) => {
                  const stageValue = stageResult(stage);
                  const Icon = stage.icon;
                  const complete = Boolean(stageValue);
                  return (
                    <article className={`pmc-loop-stage ${resultTone(stageValue)}`} key={stage.number}>
                      <header>
                        <div className="pmc-loop-stage-number">{complete ? <Check size={16} /> : stage.number}</div>
                        <Icon size={20} />
                        <div><h4>{stage.title}</h4><span>{t.owner}: {stage.owner}</span></div>
                        <div className={`pmc-loop-status ${resultTone(stageValue)}`}>
                          {stageValue === "PASS" ? t.pass : stageValue === "WARNING" ? t.warning : stageValue === "FAIL" ? t.fail : t.pending}
                        </div>
                      </header>
                      <p>{stage.description}</p>
                      <div className="pmc-loop-evidence"><strong>{t.evidence}</strong><span>{stage.evidence}</span></div>
                      <div className="pmc-loop-subgates">
                        {stage.reviews.map((type) => {
                          const review = reviewMap.get(type);
                          return <span className={resultTone(review?.result)} key={type}>{review ? <Check size={12} /> : <CircleDashed size={12} />}{reviewLabels[type][locale]}</span>;
                        })}
                      </div>
                      <details>
                        <summary title={complete ? t.reReview : t.saveReview}>{complete ? t.reReview : t.saveReview}</summary>
                        <div className="pmc-loop-review-form">
                          <div className="pmc-loop-choice" aria-label={t.conclusion}>
                            {(["PASS", "WARNING", "FAIL"] as PmcPlanReviewResult[]).map((value) => (
                              <button type="button" title={value} className={result === value ? `active ${resultTone(value)}` : ""} onClick={() => setResult(value)} key={value}>
                                {value === "PASS" ? t.pass : value === "WARNING" ? t.warning : t.fail}
                              </button>
                            ))}
                          </div>
                          <label>{t.conclusion}<textarea title={t.conclusion} value={conclusion} onChange={(event) => setConclusion(event.target.value)} placeholder={t.notePlaceholder} /></label>
                          <label>{t.evidenceRef}<input title={t.evidenceRef} value={evidenceRef} onChange={(event) => setEvidenceRef(event.target.value)} placeholder={t.evidencePlaceholder} /></label>
                          <button
                            type="button"
                            title={!conclusion.trim() || !evidenceRef.trim() ? `${t.conclusion} + ${t.evidenceRef}` : t.saveReview}
                            disabled={busy !== "" || !conclusion.trim() || !evidenceRef.trim()}
                            onClick={() => void saveStage(stage)}
                          >{busy === `stage-${stage.number}` ? t.saving : t.saveReview}</button>
                        </div>
                      </details>
                      {index < stageList.length - 1 && <ArrowRight className="pmc-loop-arrow" size={18} />}
                    </article>
                  );
                })}
              </div>

              <section className={`pmc-loop-approval ${!allReviewsPresent || failedReviews > 0 ? "locked" : ""}`}>
                <header><div><h3>6. {t.approvalTitle}</h3><p>{t.approvalHint}</p></div><ShieldCheck size={26} /></header>
                <div className="pmc-loop-approval-grid">
                  {([
                    ["PMC_MANAGER", t.pmcManager],
                    ["PRODUCTION_MANAGER", t.productionManager],
                  ] as const).map(([role, label]) => {
                    const approval = selected.approvals.find((item) => item.role === role);
                    return <article key={role}>
                      <div><strong>{label}</strong><span>{approval?.actor || t.pending}</span></div>
                      {approval ? <em className={approval.decision === "APPROVE" ? "pass" : "fail"}>
                        {approval.decision === "APPROVE" ? t.approved : t.rejected}
                      </em> : <div className="pmc-loop-approval-actions">
                        <button type="button" title={`${t.approve} · ${label}`} disabled={!allReviewsPresent || failedReviews > 0 || busy !== ""} onClick={() => void run(`approve-${role}`, () => pmcApi.decidePlan(selected.id, { approvalRole: role, decision: "APPROVE", actor, comment: "Closed-loop gate approved" }))}>{t.approve}</button>
                        <button type="button" title={`${t.reject} · ${label}`} disabled={!allReviewsPresent || busy !== ""} className="reject" onClick={() => void run(`reject-${role}`, () => pmcApi.decidePlan(selected.id, { approvalRole: role, decision: "REJECT", actor, comment: "Closed-loop gate rejected" }))}>{t.reject}</button>
                      </div>}
                    </article>;
                  })}
                </div>
              </section>

              <section className="pmc-loop-release">
                <div>
                  <h3>{t.workOrder}</h3>
                  <p>{selected.work_order_code ? `${selected.work_order_code} · ${selected.work_order_status}` : t.audit}</p>
                </div>
                {!selected.work_order_code && (
                  <div className="pmc-loop-bind">
                    <label>{t.workOrderCode}<input title={t.workOrderCode} value={workOrderCode} onChange={(event) => setWorkOrderCode(event.target.value)} /></label>
                    <label className="pmc-loop-check"><input type="checkbox" title={t.kitReady} checked={kitReady} onChange={(event) => setKitReady(event.target.checked)} />{t.kitReady}</label>
                    <button type="button" title={!approvalsComplete ? t.releaseBlocked : t.bind} disabled={!approvalsComplete || !workOrderCode.trim() || busy !== ""} onClick={() => void run("bind", () => pmcApi.bindPlanWorkOrder(selected.id, { workOrderCode: workOrderCode.trim(), kitReady, actor }))}>{t.bind}</button>
                  </div>
                )}
                <div className={`pmc-loop-release-gate ${readyToRelease ? "ready" : "blocked"}`}>
                  {readyToRelease ? <CheckCircle2 size={22} /> : <AlertTriangle size={22} />}
                  <span>{readyToRelease ? t.releaseReady : t.releaseBlocked}</span>
                  <button type="button" title={readyToRelease ? t.release : t.releaseBlocked} disabled={!readyToRelease || busy !== ""} onClick={() => void run("release", () => pmcApi.releasePlanToMes(selected.id, actor))}><Send size={15} />{t.release}</button>
                </div>
              </section>
            </>
          )}
        </main>
      </section>
    </div>
  );
}
