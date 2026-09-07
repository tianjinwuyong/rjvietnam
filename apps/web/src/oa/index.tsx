import { useEffect, useMemo, useState, type DragEvent, type ReactNode } from "react";
import { AlertTriangle, Check, Circle, ClipboardCheck, FileCheck2, GripVertical, Inbox, Plus, Settings, Siren, Trash2, X } from "lucide-react";
import type { Locale } from "../../../packages/shared-types/src/factory";
import { t } from "../i18n";
import { oaProcessApi, type OaProcessRequest, type OaProcessSummary, type OaSignatureStep } from "./oaApi";

type OaTab = "inbox" | "detail" | "management";
const words: Record<string, Record<Locale, string>> = {
  title: { "zh-CN": "OA 审批中心", "vi-VN": "Trung tâm phê duyệt OA", "en-US": "OA approval center" },
  subtitle: { "zh-CN": "物料取料申请必须完成配置的全部签核后才能执行", "vi-VN": "Yêu cầu lấy vật liệu phải được ký duyệt đầy đủ", "en-US": "Material fetching requires all configured signatures" },
  inbox: { "zh-CN": "审批列表", "vi-VN": "Danh sách phê duyệt", "en-US": "Approval list" },
  detail: { "zh-CN": "申请详情", "vi-VN": "Chi tiết yêu cầu", "en-US": "Request details" },
  management: { "zh-CN": "流程管理", "vi-VN": "Quản lý quy trình", "en-US": "Process management" },
  flowTitle: { "zh-CN": "物料取料签核流程", "vi-VN": "Quy trình ký lấy vật liệu", "en-US": "Material fetching signature flow" },
  flowHint: { "zh-CN": "从左到右依次签核；拖动节点改变顺序。保存后只影响新申请。", "vi-VN": "Ký từ trái sang phải; kéo nút để đổi thứ tự. Chỉ áp dụng cho yêu cầu mới.", "en-US": "Sign left to right. Drag nodes to reorder. Saved changes apply only to new requests." },
  add: { "zh-CN": "添加签核人", "vi-VN": "Thêm người ký", "en-US": "Add signer" },
  save: { "zh-CN": "保存流程", "vi-VN": "Lưu quy trình", "en-US": "Save flow" },
  saved: { "zh-CN": "流程已保存", "vi-VN": "Đã lưu quy trình", "en-US": "Flow saved" },
  username: { "zh-CN": "登录账号", "vi-VN": "Tài khoản", "en-US": "Username" },
  signer: { "zh-CN": "签核人姓名", "vi-VN": "Tên người ký", "en-US": "Signer name" },
  role: { "zh-CN": "角色", "vi-VN": "Vai trò", "en-US": "Role" },
  sla: { "zh-CN": "时限(小时)", "vi-VN": "SLA (giờ)", "en-US": "SLA (hours)" },
  approve: { "zh-CN": "同意", "vi-VN": "Duyệt", "en-US": "Approve" },
  reject: { "zh-CN": "拒绝", "vi-VN": "Từ chối", "en-US": "Reject" },
  note: { "zh-CN": "签核意见", "vi-VN": "Ý kiến", "en-US": "Decision note" },
  noData: { "zh-CN": "暂无申请", "vi-VN": "Không có yêu cầu", "en-US": "No requests" },
  currentSigner: { "zh-CN": "当前待签人", "vi-VN": "Người đang chờ ký", "en-US": "Current signer" },
  nextSigner: { "zh-CN": "下一签核人（流程已驳回，未激活）", "vi-VN": "Người ký tiếp theo (chưa kích hoạt do bị từ chối)", "en-US": "Next signer (not activated after rejection)" },
  timeLeft: { "zh-CN": "审批或驳回剩余时间", "vi-VN": "Thời gian còn lại để duyệt hoặc từ chối", "en-US": "Time left to approve or reject" },
  overdue: { "zh-CN": "已超时", "vi-VN": "Đã quá hạn", "en-US": "Overdue" },
  awaitingPrevious: { "zh-CN": "等待前序签核", "vi-VN": "Đang chờ bước ký trước", "en-US": "Waiting for previous signature" },
  content: { "zh-CN": "审批内容", "vi-VN": "Nội dung phê duyệt", "en-US": "Approval contents" },
  issuedBy: { "zh-CN": "发起人", "vi-VN": "Người phát hành", "en-US": "Issued by" },
  department: { "zh-CN": "发起部门", "vi-VN": "Bộ phận", "en-US": "Department" },
  issuedAt: { "zh-CN": "发起时间", "vi-VN": "Thời gian phát hành", "en-US": "Issued at" },
  attachments: { "zh-CN": "附件", "vi-VN": "Tệp đính kèm", "en-US": "Attachments" },
  deadline: { "zh-CN": "审批时限", "vi-VN": "Hạn phê duyệt", "en-US": "Approval deadline" },
  priority: { "zh-CN": "紧急等级", "vi-VN": "Mức khẩn cấp", "en-US": "Urgency" },
  normal: { "zh-CN": "普通", "vi-VN": "Bình thường", "en-US": "Normal" },
  urgent: { "zh-CN": "紧急", "vi-VN": "Khẩn cấp", "en-US": "Urgent" },
  critical: { "zh-CN": "特急", "vi-VN": "Rất khẩn cấp", "en-US": "Critical" },
  itemCount: { "zh-CN": "项内容", "vi-VN": "mục", "en-US": "items" },
  waitingForSigner: { "zh-CN": "等待该签核人处理", "vi-VN": "Đang chờ người ký này xử lý", "en-US": "Waiting for this signer" },
  yourTurn: { "zh-CN": "轮到你：请阅读、审批并签名", "vi-VN": "Đến lượt bạn: đọc, duyệt và ký", "en-US": "Your turn: read, decide and sign" },
  signRequired: { "zh-CN": "阅读并签署本角色全部文件", "vi-VN": "Đọc và ký tất cả tài liệu cho vai trò này", "en-US": "Read and sign every document required for your role" },
  signed: { "zh-CN": "已阅读并签署", "vi-VN": "Đã đọc và ký", "en-US": "Read and signed" },
};
const w = (key: string, locale: Locale) => words[key]?.[locale] ?? t(key, locale);
const tone = (status: string) => status === "APPROVED" || status === "approved" ? "ok" : status === "REJECTED" || status === "rejected" ? "danger" : "warning";

