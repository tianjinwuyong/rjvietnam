import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";

const apiBase=process.env.WMS_API_BASE;
const live=process.env.RUN_M10_OFFLINE_LIVE==="1"&&Boolean(apiBase);

describe.skipIf(!live)("M10 accelerated 20-minute offline recovery",()=>{
  it("persists, retries, acknowledges and replays one canonical event without duplication",async()=>{
    const pool=new pg.Pool({host:"127.0.0.1",port:5432,user:"postgres",password:"postgres",database:"smt_factory"});
    const eventId=`M10-OFFLINE-${randomUUID().slice(0,10)}`;
    const consumerNode=`WMS_${eventId}`;
    try{
      const login=await fetch(`${apiBase}/api/auth/login`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username:"admin",password:"Factory@123"})});
      expect(login.ok).toBe(true);
      const token=(await login.json() as any).data.token;
      const headers={authorization:`Bearer ${token}`,"content-type":"application/json"};
      const event={eventId,direction:"MES_TO_WMS",owner:"MES",eventType:"WORK_ORDER_RELEASED",entityType:"WORK_ORDER",entityKey:eventId,sourceNode:"MES",destinationNode:consumerNode,payload:{status:"released",offlineDrill:true}};
      const created=await fetch(`${apiBase}/wms/mes-exchange/events`,{method:"POST",headers,body:JSON.stringify(event)});
      expect(created.status,await created.clone().text()).toBe(201);

      const claimed=await fetch(`${apiBase}/wms/mes-exchange/claim`,{method:"POST",headers,body:JSON.stringify({consumerNode,limit:200})});
      expect(claimed.ok).toBe(true);
      expect(((await claimed.json() as any).data.items as any[]).filter(x=>x.event_id===eventId)).toHaveLength(1);
      expect((await fetch(`${apiBase}/wms/mes-exchange/events/${eventId}/fail`,{method:"POST",headers,body:JSON.stringify({error:"controlled network interruption"})})).status).toBe(200);

      await pool.query(`UPDATE mes_wms_exchange_events SET created_at=now()-interval '20 minutes',next_attempt_at=now() WHERE event_id=$1`,[eventId]);
      const reclaimed=await fetch(`${apiBase}/wms/mes-exchange/claim`,{method:"POST",headers,body:JSON.stringify({consumerNode,limit:200})});
      expect(reclaimed.ok).toBe(true);
      expect(((await reclaimed.json() as any).data.items as any[]).filter(x=>x.event_id===eventId)).toHaveLength(1);
      expect((await fetch(`${apiBase}/wms/mes-exchange/events/${eventId}/acknowledge`,{method:"POST",headers,body:JSON.stringify({consumerNode})})).status).toBe(200);

      const duplicate=await fetch(`${apiBase}/wms/mes-exchange/events`,{method:"POST",headers,body:JSON.stringify(event)});
      expect(duplicate.status).toBe(201);
      const rows=await pool.query("SELECT delivery_state,attempt_count,count(*) OVER()::int AS copies FROM mes_wms_exchange_events WHERE event_id=$1",[eventId]);
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0].delivery_state).toBe("ACKNOWLEDGED");
      expect(Number(rows.rows[0].attempt_count)).toBeGreaterThanOrEqual(2);
      expect(Number(rows.rows[0].copies)).toBe(1);

      const replay=await fetch(`${apiBase}/wms/mes-exchange/replay?destinationNode=${encodeURIComponent(consumerNode)}`,{headers});
      expect(replay.ok).toBe(true);
      expect(((await replay.json() as any).data.items as any[]).filter(x=>x.event_id===eventId)).toHaveLength(1);
    }finally{
      await pool.query("DELETE FROM mes_wms_exchange_conflicts WHERE event_id=$1",[eventId]);
      await pool.query("DELETE FROM mes_wms_exchange_events WHERE event_id=$1",[eventId]);
      await pool.end();
    }
  });
});
