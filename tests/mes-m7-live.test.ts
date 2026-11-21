import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";

const apiBase=process.env.WMS_API_BASE;
const live=process.env.RUN_MES_M7_LIVE==="1"&&Boolean(apiBase);

describe.skipIf(!live)("M7 SN station residence",()=>{
  it("opens the destination visit only after preserving and closing the upstream visit",async()=>{
    const pool=new pg.Pool({host:"127.0.0.1",port:5432,user:"postgres",password:"postgres",database:"smt_factory"});
    const sn=`M7-${randomUUID().slice(0,8).toUpperCase()}`,batchId=`B-${sn}`;
    try{
      const send=(stationCode:string)=>fetch(`${apiBase}/api/pda/events`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
        from:stationCode,to:"mes_server",type:"STATION_PROCESS_COMPLETED",stationCode,
        eventId:`${stationCode}-${sn}`,payload:{sn,batchId,result:"PASS",operator:"M7-QA"}
      })});
      expect((await send("manu_aio")).ok).toBe(true);
      await new Promise(r=>setTimeout(r,20));
      expect((await send("manu_ict")).ok).toBe(true);
      const rows=(await pool.query(`SELECT station_code,status,entered_at,exited_at,next_station_code,next_residence_id,duration_seconds
        FROM station_product_residence WHERE sn=$1 ORDER BY entered_at`,[sn])).rows;
      expect(rows).toHaveLength(2);
      expect(rows[0].station_code).toBe("manu_aio");expect(rows[0].status).toBe("LEFT_STATION");
      expect(rows[0].exited_at).toBeTruthy();expect(rows[0].next_station_code).toBe("manu_ict");expect(rows[0].next_residence_id).toBeTruthy();
      expect(rows[1].station_code).toBe("manu_ict");expect(rows[1].status).toBe("IN_STATION");expect(rows[1].exited_at).toBeNull();
      const stats=await fetch(`${apiBase}/api/station/residence-stats?stationCode=manu_ict`);
      expect(stats.ok).toBe(true);const body=await stats.json() as any;
      expect(body.current.some((x:any)=>x.sn===sn)).toBe(true);
    }finally{
      await pool.query("DELETE FROM canonical_sn_trace WHERE UPPER(sn)=UPPER($1)",[sn]).catch(()=>{});
      await pool.query("DELETE FROM station_product_residence WHERE sn=$1",[sn]);
      await pool.query("DELETE FROM station_sn_route_progress WHERE root_sn=$1 OR source_sn=$1",[sn]);
      await pool.query("DELETE FROM station_sn_identity_alias WHERE root_sn=$1 OR alias_sn=$1",[sn]);
      await pool.query("DELETE FROM station_data_staging WHERE raw_input::text ILIKE $1",[`%${sn}%`]).catch(()=>{});
      await pool.end();
    }
  });
});
