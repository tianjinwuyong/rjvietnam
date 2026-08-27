import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, ClipboardCheck, Clock3, FileCheck2, History, Inbox, X } from "lucide-react";
import type { Locale } from "../../../packages/shared-types/src/factory";
import { t } from "../i18n";
import { oaRepository, type OaAuditEvent, type OaRequest, type OaRequestStatus } from "./oaApi";

type OaTab = "inbox" | "detail" | "audit";
const repository = oaRepository;

const oaCopy: Record<string, Record<Locale, string>> = {
  "oa.title": { "zh-CN": "OA 审批中心", "vi-VN": "Trung tâm phê duyệt OA", "en-US": "OA approval center" },
  "oa.subtitle": { "zh-CN": "面向工厂决策的可追溯请求流转", "vi-VN": "Luồng yêu cầu có thể truy xuất cho nhà máy", "en-US": "A traceable request workflow for factory decisions" },
  "oa.tabs.inbox": { "zh-CN": "请求收件箱", "vi-VN": "Hộp thư yêu cầu", "en-US": "Request inbox" },
  "oa.tabs.detail": { "zh-CN": "请求详情", "vi-VN": "Chi tiết yêu cầu", "en-US": "Request detail" },
  "oa.tabs.audit": { "zh-CN": "审计历史", "vi-VN": "Lịch sử kiểm toán", "en-US": "Audit history" },
  "oa.inbox.title": { "zh-CN": "待处理请求", "vi-VN": "Yêu cầu cần xử lý", "en-US": "Request inbox" },
  "oa.inbox.subtitle": { "zh-CN": "选择一条请求开始审批", "vi-VN": "Chọn một yêu cầu để xem và quyết định", "en-US": "Select a request to review and decide" },
  "oa.filter.all": { "zh-CN": "全部状态", "vi-VN": "Tất cả trạng thái", "en-US": "All statuses" },
  "oa.status.pending": { "zh-CN": "待审批", "vi-VN": "Chờ duyệt", "en-US": "Pending" },
  "oa.status.approved": { "zh-CN": "已同意", "vi-VN": "Đã duyệt", "en-US": "Approved" },
  "oa.status.rejected": { "zh-CN": "已拒绝", "vi-VN": "Đã từ chối", "en-US": "Rejected" },
  "oa.type.leave": { "zh-CN": "请假", "vi-VN": "Nghỉ phép", "en-US": "Leave" },
  "oa.type.purchase": { "zh-CN": "采购请求", "vi-VN": "Mua hàng", "en-US": "Purchase" },
  "oa.type.expense": { "zh-CN": "费用报销", "vi-VN": "Chi phí", "en-US": "Expense" },
  "oa.detail.title": { "zh-CN": "请求详情", "vi-VN": "Chi tiết yêu cầu", "en-US": "Request detail" },
  "oa.detail.amount": { "zh-CN": "金额", "vi-VN": "Số tiền", "en-US": "Amount" },
  "oa.detail.submitted": { "zh-CN": "提交时间", "vi-VN": "Thời gian gửi", "en-US": "Submitted" },
  "oa.decision.title": { "zh-CN": "审批操作", "vi-VN": "Quyết định", "en-US": "Decision" },
  "oa.decision.hint": { "zh-CN": "操作将记录到审计历史", "vi-VN": "Quyết định sẽ được ghi vào lịch sử", "en-US": "Your decision will be recorded in the audit history" },
  "oa.decision.note": { "zh-CN": "审批备注", "vi-VN": "Ghi chú", "en-US": "Decision note" },
  "oa.decision.notePlaceholder": { "zh-CN": "可选：输入审批备注", "vi-VN": "Tùy chọn: nhập ghi chú", "en-US": "Optional note for the audit trail" },
  "oa.decision.approve": { "zh-CN": "同意", "vi-VN": "Duyệt", "en-US": "Approve" },
  "oa.decision.reject": { "zh-CN": "拒绝", "vi-VN": "Từ chối", "en-US": "Reject" },
  "oa.decision.complete": { "zh-CN": "请求已处理，不再需要决策", "vi-VN": "Yêu cầu đã được xử lý", "en-US": "This request has already been decided" },
  "oa.decision.error": { "zh-CN": "操作失败，请重试", "vi-VN": "Thao tác thất bại, hãy thử lại", "en-US": "Action failed. Please try again." },
  "oa.audit.title": { "zh-CN": "审计历史", "vi-VN": "Lịch sử kiểm toán", "en-US": "Audit history" },
  "oa.audit.subtitle": { "zh-CN": "所有请求提交与决策记录", "vi-VN": "Tất cả yêu cầu và quyết định", "en-US": "Every submission and decision is traceable" },
  "oa.audit.submitted": { "zh-CN": "提交请求", "vi-VN": "Đã gửi yêu cầu", "en-US": "Request submitted" },
  "oa.audit.approved": { "zh-CN": "审批通过", "vi-VN": "Đã duyệt", "en-US": "Request approved" },
  "oa.audit.rejected": { "zh-CN": "审批拒绝", "vi-VN": "Đã từ chối", "en-US": "Request rejected" },
};
const copy = (key: string, locale: Locale) => oaCopy[key]?.[locale] ?? t(key, locale);
const statusTone: Record<OaRequestStatus, string> = { pending: "warning", approved: "ok", rejected: "danger" };

