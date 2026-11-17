import pg from "pg";

const pool=new pg.Pool({
  host:process.env.PGHOST||"127.0.0.1",port:Number(process.env.PGPORT||5432),
  user:process.env.PGUSER||"postgres",password:process.env.PGPASSWORD||"postgres",
  database:process.env.PGDATABASE||"smt_factory",
});
const actor=process.env.M10_CLEANUP_ACTOR||"M10_AUTOMATED_ACCEPTANCE";
const startedAt=new Date();
const client=await pool.connect();
const probes={
  exchange:`SELECT count(*)::int n FROM mes_wms_exchange_events WHERE event_id LIKE 'M8-%' OR event_id LIKE 'M10-%'`,
  conflicts:`SELECT count(*)::int n FROM mes_wms_exchange_conflicts WHERE event_id LIKE 'M8-%' OR event_id LIKE 'M10-%'`,
  trace:`SELECT count(*)::int n FROM canonical_sn_trace_events WHERE sn LIKE 'M7-%' OR sn LIKE 'SCAN-GUARD-%'`,
  interceptions:`SELECT count(*)::int n FROM station_interception_events WHERE sn LIKE 'M7-%' OR sn LIKE 'SCAN-GUARD-%'`,
  residence:`SELECT count(*)::int n FROM station_product_residence WHERE sn LIKE 'M7-%'`,
  route:`SELECT count(*)::int n FROM station_sn_route_progress WHERE root_sn LIKE 'M7-%' OR source_sn LIKE 'M7-%' OR root_sn LIKE 'SCAN-GUARD-%' OR source_sn LIKE 'SCAN-GUARD-%'`,
  lots:`SELECT count(*)::int n FROM material_lots WHERE lot_no LIKE 'QA-M4-%' OR lot_no LIKE 'M6-%'`,
  requisitions:`SELECT count(*)::int n FROM requisitions WHERE doc_no LIKE 'REQ-M5-%'`,
};
async function counts(){const result={};for(const[name,sql]of Object.entries(probes))result[name]=(await client.query(sql)).rows[0].n;return result;}
try{
  await client.query("BEGIN");
  const before=await counts();
  const deleted={};
  const statements={
    conflicts:`DELETE FROM mes_wms_exchange_conflicts WHERE event_id LIKE 'M8-%' OR event_id LIKE 'M10-%'`,
    exchange:`DELETE FROM mes_wms_exchange_events WHERE event_id LIKE 'M8-%' OR event_id LIKE 'M10-%'`,
    interceptions:`DELETE FROM station_interception_events WHERE sn LIKE 'M7-%' OR sn LIKE 'SCAN-GUARD-%'`,
    trace:`DELETE FROM canonical_sn_trace_events WHERE sn LIKE 'M7-%' OR sn LIKE 'SCAN-GUARD-%'`,
    residence:`DELETE FROM station_product_residence WHERE sn LIKE 'M7-%'`,
    route:`DELETE FROM station_sn_route_progress WHERE root_sn LIKE 'M7-%' OR source_sn LIKE 'M7-%' OR root_sn LIKE 'SCAN-GUARD-%' OR source_sn LIKE 'SCAN-GUARD-%'`,
    aliases:`DELETE FROM station_sn_identity_alias WHERE root_sn LIKE 'M7-%' OR alias_sn LIKE 'M7-%' OR root_sn LIKE 'SCAN-GUARD-%' OR alias_sn LIKE 'SCAN-GUARD-%'`,
  };
  for(const[name,sql]of Object.entries(statements))deleted[name]=(await client.query(sql)).rowCount||0;
  const after=await counts();
  const remaining=Object.values(after).reduce((sum,value)=>sum+Number(value),0);
  await client.query(`INSERT INTO system_test_cleanup_audit(cleanup_scope,actor,started_at,before_counts,deleted_counts,after_counts,result,detail)
    VALUES('M4-M10_ACCEPTANCE_PREFIXES',$1,$2,$3,$4,$5,$6,$7)`,[actor,startedAt,JSON.stringify(before),JSON.stringify(deleted),JSON.stringify(after),remaining===0?'PASS':'FAIL',JSON.stringify({prefixes:['QA-M4-','REQ-M5-','M6-','M7-','M8-','M10-','SCAN-GUARD-'],productionWildcard:false})]);
  if(remaining!==0)throw new Error(`cleanup residue remains: ${JSON.stringify(after)}`);
  await client.query("COMMIT");
  console.log(JSON.stringify({ok:true,before,deleted,after},null,2));
}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();await pool.end();}
