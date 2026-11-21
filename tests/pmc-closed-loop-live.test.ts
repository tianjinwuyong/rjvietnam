import pg from "pg";
import {describe,expect,it} from "vitest";

const apiBase=process.env.PMC_API_BASE;
const live=process.env.RUN_PMC_CLOSED_LOOP_LIVE==="1"&&Boolean(apiBase);

describe.skipIf(!live)("PMC end-to-end closed loop",()=>{
  it("closes demand, plan, reviews, approvals, expedite and work order with domain classification",async()=>{
    const db=new pg.Pool({host:"127.0.0.1",database:"smt_factory",user:"postgres",password:"postgres"});
    const login=await fetch(`${apiBase}/api/auth/login`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username:"admin",password:"Factory@123"})});
    expect(login.ok).toBe(true);
    const token=(await login.json() as any).data.token,headers={"content-type":"application/json",authorization:`Bearer ${token}`};
    const fixture=(await db.query(`SELECT p.id product_id,b.id bom_id,l.id line_id,l.numeric_line_code FROM products p
      JOIN boms b ON b.product_id=p.id AND b.status='active' CROSS JOIN LATERAL(SELECT id,numeric_line_code FROM production_lines ORDER BY id LIMIT 1)l
      ORDER BY p.id LIMIT 1`)).rows[0];
    expect(fixture).toBeTruthy();
    const woCode=(await db.query("SELECT allocate_work_order_code(1,$1,NULL) code",[fixture.numeric_line_code])).rows[0].code;
    const wo=(await db.query(`INSERT INTO work_orders(code,product_id,line_id,work_order_type,planned_qty,completed_qty,status,bom_id,order_source)
      VALUES($1,$2,$3,1,10,10,'draft',$4,'PMC_TEST') RETURNING id`,[woCode,fixture.product_id,fixture.line_id,fixture.bom_id])).rows[0];
    let demandId:number|undefined,planId:number|undefined,expediteId:number|undefined,changeId:number|undefined;
    try{
      const post=async(path:string,body:unknown)=>{
        const response=await fetch(`${apiBase}${path}`,{method:"POST",headers,body:JSON.stringify(body)});
        expect(response.headers.get("x-api-domain")).toBe("PMC");
        const json=await response.json() as any;expect(response.ok,JSON.stringify(json)).toBe(true);return json.data.item;
      };
      const demand=await post("/pmc/demands",{sourceType:"SALES_ORDER",sourceRef:"SO-LIVE",productId:fixture.product_id,requiredQty:10,requiredDate:"2099-12-20",priorityCode:"P1",reason:"PMC closed-loop acceptance",actor:"PMC"});
      demandId=Number(demand.id);
      const plan=await post("/pmc/plans",{demandId,plannedQty:10,plannedStartAt:"2099-12-01T08:00:00Z",plannedFinishAt:"2099-12-02T08:00:00Z",lineId:fixture.line_id,actor:"PMC"});
      planId=Number(plan.id);
      for(const reviewType of ["CAPACITY","MATERIAL","BOM","QUALITY","COST","DELIVERY"]){
        await post(`/pmc/plans/${planId}/reviews`,{reviewType,result:"PASS",detail:{accepted:true},actor:reviewType});
      }
      await post(`/pmc/plans/${planId}/decision`,{approvalRole:"PMC_MANAGER",decision:"APPROVE",actor:"PMC_MANAGER",comment:"Plan ready"});
      expect((await post(`/pmc/plans/${planId}/decision`,{approvalRole:"PRODUCTION_MANAGER",decision:"APPROVE",actor:"PRODUCTION_MANAGER",comment:"Capacity confirmed"})).status).toBe("APPROVED");
      expect((await post(`/pmc/plans/${planId}/bind-work-order`,{workOrderCode:woCode,kitReady:true,actor:"PMC"})).status).toBe("KIT_READY");
      expect((await post(`/pmc/plans/${planId}/release-to-mes`,{actor:"PMC_MANAGER"})).status).toBe("RELEASED_TO_MES");

      const change=await post(`/pmc/work-orders/${woCode}/change-requests`,{changeType:"PRIORITY",proposedChange:{priority:1},reason:"Closed-loop approval test",actor:"PMC"});
      changeId=Number(change.id);
      await post(`/pmc/work-order-changes/${changeId}/decision`,{approvalRole:"PMC_MANAGER",decision:"APPROVE",actor:"PMC_MANAGER"});
      expect((await post(`/pmc/work-order-changes/${changeId}/decision`,{approvalRole:"PRODUCTION_MANAGER",decision:"APPROVE",actor:"PRODUCTION_MANAGER"})).status).toBe("APPROVED");
      expect((await post(`/pmc/work-order-changes/${changeId}/apply`,{actor:"PMC_MANAGER"})).status).toBe("APPLIED");

      const expedite=await post("/pmc/expedites",{planId,productId:fixture.product_id,requestedQty:5,requiredFinishAt:"2099-11-30T08:00:00Z",reason:"Urgent customer recovery",lineId:fixture.line_id,materialReady:true,estimatedDelayMinutes:30,actor:"PMC"});
      expediteId=Number(expedite.id);
      for(const role of ["PMC_MANAGER","PRODUCTION_MANAGER"]){
        const result=await post(`/pmc/expedites/${expediteId}/decision`,{approvalRole:role,decision:"APPROVE",actor:role,comment:"Impact accepted"});
        if(role==="PRODUCTION_MANAGER")expect(result.status).toBe("APPROVED");
      }
      const closure=await post(`/pmc/work-orders/${woCode}/closure-check`,{materialReconciled:true,qualityClosed:true,handoversClosed:true,finishedGoodsReceived:true,costSettled:true,actor:"PMC"});
      expect(closure.checks.every((x:any)=>x.result==="PASS")).toBe(true);
      expect((await post(`/pmc/work-orders/${woCode}/close-controlled`,{actor:"PMC_MANAGER"})).status).toBe("closed");
      const final=(await db.query(`SELECT d.status demand_status,p.status plan_status,w.status wo_status,
        (SELECT COUNT(*)::int FROM pmc_governance_audit) audit_count
        FROM pmc_demands d JOIN pmc_master_plans p ON p.demand_id=d.id
        JOIN pmc_plan_work_orders pw ON pw.plan_id=p.id JOIN work_orders w ON w.id=pw.work_order_id WHERE d.id=$1`,[demandId])).rows[0];
      expect(final).toMatchObject({demand_status:"CLOSED",plan_status:"CLOSED",wo_status:"closed"});
      expect(final.audit_count).toBeGreaterThanOrEqual(12);
    }finally{
      if(expediteId){
        await db.query("DELETE FROM pmc_schedule_impacts WHERE expedite_request_id=$1",[expediteId]);
        await db.query("DELETE FROM pmc_expedite_approvals WHERE request_id=$1",[expediteId]);
        await db.query("DELETE FROM pmc_governance_audit WHERE entity_type='EXPEDITE' AND entity_id=$1",[expediteId]);
        await db.query("DELETE FROM pmc_expedite_requests WHERE id=$1",[expediteId]);
      }
      if(changeId){
        await db.query("DELETE FROM pmc_work_order_change_approvals WHERE request_id=$1",[changeId]);
        await db.query("DELETE FROM pmc_work_order_change_requests WHERE id=$1",[changeId]);
      }
      await db.query("DELETE FROM pmc_work_order_closure_checks WHERE work_order_id=$1",[wo.id]);
      await db.query("DELETE FROM pmc_governance_audit WHERE (entity_type='WORK_ORDER' AND entity_id=$1) OR (entity_type='PLAN' AND entity_id=$2) OR (entity_type='DEMAND' AND entity_id=$3)",[wo.id,planId??0,demandId??0]);
      await db.query("DELETE FROM pmc_plan_work_orders WHERE work_order_id=$1",[wo.id]);
      if(planId){await db.query("DELETE FROM pmc_plan_approvals WHERE plan_id=$1",[planId]);await db.query("DELETE FROM pmc_plan_reviews WHERE plan_id=$1",[planId]);await db.query("DELETE FROM pmc_master_plans WHERE id=$1",[planId]);}
      if(demandId)await db.query("DELETE FROM pmc_demands WHERE id=$1",[demandId]);
      await db.query("DELETE FROM work_orders WHERE id=$1",[wo.id]);
      await db.query("DELETE FROM work_order_code_allocations WHERE code=$1",[woCode]);
      await db.end();
    }
  });
});
