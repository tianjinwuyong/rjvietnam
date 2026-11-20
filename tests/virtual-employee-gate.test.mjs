import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  mintServiceToken, verifyServiceToken, serviceActorFor,
  validateGateForApproval, canHumanApprove,
} from "../services/api/src/virtual-employees/service-identity.js";

const ORIGINAL_SECRET = process.env.JWT_SECRET;
beforeAll(() => { process.env.JWT_SECRET = "unit-test-secret-not-for-production"; });
afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = ORIGINAL_SECRET;
});

const employee = {
  id: "WMS-RECEIVING-VIRTUAL-01",
  domain: "wms",
  humanGates: ["receive_variance", "inventory_release"],
};

const waitingTask = {
  id: 1,
  status: "WAITING_APPROVAL",
  requires_human: true,
  human_gate: "receive_variance",
  input: {},
};

describe("virtual-employee service identity", () => {
  it("mints a scoped token that verifies back to the same employee", () => {
    const token = mintServiceToken("wms-receiving-virtual-01", "task:create", 600, 0);
    const payload = verifyServiceToken(token, 1);
    expect(payload.ve).toBe("WMS-RECEIVING-VIRTUAL-01");
    expect(payload.scope).toEqual(["task:create"]);
    expect(payload.exp).toBe(600000);
  });

  it("rejects tampered, malformed and expired tokens", () => {
    const token = mintServiceToken(employee.id, "task:create", 60, 0);
    const [body, mac] = token.split(".");
    expect(verifyServiceToken(`${body}.${mac.slice(0, -1)}X`, 1)).toBeNull();
    expect(verifyServiceToken("not-a-token", 1)).toBeNull();
    expect(verifyServiceToken(token, 60001)).toBeNull();
  });

  it("refuses unsupported scopes and out-of-range lifetimes", () => {
    expect(() => mintServiceToken(employee.id, "approve:any")).toThrow(/unsupported scope/);
    expect(() => mintServiceToken(employee.id, "task:create", 59)).toThrow(/ttlSeconds/);
  });

  it("binds a service token to one employee", () => {
    const token = mintServiceToken(employee.id);
    const req = { headers: { "x-ve-token": token }, user: { username: "manager" } };
    expect(serviceActorFor(req, employee.id)).toMatchObject({ ok: true, actor: `ve:${employee.id}`, service: true });
    expect(serviceActorFor(req, "IQC-VIRTUAL-01")).toMatchObject({ ok: false, code: "VE_TOKEN_EMPLOYEE_MISMATCH" });
    expect(serviceActorFor({ headers: {}, user: { username: "manager" } }, employee.id)).toMatchObject({ ok: true, actor: "manager", service: false });
  });
});

describe("human gate contract", () => {
  it("accepts a registered gate on a waiting task", () => {
    expect(validateGateForApproval(employee, waitingTask)).toEqual({ ok: true, gate: "receive_variance" });
  });

  it("rejects unregistered, undeclared and non-gated approvals", () => {
    expect(validateGateForApproval(employee, { ...waitingTask, human_gate: "invented_gate" }))
      .toMatchObject({ ok: false, code: "GATE_NOT_REGISTERED" });
    expect(validateGateForApproval(employee, { ...waitingTask, human_gate: null, input: {} }))
      .toMatchObject({ ok: false, code: "GATE_NOT_SPECIFIED" });
    expect(validateGateForApproval(employee, { ...waitingTask, requires_human: false }))
      .toMatchObject({ ok: false, code: "NOT_A_HUMAN_GATE" });
    expect(validateGateForApproval(employee, { ...waitingTask, status: "OPEN" }))
      .toMatchObject({ ok: false, code: "TASK_NOT_WAITING" });
    expect(validateGateForApproval(null, waitingTask))
      .toMatchObject({ ok: false, code: "EMPLOYEE_NOT_FOUND" });
  });
  it("never lets a virtual employee approve its own gate", () => {
    const token = mintServiceToken(employee.id);
    const req = { headers: { "x-ve-token": token }, user: { username: "manager", permissions: ["*"] } };
    expect(canHumanApprove(req, employee)).toMatchObject({ ok: false, code: "VE_CANNOT_APPROVE" });
  });

  it("enforces the WMS write permission for WMS gates", () => {
    const req = { headers: {}, user: { username: "operator", permissions: ["wms.view"] } };
    expect(canHumanApprove(req, employee)).toMatchObject({ ok: false, code: "FORBIDDEN", required: "wms.execute" });
    expect(canHumanApprove({ headers: {}, user: { username: "manager", permissions: ["wms.execute"] } }, employee))
      .toMatchObject({ ok: true, actor: "manager" });
    expect(canHumanApprove({ headers: {}, user: { username: "admin", permissions: ["*"] } }, employee))
      .toMatchObject({ ok: true, actor: "admin" });
  });
});
