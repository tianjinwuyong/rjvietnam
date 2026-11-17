import { describe,expect,it } from "vitest";

const apiBase=process.env.WMS_API_BASE;
const live=process.env.RUN_OPERATIONS_INTEGRATION_LIVE==="1"&&Boolean(apiBase);

describe.skipIf(!live)("MES WMS Station PDA integration",()=>{
  it("publishes one canonical read model with explicit ownership",async()=>{
    const login=await fetch(`${apiBase}/api/auth/login`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username:"admin",password:"Factory@123"})});
    expect(login.ok).toBe(true);
    const headers={authorization:`Bearer ${(await login.json() as any).data.token}`};
    const response=await fetch(`${apiBase}/api/integration/operations-snapshot`,{headers});
    expect(response.ok).toBe(true);
    const body=await response.json() as any;
    expect(body.ok).toBe(true);
    expect(body.canonical.mes).toContain("workOrder");
    expect(body.canonical.wms).toContain("inventoryLedger");
    expect(body.canonical.station).toContain("equipmentResult");
    expect(body.canonical.pda).toContain("scanObservation");
    expect(body.canonical.threeD).toEqual(["readOnlyDisplay","alarm"]);
    expect(body.health.mes).toBe(true);
    expect(body.health.wms).toBe(true);
    expect(Array.isArray(body.workOrders)).toBe(true);
    expect(Array.isArray(body.stations)).toBe(true);
    expect(Array.isArray(body.pda)).toBe(true);
    expect(Array.isArray(body.exchange)).toBe(true);
  });
});
