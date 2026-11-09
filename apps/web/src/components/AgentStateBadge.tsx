/**
 * W-G1 D1: additive badge for agent-initiated mutation states.
 * Design contract: NODE4-WG4-DESIGN-SPEC-001.md sections 2-4 and 9.5.
 *
 * Neutral path is byte-compatible with the legacy markup:
 *   <span className="badge badge-info">{item.status}</span>
 * so dropping this component into an existing table cannot change the
 * appearance or semantics of any non-agent row.
 */
import { CheckCircle2, LoaderCircle, ShieldAlert, XCircle } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import {
  agentStateFallbackLabel,
  agentStatePresentation,
} from "./agentStatePresentation";

export interface AgentStateBadgeProps {
  /** Raw record status. Unknown values render exactly as before. */
  status?: unknown;
  locale?: Locale;
  /** Override the visible text (e.g. a pre-formatted label). */
  label?: string;
  showIcon?: boolean;
  size?: "sm" | "md";
  /**
   * Opt in to APPROVED / REJECTED presentations for the takeover dashboard.
   * Defaults to false so existing screens never change appearance.
   */
  extended?: boolean;
  /** Appended to base classes; never replaces them. */
  className?: string;
}

const ICONS = {
  LoaderCircle,
  ShieldAlert,
  CheckCircle2,
  XCircle,
} as const;

export function AgentStateBadge({
  status,
  locale = "zh-CN",
  label,
  showIcon = true,
  size = "md",
  extended = false,
  className,
}: AgentStateBadgeProps) {
  const presentation = agentStatePresentation(status, extended);
  const extra = [
    size === "sm" ? "agent-state-sm" : "",
    className ?? "",
  ].filter(Boolean).join(" ");
  const cls = [presentation.className, extra].filter(Boolean).join(" ");

  // Neutral: keep the original plain span, with no ARIA, icon or tooltip.
  if (presentation.state === "neutral") {
    return <span className={cls}>{agentStateFallbackLabel(status, label)}</span>;
  }

  const text = label ?? t(presentation.labelKey, locale);
  const Icon = presentation.icon ? ICONS[presentation.icon] : null;

  return (
    <span
      className={cls}
      role="status"
      aria-live={presentation.ariaLive}
      title={t(presentation.hintKey, locale)}
    >
      {showIcon && Icon ? <Icon size={12} aria-hidden="true" /> : null}
      {text}
    </span>
  );
}

export default AgentStateBadge;
