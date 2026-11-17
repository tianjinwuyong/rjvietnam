import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";

const apiBase=process.env.WMS_API_BASE;
const live=process.env.RUN_M10_BACKLOG_LIVE==="1"&&Boolean(apiBase);

describe.skipIf(!live)("M10 bounded exchange backlog",()=>{
  it("drains 120 events without loss or duplicate rows",async()=>{
    const pool=new pg.Pool({host:"127.0.0.1",port:5432,user:"postgres",password:"postgres",database:"smt_factory"});
    const prefix=`M10-LOAD-${randomUUID().slice(0,8)}`;
    const consumerNode=`WMS_${prefix}`;
    const ids=Array.from({length:120},(_,index)=>`${prefix}-${String(index+1).padStart(3,"0")}`);
    try{
      const login=await fetch(`${apiBase}/api/auth/login`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username:"admin",password:"Factory@123"})});
      expect(login.ok).toBe(true);
      const token=(await login.json() as any).data.token;
      const headers={authorization:`Bearer ${token}`,"content-type":"application/json"};
      for(let offset=0;offset<ids.length;offset+=12){
        const responses=await Promise.all(ids.slice(offset,offset+12).map(eventId=>fetch(`${apiBase}/wms/mes-exchange/events`,{method:"POST",headers,body:JSON.stringify({
          eventId,direction:"MES_TO_WMS",owner:"MES",eventType:"WORK_ORDER_RELEASED",entityType:"WORK_ORDER",
          entityKey:eventId,sourceNode:"MES",destinationNode:consumerNode,payload:{status:"released",loadTest:true},
        })})));
        const failed=await Promise.all(responses.filter(response=>response.status!==201).map(async response=>({
          status:response.status,body:await response.text(),
        })));
        expect(failed,`exchange write failures: ${JSON.stringify(failed)}`).toEqual([]);
      }
      const stored=await pool.query("SELECT count(*)::int count,count(DISTINCT event_id)::int distinct_count FROM mes_wms_exchange_events WHERE event_id LIKE $1",[`${prefix}-%`]);
      expect(stored.rows[0]).toMatchObject({count:120,distinct_count:120});

      const claim=await fetch(`${apiBase}/wms/mes-exchange/claim`,{method:"POST",headers,body:JSON.stringify({consumerNode,limit:200})});
      expect(claim.ok).toBe(true);
      const claimed=((await claim.json() as any).data.items as any[]).filter(item=>String(item.event_id).startsWith(prefix));
      expect(claimed).toHaveLength(120);
      for(let offset=0;offset<ids.length;offset+=12){
        const responses=await Promise.all(ids.slice(offset,offset+12).map(eventId=>fetch(`${apiBase}/wms/mes-exchange/events/${eventId}/acknowledge`,{method:"POST",headers,body:JSON.stringify({consumerNode})})));
        expect(responses.every(response=>response.status===200)).toBe(true);
      }
      const final=await pool.query("SELECT delivery_state,count(*)::int count FROM mes_wms_exchange_events WHERE event_id LIKE $1 GROUP BY delivery_state",[`${prefix}-%`]);
      expect(final.rows).toEqual([{delivery_state:"ACKNOWLEDGED",count:120}]);
    }finally{
      await pool.query("DELETE FROM mes_wms_exchange_conflicts WHERE event_id LIKE $1",[`${prefix}-%`]);
      await pool.query("DELETE FROM mes_wms_exchange_events WHERE event_id LIKE $1",[`${prefix}-%`]);
      await pool.end();
    }
  });
});
