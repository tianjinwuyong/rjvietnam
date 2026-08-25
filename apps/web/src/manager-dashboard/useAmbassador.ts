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
      const data = await apiClient.get<BusStats>("/api/agents/bus-stats");
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