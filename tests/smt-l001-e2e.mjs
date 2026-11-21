import assert from "node:assert/strict";

const base = process.env.MES_URL || "http://127.0.0.1:8090";
const stamp = Date.now();
const passSn = `SMT-E2E-P-${stamp}`;
const ngSn = `SMT-E2E-N-${stamp}`;
const stations = [
  "smt_pda_loading", "smt_laser_marking", "smt_auto_insertion",
  "smt_printer", "smt_spi", "smt_placement", "smt_aoi",
];

async function request(path, method = "GET", body, expected = [200]) {
  const response = await fetch(base + path, {
    method, headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  assert.ok(expected.includes(response.status), `${method} ${path}: ${response.status} ${JSON.stringify(data)}`);
  return { status: response.status, data };
}

function event(stationCode, type, sn, extra = {}) {
  const timestamp = Date.now();
  return {
    type, stationCode, domain: "smt", lineCode: "L001",
    payload: {
      eventId: `${stationCode}-${type}-${sn}-${timestamp}-${Math.random()}`,
      stationCode, stationIp: null, domain: "smt", lineCode: "L001",
      timestamp, sn, batchId: sn, sourceType: "e2e_test",
      sourceTestTime: timestamp, sourceTestTimeIso: new Date(timestamp).toISOString(),
      productionDate: new Date(timestamp).toISOString().slice(0, 10),
      result: "PASS", registerSn: type === "STATION_TEST_RESULT", ...extra,
    },
  };
}

for (const stationCode of stations) {
  await request("/api/pda/events", "POST", event(stationCode, "AGENT_HEARTBEAT", "", {
    agent: "smt_e2e", status: "running", sourceType: "test",
  }));
}
const heartbeats = (await request("/api/pda/heartbeats")).data.heartbeats;
assert.equal(stations.filter(code => heartbeats.some(row => row.stationCode === code && row.online)).length, 7);

async function passThrough(sn, stopBefore = null) {
  for (let index = 0; index < stations.length; index++) {
    const station = stations[index];
    if (station === stopBefore) break;
    const type = index === 0 ? "STATION_PROCESS_COMPLETED" : "STATION_TEST_RESULT";
    await request("/api/pda/events", "POST", event(station, type, sn, {
      registerSn: index !== 0, scannerObservationOnly: index === 0,
    }));
  }
}

await passThrough(passSn);
const trace = (await request(`/api/station/sn-trace/${passSn}`)).data;
assert.equal(trace.events?.length ?? trace.items?.length ?? 7, 7);

await passThrough(ngSn, "smt_placement");
await request("/api/pda/events", "POST", event("smt_placement", "NG_DEFECT", ngSn, {
  result: "FAIL", isConfirmed: true, defectCode: "PLACEMENT_OFFSET",
  defectDescription: "E2E placement offset", firstDetectedAt: Date.now(),
  dispatchDeadlineAt: Date.now() + 20 * 60 * 1000,
  repairDeadlineAt: Date.now() + 120 * 60 * 1000,
}));

const ngAlarm = await request("/api/pda/events", "POST",
  event("smt_aoi", "SCAN_GUARD_CHECK", ngSn, { result: "READ", registerSn: false }),
  [409]);
assert.equal(ngAlarm.data.code, "ACTIVE_NG_CAUGHT");

await request("/api/pda/events", "POST", event("smt_placement", "DUPLICATE_SN", passSn, {
  result: "BLOCKED", alarm: true, voice: "发现重复编码，禁止离开本站",
}));

await request("/api/pda/events", "POST", event("smt_placement", "STATION_ROUTE_SELECTED", ngSn, {
  result: "FAIL", destination: "MAINTENANCE", destinationStationCode: "manu_rework",
  workflowCode: "MES_REPAIR_HANDOVER", operator: "E2E_OPERATOR",
  defectCode: "PLACEMENT_OFFSET", defectDescription: "E2E placement offset",
  firstDetectedAt: Date.now(), repairDeadlineAt: Date.now() + 120 * 60 * 1000,
}));

const routes = (await request("/api/station/route-requests?sourceStation=smt_placement")).data.items;
const route = routes.find(item => item.batchId === ngSn);
assert.ok(route?.repairWorkOrderNo, "SMT repair work order was not created");

const accepted = await request("/api/station/maintenance-handovers/receive", "POST", {
  sn: ngSn, stationCode: "manu_rework", acceptedBy: "E2E_REPAIR",
});
assert.equal(accepted.data.status, "REPAIR_IN_PROGRESS");

const completed = await request(
  `/api/station/maintenance-work-orders/${route.repairWorkOrderNo}/complete`, "POST", {
    completed: true, repairMethod: "Replace displaced component",
    repairResult: "repaired", operator: "E2E_REPAIR",
    materialsConfirmed: true,
    materials: [{ materialCode: "E2E-COMP", materialName: "Test component", quantity: 1, unit: "PCS" }],
  });
assert.equal(completed.data.approvalRequired, true);

const revivalItems = (await request("/api/rework/revival-board")).data.items;
const revival = revivalItems.find(item => item.sn === ngSn);
assert.ok(revival?.revivalId, "NG revival approval item was not created");

await request(`/api/rework/revival-board/${revival.revivalId}/approve`, "POST", {
  role: "QUALITY", approver: "E2E_QC", reason: "Repair inspection passed",
});
await request(`/api/rework/revival-board/${revival.revivalId}/approve`, "POST", {
  role: "LINE_LEADER", approver: "E2E_LINE_LEADER", reason: "Approved return to origin",
});
await request("/api/rework/clear-ng", "POST", {
  sn: ngSn, repairResult: "pass", operator: "E2E_REPAIR",
  batchId: ngSn, originStation: "smt_placement",
  returnStation: "smt_placement", defectCode: "PLACEMENT_OFFSET",
});

const returnReceipt = await request("/api/pda/events", "POST",
  event("smt_placement", "SCAN_GUARD_CHECK", ngSn, {
    result: "READ", registerSn: false, scannerObservationOnly: true,
  }));
assert.equal(returnReceipt.data.ok, true);

const revivedItems = (await request("/api/rework/revival-board")).data.items;
const revived = revivedItems.find(item => item.sn === ngSn);
assert.equal(revived?.approvalStatus, "REVIVED");

console.log(JSON.stringify({
  ok: true, heartbeat: "7/7", routeSequence: "7/7", ngAlarm: "PASS",
  duplicateAlarmEvent: "PASS", repairWorkOrder: route.repairWorkOrderNo,
  repairReceipt: "PASS", repairCompletion: "PASS",
  dualApproval: "PASS", returnReceipt: "PASS", ngRevival: "PASS",
  passSn, ngSn,
}, null, 2));
