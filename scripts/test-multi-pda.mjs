import http from "http";

function post(path, body) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: "127.0.0.1", port: 8080, path, method: "POST", headers: { "Content-Type": "application/json" } };
    const req = http.request(opts, res => {
      let d = ""; res.on("data", c => d += c); res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, body: d }); }
      });
    });
    req.on("error", reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  // WO codes from seed: 26061010008 (L001), 26061020008 (L002), 26061020007, 26061030009
  const WO_CODES = ["26061010008", "26061020008", "26061020007", "26061030009", "26061010008"];
  let WO = null;
  for (const code of WO_CODES) {
    const r = await post(`/pmc/work-orders/${code}/lock`, { payload: { operator: "TESTOP" } });
    if (r.body.code === 0) { WO = code; await post(`/pmc/work-orders/${code}/unlock`, { payload: { operator: "TESTOP", force: true } }); break; }
    process.stdout.write(".");
  }
  if (!WO) { console.log("\nNo WOs found."); return; }
  console.log("\nUsing WO:", WO);

  const [op1, op2] = ["VN_OP_001", "VN_WH_001"];

  const l1 = await post(`/pmc/work-orders/${WO}/lock`, { payload: { operator: op1 } });
  console.log(`[${op1}] LOCK:`, l1.body.code === 0 ? `OK ops=${JSON.stringify(l1.body.data?.activeOperators)}` : `FAIL: ${l1.body.message}`);

  const l2 = await post(`/pmc/work-orders/${WO}/lock`, { payload: { operator: op2 } });
  console.log(`[${op2}] LOCK:`, l2.body.code === 0 ? `OK ops=${JSON.stringify(l2.body.data?.activeOperators)}` : `FAIL: ${l2.body.message}`);

  const l1b = await post(`/pmc/work-orders/${WO}/lock`, { payload: { operator: op1 } });
  console.log(`[${op1}] re-LOCK:`, l1b.body.code === 0 ? `idempotent alreadyActive=${l1b.body.data?.alreadyActive}` : `status=${l1b.status}`);

  const u1 = await post(`/pmc/work-orders/${WO}/unlock`, { payload: { operator: op1 } });
  console.log(`[${op1}] UNLOCK:`, u1.body.code === 0 ? `OK remaining=${JSON.stringify(u1.body.data?.activeOperators)}` : u1.body.message);

  const fu = await post(`/pmc/work-orders/${WO}/unlock`, { payload: { operator: "MANAGER", force: true } });
  console.log(`[MANAGER] FORCE:`, fu.body.code === 0 ? "OK" : JSON.stringify(fu.body));

  console.log("\n=== DONE ===");
}

main().catch(e => { console.error(e.message); process.exit(1); });