function Status({ status, locale, children }: { status: OaRequestStatus; locale: Locale; children?: ReactNode }) {
  return <span className={`badge badge-${statusTone[status]}`}>{copy(`oa.status.${status}`, locale)}</span>;
}

function ActionPanel({ request, locale, onDecide }: { request: OaRequest; locale: Locale; onDecide: (decision: "approved" | "rejected", note: string) => Promise<void> }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (request.status !== "pending") return <div className="oa-decision-complete"><Check size={16} /> {copy("oa.decision.complete", locale)}</div>;
  const decide = async (decision: "approved" | "rejected") => {
    setBusy(true); setError("");
    try { await onDecide(decision, note); } catch { setError(copy("oa.decision.error", locale)); } finally { setBusy(false); }
  };
  return <div className="oa-action-panel">
    <div><strong>{copy("oa.decision.title", locale)}</strong><span>{copy("oa.decision.hint", locale)}</span></div>
    <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder={copy("oa.decision.notePlaceholder", locale)} aria-label={copy("oa.decision.note", locale)} />
    {error && <p className="oa-error">{error}</p>}
    <div className="toolbar"><button className="action-button oa-approve" type="button" disabled={busy} onClick={() => decide("approved")}><Check size={15} /> {copy("oa.decision.approve", locale)}</button><button className="action-button oa-reject" type="button" disabled={busy} onClick={() => decide("rejected")}><X size={15} /> {copy("oa.decision.reject", locale)}</button></div>
  </div>;
}

