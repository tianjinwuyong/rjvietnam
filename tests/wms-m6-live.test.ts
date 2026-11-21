import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";

const apiBase=process.env.WMS_API_BASE;
const live=process.env.RUN_WMS_M6_LIVE==="1"&&Boolean(apiBase);

describe.skipIf(!live)("M6 material lifetime enforcement",()=>{
  it("isolates expired stock and only an approved passing report can extend it",async()=>{
    const pool=new pg.Pool({host:"127.0.0.1",port:5432,user:"postgres",password:"postgres",database:"smt_factory"});
    const suffix=randomUUID().slice(0,8).toUpperCase();let lotId:number|undefined,failedId:number|undefined,passedId:number|undefined;
    try{
      const login=await fetch(`${apiBase}/api/auth/login`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username:"admin",password:"Factory@123"})});
      expect(login.ok).toBe(true);const token=(await login.json() as any).data.token;
      const headers={authorization:`Bearer ${token}`,"content-type":"application/json"};
      const material=(await pool.query("SELECT id FROM materials WHERE status='active' ORDER BY id LIMIT 1")).rows[0];
      const supplier=(await pool.query("SELECT id FROM suppliers ORDER BY id LIMIT 1")).rows[0];
      const approver=(await pool.query("SELECT id FROM hr_employees ORDER BY id LIMIT 1")).rows[0];
      expect(approver).toBeTruthy();
      const lotNo=`M6-EXP-${suffix}`;
      lotId=Number((await pool.query(`INSERT INTO material_lots(material_id,supplier_id,lot_no,received_qty,reserved_qty,iqc_status,lot_status,received_at,expiry_date)
        VALUES($1,$2,$3,10,0,'released','open',now(),CURRENT_DATE-1) RETURNING id`,[material.id,supplier.id,lotNo])).rows[0].id);
      const classified=(await pool.query("SELECT * FROM wms_refresh_material_lifecycle()")).rows[0];
      expect(Number(classified.isolated_count)).toBeGreaterThanOrEqual(1);
      expect((await pool.query("SELECT lifecycle_status FROM material_lots WHERE id=$1",[lotId])).rows[0].lifecycle_status).toBe("EXPIRED_ISOLATED");

      const transfer=await fetch(`${apiBase}/wms/transactions`,{method:"POST",headers,body:JSON.stringify({action:"TRANSFER",lotNo,qty:1,toLocation:"DOES-NOT-MATTER",operator:"admin"})});
      expect(transfer.status).toBe(409);

      const failed=await fetch(`${apiBase}/api/lifecycle/reinspection`,{method:"POST",headers,body:JSON.stringify({lotNo,testItems:"appearance",testResults:"fail",pass:false,disposalAdvice:"isolate"})});
      expect(failed.status,await failed.clone().text()).toBe(201);failedId=Number((await failed.json() as any).data.id);
      expect((await fetch(`${apiBase}/api/lifecycle/reinspection/${failedId}/approve`,{method:"POST",headers,body:JSON.stringify({qualityApproverId:approver.id,extensionMonths:1})})).status).toBe(409);

      const passed=await fetch(`${apiBase}/api/lifecycle/reinspection`,{method:"POST",headers,body:JSON.stringify({lotNo,testItems:"appearance,solderability",testResults:"pass",pass:true,disposalAdvice:"extend"})});
      expect(passed.status,await passed.clone().text()).toBe(201);passedId=Number((await passed.json() as any).data.id);
      const approved=await fetch(`${apiBase}/api/lifecycle/reinspection/${passedId}/approve`,{method:"POST",headers,body:JSON.stringify({qualityApproverId:approver.id,extensionMonths:1,notes:"M6 acceptance"})});
      expect(approved.status,await approved.clone().text()).toBe(200);
      const lot=(await pool.query("SELECT expiry_date,lifecycle_status FROM material_lots WHERE id=$1",[lotId])).rows[0];
      expect(lot.lifecycle_status).toBe("NORMAL");expect(new Date(lot.expiry_date).getTime()).toBeGreaterThan(Date.now());
      const report=(await pool.query("SELECT status,extended_expiry_date,quality_approved_by FROM material_reinspection WHERE id=$1",[passedId])).rows[0];
      expect(report.status).toBe("APPROVED");expect(Number(report.quality_approved_by)).toBe(Number(approver.id));
      expect((await pool.query("SELECT count(*)::int count FROM material_lifecycle_status_history WHERE material_lot_id=$1 AND source_type='REINSPECTION_REPORT' AND source_id=$2",[lotId,String(passedId)])).rows[0].count).toBe(1);
    }finally{
      if(lotId)await pool.query("DELETE FROM material_lifecycle_status_history WHERE material_lot_id=$1",[lotId]);
      if(lotId)await pool.query("DELETE FROM material_reinspection WHERE material_lot_id=$1",[lotId]);
      if(lotId)await pool.query("DELETE FROM material_lots WHERE id=$1",[lotId]);
      await pool.end();
    }
  });
});
