// Deterministic, context-grounded VE chat. No network, no LLM, no new dependency:
// intents are keyword-matched across the three UI languages and replies are always
// built from the employee's current live snapshot via labels.ts.
import type { Locale, VirtualEmployee } from "./types";
import { domainLabel, levelLabel, modeLabel, statusLabel, t } from "./labels";
import { zoneForEmployee } from "./layout";

export type ChatIntent = "greeting" | "working" | "tasks" | "approval" | "help" | "done" | "fallback";

/** Trilingual keyword routing; order matters (approval blocks everything else). */
export function detectChatIntent(message: string): ChatIntent {
  const m = message.toLowerCase();
  if (/approv|blocked|waiting gate|phê duyệt|chờ duyệt|审批|待审批|阻塞|卡住/.test(m)) return "approval";
  if (/help|can you|giúp|hỗ trợ|帮忙|帮助/.test(m)) return "help";
  if (/\bdone\b|complet|finished|hoàn thành|^xong|已完成|完成了/.test(m)) return "done";
  if (/what are you doing|what do you do|đang làm gì|bạn làm gì|在做什么|做什么|在干吗/.test(m)) return "working";
  if (/\btask\b|\bopen\b|workload|nhiệm vụ|\bviệc\b|任务|待办/.test(m)) return "tasks";
  if (/^(hi|hello|hey|chào|xin chào|你好|您好|哈喽)\b|^chào/.test(m)) return "greeting";
  return "fallback";
}

export interface GreetingCue { key: string; vars: Record<string, string | number> }

/** Focus greeting uses the same live numbers as the profile panel. */
export function greetingCue(employee: VirtualEmployee): GreetingCue {
  const name = employee.display_name || employee.name || employee.id;
  const waiting = Number(employee.taskCounts?.WAITING_APPROVAL ?? 0);
  const open = Number(employee.taskCounts?.OPEN ?? 0);
  if (waiting > 0) return { key: "speech.greeting.waiting", vars: { name, n: waiting } };
  if (open > 0) return { key: "speech.greeting.busy", vars: { name, n: open } };
  return { key: "speech.greeting.clear", vars: { name } };
}

export function greetingText(employee: VirtualEmployee, locale: Locale): string {
  const cue = greetingCue(employee);
  return t(cue.key, locale, cue.vars);
}

function replyVars(employee: VirtualEmployee, locale: Locale): Record<string, string | number> {
  return {
    name: employee.display_name || employee.name || employee.id,
    domain: domainLabel(employee.domain, locale),
    level: levelLabel(employee.level, locale),
    mode: modeLabel(employee.mode, locale),
    status: statusLabel(employee.enabled === false ? "OFFLINE" : employee.status, locale),
    zone: t(`zone.${zoneForEmployee(employee.id, employee.domain)}`, locale),
    n: Number(employee.taskCounts?.OPEN ?? 0),
    m: Number(employee.taskCounts?.WAITING_APPROVAL ?? 0),
    d: Number(employee.taskCounts?.DONE ?? 0),
  };
}

/** The exact localized string returned here is both displayed and spoken. */
export function buildReply(employee: VirtualEmployee, locale: Locale, message: string): string {
  const intent = detectChatIntent(message);
  if (intent === "approval" && Number(employee.taskCounts?.WAITING_APPROVAL ?? 0) === 0) {
    // Politely correct a false premise instead of inventing a blocked task.
    return t("chat.reply.tasks", locale, replyVars(employee, locale));
  }
  return t(`chat.reply.${intent}`, locale, replyVars(employee, locale));
}

/** One-line live snapshot handed to the backend model as grounding. */
export function veContextLine(employee: VirtualEmployee, locale: Locale): string {
  const counts = employee.taskCounts ?? {};
  return [
    `id=${employee.id}`,
    `name=${employee.display_name || employee.name || employee.id}`,
    `domain=${domainLabel(employee.domain, locale)}`,
    `level=${levelLabel(employee.level, locale)}`,
    `mode=${modeLabel(employee.mode, locale)}`,
    `status=${statusLabel(employee.enabled === false ? "OFFLINE" : employee.status, locale)}`,
    `enabled=${employee.enabled === false ? "no" : "yes"}`,
    `station=${t(`zone.${zoneForEmployee(employee.id, employee.domain)}`, locale)}`,
    `openTasks=${Number(counts.OPEN ?? 0)}`,
    `waitingApproval=${Number(counts.WAITING_APPROVAL ?? 0)}`,
    `doneTasks=${Number(counts.DONE ?? 0)}`,
    employee.jobDescription ? `duty=${employee.jobDescription}` : "",
    (employee.humanGates ?? []).length ? `humanGates=${employee.humanGates!.join(",")}` : "",
    (employee.capabilities ?? []).length ? `capabilities=${employee.capabilities!.slice(0, 6).join(",")}` : "",
  ].filter(Boolean).join("; ");
}

const LANG_NAME: Record<Locale, string> = { "zh-CN": "简体中文", "vi-VN": "tiếng Việt", "en-US": "English" };

/**
 * Grounding prompt for the existing backend assistant (app-level POST /ai/chat,
 * server.js:25183 — no /api prefix, same path apps/web/src/api/client.ts uses).
 * The endpoint only accepts { message, locale }, so the VE persona + live snapshot
 * travel inside the message. No new endpoint, no API key on the client.
 */
export function buildAiChatMessage(employee: VirtualEmployee, locale: Locale, message: string): string {
  return [
    `你正在扮演瑞晶 SMT 工厂的一名虚拟员工。只以该员工第一人称回答，使用${LANG_NAME[locale]}，最多两句，不要列表或 markdown，不要编造数字；所有事实只能来自下面的实时档案。`,
    `LIVE_PROFILE: ${veContextLine(employee, locale)}`,
    `HUMAN_MESSAGE: ${message}`,
  ].join("\n");
}

/**
 * Unwraps the live backend contract: HTTP 200 `{ data: { reply: { role, content } } }`
 * (also accepts a plain string reply). Verified against POST /ai/chat on 2026-11-23.
 */
export function parseAiReply(payload: unknown): string | null {
  const root = payload as { data?: { reply?: unknown }; reply?: unknown } | null;
  const candidate = root?.data?.reply ?? root?.reply;
  const text = typeof candidate === "string"
    ? candidate
    : candidate && typeof candidate === "object" && typeof (candidate as { content?: unknown }).content === "string"
      ? (candidate as { content: string }).content
      : null;
  if (!text) return null;
  const cleaned = text.replace(/\s+/g, " ").replace(/\*+/g, "").trim();
  return cleaned ? cleaned : null;
}
