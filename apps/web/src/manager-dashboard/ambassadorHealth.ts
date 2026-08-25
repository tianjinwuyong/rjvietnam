import type { BusStats } from "./useAmbassador";

export type AmbassadorDimension = "safety" | "effectiveness" | "efficiency" | "swiftness" | "collaboration";

export interface AmbassadorHealth {
  dimension: AmbassadorDimension;
  status: "ok" | "warning" | "critical";
  criticalCount: number;
  warningCount: number;
  summary: string;
}

// Safety: derived from recent event count + critical event types
export function computeSafetyHealth(stats: BusStats): AmbassadorHealth {
  // Safety health based on failed messages as proxy for safety-critical events
  const { failed_count, total_messages } = stats;
  const errRate = total_messages > 0 ? failed_count / total_messages : 0;
  if (failed_count >= 5 || errRate >= 0.08) {
    return { dimension: "safety", status: "critical", criticalCount: failed_count, warningCount: 0, summary: "Multiple failed deliveries — possible safety breach" };
  }
  if (failed_count >= 2 || errRate >= 0.03) {
    return { dimension: "safety", status: "warning", criticalCount: 0, warningCount: failed_count, summary: "Some delivery failures detected" };
  }
  return { dimension: "safety", status: "ok", criticalCount: 0, warningCount: 0, summary: "All systems operating normally" };
}

// Effectiveness: based on error rate + success rate
export function computeEffectivenessHealth(stats: BusStats): AmbassadorHealth {
  const { error_rate, total_messages, pending_count } = stats;
  const pendingRatio = total_messages > 0 ? pending_count / total_messages : 0;
  if (error_rate >= 0.08 || pendingRatio >= 0.30) {
    return { dimension: "effectiveness", status: "critical", criticalCount: 1, warningCount: 0, summary: `Error rate ${(error_rate * 100).toFixed(1)}% — effectiveness degraded` };
  }
  if (error_rate >= 0.03 || pendingRatio >= 0.15) {
    return { dimension: "effectiveness", status: "warning", criticalCount: 0, warningCount: 1, summary: `Elevated error rate ${(error_rate * 100).toFixed(1)}%` };
  }
  return { dimension: "effectiveness", status: "ok", criticalCount: 0, warningCount: 0, summary: "Effectiveness metrics within normal range" };
}

// Efficiency: based on throughput + queue depth
export function computeEfficiencyHealth(stats: BusStats): AmbassadorHealth {
  const { throughput, queue_depth } = stats;
  if (throughput <= 5 || queue_depth >= 60) {
    return { dimension: "efficiency", status: "critical", criticalCount: 1, warningCount: 0, summary: throughput <= 5 ? `Very low throughput: ${throughput.toFixed(1)} msg/min` : `Queue overloaded: ${queue_depth} pending` };
  }
  if (throughput <= 15 || queue_depth >= 30) {
    return { dimension: "efficiency", status: "warning", criticalCount: 0, warningCount: 1, summary: throughput <= 15 ? `Throughput below target: ${throughput.toFixed(1)} msg/min` : `Queue building up: ${queue_depth} pending` };
  }
  return { dimension: "efficiency", status: "ok", criticalCount: 0, warningCount: 0, summary: `Throughput ${throughput.toFixed(1)} msg/min — healthy` };
}

// Swiftness: based on avg latency + stale pending
export function computeSwiftnessHealth(stats: BusStats): AmbassadorHealth {
  const { avg_latency_ms, pending_count, messages } = stats;
  const now = Date.now();
  const stalePending = messages.filter(m => {
    if (m.status !== "pending") return false;
    return (now - new Date(m.created_at).getTime()) / 1000 >= 60;
  }).length;

  if (avg_latency_ms >= 1000 || stalePending >= 3) {
    return { dimension: "swiftness", status: "critical", criticalCount: 1, warningCount: 0, summary: avg_latency_ms >= 1000 ? `Avg latency ${avg_latency_ms.toFixed(0)}ms — slow` : `${stalePending} messages stuck > 60s` };
  }
  if (avg_latency_ms >= 300 || stalePending >= 1) {
    return { dimension: "swiftness", status: "warning", criticalCount: 0, warningCount: 1, summary: avg_latency_ms >= 300 ? `Latency elevated: ${avg_latency_ms.toFixed(0)}ms avg` : `${stalePending} pending message(s) aging` };
  }
  return { dimension: "swiftness", status: "ok", criticalCount: 0, warningCount: 0, summary: `Avg latency ${avg_latency_ms.toFixed(0)}ms — responsive` };
}

// Collaboration: based on failed count + orphan requests + agent silence
export function computeCollaborationHealth(stats: BusStats): AmbassadorHealth {
  const { failed_count, per_agent, messages } = stats;
  const orphanRequests = messages.filter(m => m.status === "pending" && m.type === "request").length;
  const silentAgents = Object.values(per_agent).filter(a => a.messages_sent === 0 && a.messages_received === 0 && stats.total_messages > 20).length;

  const issues = failed_count + orphanRequests + silentAgents;
  if (issues >= 8) {
    return { dimension: "collaboration", status: "critical", criticalCount: 1, warningCount: 0, summary: `${issues} collaboration issues: ${failed_count} failed, ${orphanRequests} orphan, ${silentAgents} silent` };
  }
  if (issues >= 3) {
    return { dimension: "collaboration", status: "warning", criticalCount: 0, warningCount: 1, summary: `${issues} issues: ${failed_count} failed, ${orphanRequests} orphan, ${silentAgents} silent` };
  }
  return { dimension: "collaboration", status: "ok", criticalCount: 0, warningCount: 0, summary: "All agents communicating normally" };
}

export function computeAllHealth(stats: BusStats | null): AmbassadorHealth[] {
  if (!stats) return [];
  return [
    computeSafetyHealth(stats),
    computeEffectivenessHealth(stats),
    computeEfficiencyHealth(stats),
    computeSwiftnessHealth(stats),
    computeCollaborationHealth(stats),
  ];
}

export const AMBASSADOR_META: Record<AmbassadorDimension, { icon: string; labelKey: string; color: string }> = {
  safety: { icon: "🛡️", labelKey: "ambassador.safety.title", color: "#c62828" },
  effectiveness: { icon: "📈", labelKey: "ambassador.effectiveness.title", color: "#1565c0" },
  efficiency: { icon: "⚡", labelKey: "ambassador.efficiency.title", color: "#ef6c00" },
  swiftness: { icon: "🚀", labelKey: "ambassador.swiftness.title", color: "#6a1b9a" },
  collaboration: { icon: "🤝", labelKey: "ambassador.collaboration.title", color: "#2e7d32" },
};

export const STATUS_COLOR: Record<string, string> = {
  ok: "#4caf50",
  warning: "#fb8c00",
  critical: "#d32f2f",
};

export const STATUS_BG: Record<string, string> = {
  ok: "#e8f5e9",
  warning: "#fff3e0",
  critical: "#ffebee",
};

export const STATUS_TEXT: Record<string, string> = {
  ok: "正常",
  warning: "警告",
  critical: "严重",
};