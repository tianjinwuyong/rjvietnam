import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";

const apiBase=process.env.WMS_API_BASE;
const live=process.env.RUN_WMS_FINISHED_OUTBOUND_LIVE==="1"&&Boolean(apiBase);

describe.skipIf(!live)("WMS finished-goods outbound closed loop",()=>{
  it("reserves only available SNs and ships only with load evidence",async()=>{
    const db=new pg.Pool({host:"127.0.0.1",database:"smt_factory",user:"postgres",password:"postgres"});
    const key=randomUUID().slice(0,8).toUpperCase();
    const sn=`E2E-FG-${key}`,outboundNo=`E2E-OUT-${key}`;
    let orderId:number|undefined;
    try{
      const login=await fetch(`${apiBase}/api/auth/login`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username:"admin",password:"Factory@123"})});
      expect(login.ok).toBe(true);
      const headers={"content-type":"application/json",authorization:`Bearer ${(await login.json() as any).data.token}`};
      await db.query(`INSERT INTO wms_finished_goods
        (sn_no,work_order_no,material_code,material_name,production_date,qty,iqc_status,oqc_inspector,oqc_inspected_at,stored_at,stored_by,status)
        VALUES($1,'E2E-WO','E2E-PRODUCT','E2E Product',CURRENT_DATE,1,'passed','E2E-QC',NOW(),NOW(),'E2E-WMS','in_stock')`,[sn]);
      const created=await fetch(`${apiBase}/api/wms/outbound-orders`,{method:"POST",headers,body:JSON.stringify({
        outbound_no:outboundNo,customer_code:"E2E-CUSTOMER",customer_name:"E2E Customer",operator_id:"E2E-WMS",
      })});
      expect(created.status,await created.clone().text()).toBe(201);
      orderId=Number((await created.json() as any).id);
      const emptyShip=await fetch(`${apiBase}/api/wms/outbound-orders/${orderId}/ship`,{method:"PATCH",headers,body:JSON.stringify({logistics_no:"E2E-LOAD"})});
      expect(emptyShip.status).toBe(409);
      const added=await fetch(`${apiBase}/api/wms/outbound-orders/${orderId}/items`,{method:"POST",headers,body:JSON.stringify({
        sn_list:[{sn_no:sn,qty:1}],material_code:"E2E-PRODUCT",
      })});
      expect(added.ok,await added.clone().text()).toBe(true);
      expect((await db.query("SELECT status FROM wms_finished_goods WHERE sn_no=$1",[sn])).rows[0].status).toBe("reserved");
      const shipped=await fetch(`${apiBase}/api/wms/outbound-orders/${orderId}/ship`,{method:"PATCH",headers,body:JSON.stringify({
        logistics_no:`LOAD-${key}`,shipping_method:"E2E",
      })});
      expect(shipped.ok,await shipped.clone().text()).toBe(true);
      const state=(await db.query(`SELECT o.status order_status,fg.status sn_status
        FROM wms_outbound_orders o JOIN wms_outbound_items oi ON oi.outbound_order_id=o.id
        JOIN wms_finished_goods fg ON fg.sn_no=oi.sn_no WHERE o.id=$1`,[orderId])).rows[0];
      expect(state).toMatchObject({order_status:"shipped",sn_status:"shipped"});
    }finally{
      if(orderId)await db.query("DELETE FROM wms_outbound_items WHERE outbound_order_id=$1",[orderId]);
      if(orderId)await db.query("DELETE FROM wms_outbound_orders WHERE id=$1",[orderId]);
      await db.query("DELETE FROM wms_finished_goods WHERE sn_no=$1",[sn]);
      await db.end();
    }
  });
});
