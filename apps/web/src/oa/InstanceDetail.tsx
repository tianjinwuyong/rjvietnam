import { useCallback, useEffect, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import {
  oaApi,
  type OaAttachmentRow,
  type OaCcRow,
  type OaExecutionRow,
  type OaInstanceDetail,
  type OaLogRow,
  type OaTask,
} from "./oaApi";
import { t } from "./i18n";

/**
 * 单据详情 —— 对齐原 OA「flowDetail」页：
 * 基本信息 / 申请内容 / 审批操作 / 流转时间轴 / 抄送人 / 附件 / 执行与闭环记录 / 操作日志。
 * 操作集合（通过/驳回/撤回/催办/终止/退回/归档）按后端 can* 标志显隐。
 */

function fmtDate(value: string | null | undefined, locale: Locale): string {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString(locale === "vi-VN" ? "vi-VN" : locale === "en-US" ? "en-US" : "zh-CN", {
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return value;
  }
}

function statusColor(status: string): string {
  switch (status) {
    case "completed": case "approved": return "#15803d";
    case "rejected": return "#b91c1c";
    case "running": return "#b45309";
    default: return "#64748b";
  }
}

function statusLabelOf(status: string, locale: Locale): string {
  const key = `flowStatus.${status}`;
  return t(key, locale) === key ? status : t(key, locale);
}

export function InstanceDetail({
  id, locale, onBack, onActed,
}: {
  id: OaInstanceDetail["id"];
  locale: Locale;
  onBack: () => void;
  onActed: () => void;
}) {
  const [detail, setDetail] = useState<OaInstanceDetail | null>(null);
  const [error, setError] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      setDetail(await oaApi.instance(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const act = async (action: "approve" | "reject") => {
    const task = detail?.myTask ?? detail?.tasks?.find(x => x.status === "assigned");
    if (!task) return;
    setBusy(true);
    setMessage("");
    try {
      await oaApi.approveTask(task.id, { action, comment: comment.trim() || undefined });
      setMessage(t("flowDetail.actionDone", locale));
      setComment("");
      await load();
      onActed();
    } catch (e) {
      setMessage(`${t("common.failed", locale)}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const instanceAction = async (action: "withdraw" | "urge" | "terminate", body?: { comment?: string }) => {
    setBusy(true);
    setMessage("");
    try {
      await oaApi.instanceAction(id, action, body ?? {});
      setMessage(
        action === "urge" ? t("flowDetail.urgeOk", locale)
          : action === "terminate" ? t("flowDetail.terminateOk", locale)
            : t("flowDetail.actionDone", locale),
      );
      await load();
      onActed();
    } catch (e) {
      setMessage(`${t("common.failed", locale)}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  if (error) return <div className="empty-state">{t("empty.loadFailed", locale)}: {error}</div>;
  if (!detail) return <div className="empty-state">{t("common.loading", locale)}</div>;

  const pendingTask = detail.myTask ?? detail.tasks?.find(x => x.status === "assigned");
  const canApprove = detail.canApprove ?? false;
  const canWithdraw = detail.canWithdraw ?? false;
  const canUrge = detail.canUrge ?? false;
  const canTerminate = detail.canTerminate ?? false;

  return (
    <div>
      <button onClick={onBack} style={{ marginBottom: 10, cursor: "pointer" }}>← {t("flowDetail.back", locale)}</button>

      {/* 基本信息 */}
      <div className="surface-panel" style={{ padding: "14px 16px", marginBottom: 12 }}>
        <h3 style={{ margin: "0 0 6px" }}>{detail.title}</h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 18px", fontSize: 13, color: "var(--text-muted, #64748b)" }}>
          <span>{detail.instance_no}</span>
          <span>{t("flowDetail.applicant", locale)}：{detail.applicant_name ?? "-"}</span>
          <span>{t("flowDetail.defName", locale)}：{locale === "vi-VN" && detail.def_name_vi ? detail.def_name_vi : detail.def_name}</span>
          <span>{t("flowDetail.submittedAt", locale)}：{fmtDate(detail.submitted_at ?? detail.created_at, locale)}</span>
          <span>
            {t("flowDetail.statusLabel", locale)}：
            <b style={{ color: statusColor(detail.status) }}>{statusLabelOf(detail.status, locale)}</b>
          </span>
          {detail.currentNode?.name && detail.status === "running" ? (
            <span>{t("flowDetail.currentNode", locale)}：{locale === "vi-VN" && detail.currentNode.name_vi ? detail.currentNode.name_vi : detail.currentNode.name}</span>
          ) : null}
        </div>
      </div>

      {/* 审批操作（待办任务） */}
      {canApprove && pendingTask ? (
        <div className="surface-panel" style={{ padding: "14px 16px", marginBottom: 12 }}>
          <label style={{ display: "block", marginBottom: 6, fontSize: 13 }}>{t("flowDetail.approveOpinion", locale)}</label>
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            rows={2}
            placeholder={t("flowDetail.opinionPlaceholder", locale)}
            style={{ width: "100%", boxSizing: "border-box", marginBottom: 10 }}
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button
              disabled={busy}
              onClick={() => void act("approve")}
              style={{ padding: "7px 16px", cursor: "pointer", background: "#15803d", color: "#fff", border: 0, borderRadius: 6 }}
            >{t("flowDetail.pass", locale)}</button>
            <button
              disabled={busy}
              onClick={() => void act("reject")}
              style={{ padding: "7px 16px", cursor: "pointer", background: "#b91c1c", color: "#fff", border: 0, borderRadius: 6 }}
            >{t("flowDetail.reject", locale)}</button>
            {canUrge && (
              <button disabled={busy} onClick={() => void instanceAction("urge")}
                style={{ padding: "7px 16px", cursor: "pointer", border: "1px solid #cbd5e1", borderRadius: 6, background: "white" }}>
                {t("flowDetail.urge", locale)}
              </button>
            )}
            {message && <span style={{ fontSize: 13 }}>{message}</span>}
          </div>
        </div>
      ) : null}

      {/* 发起人/管理员操作 */}
      {(canWithdraw || canTerminate) && (
        <div className="surface-panel" style={{ padding: "14px 16px", marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {canWithdraw && (
              <button
                disabled={busy}
                onClick={() => { if (window.confirm(t("flowDetail.withdrawConfirm", locale))) void instanceAction("withdraw"); }}
                style={{ padding: "7px 16px", cursor: "pointer", border: "1px solid #cbd5e1", borderRadius: 6, background: "white" }}
              >{t("flowDetail.withdraw", locale)}</button>
            )}
            {canTerminate && (
              <button
                disabled={busy}
                onClick={() => {
                  const reason = window.prompt(t("flowDetail.terminateReason", locale));
                  if (reason !== null) void instanceAction("terminate", { comment: reason || undefined });
                }}
                style={{ padding: "7px 16px", cursor: "pointer", border: "1px solid #cbd5e1", borderRadius: 6, background: "white" }}
              >{t("flowDetail.terminate", locale)}</button>
            )}
            {message && <span style={{ fontSize: 13 }}>{message}</span>}
          </div>
        </div>
      )}

      {/* 申请内容（表单数据） */}
      {detail.form_data && Object.keys(detail.form_data).length > 0 && (
        <div className="surface-panel" style={{ padding: "14px 16px", marginBottom: 12 }}>
          <h4 style={{ margin: "0 0 8px" }}>{t("flowDetail.applyContent", locale)}</h4>
          <div className="table-shell">
            <table>
              <tbody>
                {Object.entries(detail.form_data).map(([k, v]) => (
                  <tr key={k}><th style={{ width: 180, textAlign: "left" }}>{k}</th><td>{formatValue(v)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 流转时间轴（审批节点 × 任务） */}
      <div className="surface-panel" style={{ padding: "14px 16px", marginBottom: 12 }}>
        <h4 style={{ margin: "0 0 8px" }}>{t("flowDetail.timeline", locale)}</h4>
        <NodeTimeline detail={detail} locale={locale} fmtDate={fmtDate} />
      </div>

      {/* 抄送人 */}
      <div className="surface-panel" style={{ padding: "14px 16px", marginBottom: 12 }}>
        <h4 style={{ margin: "0 0 8px" }}>{t("flowDetail.ccList", locale)}</h4>
        {(detail.ccs?.length ?? 0) === 0 ? (
          <div style={{ fontSize: 13, color: "var(--text-muted, #64748b)" }}>{t("flowDetail.ccNone", locale)}</div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {(detail.ccs as OaCcRow[]).map(c => (
              <span key={String(c.id)} style={{ fontSize: 13, border: "1px solid #e2e8f0", borderRadius: 999, padding: "2px 10px" }}>
                {c.real_name ?? "-"}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 附件 */}
      {(detail.attachments?.length ?? 0) > 0 && (
        <div className="surface-panel" style={{ padding: "14px 16px", marginBottom: 12 }}>
          <h4 style={{ margin: "0 0 8px" }}>{t("flowDetail.attachment", locale)}</h4>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {(detail.attachments as OaAttachmentRow[]).map(a => (
              <div key={String(a.id)} style={{ fontSize: 13 }}>
                📎 {a.file_name}
                {a.file_size ? <span style={{ color: "var(--text-muted, #64748b)" }}> · {fmtSize(Number(a.file_size))}</span> : null}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 操作日志 */}
      {(detail.logs?.length ?? 0) > 0 && (
        <div className="surface-panel" style={{ padding: "14px 16px", marginBottom: 12 }}>
          <h4 style={{ margin: "0 0 8px" }}>{t("flowDetail.log", locale)}</h4>
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>{t("flowDetail.handler", locale)}</th>
                  <th>{t("flowDetail.action", locale)}</th>
                  <th>{t("flowDetail.time", locale)}</th>
                  <th>{t("flowDetail.comment", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {(detail.logs as OaLogRow[]).map(l => (
                  <tr key={String(l.id)}>
                    <td>{l.real_name ?? "-"}</td>
                    <td>{l.action ?? "-"}</td>
                    <td>{fmtDate(l.created_at, locale)}</td>
                    <td>{l.detail ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 闭环执行/验证记录 */}
      {(detail.executions?.length ?? 0) > 0 && (
        <div className="surface-panel" style={{ padding: "14px 16px", marginBottom: 12 }}>
          <h4 style={{ margin: "0 0 8px" }}>{t("flowDetail.closedLoop", locale)}</h4>
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>{t("flowDetail.replyBy", locale)}</th>
                  <th>{t("flowDetail.verifyBy", locale)}</th>
                  <th>{t("flowDetail.time", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {(detail.executions as OaExecutionRow[]).map(e => (
                  <tr key={String(e.id)}>
                    <td>{e.reply_by_name ?? "-"}</td>
                    <td>{e.verified_by_name ?? "-"}</td>
                    <td>{fmtDate((e.created_at as string) ?? null, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function NodeTimeline({
  detail, locale, fmtDate: fmt,
}: {
  detail: OaInstanceDetail;
  locale: Locale;
  fmtDate: (v: string | null | undefined, locale: Locale) => string;
}) {
  const nodes = detail.flow_nodes || [];
  const tasks = detail.tasks || [];
  if (nodes.length === 0) {
    // 无节点定义时退回任务平铺
    return <div className="table-shell"><table><tbody>
      {tasks.map(x => (
        <tr key={String(x.id)}>
          <td>{x.node_name ?? "-"}</td>
          <td>{x.assignee_name ?? "-"}</td>
          <td>{x.status}</td>
          <td>{fmt(x.finished_at ?? x.created_at, locale)}</td>
        </tr>
      ))}
    </tbody></table></div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {nodes.map((node, i) => {
        const nodeTasks = tasks.filter(x => Number(x.node_index) === i);
        const done = nodeTasks.some(x => x.status === "approved");
        const rejected = nodeTasks.some(x => x.status === "rejected");
        const isCurrent = detail.status === "running" && Number(detail.current_index) === i;
        const label = locale === "vi-VN" && node.name_vi ? node.name_vi : node.name;
        return (
          <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <div style={{
              width: 12, height: 12, borderRadius: 999, marginTop: 4, flexShrink: 0,
              background: rejected ? "#b91c1c" : done ? "#15803d" : isCurrent ? "#b45309" : "#e2e8f0",
            }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: isCurrent ? 700 : 400 }}>
                {label}
                {isCurrent ? <span style={{ marginLeft: 8, color: "#b45309", fontSize: 12 }}>● {t("flowDetail.currentNode", locale)}</span> : null}
              </div>
              {nodeTasks.map(x => (
                <div key={String(x.id)} style={{ fontSize: 12, color: "var(--text-muted, #64748b)" }}>
                  {x.assignee_name ?? "-"} · {x.status} · {fmt(x.finished_at ?? x.created_at, locale)}
                  {x.comment ? ` · ${x.comment}` : ""}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "-";
  if (Array.isArray(v)) {
    // 明细表：每行一条摘要
    return v.length === 0 ? "-" : v.map(row => (typeof row === "object" && row !== null ? JSON.stringify(row) : String(row))).join(" | ");
  }
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function fmtSize(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}
