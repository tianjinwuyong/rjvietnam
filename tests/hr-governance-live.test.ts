import pg from "pg";
import { describe, expect, it } from "vitest";

const apiBase = process.env.HR_API_BASE;
const live = process.env.RUN_HR_GOVERNANCE_LIVE === "1" && Boolean(apiBase);

describe.skipIf(!live)("HR responsibility and personnel governance", () => {
  it("publishes duties and completes an approved, acknowledged, audited personnel action", async () => {
    const db = new pg.Pool({
      host: "127.0.0.1",
      database: "smt_factory",
      user: "postgres",
      password: "postgres",
    });
    const login = await fetch(`${apiBase}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "Factory@123" }),
    });
    expect(login.ok).toBe(true);
    const token = (await login.json() as any).data.token;
    const headers = { "content-type": "application/json", authorization: `Bearer ${token}` };
    const fixture = (await db.query(`
      SELECT e.id employee_id,e.position_id,p.id position_id
      FROM employees e JOIN positions p ON p.id=e.position_id
      WHERE e.status='active' ORDER BY e.id LIMIT 1
    `)).rows[0];
    expect(fixture).toBeTruthy();

    const post = async (path: string, body: unknown) => {
      const response = await fetch(`${apiBase}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const json = await response.json() as any;
      expect(response.ok, JSON.stringify(json)).toBe(true);
      return json.data.item;
    };

    let responsibilityId: number | undefined;
    let actionId: number | undefined;
    try {
      const responsibility = await post("/hr/responsibilities", {
        positionId: fixture.position_id,
        titleZh: "现场岗位责任测试版",
        titleEn: "Factory responsibility acceptance test",
        titleVi: "Kiểm thử trách nhiệm vị trí",
        purpose: "Verify controlled publication and acknowledgement",
        responsibilities: ["Follow approved work instruction", "Protect product quality and safety"],
      });
      responsibilityId = Number(responsibility.id);
      const activated = await post(`/hr/responsibilities/${responsibilityId}/activate`, {});
      expect(activated.status).toBe("ACTIVE");
      const assigned = (await db.query(
        "SELECT COUNT(*)::int count FROM hr_responsibility_acknowledgements WHERE responsibility_version_id=$1",
        [responsibilityId],
      )).rows[0].count;
      expect(assigned).toBeGreaterThan(0);
      await post(`/hr/responsibilities/${responsibilityId}/acknowledge`, {
        employeeId: fixture.employee_id,
        status: "ACKNOWLEDGED",
        signatureMethod: "EMPLOYEE_BADGE",
      });

      const action = await post("/hr/personnel-actions", {
        employeeId: fixture.employee_id,
        actionType: "REWARD",
        reasonCode: "QUALITY-CONTRIBUTION",
        reasonDetail: "Live acceptance reward workflow; no payroll amount is posted",
        proposedValue: { recognition: "QUALITY_CONTRIBUTION" },
        actor: "HR-LIVE-TEST",
      });
      actionId = Number(action.id);
      expect(action.status).toBe("PENDING_APPROVAL");
      await post(`/hr/personnel-actions/${actionId}/decision`, {
        decision: "APPROVE", approvalRole: "LINE_LEADER", comment: "Evidence checked", actor: "LINE_LEADER",
      });
      const approved = await post(`/hr/personnel-actions/${actionId}/decision`, {
        decision: "APPROVE", approvalRole: "DEPARTMENT_MANAGER", comment: "Approved", actor: "DEPARTMENT_MANAGER",
      });
      expect(approved.status).toBe("APPROVED");
      await post(`/hr/personnel-actions/${actionId}/employee-ack`, {
        decision: "ACKNOWLEDGED", comment: "Received", signatureMethod: "EMPLOYEE_BADGE",
      });
      const executed = await post(`/hr/personnel-actions/${actionId}/execute`, { actor: "HR-LIVE-TEST" });
      expect(executed.status).toBe("EXECUTED");

      const state = (await db.query(`
        SELECT a.status,
          (SELECT COUNT(*)::int FROM hr_personnel_action_approvals WHERE action_id=a.id) approval_count,
          (SELECT COUNT(*)::int FROM hr_personnel_action_employee_ack WHERE action_id=a.id) ack_count,
          (SELECT COUNT(*)::int FROM hr_personnel_action_effects WHERE action_id=a.id) effect_count,
          (SELECT COUNT(*)::int FROM hr_personnel_action_audit WHERE action_id=a.id) audit_count
        FROM hr_personnel_actions a WHERE a.id=$1
      `, [actionId])).rows[0];
      expect(state).toMatchObject({
        status: "EXECUTED",
        approval_count: 2,
        ack_count: 1,
        effect_count: 1,
      });
      expect(state.audit_count).toBeGreaterThanOrEqual(5);
    } finally {
      if (actionId) {
        for (const table of [
          "hr_personnel_action_effects",
          "hr_personnel_action_employee_ack",
          "hr_personnel_action_audit",
          "hr_personnel_action_appeals",
          "hr_personnel_action_approvals",
        ]) {
          await db.query(`DELETE FROM ${table} WHERE action_id=$1`, [actionId]);
        }
        await db.query("DELETE FROM hr_personnel_actions WHERE id=$1", [actionId]);
      }
      if (responsibilityId) {
        await db.query("DELETE FROM hr_responsibility_acknowledgements WHERE responsibility_version_id=$1", [responsibilityId]);
        await db.query("DELETE FROM hr_position_responsibility_versions WHERE id=$1", [responsibilityId]);
      }
      await db.end();
    }
  });
});
