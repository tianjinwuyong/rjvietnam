import { useEffect, useState, useCallback, useRef } from "react";
import { apiClient } from "../api/client";

// ── Shared types ────────────────────────────────────────────────────
export interface BusStats {
  total_messages: number;
  pending_count: number;
  completed_count: number;
  failed_count: number;
  throughput: number;
  avg_latency_ms: number;
  error_rate: number;
  queue_depth: number;
  messages: MessageRecord[];
  per_agent: Record<string, AgentMetrics>;
}

export interface MessageRecord {
  id: string;
  from_agent: string;
  to_agent: string;
  subject: string;
  type: string;
  priority: string;
  status: string;
  latency_ms: number;
  created_at: string;
}

export interface AgentMetrics {
  agent_id: string;
  agent_name: string;
  messages_sent: number;
  messages_received: number;
  success_count: number;
  failed_count: number;
  avg_latency_ms: number;
  error_rate: number;
  pending_count: number;
}

// ── API response → BusStats ───────────────────────────────────────
// GET /api/agents/bus-stats returns { stats, byAgent, recentMessages }
// aggregated over the last hour (services/api/server.js). The ambassador
// pages were written against a flat BusStats shape that the endpoint never
// returned — every field arrived undefined and computeEfficiencyHealth
// crashed on throughput.toFixed. Map once here; consumers stay typed.
interface RawStatusCounts { pending: number; processing: number; completed: number; failed: number; dead: number; total: number }
interface RawBusStats {
  stats?: Partial<RawStatusCounts>;
  byAgent?: Record<string, number>;
  recentMessages?: Array<{
    source_agent: string; target_agent: string; subject: string; message_type: string;
    status: string; priority: string; created_at: string; processed_at: string | null;
  }>;
}

export function mapBusStats(raw: RawBusStats): BusStats {
  const s: RawStatusCounts = {
    pending: 0, processing: 0, completed: 0, failed: 0, dead: 0, total: 0, ...raw.stats,
  };
  const messages: MessageRecord[] = (raw.recentMessages ?? []).map((m, i) => ({
    id: `${m.source_agent}>${m.target_agent}:${m.created_at}#${i}`,
    from_agent: m.source_agent,
    to_agent: m.target_agent,
    subject: m.subject,
    type: m.message_type,
    priority: m.priority,
    status: m.status,
    latency_ms: m.processed_at
      ? Math.max(0, new Date(m.processed_at).getTime() - new Date(m.created_at).getTime())
      : -1,
    created_at: m.created_at,
  }));
  const latencies = messages.filter(m => m.latency_ms >= 0).map(m => m.latency_ms);
  const per_agent: Record<string, AgentMetrics> = {};
  for (const [agent, received] of Object.entries(raw.byAgent ?? {})) {
    per_agent[agent] = {
      agent_id: agent, agent_name: agent,
      messages_sent: 0, messages_received: received,
      success_count: 0, failed_count: 0,
      avg_latency_ms: 0, error_rate: 0, pending_count: 0,
    };
  }
  return {
    total_messages: s.total,
    pending_count: s.pending,
    completed_count: s.completed,
    failed_count: s.failed,
    // the API window is one hour → msg/min
    throughput: s.total / 60,
    avg_latency_ms: latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
    error_rate: s.total > 0 ? s.failed / s.total : 0,
    queue_depth: s.pending + s.processing,
    messages,
    per_agent,
  };
}

export interface AmbassadorAlert {
  id: string;
  agentId: string;
  agentName: string;
  severity: "critical" | "warning" | "info";
  type: string;
  message: string;
  metric: string;
  value: number;
  threshold: number;
  timestamp: string;
}

export type FilterLevel = "all" | "critical" | "warning";

export interface UseAmbassadorResult<T extends AmbassadorAlert> {
  stats: BusStats | null;
  alerts: T[];
  loading: boolean;
  filter: FilterLevel;
  setFilter: (f: FilterLevel) => void;
  resolveAlert: (id: string) => void;
  criticalCount: number;
  warningCount: number;
  filteredAlerts: T[];
  refresh: () => void;
}

// ── Hook ────────────────────────────────────────────────────────────
export function useAmbassador<T extends AmbassadorAlert>(
  deriveAlerts: (stats: BusStats) => T[],
  pollInterval = 8000,
): UseAmbassadorResult<T> {
  const [stats, setStats] = useState<BusStats | null>(null);
  const [alerts, setAlerts] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterLevel>("all");
  const fetchedRef = useRef(false);

  const fetchStats = useCallback(async () => {
    try {
      const raw = await apiClient.get<RawBusStats>("/api/agents/bus-stats");
      const data = mapBusStats(raw);
      setStats(data);
      const derived = deriveAlerts(data);
      setAlerts(prev => {
        const existingIds = new Set(prev.map(a => a.id));
        const newAlerts = derived.filter(a => !existingIds.has(a.id));
        return [...newAlerts, ...prev].slice(0, 150);
      });
    } catch {
      // network error — keep showing last known state
    } finally {
      setLoading(false);
      fetchedRef.current = true;
    }
  }, [deriveAlerts]);

  useEffect(() => {
    fetchStats();
    const iv = setInterval(fetchStats, pollInterval);
    return () => clearInterval(iv);
  }, [fetchStats, pollInterval]);

  const resolveAlert = useCallback((id: string) => {
    setAlerts(prev => prev.filter(a => a.id !== id));
  }, []);

  const criticalCount = alerts.filter(a => a.severity === "critical").length;
  const warningCount = alerts.filter(a => a.severity === "warning").length;
  const filteredAlerts = filter === "all" ? alerts : alerts.filter(a => a.severity === filter);

  return { stats, alerts, loading, filter, setFilter, resolveAlert, criticalCount, warningCount, filteredAlerts, refresh: fetchStats };
}