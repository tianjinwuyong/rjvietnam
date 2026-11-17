import 'dotenv/config';
import { query } from '../services/api/src/db.js';
import { AUTO_STATIONS, CANONICAL_LINES, canonicalStationId } from '../services/api/src/shared/station-identity.js';

const BASE='http://127.0.0.1:8080';
const SN=`AUTO-NG-GUARD-${Date.now()}`;
const stations=AUTO_STATIONS.filter(s=>s.code!=='auto_pda');
let failures=0;
async function call(path,options){
  try{const response=await fetch(BASE+path,{...options,signal:AbortSignal.timeout(10000)});return {status:response.status,body:await response.json().catch(()=>({}))};}
  catch(error){return {status:-1,body:{message:String(error)}};}
}
try{
  await query(`INSERT INTO ng_defect_records(line_name,station_code,sn,result,error_code,defect_code,defect_desc,source,operator,repair_status)
    VALUES('L002','auto_ict',$1,'fail','TEST-AUTO-NG','TEST-AUTO-NG','controlled automatic-line guard audit','system_test','CODEX','pending')`,[SN]);
  for(const station of stations){
    const scan=await call('/api/pda/events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      from:'auto_ng_guard_audit',to:'mes_server',type:'SCAN_GUARD_CHECK',lineCode:'L002',stationCode:station.code,
      payload:{sn:SN,pcbSerial:SN,result:'CLEAR',lineCode:'L002',sourceType:'controlled_test'}})});
    const blocked=scan.status>=400||scan.body?.blocked===true||/BLOCK|NG/i.test(String(scan.body?.code||scan.body?.message||scan.body?.error?.message||''));
    if(!blocked)failures++;
    console.log(`${blocked?'PASS':'FAIL'} ${canonicalStationId(CANONICAL_LINES.AUTO,station.code)} scan=${scan.status} ${scan.body?.code||''}`);
  }
}finally{
  await query(`DELETE FROM ng_defect_records WHERE sn=$1 AND source='system_test'`,[SN]);
  await query(`DELETE FROM station_data_staging WHERE raw_payload::text LIKE $1`,[`%${SN}%`]).catch(()=>{});
  console.log(`Cleanup complete: ${SN}`);
}
if(failures)process.exitCode=1;
