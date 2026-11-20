// One approval path, shared by the HTTP route and the batch CLI.
//
// The rules (mirrored from service-identity.js, which owns them):
//   * the actor must be a named human — `ve:` and service tokens never approve;
//   * the human must hold the domain permission key for the employee's domain;
//   * the task's gate must be registered on that employee and match
//     `human_gate` / `input.action`, otherwise a stale approval would flip a
//     different obligation to OPEN;
//   * the UPDATE is conditional on status='WAITING_APPROVAL' so a double click
//     cannot approve twice.
// After a successful approval the workflow is advanced by writeback.js, and a
// failing advance is recorded — never allowed to revert the human's decision.

import { humanDomainPermission, validateGateForApproval } from "../virtual-employees/service-identity.js";
import { applyWriteback } from "./writeback.js";

const VE_ACTOR = /^ve:/i;

export function humanActor({ actor, serviceToken = false }) {
  const name = String(actor || "").trim();
  if (!name) return { ok: false, code: "UNAUTHORIZED" };
  // A request carrying a VE service token is not a human, whatever its subject
  // claims to be.
  if (serviceToken || VE_ACTOR.test(name)) return { ok: false, code: "VE_CANNOT_APPROVE", actor: name };
  return { ok: true, actor: name };
}

// Permission check without an Express request: same mapping, plain inputs.
export function humanPermissionCheck({ actor, permissions = [], employee, serviceToken = false }) {
  if (serviceToken) return { ok: false, code: "VE_CANNOT_ACT_AS_HUMAN" };
  const fakeReq = { user: { username: actor, displayName: actor, permissions, isService: false } };
  return humanDomainPermission(fakeReq, employee);
}

export async function approveTask({ query, task, employee, actor, permissions = [], serviceToken = false, writeback = true }) {
  if (!task) return { ok: false, code: "TASK_NOT_FOUND" };
  if (!employee) return { ok: false, code: "EMPLOYEE_NOT_FOUND", employeeId: task.employee_id };
  const who = humanActor({ actor, serviceToken });
  if (!who.ok) return who;
  const perm = humanPermissionCheck({ actor: who.actor, permissions, employee, serviceToken });
  if (!perm.ok) return { ok: false, code: perm.code, required: perm.required, actor: who.actor };
  const gate = validateGateForApproval(employee, task);
  if (!gate.ok) return { ok: false, code: gate.code, gate: gate.gate, actor: who.actor };
  if (task.status !== "WAITING_APPROVAL") return { ok: false, code: "TASK_NOT_WAITING", status: task.status };

  const row = (await query(
    `UPDATE factory_virtual_employee_tasks
        SET status='OPEN', approved_by=$1, updated_at=NOW()
      WHERE id=$2 AND status='WAITING_APPROVAL' RETURNING *`,
    [who.actor, task.id],
  )).rows[0];
  if (!row) return { ok: false, code: "TASK_NOT_WAITING" };

  await query(
    `INSERT INTO factory_virtual_employee_events(employee_id,task_id,event_type,detail,actor)
     VALUES($1,$2,'HUMAN_APPROVED',$3::jsonb,$4)`,
    [row.employee_id, row.id,
      JSON.stringify({ humanGate: gate.gate, taskType: row.task_type, approvedBy: who.actor }), who.actor],
  );

  let effect = null;
  if (writeback) {
    try {
      effect = await applyWriteback({ query, task: row, employee, reviewer: who.actor });
    } catch (err) {
      // The human's decision stands; the lost advance is an audit finding.
      effect = { applied: false, code: "WRITEBACK_FAILED", error: String(err.message || err) };
      await query(
        `INSERT INTO factory_virtual_employee_events(employee_id,task_id,event_type,detail,actor)
         VALUES($1,$2,'WRITEBACK_FAILED',$3::jsonb,$4)`,
        [row.employee_id, row.id, JSON.stringify({ gate: gate.gate, error: String(err.message || err) }), "rule:writeback-v1"],
      ).catch(() => {});
    }
  }
  return { ok: true, task: row, gate: gate.gate, actor: who.actor, writeback: effect };
}

// The queue a human has to clear, grouped by gate — the input for the batch tool.
export async function pendingQueue({ query, gate = null, employeeId = null, limit = 50 }) {
  const rows = (await query(
    `SELECT id, employee_id, task_type, title, human_gate, requested_by, priority, created_at,
            (input->'evidence') AS evidence
       FROM factory_virtual_employee_tasks
      WHERE status='WAITING_APPROVAL' AND requires_human
        AND ($1::text IS NULL OR human_gate=$1)
        AND ($2::text IS NULL OR employee_id=$2)
      ORDER BY CASE priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END,
               created_at
      LIMIT $3`,
    [gate, employeeId, limit],
  )).rows;
  const byGate = {};
  for (const r of rows) (byGate[r.human_gate || "(none)"] ||= []).push(r);
  return { scanned: rows.length, gates: Object.entries(byGate).map(([g, list]) => ({ gate: g, count: list.length, oldest: list[list.length - 1].created_at, sample: list.slice(0, 3).map(r => r.id) })) };
}

// A reviewer's real permission keys, straight from the same tables the JWT
// path fills. No invented grants: whatever the human can do in the UI is what
// this tool may use.
export async function reviewerPermissions({ query, username }) {
  const row = (await query(
    `SELECT id, username, display_name, role_id, status
       FROM users WHERE lower(username)=lower($1) LIMIT 1`, [username])).rows[0];
  if (!row) return { ok: false, code: "REVIEWER_NOT_FOUND", username };
  if (row.status && row.status !== "active") return { ok: false, code: "REVIEWER_INACTIVE", username, status: row.status };
  // `users.role_id` is the live grant path in this schema; `user_roles` also
  // exists, so both are unioned — a human entitled through either wiring must
  // not be wrongly refused.
  const direct = (await query(
    `SELECT DISTINCT p.code
       FROM users u
       JOIN role_permissions rp ON rp.role_id = u.role_id
       JOIN permissions p ON p.id = rp.permission_id
      WHERE lower(u.username)=lower($1)`, [username])).rows.map(r => r.code);
  const joined = (await query(
    `SELECT DISTINCT p.code
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN role_permissions rp ON rp.role_id = ur.role_id
       JOIN permissions p ON p.id = rp.permission_id
      WHERE lower(u.username)=lower($1)`, [username])).rows.map(r => r.code);
  return { ok: true, username: row.username, displayName: row.display_name || row.username,
    roleId: row.role_id, permissions: [...new Set([...direct, ...joined])] };
}
