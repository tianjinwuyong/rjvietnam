/**
 * Agent provenance context for write requests (WB-002 / WB-003, Phase 1).
 *
 * Design constraints:
 *  - Strictly opt-in. `current` starts as null, so `apiClient` emits exactly
 *    the same headers as before until a caller sets provenance explicitly.
 *  - Header names deliberately match the NestJS WMS constants at
 *    `wms/server/common/auth/agent-scope.constants.ts:17-22`.
 *  - This module is pure state + helpers. It performs no I/O and makes no
 *    security claim. The current web app targets `http://<host>:8080`
 *    (`services/api/server.js`), which does not read these headers yet, so the
 *    headers are emitted but INERT until the backend integration lands.
 *    Do NOT treat this as enforced access control.
 *
 * Integration gate before enabling globally:
 *  1. Confirm the receiving server allows `x-agent-key`, `x-agent-scope`,
 *     `x-created-by-type`, `x-created-by-id` in CORS preflight. The Express
 *     server uses `cors()` with defaults (reflects requested headers) so it is
 *     safe; the NestJS server (`wms/server/main.ts:34-42`) has an empty
 *     `CORS_ORIGINS` whitelist and expects same-origin relative paths.
 *  2. Confirm the backend actually persists `created_by_type` / `created_by_id`
 *     (currently `operation-log.interceptor.ts:205-216` does not).
 *  3. The 133 raw-`fetch` write sites inventoried in WB-002 bypass `apiClient`
 *     entirely and will NOT inherit these headers.
 */

/** In-flight agent mutation that has not yet been committed. */
export const AGENT_PROCESSING = "AGENT_PROCESSING";

/** Agent-initiated mutation parked until a human decides. */
export const PENDING_HUMAN_APPROVAL = "PENDING_HUMAN_APPROVAL";

export interface AgentProvenance {
  /** Identifies the calling agent; maps to `x-agent-key`. */
  agentKey?: string;
  /** Scope claimed by the agent; maps to `x-agent-scope`. */
  agentScope?: string | null;
  /** `"AGENT"` | `"HUMAN"`; maps to `x-created-by-type`. */
  createdByType?: string | null;
  /** Actor id (user id or agent id); maps to `x-created-by-id`. */
  createdById?: string | null;
}

let current: AgentProvenance | null = null;

/** Set or replace the provenance for subsequent `apiClient` writes. Pass null to disable. */
export function setAgentProvenance(next: AgentProvenance | null): void {
  current = next;
}

export function getAgentProvenance(): AgentProvenance | null {
  return current;
}

export function clearAgentProvenance(): void {
  current = null;
}

/** True when a mutation is parked for a human decision. */
export function isPendingHumanApproval(status: unknown): boolean {
  return status === PENDING_HUMAN_APPROVAL;
}

/** True while an agent mutation is still in flight. */
export function isAgentProcessing(status: unknown): boolean {
  return status === AGENT_PROCESSING;
}

/**
 * Badge class for existing approval UIs (the project already uses
 * `badge badge-info` / `badge badge-warning` in hr/HrGovernance.tsx:242).
 * Returns a class only; callers own the label.
 */
export function approvalBadgeClass(status: unknown): string {
  if (status === PENDING_HUMAN_APPROVAL) return "badge badge-warning";
  if (status === AGENT_PROCESSING) return "badge badge-info";
  return "badge badge-info";
}
