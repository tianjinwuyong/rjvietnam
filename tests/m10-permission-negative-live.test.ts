import { describe, expect, it } from "vitest";

const apiBase=process.env.WMS_API_BASE;
const live=process.env.RUN_M10_PERMISSION_LIVE==="1"&&Boolean(apiBase);

async function login(username:string){
  const response=await fetch(`${apiBase}/api/auth/login`,{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({username,password:"Factory@123"}),
  });
  expect(response.ok,await response.clone().text()).toBe(true);
  return (await response.json() as any).data.token as string;
}

describe.skipIf(!live)("M10 permission boundaries",()=>{
  it("blocks ordinary warehouse and station users from synchronization conflict decisions",async()=>{
    for(const username of ["VN_WH_001","VN_OP_001"]){
      const token=await login(username);
      const response=await fetch(`${apiBase}/wms/mes-exchange/conflicts/0/decision`,{
        method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},
        body:JSON.stringify({decision:"KEEP_EXISTING",reason:"negative permission acceptance"}),
      });
      expect(response.status,`${username} must not decide canonical conflicts`).toBe(403);
    }
  });

  it("allows a management identity through the permission boundary",async()=>{
    const token=await login("PDA_USER");
    const response=await fetch(`${apiBase}/wms/mes-exchange/conflicts/0/decision`,{
      method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},
      body:JSON.stringify({decision:"KEEP_EXISTING",reason:"permission boundary acceptance"}),
    });
    expect(response.status).toBe(409);
  });

  it("reserves lifetime-extension approval for quality governance",async()=>{
    const warehouse=await login("VN_WH_001");
    const blocked=await fetch(`${apiBase}/api/lifecycle/reinspection/0/approve`,{
      method:"POST",headers:{authorization:`Bearer ${warehouse}`,"content-type":"application/json"},
      body:JSON.stringify({qualityApproverId:1,extensionMonths:1}),
    });
    expect(blocked.status).toBe(403);

    const quality=await login("QC_VN_01");
    const allowed=await fetch(`${apiBase}/api/lifecycle/reinspection/0/approve`,{
      method:"POST",headers:{authorization:`Bearer ${quality}`,"content-type":"application/json"},
      body:JSON.stringify({qualityApproverId:1,extensionMonths:1}),
    });
    expect(allowed.status).toBe(404);
  });
});
