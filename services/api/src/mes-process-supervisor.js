import { requireMesProcess } from "./mes-process-registry.js";

const TERMINAL_STATES = new Set(["COMPLETED", "CLOSED", "CANCELLED"]);

export function superviseMesProcess(snapshot, now = new Date()) {
  const issues = [];
  const registration = requireMesProcess(snapshot.processCode, snapshot.domain, snapshot.lastFactType);
  if (!registration.ok) {
    issues.push({
      issueType: "PROCESS_CONTRACT_VIOLATION",
      severity: "BLOCK",
      code: registration.code,
      owner: "MES_DOMAIN_MANAGER",
      action: "QUARANTINE_FACT_AND_REVIEW_DOMAIN_ROUTE",
    });
  }

  const lastActivityAt = new Date(snapshot.lastActivityAt);
  const ageMinutes = Math.max(0, (now.getTime() - lastActivityAt.getTime()) / 60000);
  if (!TERMINAL_STATES.has(snapshot.status) && Number.isFinite(snapshot.slaMinutes) && ageMinutes > snapshot.slaMinutes) {
    issues.push({
      issueType: "PROCESS_SLA_BREACH",
      severity: snapshot.blocking ? "BLOCK" : "WARNING",
      code: "PROCESS_INACTIVE_BEYOND_SLA",
      owner: snapshot.owner,
      action: "ACKNOWLEDGE_AND_HANDLE_STUCK_PROCESS",
      ageMinutes: Math.round(ageMinutes),
      slaMinutes: snapshot.slaMinutes,
    });
  }

  if (snapshot.expectedHandoff && !snapshot.completedHandoffs?.includes(snapshot.expectedHandoff)) {
    issues.push({
      issueType: "MISSING_PROCESS_HANDOFF",
      severity: "WARNING",
      code: "EXPECTED_HANDOFF_NOT_CONFIRMED",
      owner: snapshot.owner,
      action: "CONFIRM_OR_RETRY_HANDOFF",
      expectedHandoff: snapshot.expectedHandoff,
    });
  }

  if (TERMINAL_STATES.has(snapshot.status) && !snapshot.closureEvidenceId) {
    issues.push({
      issueType: "UNVERIFIED_PROCESS_CLOSURE",
      severity: "BLOCK",
      code: "CLOSURE_EVIDENCE_REQUIRED",
      owner: snapshot.owner,
      action: "REOPEN_OR_ATTACH_CLOSURE_EVIDENCE",
    });
  }

  return {
    processInstanceId: snapshot.processInstanceId,
    processCode: snapshot.processCode,
    domain: snapshot.domain,
    health: issues.some((issue) => issue.severity === "BLOCK") ? "BLOCKED" : issues.length ? "AT_RISK" : "HEALTHY",
    issues,
    checkedAt: now.toISOString(),
  };
}

export function superviseMesProcesses(snapshots, now = new Date()) {
  const processes = snapshots.map((snapshot) => superviseMesProcess(snapshot, now));
  return {
    summary: {
      total: processes.length,
      healthy: processes.filter((item) => item.health === "HEALTHY").length,
      atRisk: processes.filter((item) => item.health === "AT_RISK").length,
      blocked: processes.filter((item) => item.health === "BLOCKED").length,
    },
    processes,
    checkedAt: now.toISOString(),
  };
}
