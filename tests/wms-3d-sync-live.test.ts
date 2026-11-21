import { describe,expect,it } from "vitest";

const apiBase=process.env.WMS_API_BASE;
const live=process.env.RUN_WMS_3D_SYNC_LIVE==="1"&&Boolean(apiBase);

describe.skipIf(!live)("WMS canonical 3D synchronization",()=>{
  it("returns the same read-only snapshot to independent web clients",async()=>{
    const login=await fetch(`${apiBase}/api/auth/login`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username:"admin",password:"Factory@123"})});
    expect(login.ok).toBe(true);
    const headers={authorization:`Bearer ${(await login.json() as any).data.token}`};
    const [a,b]=await Promise.all([
      fetch(`${apiBase}/api/3d/wms-snapshot`,{headers}),
      fetch(`${apiBase}/api/3d/wms-snapshot`,{headers}),
    ]);
    expect(a.ok).toBe(true);expect(b.ok).toBe(true);
    const left=await a.json() as any,right=await b.json() as any;
    expect(left.readOnly).toBe(true);expect(right.readOnly).toBe(true);
    expect(left.metrics).toEqual(right.metrics);
    expect(left.rawMaterials).toEqual(right.rawMaterials);
    expect(left.finishedGoods).toEqual(right.finishedGoods);
    expect(left.cases).toEqual(right.cases);
    expect(left.handovers).toEqual(right.handovers);
  });
});
