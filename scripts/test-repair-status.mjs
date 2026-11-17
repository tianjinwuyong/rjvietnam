// Quick repair_status flow verification
import http from "http";

const BASE = "http://127.0.0.1:8080";
const SN = "REPAIR-TEST-" + Date.now();

function post(path, body, token) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: "127.0.0.1", port: 8080, path, method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    };
    const req = http.request(opts, res => {
      let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(d) }));
    });
    req.on("error", reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

function get(path, token) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: "127.0.0.1", port: 8080, path, method: "GET", headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) } };
    const req = http.request(opts, res => {
      let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(d) }));
    });
    req.on("error", reject);
    req.end();
  });
}

async function main() {
  const { body: loginBody } = await post("/api/auth/login", { username: "VN_OP_001", password: "Factory@123" });
  const token = loginBody.data?.token;
  if (!token) { console.error("Login failed:", loginBody); process.exit(1); }
  console.log("[1] Login OK");

  const passR = await post("/api/mes/events", {
    action: "station_event",
    payload: { stationCode: "AOI-01", pcbSerial: SN, result: "pass", eventType: "output", workOrderCode: "SMT-WO-001" },
  }, token);
  console.log("[2] AOI-01 PASS:", passR.body.code === 0 ? "OK" : passR.body);

  const failR = await post("/api/mes/events", {
    action: "station_event",
    payload: { stationCode: "ICT-01", pcbSerial: SN, result: "fail", eventType: "output", defectCode: "OPEN", defectDescription: "Open circuit", workOrderCode: "SMT-WO-001" },
  }, token);
  console.log("[3] ICT-01 FAIL:", failR.body.code === 0 ? "OK" : failR.body);

  const uc1 = await get(`/mes/events/upstream-check/${encodeURIComponent(SN)}?stationCode=FCT-01`, token);
  const d1 = uc1.body.data;
  console.log(`[4] FCT-01 upstream: hasNg=${d1.hasNg}, pendingNgCount=${d1.pendingNgCount}, verdict=${d1.verdict}`);
  if (d1.pendingNgCount !== 1) console.error("  [FAIL] expected pendingNgCount=1");

  const repairR = await post("/api/mes/events", {
    action: "station_event",
    payload: { stationCode: "REPAIR-01", pcbSerial: SN, result: "pass", eventType: "output", workOrderCode: "SMT-WO-001" },
  }, token);
  console.log("[5] REPAIR-01 PASS:", repairR.body.code === 0 ? "OK" : repairR.body);

  const uc2 = await get(`/mes/events/upstream-check/${encodeURIComponent(SN)}?stationCode=FCT-01`, token);
  const d2 = uc2.body.data;
  console.log(`[6] FCT-01 after repair: hasNg=${d2.hasNg}, pendingNgCount=${d2.pendingNgCount}, verdict=${d2.verdict}`);
  if (d2.pendingNgCount !== 0) console.error("  [FAIL] expected pendingNgCount=0 after repair");
  if (d2.verdict !== "OK") console.error("  [FAIL] expected verdict=OK");

  console.log("\n=== DONE ===");
}

main().catch(e => { console.error(e.message); process.exit(1); });