function remainingLabel(dueAt: string | null | undefined, now: number, locale: Locale) {
  if (!dueAt) return w("awaitingPrevious", locale);
  const milliseconds = new Date(dueAt).getTime() - now;
  const absoluteMinutes = Math.ceil(Math.abs(milliseconds) / 60000);
  const hours = Math.floor(absoluteMinutes / 60);
  const minutes = absoluteMinutes % 60;
  const duration = locale === "zh-CN" ? `${hours}小时${minutes}分钟` : locale === "vi-VN" ? `${hours} giờ ${minutes} phút` : `${hours}h ${minutes}m`;
  return milliseconds < 0 ? `${w("overdue", locale)} ${duration}` : duration;
}

function Surface({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: ReactNode; children?: ReactNode }) {
  return <section className="surface-panel"><div className="section-header"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action && <div className="section-action">{action}</div>}</div>{children}</section>;
}

const priorityLabel = (priority: string | undefined, locale: Locale) => w((priority || "NORMAL").toLowerCase(), locale);

function UrgencyBadge({ priority, locale }: { priority?: string; locale: Locale }) {
  const level = (priority || "NORMAL").toUpperCase();
  const Icon = level === "CRITICAL" ? Siren : level === "URGENT" ? AlertTriangle : Circle;
  return <span className={`oa-priority oa-priority-${level.toLowerCase()}`} title={`${w("priority", locale)}: ${priorityLabel(level, locale)}`}><Icon size={14}/>{priorityLabel(level, locale)}</span>;
}

function ApprovalPackageSummary({ request, locale }: { request: OaProcessRequest; locale: Locale }) {
  const pack = request.package;
  const activeStep = request.steps.find(step => step.stepNo === request.currentStep);
  return <>
    <span className="oa-request-icon"><ClipboardCheck size={18}/></span>
    <span className="oa-request-main">
      <strong>{request.title}</strong>
      <span>{request.entityNo} · {pack?.content?.length ?? 0} {w("itemCount", locale)} · {pack?.attachments?.length ?? 0} {w("attachments", locale)}</span>
      <span className="oa-package-summary">{pack?.summary || pack?.content?.slice(0, 2).map(item => `${item.materialCode || ""} ${item.materialName || ""} × ${item.quantity ?? "—"} ${item.unit || ""}`).join("；") || "—"}</span>
      <span className="oa-package-facts"><span>{w("issuedBy", locale)}: {pack?.issuedBy || request.requesterName || request.requesterUsername || "—"}</span><span>{w("department", locale)}: {pack?.department || "—"}</span><span>{w("issuedAt", locale)}: {new Date(pack?.issuedAt || request.submittedAt).toLocaleString()}</span></span>
    </span>
    <span className="oa-request-meta"><span className={`badge badge-${tone(request.status)}`}>{request.status}</span><UrgencyBadge priority={pack?.priority} locale={locale}/><span>{w("deadline", locale)}: {activeStep?.dueAt ? remainingLabel(activeStep.dueAt, Date.now(), locale) : "—"}</span><span>{w("currentSigner", locale)}: {activeStep?.signerName || activeStep?.signerUsername || "—"}</span></span>
  </>;
}

