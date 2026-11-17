import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";

const apiBase=process.env.WMS_API_BASE;
const live=process.env.RUN_MES_WMS_M8_LIVE==="1"&&Boolean(apiBase);

describe.skipIf(!live)("M8 resilient MES/WMS exchange",()=>{
  it("deduplicates replay, detects payload conflict, retries and resumes by cursor",async()=>{
    const pool=new pg.Pool({host:"127.0.0.1",port:5432,user:"postgres",password:"postgres",database:"smt_factory"});
    const id=`M8-${randomUUID().slice(0,10)}`,entity=`WO-${id}`,consumerNode=`WMS_${id}`;let conflictId:number|undefined;
    try{
      const login=await fetch(`${apiBase}/api/auth/login`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username:"admin",password:"Factory@123"})});
      const token=(await login.json() as any).data.token,headers={authorization:`Bearer ${token}`,"content-type":"application/json"};
      const event={eventId:id,direction:"MES_TO_WMS",owner:"MES",eventType:"WORK_ORDER_RELEASED",entityType:"WORK_ORDER",entityKey:entity,sourceNode:"MES",destinationNode:consumerNode,payload:{status:"released",revision:1}};
      const post=(body:any)=>fetch(`${apiBase}/wms/mes-exchange/events`,{method:"POST",headers,body:JSON.stringify(body)});
      expect((await post(event)).status).toBe(201);expect((await post(event)).status).toBe(201);
      const conflict=await post({...event,payload:{status:"cancelled",revision:2}});expect(conflict.status).toBe(409);
      conflictId=Number((await pool.query("SELECT id FROM mes_wms_exchange_conflicts WHERE event_id=$1 AND status='PENDING'",[id])).rows[0].id);
      expect((await fetch(`${apiBase}/wms/mes-exchange/conflicts/${conflictId}/decision`,{method:"POST",headers,body:JSON.stringify({decision:"KEEP_EXISTING",reason:"producer history is canonical"})})).status).toBe(200);
      const claim=await fetch(`${apiBase}/wms/mes-exchange/claim`,{method:"POST",headers,body:JSON.stringify({consumerNode,limit:10})});
      expect(claim.ok).toBe(true);expect(((await claim.json() as any).data.items as any[]).some(x=>x.event_id===id)).toBe(true);
      expect((await fetch(`${apiBase}/wms/mes-exchange/events/${id}/fail`,{method:"POST",headers,body:JSON.stringify({error:"simulated network break"})})).status).toBe(200);
      await pool.query("UPDATE mes_wms_exchange_events SET next_attempt_at=now() WHERE event_id=$1",[id]);
      expect((await fetch(`${apiBase}/wms/mes-exchange/claim`,{method:"POST",headers,body:JSON.stringify({consumerNode,limit:10})})).ok).toBe(true);
      expect((await fetch(`${apiBase}/wms/mes-exchange/events/${id}/acknowledge`,{method:"POST",headers,body:JSON.stringify({consumerNode})})).status).toBe(200);
      const replay=await fetch(`${apiBase}/wms/mes-exchange/replay?destinationNode=${encodeURIComponent(consumerNode)}`,{headers});expect(replay.ok).toBe(true);
      expect(((await replay.json() as any).data.items as any[]).some(x=>x.event_id===id)).toBe(true);
      const row=(await pool.query("SELECT delivery_state,attempt_count,last_error FROM mes_wms_exchange_events WHERE event_id=$1",[id])).rows[0];
      expect(row.delivery_state).toBe("ACKNOWLEDGED");expect(Number(row.attempt_count)).toBeGreaterThanOrEqual(2);expect(row.last_error).toBeNull();
    }finally{
      await pool.query("DELETE FROM mes_wms_exchange_conflicts WHERE event_id=$1",[id]);
      await pool.query("DELETE FROM mes_wms_exchange_events WHERE event_id=$1",[id]);await pool.end();
    }
  });
});
