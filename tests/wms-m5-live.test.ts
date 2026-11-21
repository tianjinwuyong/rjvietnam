import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";

const apiBase=process.env.WMS_API_BASE;
const live=process.env.RUN_WMS_M5_LIVE==="1"&&Boolean(apiBase);

describe.skipIf(!live)("M5 reserve -> pick -> issue -> acknowledge -> consume/return",()=>{
  it("keeps the work-order material equation balanced and rejects duplicate or excess actions",async()=>{
    const pool=new pg.Pool({host:"127.0.0.1",port:5432,user:"postgres",password:"postgres",database:"smt_factory"});
    const suffix=randomUUID().slice(0,8).toUpperCase();let woId:number|undefined,lotId:number|undefined,expiredLotId:number|undefined,requisitionId:number|undefined,replenishmentId:number|undefined;
    try{
      const login=await fetch(`${apiBase}/api/auth/login`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username:"admin",password:"Factory@123"})});
      expect(login.ok).toBe(true);const token=(await login.json() as any).data.token;
      const headers={authorization:`Bearer ${token}`,"content-type":"application/json"};
      const bom=(await pool.query("SELECT id,product_id FROM boms WHERE status='active' ORDER BY id DESC LIMIT 1")).rows[0];
      const line=(await pool.query("SELECT id,numeric_line_code FROM production_lines WHERE numeric_line_code IS NOT NULL ORDER BY id LIMIT 1")).rows[0];
      const material=(await pool.query("SELECT material_id FROM bom_lines WHERE bom_id=$1 ORDER BY qty_per DESC,id LIMIT 1",[bom.id])).rows[0];
      const supplier=(await pool.query("SELECT id FROM suppliers ORDER BY id LIMIT 1")).rows[0];
      const code=(await pool.query("SELECT allocate_work_order_code(1::smallint,$1::char(2),10::bigint,now()) AS code",[line.numeric_line_code])).rows[0].code.trim();
      woId=Number((await pool.query(`INSERT INTO work_orders(code,product_id,line_id,work_order_type,planned_qty,status,released_at,created_by,bom_id)
        VALUES($1,$2,$3,1,1000,'released',now(),10,$4) RETURNING id`,[code,bom.product_id,line.id,bom.id])).rows[0].id);
      await pool.query("SELECT freeze_work_order_bom_requirements($1)",[woId]);
      requisitionId=Number((await pool.query(`INSERT INTO requisitions(doc_no,status,work_order_code,work_order_id,line_code,requestor_name,created_by,approved_by,approved_at)
        VALUES($1,'APPROVED',$2,$3,$4,'QA',10,10,now()) RETURNING id`,[`REQ-M5-${suffix}`,code,woId,line.numeric_line_code])).rows[0].id);
      await pool.query(`INSERT INTO requisition_lines(requisition_id,material_id,material_code,requested_qty,approved_qty,line_status)
        SELECT $1,m.id,m.code,5,5,'APPROVED' FROM materials m WHERE m.id=$2`,[requisitionId,material.material_id]);
      lotId=Number((await pool.query(`INSERT INTO material_lots(material_id,supplier_id,lot_no,received_qty,reserved_qty,iqc_status,lot_status,received_at)
        VALUES($1,$2,$3,20,0,'released','open',now()) RETURNING id`,[material.material_id,supplier.id,`LOT-${code}`])).rows[0].id);
      expiredLotId=Number((await pool.query(`INSERT INTO material_lots(material_id,supplier_id,lot_no,received_qty,reserved_qty,iqc_status,lot_status,received_at,expiry_date)
        VALUES($1,$2,$3,20,0,'released','open',now(),CURRENT_DATE-1) RETURNING id`,[material.material_id,supplier.id,`EXP-${code}`])).rows[0].id);

      const expiredReserve=await fetch(`${apiBase}/wms/reservations`,{method:"POST",headers,body:JSON.stringify({lotNo:`EXP-${code}`,workOrderCode:code,qty:1,operator:"admin"})});
      expect(expiredReserve.status).toBe(409);
      expect((await fetch(`${apiBase}/wms/replenishment-requests`,{method:"POST",headers,body:JSON.stringify({workOrderCode:code,originalRequisitionId:-1,materialCode:"BAD",qty:1,reasonCode:"LOSS"})})).status).toBe(409);
      const replenishment=await fetch(`${apiBase}/wms/replenishment-requests`,{method:"POST",headers,body:JSON.stringify({workOrderCode:code,originalRequisitionId:requisitionId,materialCode:(await pool.query("SELECT code FROM materials WHERE id=$1",[material.material_id])).rows[0].code,qty:1,reasonCode:"LOSS",requestor:"QA"})});
      expect(replenishment.status,await replenishment.clone().text()).toBe(201);replenishmentId=Number((await replenishment.json() as any).data.item.id);

      const reserve=await fetch(`${apiBase}/wms/reservations`,{method:"POST",headers,body:JSON.stringify({lotNo:`LOT-${code}`,workOrderCode:code,qty:5,operator:"admin"})});
      expect(reserve.status,await reserve.clone().text()).toBe(201);const reservationId=Number((await reserve.json() as any).data.item.id);
      const duplicateReserve=await fetch(`${apiBase}/wms/reservations`,{method:"POST",headers,body:JSON.stringify({lotNo:`LOT-${code}`,workOrderCode:code,qty:1,operator:"admin"})});
      expect(duplicateReserve.status).toBe(409);
      const beforePick=await fetch(`${apiBase}/wms/issue-to-line`,{method:"POST",headers,body:JSON.stringify({lotNo:`LOT-${code}`,workOrderCode:code,reservationId,qty:5,operator:"admin"})});
      expect(beforePick.status).toBe(409);
      expect((await fetch(`${apiBase}/wms/reservations/${reservationId}/pick`,{method:"POST",headers,body:JSON.stringify({operator:"admin"})})).status).toBe(201);
      const issue=await fetch(`${apiBase}/wms/issue-to-line`,{method:"POST",headers,body:JSON.stringify({lotNo:`LOT-${code}`,workOrderCode:code,reservationId,qty:5,operator:"admin"})});
      expect(issue.status,await issue.clone().text()).toBe(201);const issueId=Number((await issue.json() as any).data.item.id);
      expect((await fetch(`${apiBase}/wms/issue-to-line`,{method:"POST",headers,body:JSON.stringify({lotNo:`LOT-${code}`,workOrderCode:code,reservationId,qty:5,operator:"admin"})})).status).toBe(409);
      expect((await fetch(`${apiBase}/wms/line-issues/${issueId}/acknowledge`,{method:"POST",headers,body:JSON.stringify({receiver:"admin"})})).status).toBe(201);
      expect((await fetch(`${apiBase}/wms/line-issues/${issueId}/acknowledge`,{method:"POST",headers,body:JSON.stringify({receiver:"admin"})})).status).toBe(409);
      expect((await fetch(`${apiBase}/wms/return-from-line`,{method:"POST",headers,body:JSON.stringify({lotNo:`LOT-${code}`,workOrderCode:code,qty:6,operator:"admin"})})).status).toBe(409);
      const returnResponse=await fetch(`${apiBase}/wms/return-from-line`,{method:"POST",headers,body:JSON.stringify({lotNo:`LOT-${code}`,workOrderCode:code,qty:2,operator:"admin",reason:"unused"})});
      expect(returnResponse.status,await returnResponse.clone().text()).toBe(201);
      const materialCode=(await pool.query("SELECT code FROM materials WHERE id=$1",[material.material_id])).rows[0].code;
      expect((await fetch(`${apiBase}/mes/work-orders/${woId}/bom-writeoffs`,{method:"POST",headers,body:JSON.stringify({materialCode,materialLotId:lotId,qty:2,stage:"PRODUCTION",actor:"QA"})})).status).toBe(201);
      const difference=await fetch(`${apiBase}/wms/work-orders/${code}/material-differences`,{method:"POST",headers,body:JSON.stringify({materialCode,differenceQty:1,reasonCode:"PROCESS_LOSS",reasonDetail:"M5 controlled test"})});
      expect(difference.status,await difference.clone().text()).toBe(201);const differenceId=Number((await difference.json() as any).data.item.id);
      expect((await fetch(`${apiBase}/wms/material-differences/${differenceId}/decision`,{method:"POST",headers,body:JSON.stringify({decision:"APPROVE"})})).status).toBe(200);
      const reconciliation=await fetch(`${apiBase}/wms/work-orders/${code}/material-reconciliation`,{headers});
      expect(reconciliation.ok).toBe(true);const result=(await reconciliation.json() as any).data;
      const target=result.items.find((row:any)=>row.material_code===materialCode);
      // A line return is quarantined as a closure case; it must not become
      // available stock or balance the WO until warehouse verification closes it.
      expect(target.balanced).toBe(false);expect(Number(target.issued_qty)).toBe(5);expect(Number(target.returned_qty)).toBe(0);expect(Number(target.consumed_qty)).toBe(2);expect(Number(target.approved_difference_qty)).toBe(1);
      const lot=(await pool.query("SELECT received_qty,reserved_qty FROM material_lots WHERE id=$1",[lotId])).rows[0];
      expect(Number(lot.received_qty)).toBe(15);expect(Number(lot.reserved_qty)).toBe(0);
      const recommendations=await fetch(`${apiBase}/wms/work-orders/${code}/lot-recommendations/${materialCode}`,{headers});
      expect(recommendations.ok).toBe(true);const recommended=(await recommendations.json() as any).data.items;
      expect(recommended.some((row:any)=>row.lotNo===`LOT-${code}`)).toBe(true);
      expect(recommended.some((row:any)=>row.lotNo===`EXP-${code}`)).toBe(false);
    }finally{
      if(woId){await pool.query("DELETE FROM line_issue_acknowledgements WHERE work_order_id=$1",[woId]);await pool.query("DELETE FROM work_order_material_differences WHERE work_order_id=$1",[woId]);await pool.query("DELETE FROM work_order_bom_writeoffs WHERE work_order_id=$1",[woId]);await pool.query("DELETE FROM inventory_transactions WHERE work_order_id=$1",[woId]);await pool.query("DELETE FROM material_lot_reservations WHERE work_order_id=$1",[woId]);}
      if(lotId){
        const closureIds=(await pool.query("SELECT id FROM wms_closure_cases WHERE material_lot_id=$1",[lotId])).rows.map((row)=>Number(row.id));
        if(closureIds.length){
          for(const table of ["wms_closed_loop_audit","wms_inventory_freezes","wms_custody_handovers","wms_closure_approvals"]){
            await pool.query(`DELETE FROM ${table} WHERE case_id=ANY($1::bigint[])`,[closureIds]);
          }
          await pool.query("DELETE FROM wms_closure_cases WHERE id=ANY($1::bigint[])",[closureIds]);
        }
      }
      if(replenishmentId)await pool.query("DELETE FROM replenishments WHERE id=$1",[replenishmentId]);
      if(requisitionId)await pool.query("DELETE FROM requisitions WHERE id=$1",[requisitionId]);
      if(woId)await pool.query("DELETE FROM work_order_bom_requirements WHERE work_order_id=$1",[woId]);
      if(lotId||expiredLotId)await pool.query("DELETE FROM material_lifecycle_status_history WHERE material_lot_id=ANY($1::bigint[])",[[lotId,expiredLotId].filter(Boolean)]);
      if(lotId)await pool.query("DELETE FROM material_lots WHERE id=$1",[lotId]);
      if(expiredLotId)await pool.query("DELETE FROM material_lots WHERE id=$1",[expiredLotId]);
      if(woId)await pool.query("DELETE FROM work_orders WHERE id=$1",[woId]);await pool.end();
    }
  });
});