function ApprovalPackageDetail({ request, locale, roleKey, canSign, signedNames, onToggle }: { request: OaProcessRequest; locale: Locale; roleKey: string; canSign: boolean; signedNames: string[]; onToggle: (name: string) => void }) {
  const pack = request.package;
  const activeStep = request.steps.find(step => step.stepNo === request.currentStep);
  return <div className="oa-package-envelope">
    <div className="oa-package-detail"><div><span>{w("issuedBy", locale)}</span><strong>{pack?.issuedBy || request.requesterName || request.requesterUsername || "—"}</strong></div><div><span>{w("department", locale)}</span><strong>{pack?.department || "—"}</strong></div><div><span>{w("issuedAt", locale)}</span><strong>{new Date(pack?.issuedAt || request.submittedAt).toLocaleString()}</strong></div><div><span>{w("deadline", locale)}</span><strong>{pack?.approvalDueAt ? new Date(pack.approvalDueAt).toLocaleString() : activeStep?.dueAt ? new Date(activeStep.dueAt).toLocaleString() : "—"}</strong></div><div><span>{w("priority", locale)}</span><UrgencyBadge priority={pack?.priority} locale={locale}/></div><div><span>{w("attachments", locale)}</span><strong>{pack?.attachments?.length ?? 0}</strong></div></div>
    <h3>{w("content", locale)}</h3><div className="oa-package-content">{pack?.content?.length ? pack.content.map((item, index) => <div className="oa-package-line" key={`${item.materialCode || "item"}-${index}`}><strong>{item.materialCode || index + 1}</strong><span>{item.materialName || "—"}</span><span>{item.quantity ?? "—"} {item.unit || ""}</span><small>{item.remarks || ""}</small></div>) : <span>—</span>}</div>
    {Boolean(pack?.attachments?.length) && <><h3>{w("attachments", locale)}</h3>{canSign && <p className="oa-sign-instruction">{w("signRequired", locale)}</p>}<div className="oa-package-attachments">{pack.attachments.map((file, index) => { const requiredForRole = ["document", "signature"].includes(file.kind) && (!file.requiredSignerRoles?.length || file.requiredSignerRoles.some(role => role.toLowerCase() === roleKey.toLowerCase())); return <div className={`oa-package-file ${requiredForRole ? "signature-required" : ""}`} key={`${file.name}-${index}`}><span className="badge badge-info">{file.kind}</span>{file.url ? <a href={file.url} target="_blank" rel="noreferrer">{file.name}</a> : <strong>{file.name}</strong>}<small>{file.mimeType || ""}{file.signedBy ? ` · ${file.signedBy}` : ""}</small>{canSign && requiredForRole && <label className="oa-document-sign"><input type="checkbox" checked={signedNames.includes(file.name)} onChange={() => onToggle(file.name)}/>{w("signed", locale)}</label>}</div>; })}</div></>}
  </div>;
}

