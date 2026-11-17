import pg from "pg";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

const apiBase=process.env.WMS_API_BASE;
const live=process.env.RUN_WMS_CLOSED_LOOP_LIVE==="1"&&Boolean(apiBase);

describe.skipIf(!live)("WMS closed-loop governance",()=>{
  it("freezes, approves, hands over, receives, closes and preserves the audit chain",async()=>{
    const db=new pg.Pool({host:"127.0.0.1",database:"smt_factory",user:"postgres",password:"postgres"});
    const login=await fetch(`${apiBase}/api/auth/login`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username:"admin",password:"Factory@123"})});
    expect(login.ok).toBe(true);
    const token=(await login.json() as any).data.token;
    const headers={"content-type":"application/json",authorization:`Bearer ${token}`};
    const fixture=(await db.query(`
      SELECT m.id material_id,s.id supplier_id
      FROM materials m CROSS JOIN suppliers s
      ORDER BY m.id,s.id LIMIT 1`)).rows[0];
    const lot=(await db.query(`
      INSERT INTO material_lots(material_id,supplier_id,lot_no,received_qty,reserved_qty,iqc_status,lot_status,received_at)
      VALUES($1,$2,$3,10,0,'released','open',now())
      RETURNING id,lot_no,received_qty`,
      [fixture.material_id,fixture.supplier_id,`LOT-CLOSURE-${randomUUID().slice(0,8).toUpperCase()}`])).rows[0];
    let caseId:number|undefined;
    try{
      const post=async(path:string,body:unknown)=>{
        const response=await fetch(`${apiBase}${path}`,{method:"POST",headers,body:JSON.stringify(body)});
        const json=await response.json() as any;
        expect(response.ok,JSON.stringify(json)).toBe(true);
        return json.data.item;
      };
      const created=await post("/wms/closure/cases",{
        caseType:"INVENTORY_DIFFERENCE",entityType:"MATERIAL_LOT",entityKey:lot.lot_no,
        materialLotId:lot.id,expectedQty:Number(lot.received_qty),actualQty:Number(lot.received_qty)-1,
        reasonCode:"COUNT_MISMATCH",reasonDetail:"Closed-loop live acceptance",actorBadge:"WMS-LIVE-TEST",
      });
      caseId=Number(created.id);
      expect(created.status).toBe("PENDING_APPROVAL");
      expect((await db.query("SELECT status FROM wms_inventory_freezes WHERE case_id=$1",[caseId])).rows[0].status).toBe("ACTIVE");
      const operatorId=(await db.query("SELECT id FROM users ORDER BY id LIMIT 1")).rows[0].id;
      await expect(db.query(
        `INSERT INTO inventory_transactions(tx_no,action,material_lot_id,qty,operator_id,tx_status)
         VALUES($1,'RECEIVE',$2,1,$3,'posted')`,
        [`WMS-FROZEN-${caseId}`,lot.id,operatorId],
      )).rejects.toThrow(/WMS_INVENTORY_FROZEN/);
      const approved=await post(`/wms/closure/cases/${caseId}/decision`,{
        decision:"APPROVE",approvalRole:"WAREHOUSE_SUPERVISOR",actorBadge:"WMS-LIVE-SUP",comment:"Recount verified",
      });
      expect(approved.status).toBe("APPROVED");
      const sent=await post("/wms/closure/handovers",{
        caseId,entityType:"MATERIAL_LOT",entityKey:lot.lot_no,quantity:1,
        fromDomain:"RAW_MATERIAL",toDomain:"QUALITY",senderBadge:"WMS-LIVE-TEST",dueMinutes:15,
      });
      expect(sent.status).toBe("IN_TRANSIT");
      const received=await post(`/wms/closure/handovers/${sent.id}/receive`,{receiverBadge:"WMS-LIVE-QC"});
      expect(received.caseStatus).toBe("CLOSED");
      const state=(await db.query(`SELECT c.status,
        (SELECT status FROM wms_inventory_freezes WHERE case_id=c.id) freeze_status,
        (SELECT COUNT(*)::int FROM wms_closed_loop_audit WHERE case_id=c.id) audit_count
        FROM wms_closure_cases c WHERE c.id=$1`,[caseId])).rows[0];
      expect(state).toMatchObject({status:"CLOSED",freeze_status:"RELEASED",audit_count:4});
    }finally{
      if(caseId){
        for(const table of ["wms_closed_loop_audit","wms_inventory_freezes","wms_custody_handovers","wms_closure_approvals"]){
          await db.query(`DELETE FROM ${table} WHERE case_id=$1`,[caseId]);
        }
        await db.query("DELETE FROM wms_closure_cases WHERE id=$1",[caseId]);
      }
      await db.query("DELETE FROM material_lots WHERE id=$1",[lot.id]);
      await db.end();
    }
  });
});