export function OaModule({ locale }: { locale: Locale }) {
  const [tab, setTab] = useState<OaTab>("inbox");
  const [requests, setRequests] = useState<OaRequest[]>([]);
  const [audit, setAudit] = useState<OaAuditEvent[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [filter, setFilter] = useState<"all" | OaRequestStatus>("all");

  useEffect(() => { Promise.all([repository.listRequests(), repository.listAudit()]).then(([nextRequests, nextAudit]) => { setRequests(nextRequests); setAudit(nextAudit); setSelectedId(nextRequests[0]?.id ?? ""); }); }, []);
  const selected = requests.find((request) => request.id === selectedId) ?? requests[0];
  const visibleRequests = useMemo(() => filter === "all" ? requests : requests.filter((request) => request.status === filter), [filter, requests]);
  const pendingCount = requests.filter((request) => request.status === "pending").length;
  const decide = async (decision: "approved" | "rejected", note: string) => {
    if (!selected) return;
    await repository.decide(selected.id, decision, note);
    const [nextRequests, nextAudit] = await Promise.all([repository.listRequests(), repository.listAudit()]);
    setRequests(nextRequests); setAudit(nextAudit);
    try {
      const raw = sessionStorage.getItem("oa:return-target");
      if (!raw) return;
      const target = JSON.parse(raw) as { view?: string; wmsTab?: string };
      sessionStorage.removeItem("oa:return-target");
      const url = new URL(window.location.href);
      if (target.view) url.searchParams.set("view", target.view);
      if (target.wmsTab) url.searchParams.set("wmsTab", target.wmsTab);
      window.history.pushState({}, "", url);
      window.dispatchEvent(new CustomEvent("factory:navigate", { detail: target }));
    } catch { /* keep OA page open if the return target is malformed */ }
  };

  return <div className="screen-stack oa-module">
    <Surface title={copy("oa.title", locale)} subtitle={copy("oa.subtitle", locale)} />
    <div className="oa-tabs" role="tablist" aria-label={copy("oa.title", locale)}>
      {([["inbox", Inbox, "oa.tabs.inbox"], ["detail", FileCheck2, "oa.tabs.detail"], ["audit", History, "oa.tabs.audit"]] as const).map(([key, Icon, label]) => <button key={key} type="button" className={tab === key ? "active" : ""} onClick={() => setTab(key)}><Icon size={16} />{copy(label, locale)}{key === "inbox" && pendingCount > 0 ? <span className="oa-tab-count">{pendingCount}</span> : null}</button>)}
    </div>
    {tab === "inbox" && <Surface title={copy("oa.inbox.title", locale)} subtitle={copy("oa.inbox.subtitle", locale)} action={<select className="oa-filter" value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="all">{copy("oa.filter.all", locale)}</option><option value="pending">{copy("oa.status.pending", locale)}</option><option value="approved">{copy("oa.status.approved", locale)}</option><option value="rejected">{copy("oa.status.rejected", locale)}</option></select>}><div className="oa-request-list">{visibleRequests.map((request) => <button className={`oa-request-row ${selected?.id === request.id ? "selected" : ""}`} key={request.id} type="button" onClick={() => { setSelectedId(request.id); setTab("detail"); }}><span className="oa-request-icon"><ClipboardCheck size={18} /></span><span className="oa-request-main"><strong>{request.title}</strong><span>{request.requester} · {request.department}</span></span><span className="oa-request-meta"><Status status={request.status} locale={locale}><span /></Status><span>{request.submittedAt}</span></span></button>)}</div></Surface>}
    {tab === "detail" && selected && <Surface title={copy("oa.detail.title", locale)} subtitle={`${selected.id} · ${selected.requester}`} action={<button className="icon-button" type="button" onClick={() => setTab("inbox")}><Inbox size={15} /> {copy("oa.tabs.inbox", locale)}</button>}><div className="oa-detail-head"><div><span className="oa-kicker">{copy(`oa.type.${selected.type}`, locale)}</span><h2>{selected.title}</h2><p>{selected.summary}</p></div><Status status={selected.status} locale={locale} /></div><div className="oa-detail-grid">{selected.details.map((detail) => <div className="oa-detail-field" key={detail.label}><span>{detail.label}</span><strong>{detail.value}</strong></div>)}{selected.amount !== undefined && <div className="oa-detail-field"><span>{copy("oa.detail.amount", locale)}</span><strong>${selected.amount.toLocaleString()}</strong></div>}<div className="oa-detail-field"><span>{copy("oa.detail.submitted", locale)}</span><strong>{selected.submittedAt}</strong></div></div><ActionPanel request={selected} locale={locale} onDecide={decide} /></Surface>}
    {tab === "detail" && !selected && <Surface title={copy("oa.detail.title", locale)}><div className="empty-state">{copy("common.noData", locale)}</div></Surface>}
    {tab === "audit" && <Surface title={copy("oa.audit.title", locale)} subtitle={copy("oa.audit.subtitle", locale)}><div className="oa-audit-list">{audit.map((event) => <div className="oa-audit-row" key={event.id}><span className={`oa-audit-dot ${statusTone[event.action === "submitted" ? "pending" : event.action]}`} /><div><strong>{event.requestId} · {copy(`oa.audit.${event.action}`, locale)}</strong><span>{event.actor} · {event.at}</span>{event.note && <p>{event.note}</p>}</div></div>)}</div></Surface>}
  </div>;
}

function Surface({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: ReactNode; children?: ReactNode }) {
  return <section className="surface-panel"><div className="section-header"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action && <div className="section-action">{action}</div>}</div>{children}</section>;
}