function SignatureEditor({ locale, steps, onChange }: { locale: Locale; steps: OaSignatureStep[]; onChange: (steps: OaSignatureStep[]) => void }) {
  const [dragged, setDragged] = useState<number | null>(null);
  const update = (index: number, field: keyof OaSignatureStep, value: string | number) => onChange(steps.map((step, i) => i === index ? { ...step, [field]: value } : step));
  const drop = (event: DragEvent, target: number) => {
    event.preventDefault();
    if (dragged === null || dragged === target) return;
    const next = [...steps]; const [node] = next.splice(dragged, 1); next.splice(target, 0, node);
    onChange(next.map((step, index) => ({ ...step, stepNo: index + 1 }))); setDragged(null);
  };
  return <div className="oa-signature-editor">
    <div className="oa-signature-canvas">
      {steps.map((step, index) => <div className="oa-signature-config-node" draggable onDragStart={() => setDragged(index)} onDragOver={event => event.preventDefault()} onDrop={event => drop(event, index)} key={`${step.id ?? "new"}-${index}`}>
        <div className="oa-signature-node-head"><GripVertical size={18}/><strong>{index + 1}</strong><button type="button" title={t("common.delete", locale)} onClick={() => onChange(steps.filter((_, i) => i !== index).map((item, i) => ({ ...item, stepNo: i + 1 })))}><Trash2 size={15}/></button></div>
        <label>{w("username", locale)}<input value={step.signerUsername} onChange={e => update(index, "signerUsername", e.target.value)}/></label>
        <label>{w("signer", locale)}<input value={step.signerName ?? ""} onChange={e => update(index, "signerName", e.target.value)}/></label>
        <label>{w("role", locale)}<input value={step.signerRole ?? ""} onChange={e => update(index, "signerRole", e.target.value)}/></label>
        <label>{w("sla", locale)}<input type="number" min={1} value={step.slaHours} onChange={e => update(index, "slaHours", Number(e.target.value))}/></label>
      </div>)}
    </div>
    <button className="action-button" type="button" onClick={() => onChange([...steps, { stepNo: steps.length + 1, signerUsername: "", signerName: "", signerRole: "", slaHours: 24 }])}><Plus size={15}/> {w("add", locale)}</button>
  </div>;
}

