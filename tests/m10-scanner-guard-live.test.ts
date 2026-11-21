import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";

const apiBase=process.env.WMS_API_BASE;
const live=process.env.RUN_M10_SCANNER_LIVE==="1"&&Boolean(apiBase);

describe.skipIf(!live)("M10 scanner guard contract",()=>{
  it("checks without SN registration and blocks unknown or station-jumping SNs",async()=>{
    const pool=new pg.Pool({host:"127.0.0.1",port:5432,user:"postgres",password:"postgres",database:"smt_factory"});
    const sn=`SCAN-GUARD-${randomUUID().slice(0,10).toUpperCase()}`;
    try{
      const login=await fetch(`${apiBase}/api/auth/login`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username:"admin",password:"Factory@123"})});
      expect(login.ok).toBe(true);
      const token=(await login.json() as any).data.token;
      const headers={authorization:`Bearer ${token}`,"content-type":"application/json"};
      const send=(stationCode:string)=>fetch(`${apiBase}/api/pda/events`,{method:"POST",headers,body:JSON.stringify({
        from:stationCode,to:"mes_server",type:"SCAN_GUARD_CHECK",stationCode,
        payload:{sn,pcbSerial:sn,result:"CLEAR",operator:"M10_SCANNER_TEST",scannedAt:Date.now()},
      })});

      const first=await send("manu_pda");
      expect(first.status,await first.clone().text()).toBe(409);
      expect((await first.json() as any).code).toBe("UNKNOWN_SN");
      const registeredAfterFirst=await pool.query(`SELECT
        (SELECT count(*)::int FROM station_sn_registry WHERE UPPER(sn)=UPPER($1)) station_count,
        (SELECT count(*)::int FROM factory_sn_master WHERE UPPER(sn)=UPPER($1)) factory_count,
        (SELECT count(*)::int FROM station_sn_route_progress WHERE UPPER(source_sn)=UPPER($1)) route_count`,[sn]);
      expect(registeredAfterFirst.rows[0]).toMatchObject({station_count:0,factory_count:0,route_count:0});

      const jumped=await send("manu_ict");
      expect(jumped.status,await jumped.clone().text()).toBe(409);
      const body=await jumped.json() as any;
      expect(body.code).toBe("OUT_OF_SEQUENCE");
      expect(body.blocked).toBe(true);
      expect(body.missingUpstreamStations.length).toBeGreaterThan(0);

      const registeredAfterJump=await pool.query(`SELECT
        (SELECT count(*)::int FROM station_sn_registry WHERE UPPER(sn)=UPPER($1)) station_count,
        (SELECT count(*)::int FROM factory_sn_master WHERE UPPER(sn)=UPPER($1)) factory_count`,[sn]);
      expect(registeredAfterJump.rows[0]).toMatchObject({station_count:0,factory_count:0});
    }finally{
      await pool.query("DELETE FROM station_interception_events WHERE UPPER(sn)=UPPER($1)",[sn]);
      await pool.query("DELETE FROM canonical_sn_trace_events WHERE UPPER(sn)=UPPER($1)",[sn]);
      await pool.query("DELETE FROM station_sn_route_progress WHERE UPPER(source_sn)=UPPER($1) OR UPPER(root_sn)=UPPER($1)",[sn]);
      await pool.query("DELETE FROM station_sn_identity_alias WHERE UPPER(alias_sn)=UPPER($1) OR UPPER(root_sn)=UPPER($1)",[sn]);
      await pool.query("DELETE FROM station_sn_registry WHERE UPPER(sn)=UPPER($1)",[sn]);
      await pool.query("DELETE FROM factory_sn_master WHERE UPPER(sn)=UPPER($1)",[sn]);
      await pool.end();
    }
  });
});
