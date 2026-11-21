// End-to-end material loading flow test
import http from "http";

function req(path, method = "GET", body = null, token = null) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: "127.0.0.1", port: 8080, path, method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    };
    const r = http.request(opts, res => {
      let d = ""; res.on("data", c => d += c);
      res.on("end", () => { try { resolve({ s: res.statusCode, b: JSON.parse(d) }); } catch { resolve({ s: res.statusCode, b: d }); } });
    });
    r.on("error", reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function main() {
  console.log("=== Material Loading E2E Test ===\n");

  // 1. Login
  const login = await req("/api/auth/login", "POST", { username: "VN_OP_001", password: "Factory@123" });
  if (!login.b.data?.token) { console.log("[FAIL] Login:", JSON.stringify(login.b)); return; }
  const token = login.b.data.token;
  console.log("[1] Login OK:", "VN_OP_001");

  const WO = "26061010008";

  // 2. Lock WO
  const lock = await req(`/pmc/work-orders/${WO}/lock`, "POST", { payload: { operator: "VN_OP_001" } });
  console.log("\n[2] Lock WO:", lock.b.data ? "OK" : "FAIL");
  console.log("    activeOperators:", JSON.stringify(lock.b.data?.activeOperators));

  // 3. BOM material status
  const bom = await req(`/pmc/work-order-material-status?workOrderCode=${WO}`, "GET", null, token);
  console.log("\n[3] BOM Status:", bom.b.data ? "OK" : "FAIL");
  const items = bom.b.data?.items ?? [];
  console.log("   Materials:", items.length, "found");
  items.slice(0, 3).forEach(i => console.log("   -", i.materialCode, "| shortfall:", i.shortfall ?? i.shortage ?? "—"));

  // 4. Feeder bindings for L001
  const binds = await req(`/mes/feeder-bindings?lineCode=L001&limit=10`, "GET", null, token);
  console.log("\n[4] Feeder Bindings:", binds.b.data ? "OK" : "FAIL");
  const activeBinds = (binds.b.data?.items ?? []).filter(b => !b.unboundAt);
  console.log("   Active:", activeBinds.length);

  // 5. Feeder loading records for WO
  const recs = await req(`/mes/feeder-loading/${WO}`, "GET", null, token);
  console.log("\n[5] Loading Records:", recs.b.data ? "OK" : "FAIL");
  console.log("   Records:", recs.b.data?.items?.length ?? 0);

  // 6. Post feeder loading (simulate loading F01)
  const post = await req("/mes/feeder-loading", "POST", {
    payload: {
      workOrderCode: WO,
      lineCode: "L001",
      slotNo: "F01",
      lotNo: "VN-R240620-02",
      materialCode: "R-0603-10K-1",
      qty: 5000,
      operator: "VN_OP_001",
    },
  }, token);
  console.log("\n[6] Post Feeder Loading:", post.s === 201 || post.b.data ? "OK" : "FAIL");
  console.log("    Status:", post.s, "| Response:", JSON.stringify(post.b.data ?? post.b.message ?? post.b));

  // 7. Verify record was created
  const recs2 = await req(`/mes/feeder-loading/${WO}`, "GET", null, token);
  const loadedItems = recs2.b.data?.items ?? [];
  const count2 = loadedItems.length;
  console.log("\n[7] After loading — Records:", count2, "(was", (recs.b.data?.items?.length ?? 0) + ")");
  const latest = loadedItems[0];
  if (latest) console.log("    Latest:", latest.slotNo, "|", latest.materialCode);

  // 8. Unlock WO
  const unlock = await req(`/pmc/work-orders/${WO}/unlock`, "POST", { payload: { operator: "VN_OP_001" } });
  console.log("\n[8] Unlock:", unlock.b.data ? "OK" : "FAIL");
  console.log("    Remaining:", JSON.stringify(unlock.b.data?.activeOperators));

  console.log("\n=== DONE ===");
}

main().catch(e => { console.error(e.message); process.exit(1); });