export function OaModule({ locale, currentUsername, roleKey }: { locale: Locale; currentUsername: string; roleKey: string }) {
  const initialTab = new URLSearchParams(window.location.search).get("oaTab");
  const [tab, setTab] = useState<OaTab>(initialTab === "management" ? "management" : initialTab === "detail" ? "detail" : "inbox");
  const [requests, setRequests] = useState<OaProcessRequest[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [steps, setSteps] = useState<OaSignatureStep[]>([]);
  const [processes, setProcesses] = useState<OaProcessSummary[]>([]);
  const [processCode, setProcessCode] = useState("WMS-MATERIAL-REQUISITION");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [signedAttachmentNames, setSignedAttachmentNames] = useState<string[]>([]);
  const selected = useMemo(() => requests.find(item => item.id === selectedId), [requests, selectedId]);
  const selectedCurrentStep = selected?.steps.find(step => step.stepNo === selected.currentStep);
  const isMyTurn = Boolean(selected?.status === "PENDING" && selectedCurrentStep?.signerUsername.trim().toLowerCase() === currentUsername.trim().toLowerCase());
  const requiredRoleDocuments = selected?.package?.attachments?.filter(file => ["document", "signature"].includes(file.kind) && (!file.requiredSignerRoles?.length || file.requiredSignerRoles.some(role => role.toLowerCase() === roleKey.toLowerCase()))) ?? [];
  const allRoleDocumentsSigned = requiredRoleDocuments.every(file => signedAttachmentNames.includes(file.name));
  const refresh = async () => { const result = await oaProcessApi.listRequests(); setRequests(result.items); if (!selectedId && result.items[0]) setSelectedId(result.items[0].id); };
  const loadProcess = async (code = processCode) => { setMessage(""); try { const process = await oaProcessApi.getProcess(code); setSteps(process.steps); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } };
  useEffect(() => { void refresh().catch(error => setMessage(error instanceof Error ? error.message : String(error))); void oaProcessApi.listProcesses().then(result => setProcesses(result.items)).catch(error => setMessage(error instanceof Error ? error.message : String(error))); void loadProcess(); }, []);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const decide = async (decision: "APPROVE" | "REJECT") => { if (!selected) return; await oaProcessApi.decide(selected.id, decision, note, signedAttachmentNames); setNote(""); setSignedAttachmentNames([]); await refresh(); };
  const save = async () => { setMessage(""); try { await oaProcessApi.saveProcess(processCode, steps.map((step, index) => ({ ...step, stepNo: index + 1 }))); setMessage(w("saved", locale)); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } };
  return <div className="screen-stack oa-module">
    <Surface title={w("title", locale)} subtitle={w("subtitle", locale)}/>
    <div className="oa-tabs" role="tablist">
      <button className={tab === "inbox" ? "active" : ""} onClick={() => setTab("inbox")}><Inbox size={16}/>{w("inbox", locale)}{requests.filter(r => r.status === "PENDING").length > 0 && <span className="oa-tab-count">{requests.filter(r => r.status === "PENDING").length}</span>}</button>
      <button className={tab === "detail" ? "active" : ""} onClick={() => setTab("detail")}><FileCheck2 size={16}/>{w("detail", locale)}</button>
      <button className={tab === "management" ? "active" : ""} onClick={() => { setTab("management"); void loadProcess(); }}><Settings size={16}/>{w("management", locale)}</button>
    </div>
    {message && <div className="inline-alert">{message}</div>}
    {tab === "inbox" && <Surface title={w("inbox", locale)}><div className="oa-request-list">
      {requests.map(request => <button className={`oa-request-row oa-package-row ${selectedId === request.id ? "selected" : ""}`} key={request.id} onClick={() => { setSelectedId(request.id); setTab("detail"); }}><ApprovalPackageSummary request={request} locale={locale}/></button>)}
      {!requests.length && <div className="empty-state">{w("noData", locale)}</div>}
    </div></Surface>}
    {tab === "detail" && selected && <Surface title={selected.title} subtitle={`${selected.requestNo} · ${selected.entityNo}`}><ApprovalPackageDetail request={selected} locale={locale} roleKey={roleKey} canSign={isMyTurn} signedNames={signedAttachmentNames} onToggle={name => setSignedAttachmentNames(current => current.includes(name) ? current.filter(item => item !== name) : [...current, name])}/><div className="oa-signature-progress">{selected.steps.map(step => { const current = selected.status === "PENDING" && step.stepNo === selected.currentStep && ["PENDING", "OVERDUE"].includes(step.status || ""); const assignedToMe = current && step.signerUsername.trim().toLowerCase() === currentUsername.trim().toLowerCase(); const rejectedStep = selected.steps.find(item => item.status === "REJECTED"); const nextAfterRejection = selected.status === "REJECTED" && Boolean(rejectedStep) && step.stepNo === Number(rejectedStep?.stepNo) + 1; return <div className={`oa-signature-node ${step.status?.toLowerCase()} ${current ? "oa-flow-current" : ""} ${assignedToMe ? "oa-current-signer" : ""} ${nextAfterRejection ? "oa-next-after-rejection" : ""}`} key={step.id}><strong>{step.stepNo}. {step.signerName || step.signerUsername}</strong><span>{step.signerUsername}</span>{current && <span className={assignedToMe ? "oa-signer-callout" : "oa-waiting-callout"}>{assignedToMe ? w("yourTurn", locale) : w("waitingForSigner", locale)}</span>}{nextAfterRejection && <span className="oa-next-callout">{w("nextSigner", locale)}</span>}<span className={`badge badge-${tone(step.status || "PENDING")}`}>{step.status}</span>{current && <span className={`oa-countdown ${step.dueAt && new Date(step.dueAt).getTime() < now ? "overdue" : ""}`} title={w("timeLeft", locale)}><small>{w("timeLeft", locale)}</small><b>{remainingLabel(step.dueAt, now, locale)}</b></span>}</div>; })}</div>{isMyTurn && <div className="oa-action-panel"><textarea value={note} onChange={e => setNote(e.target.value)} placeholder={w("note", locale)}/><div className="toolbar"><button className="action-button oa-approve" disabled={!allRoleDocumentsSigned} title={!allRoleDocumentsSigned ? w("signRequired", locale) : w("approve", locale)} onClick={() => void decide("APPROVE")}><Check size={15}/>{w("approve", locale)}</button><button className="action-button oa-reject" disabled={!allRoleDocumentsSigned} title={!allRoleDocumentsSigned ? w("signRequired", locale) : w("reject", locale)} onClick={() => void decide("REJECT")}><X size={15}/>{w("reject", locale)}</button></div></div>}</Surface>}
    {tab === "detail" && !selected && <Surface title={w("detail", locale)}><div className="empty-state">{w("noData", locale)}</div></Surface>}
    {tab === "management" && <Surface title={processes.find(item => item.processCode === processCode)?.processName || w("flowTitle", locale)} subtitle={w("flowHint", locale)} action={<button className="action-button" onClick={() => void save()}><Check size={15}/>{w("save", locale)}</button>}><div className="toolbar"><select value={processCode} onChange={event => { const code=event.target.value; setProcessCode(code); void loadProcess(code); }}>{processes.map(process => <option value={process.processCode} key={process.processCode}>{process.processName} · {process.stepCount}</option>)}</select><a className="action-button" href={`/architecture/oa-processes.html?process=${encodeURIComponent(processCode)}`} target="_blank" rel="noreferrer">Archify</a></div><SignatureEditor locale={locale} steps={steps} onChange={setSteps}/></Surface>}
  </div>;
}
