/**
 * W-G4 D0 -> W-G1 D1: pure presentation contract for agent mutation states.
 *
 * Deliberately free of React, DOM and I/O so it can be verified without
 * `node_modules` (see NODE4-WG4-DESIGN-SPEC-001.md sections 4 and 9.5).
 *
 * IMPORTANT: this module describes how a record LOOKS. It does not enforce
 * access control and does not imply the backend persisted provenance. The
 * provenance headers added in Phase 1 are still INERT until a server consumes
 * them. Do not treat a badge as an authorization decision.
 */
import { AGENT_PROCESSING, PENDING_HUMAN_APPROVAL } from "../api/agentProvenance";

export type AgentVisualState =
  | "processing"
  | "approval"
  | "approved"
  | "rejected"
  | "neutral";

export interface AgentStatePresentation {
  state: AgentVisualState;
  /** Always starts with `badge`. Unknown states keep the legacy `badge badge-info`. */
  className: string;
  /** i18n key for the visible label (unused for neutral states). */
  labelKey: string;
  /** i18n key for the tooltip (unused for neutral states). */
  hintKey: string;
  /** lucide-react icon name, resolved by the component. */
  icon: "LoaderCircle" | "ShieldAlert" | "CheckCircle2" | "XCircle" | null;
  ariaLive: "polite" | "off";
  requiresHuman: boolean;
}

const PROCESSING: AgentStatePresentation = {
  state: "processing",
  className: "badge badge-info agent-state-processing",
  labelKey: "agentState.agentProcessing",
  hintKey: "agentState.agentProcessingHint",
  icon: "LoaderCircle",
  // A pulsing icon plus a live region would generate continuous SR chatter.
  ariaLive: "off",
  requiresHuman: false,
};

const APPROVAL: AgentStatePresentation = {
  state: "approval",
  className: "badge badge-warning agent-state-approval",
  labelKey: "agentState.pendingHumanApproval",
  hintKey: "agentState.pendingHumanApprovalHint",
  icon: "ShieldAlert",
  ariaLive: "polite",
  requiresHuman: true,
};

/** Extended states are opt-in for the takeover dashboard only. */
const APPROVED: AgentStatePresentation = {
  state: "approved",
  className: "badge badge-ok agent-state-approved",
  labelKey: "agentState.approved",
  hintKey: "agentState.approvedHint",
  icon: "CheckCircle2",
  ariaLive: "off",
  requiresHuman: false,
};

const REJECTED: AgentStatePresentation = {
  state: "rejected",
  className: "badge badge-danger agent-state-rejected",
  labelKey: "agentState.rejected",
  hintKey: "agentState.rejectedHint",
  icon: "XCircle",
  ariaLive: "off",
  requiresHuman: false,
};

/** Neutral keeps the exact legacy class so existing screens render unchanged. */
const NEUTRAL: AgentStatePresentation = {
  state: "neutral",
  className: "badge badge-info",
  labelKey: "",
  hintKey: "",
  icon: null,
  ariaLive: "off",
  requiresHuman: false,
};

/**
 * Map a raw status to its visual presentation. Anything unrecognised falls
 * through to NEUTRAL, which is intentionally a no-op relative to the old code.
 *
 * `extended` enables APPROVED / REJECTED for the human takeover dashboard.
 * It defaults to **false** so existing screens (e.g. HrGovernance.tsx) keep
 * rendering those statuses with the legacy `badge badge-info` + raw text.
 */
export function agentStatePresentation(
  status: unknown,
  extended = false,
): AgentStatePresentation {
  if (status === AGENT_PROCESSING) return PROCESSING;
  if (status === PENDING_HUMAN_APPROVAL) return APPROVAL;
  if (extended && status === "APPROVED") return APPROVED;
  if (extended && status === "REJECTED") return REJECTED;
  return NEUTRAL;
}

/** Text for a neutral state: preserve the raw status string exactly. */
export function agentStateFallbackLabel(status: unknown, override?: string): string {
  if (override !== undefined) return override;
  return status == null ? "" : String(status);
}
