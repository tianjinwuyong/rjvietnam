const base = process.env.MES_BASE_URL || 'http://127.0.0.1:8080';

async function send(body) {
  const response = await fetch(`${base}/api/pda/events`, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify(body),
  });
  let data = {};
  try { data = await response.json(); } catch {}
  return {status: response.status, data};
}

const autoOk = await send({type:'AGENT_HEARTBEAT', stationCode:'auto_ict', domain:'auto', lineCode:'L002', payload:{status:'running'}});
const manualOk = await send({type:'AGENT_HEARTBEAT', stationCode:'manu_ict', domain:'manual', lineCode:'L004', payload:{status:'running'}});
const wrongDomain = await send({type:'SN_SCAN', stationCode:'auto_ict', domain:'manual', lineCode:'L002', payload:{sn:'DOMAIN-TEST-001'}});
const wrongLine = await send({type:'SN_SCAN', stationCode:'manu_fct', domain:'manual', lineCode:'L002', payload:{sn:'DOMAIN-TEST-002'}});
const crossWrite = await send({type:'SN_SCAN', stationCode:'auto_fct', domain:'auto', lineCode:'L002', payload:{sn:'DOMAIN-TEST-003', targetStationCode:'manu_depanel'}});

const checks = [
  ['auto own-domain accepted', autoOk.status < 400, autoOk],
  ['manual own-domain accepted', manualOk.status < 400, manualOk],
  ['wrong domain rejected', wrongDomain.status === 409, wrongDomain],
  ['wrong line rejected', wrongLine.status === 409, wrongLine],
  ['cross-domain write rejected', crossWrite.status === 409, crossWrite],
];
for (const [name, ok, result] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${name} HTTP ${result.status}`);
if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
