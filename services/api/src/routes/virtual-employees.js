// Factory virtual employees (/api/factory/virtual-employees/*), moved out of
// services/api/server.js.
//
// The platform half of the virtual-employee feature: per-employee triggers and state,
// config, training cases and runs, evaluations and their review, task dispatch and
// approval, the event audit trail, and the WeChat hook. The per-employee route groups
// that belong to WMS/IQC live with their own domains.
//
// Pure registrations -- the two module-level statements that follow this block in
// server.js (`receivingVirtualEmployeeInterval` and its setInterval) stay there.
import { mintServiceToken, serviceActorFor, validateGateForApproval, canHumanApprove, humanDomainPermission, hasServiceToken } from "../virtual-employees/service-identity.js";
import { capabilitiesFor, auditCapabilities, ALL_ROLE_IDS, MCP_SERVERS } from "../virtual-employees/capabilities.js";
import { FACTORY_VIRTUAL_EMPLOYEES } from "../virtual-employees/registry.js";
import { approveTask } from "../agent/approval.js";

export function registerVirtualEmployeeRoutes(app, deps) {
  const {
    query, requirePermission, envelope, errorEnvelope, mutateEnvelope, listEnvelope,
    factoryVirtualEmployeesReady, getFactoryVirtualEmployee, runWarehouseSafetyReport,
    WAREHOUSE_INVENTORY_EMPLOYEE_ID, PUTAWAY_RULES, rankPutawayLocations, buildPutawayPath,
    sendVirtualEmployeeWechat, neuralBroadcast, receivingQrRegistrationReady,
  } = deps;

app.post('/api/factory/virtual-employees/WMS-INVENTORY-VIRTUAL-01/safety-report/run-now',async(_req,res)=>{try{res.json(mutateEnvelope(await runWarehouseSafetyReport()));}catch(e){res.status(409).json(errorEnvelope('WAREHOUSE_SAFETY_REPORT_FAILED',e.message));}});
app.get('/api/factory/virtual-employees/WMS-INVENTORY-VIRTUAL-01/safety-reports',async(_req,res)=>{try{await factoryVirtualEmployeesReady;const reports=await query(`SELECT id,detail,created_at FROM factory_virtual_employee_events WHERE employee_id=$1 AND event_type='SAFETY_STOCK_REPORT_ISSUED' ORDER BY created_at DESC LIMIT 100`,[WAREHOUSE_INVENTORY_EMPLOYEE_ID]);res.json(listEnvelope(reports.rows));}catch(e){res.status(500).json(errorEnvelope('WAREHOUSE_SAFETY_REPORT_LIST_FAILED',e.message));}});
app.get('/api/factory/virtual-employees/WMS-INVENTORY-VIRTUAL-01/putaway-rules',requirePermission('wms.view'),(_req,res)=>res.json(listEnvelope(PUTAWAY_RULES)));
app.post('/api/factory/virtual-employees/WMS-INVENTORY-VIRTUAL-01/putaway-recommendations',requirePermission('wms.view'),async(req,res)=>{try{
  await factoryVirtualEmployeesReady;const p=req.body||{},lotId=Number(p.materialLotId||0),materialCode=String(p.materialCode||'').trim();
  if(!lotId&&!materialCode)return res.status(400).json(errorEnvelope('PUTAWAY_MATERIAL_REQUIRED','materialLotId or materialCode is required'));
  const material=(await query(`SELECT m.id,m.code,m.msd_level,m.storage_condition,ml.id AS lot_id,ml.lot_no,ml.iqc_status
    FROM materials m LEFT JOIN material_lots ml ON ml.material_id=m.id AND ($1::bigint=0 OR ml.id=$1)
    WHERE ($1::bigint>0 AND ml.id=$1) OR ($1::bigint=0 AND UPPER(m.code)=UPPER($2)) ORDER BY ml.created_at DESC NULLS LAST LIMIT 1`,[lotId,materialCode])).rows[0];
  if(!material)return res.status(404).json(errorEnvelope('PUTAWAY_MATERIAL_NOT_FOUND','material or lot not found'));
  const locations=(await query(`SELECT sl.id,sl.code,sl.status,w.code AS warehouse_code,w.status AS warehouse_status,z.code AS zone_code,z.status AS zone_status,z.zone_type,
    sl.allow_putaway,sl.locked_reason,sl.capacity_qty,sl.max_pallets,sl.length_cm,sl.width_cm,sl.height_cm,
    sl.floor_id,sl.position_code,sl.aisle_code,sl.cross_aisle_code,sl.aisle_side,sl.access_direction,sl.rack_code,sl.level_code,sl.bin_code,sl.x_coord,sl.y_coord,sl.z_coord,sl.orientation_deg,
    sl.capacity_uom,sl.max_weight_kg,sl.max_volume_m3,sl.max_stack_height,sl.route_node_id,sl.handling_equipment,sl.fire_zone_code,sl.esd_controlled,sl.hazardous_allowed,sl.cold_storage,
    COALESCE(sl.temperature_min,z.temperature_min) AS temperature_min,COALESCE(sl.temperature_max,z.temperature_max) AS temperature_max,
    COALESCE(sl.humidity_min,z.humidity_min) AS humidity_min,COALESCE(sl.humidity_max,z.humidity_max) AS humidity_max,sl.msd_allowed,
    COALESCE(SUM(CASE WHEN ml.lot_status IN('open','active') THEN ml.received_qty ELSE 0 END),0)::numeric AS occupied_qty,
    COUNT(DISTINCT ml.id) FILTER(WHERE ml.lot_status IN('open','active'))::int AS occupied_pallets,
    COUNT(DISTINCT ml.id) FILTER(WHERE ml.material_id=$1 AND ml.lot_status IN('open','active'))::int AS same_material_lots
    FROM storage_locations sl JOIN wms_warehouses w ON w.id=sl.warehouse_id JOIN wms_zones z ON z.id=sl.zone_id
    LEFT JOIN material_lots ml ON ml.storage_location_id=sl.id GROUP BY sl.id,w.code,w.status,z.code,z.status,z.zone_type,z.temperature_min,z.temperature_max,z.humidity_min,z.humidity_max ORDER BY sl.code`,[material.id])).rows;
  const goods={qty:Number(p.qty||0),palletCount:Number(p.palletCount||1),lengthCm:p.lengthCm,widthCm:p.widthCm,heightCm:p.heightCm,weightKg:p.weightKg,temperature:p.temperature,humidity:p.humidity,iqcStatus:String(p.iqcStatus||material.iqc_status||'pending'),msdLevel:material.msd_level,storageCondition:material.storage_condition};
  const source=p.sourceLocationCode?(await query(`SELECT code,x_coord,y_coord FROM storage_locations WHERE UPPER(code)=UPPER($1) LIMIT 1`,[String(p.sourceLocationCode)])).rows[0]||{}:{code:'RECEIVING_STAGING',x_coord:p.sourceXCoord,y_coord:p.sourceYCoord};
  const candidates=locations.map(row=>({id:row.id,code:row.code,status:row.status,warehouseCode:row.warehouse_code,warehouseStatus:row.warehouse_status,zoneCode:row.zone_code,zoneStatus:row.zone_status,zoneType:row.zone_type,floorId:row.floor_id,positionCode:row.position_code,aisleCode:row.aisle_code,crossAisleCode:row.cross_aisle_code,aisleSide:row.aisle_side,accessDirection:row.access_direction,rackCode:row.rack_code,levelCode:row.level_code,binCode:row.bin_code,xCoord:row.x_coord,yCoord:row.y_coord,zCoord:row.z_coord,orientationDeg:row.orientation_deg,routeNodeId:row.route_node_id,routeDistance:[source.x_coord,source.y_coord,row.x_coord,row.y_coord].every(value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value)))?Math.hypot(Number(row.x_coord)-Number(source.x_coord),Number(row.y_coord)-Number(source.y_coord)):null,allowPutaway:row.allow_putaway,lockedReason:row.locked_reason,capacityQty:row.capacity_qty,capacityUom:row.capacity_uom,maxPallets:row.max_pallets,maxWeightKg:row.max_weight_kg,maxVolumeM3:row.max_volume_m3,maxStackHeight:row.max_stack_height,lengthCm:row.length_cm,widthCm:row.width_cm,heightCm:row.height_cm,handlingEquipment:row.handling_equipment,fireZoneCode:row.fire_zone_code,esdControlled:row.esd_controlled,hazardousAllowed:row.hazardous_allowed,coldStorage:row.cold_storage,temperatureMin:row.temperature_min,temperatureMax:row.temperature_max,humidityMin:row.humidity_min,humidityMax:row.humidity_max,msdAllowed:row.msd_allowed,occupiedQty:row.occupied_qty,occupiedPallets:row.occupied_pallets,sameMaterialLots:row.same_material_lots,utilization:Number(row.capacity_qty)>0?Number(row.occupied_qty)/Number(row.capacity_qty):0,zoneStorageMatch:material.storage_condition?String(row.zone_type||'').toUpperCase().includes(String(material.storage_condition).toUpperCase()):false}));
  const recommendations=rankPutawayLocations(candidates,goods,p.limit||5).map(location=>({...location,path:buildPutawayPath(location,{code:source.code,xCoord:source.x_coord,yCoord:source.y_coord})})),warnings=[];if(p.weightKg!=null&&candidates.every(x=>x.maxWeightKg==null))warnings.push('LOCATION_WEIGHT_LIMIT_NOT_CONFIGURED');if(!recommendations.length)warnings.push('NO_ELIGIBLE_LOCATION');
  const output={employeeId:WAREHOUSE_INVENTORY_EMPLOYEE_ID,rulesVersion:'1.0.0',rules:PUTAWAY_RULES,material:{id:material.id,code:material.code,lotId:material.lot_id,lotNo:material.lot_no,iqcStatus:goods.iqcStatus,msdLevel:material.msd_level,storageCondition:material.storage_condition},goods,recommendations,warnings,approvalRequired:!recommendations.length};
  await query(`INSERT INTO factory_virtual_employee_events(employee_id,event_type,detail,actor) VALUES($1,'PUTAWAY_RECOMMENDATION_CREATED',$2::jsonb,$3)`,[WAREHOUSE_INVENTORY_EMPLOYEE_ID,JSON.stringify({materialCode:material.code,lotId:material.lot_id,recommendationCodes:recommendations.map(x=>x.code),warnings}),req.user?.username||WAREHOUSE_INVENTORY_EMPLOYEE_ID]);
  res.json(mutateEnvelope(output));
}catch(e){res.status(409).json(errorEnvelope('PUTAWAY_RECOMMENDATION_FAILED',e.message));}});
const warehouseSafetyReportInterval=Math.max(300000,Number(process.env.WAREHOUSE_SAFETY_REPORT_INTERVAL_MS||21600000));
setInterval(()=>{void runWarehouseSafetyReport().catch(error=>console.error('[WMS-INVENTORY-VIRTUAL-01]',error.message));},warehouseSafetyReportInterval);
app.put('/api/factory/virtual-employees/:id/config', async (req,res) => {
  try {
    await factoryVirtualEmployeesReady;
    const employee=getFactoryVirtualEmployee(req.params.id),p=req.body||{};
    if(!employee)return res.status(404).json(errorEnvelope('VIRTUAL_EMPLOYEE_NOT_FOUND','virtual employee not found'));
    const provider=String(p.provider||'minimax').trim().toLowerCase(),model=String(p.model||'MiniMax-M2.7').trim().slice(0,160);
    const intervalSeconds=Math.max(60,Math.min(86400,Number(p.intervalSeconds||p.interval_seconds||300)));
    const baseUrl=String(p.baseUrl||p.base_url||'').trim(),credentialEnv=String(p.credentialEnv||p.credential_env||'').trim();
    const timeoutMs=Math.max(5000,Math.min(300000,Number(p.timeoutMs||p.timeout_ms||120000)));
    const temperature=Math.max(0,Math.min(1,Number(p.temperature??0.2)));
    const displayName=String(p.displayName||p.display_name||employee.name).trim().slice(0,120);
    const avatarUrl=String(p.avatarUrl||p.avatar_url||'').trim();
    const preferredLanguage=String(p.preferredLanguage||p.preferred_language||'zh-CN');
    const communicationTone=String(p.communicationTone||p.communication_tone||'professional').trim().slice(0,40);
    const personality=String(p.personality||'').trim().slice(0,2000);
    if(!['minimax','openai-compatible','ollama','hermes','rules'].includes(provider))return res.status(400).json(errorEnvelope('VIRTUAL_EMPLOYEE_PROVIDER_INVALID','unsupported provider'));
    if(!model)return res.status(400).json(errorEnvelope('VIRTUAL_EMPLOYEE_MODEL_REQUIRED','model is required'));
    if(baseUrl&&!/^https?:\/\/[^\s]+$/i.test(baseUrl))return res.status(400).json(errorEnvelope('VIRTUAL_EMPLOYEE_BASE_URL_INVALID','baseUrl must be an http(s) URL'));
    if(credentialEnv&&!/^[A-Z][A-Z0-9_]{2,119}$/.test(credentialEnv))return res.status(400).json(errorEnvelope('VIRTUAL_EMPLOYEE_CREDENTIAL_ENV_INVALID','credentialEnv must be an environment variable name'));
    if(avatarUrl&&!/^\/(?!\/)[^\s]+$|^https?:\/\/[^\s]+$/i.test(avatarUrl))return res.status(400).json(errorEnvelope('VIRTUAL_EMPLOYEE_AVATAR_INVALID','avatarUrl must be an app path or http(s) URL'));
    if(!['zh-CN','vi-VN','en-US'].includes(preferredLanguage))return res.status(400).json(errorEnvelope('VIRTUAL_EMPLOYEE_LANGUAGE_INVALID','unsupported language'));
    const actor=req.user?.username||'admin';
    const row=(await query(`INSERT INTO factory_virtual_employee_configs(employee_id,enabled,provider,model,base_url,credential_env,timeout_ms,temperature,display_name,avatar_url,preferred_language,communication_tone,personality,interval_seconds,owner,notes,updated_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) ON CONFLICT(employee_id) DO UPDATE SET enabled=EXCLUDED.enabled,provider=EXCLUDED.provider,model=EXCLUDED.model,base_url=EXCLUDED.base_url,credential_env=EXCLUDED.credential_env,timeout_ms=EXCLUDED.timeout_ms,temperature=EXCLUDED.temperature,display_name=EXCLUDED.display_name,avatar_url=EXCLUDED.avatar_url,preferred_language=EXCLUDED.preferred_language,communication_tone=EXCLUDED.communication_tone,personality=EXCLUDED.personality,interval_seconds=EXCLUDED.interval_seconds,owner=EXCLUDED.owner,notes=EXCLUDED.notes,updated_by=EXCLUDED.updated_by,updated_at=NOW() RETURNING *`,[employee.id,p.enabled!==false,provider,model,baseUrl||null,credentialEnv||null,timeoutMs,temperature,displayName,avatarUrl||null,preferredLanguage,communicationTone,personality||null,intervalSeconds,String(p.owner||'').trim()||null,String(p.notes||'').trim()||null,actor])).rows[0];
    const safeRow={...row,credential_configured:row.credential_env?Boolean(String(process.env[row.credential_env]||'').trim()):true};
    await query(`INSERT INTO factory_virtual_employee_events(employee_id,event_type,detail,actor) VALUES($1,'CONFIG_UPDATED',$2::jsonb,$3)`,[employee.id,JSON.stringify({...safeRow,credential_env:row.credential_env||null}),actor]);
    res.json(mutateEnvelope(safeRow));
  }catch(e){res.status(409).json(errorEnvelope('VIRTUAL_EMPLOYEE_CONFIG_FAILED',e.message));}
});
app.get('/api/factory/virtual-employees/:id/training-cases', async (req,res)=>{
  try{await factoryVirtualEmployeesReady;const employee=getFactoryVirtualEmployee(req.params.id);if(!employee)return res.status(404).json(errorEnvelope('VIRTUAL_EMPLOYEE_NOT_FOUND','virtual employee not found'));const r=await query(`SELECT c.*,COALESCE(json_agg(r ORDER BY r.created_at DESC) FILTER(WHERE r.id IS NOT NULL),'[]') AS runs FROM factory_virtual_employee_training_cases c LEFT JOIN factory_virtual_employee_training_runs r ON r.case_id=c.id WHERE c.employee_id=$1 GROUP BY c.id ORDER BY c.created_at DESC`,[employee.id]);res.json(listEnvelope(r.rows));}catch(e){res.status(500).json(errorEnvelope('TRAINING_CASE_LIST_FAILED',e.message));}
});
app.post('/api/factory/virtual-employees/:id/training-cases', async (req,res)=>{
  try{await factoryVirtualEmployeesReady;const employee=getFactoryVirtualEmployee(req.params.id),p=req.body||{};if(!employee)return res.status(404).json(errorEnvelope('VIRTUAL_EMPLOYEE_NOT_FOUND','virtual employee not found'));if(!String(p.title||'').trim()||!String(p.scenario||'').trim()||!String(p.expectedBehavior||'').trim())return res.status(400).json(errorEnvelope('TRAINING_CASE_REQUIRED','title, scenario and expectedBehavior are required'));const row=(await query(`INSERT INTO factory_virtual_employee_training_cases(employee_id,title,scenario,expected_behavior,acceptance_criteria,created_by) VALUES($1,$2,$3,$4,$5::jsonb,$6) RETURNING *`,[employee.id,String(p.title).trim(),String(p.scenario).trim(),String(p.expectedBehavior).trim(),JSON.stringify(Array.isArray(p.acceptanceCriteria)?p.acceptanceCriteria:[]),req.user?.username||'trainer'])).rows[0];res.status(201).json(mutateEnvelope(row));}catch(e){res.status(400).json(errorEnvelope('TRAINING_CASE_CREATE_FAILED',e.message));}
});
app.post('/api/factory/virtual-employees/training-cases/:caseId/runs', async (req,res)=>{
  try{await factoryVirtualEmployeesReady;const p=req.body||{},testCase=(await query(`SELECT * FROM factory_virtual_employee_training_cases WHERE id=$1`,[req.params.caseId])).rows[0];if(!testCase)return res.status(404).json(errorEnvelope('TRAINING_CASE_NOT_FOUND','training case not found'));const response=String(p.response||'').trim();if(!response)return res.status(400).json(errorEnvelope('TRAINING_RESPONSE_REQUIRED','response is required'));const row=(await query(`INSERT INTO factory_virtual_employee_training_runs(case_id,employee_id,response) VALUES($1,$2,$3) RETURNING *`,[testCase.id,testCase.employee_id,response])).rows[0];res.status(201).json(mutateEnvelope(row));}catch(e){res.status(400).json(errorEnvelope('TRAINING_RUN_CREATE_FAILED',e.message));}
});
app.post('/api/factory/virtual-employees/training-runs/:runId/review', async (req,res)=>{
  try{await factoryVirtualEmployeesReady;const p=req.body||{},score=Math.max(0,Math.min(100,Number(p.score)));if(!Number.isFinite(score))return res.status(400).json(errorEnvelope('TRAINING_SCORE_REQUIRED','score is required'));const result=score>=Number(p.passScore||80)?'PASSED':'FAILED';const row=(await query(`UPDATE factory_virtual_employee_training_runs SET score=$1,result=$2,reviewer=$3,feedback=$4,reviewed_at=NOW() WHERE id=$5 AND result='WAITING_REVIEW' RETURNING *`,[score,result,req.user?.username||'trainer',String(p.feedback||''),req.params.runId])).rows[0];if(!row)return res.status(409).json(errorEnvelope('TRAINING_REVIEW_INVALID','run is unavailable or already reviewed'));await query(`INSERT INTO factory_virtual_employee_events(employee_id,event_type,detail,actor) VALUES($1,'TRAINING_REVIEWED',$2::jsonb,$3)`,[row.employee_id,JSON.stringify({runId:row.id,score,result}),req.user?.username||'trainer']);res.json(mutateEnvelope(row));}catch(e){res.status(409).json(errorEnvelope('TRAINING_REVIEW_FAILED',e.message));}
});
app.get('/api/factory/virtual-employees/:id/evaluations', async (req,res)=>{
  try {
    await factoryVirtualEmployeesReady;
    const employee=getFactoryVirtualEmployee(req.params.id);
    if(!employee)return res.status(404).json(errorEnvelope('VIRTUAL_EMPLOYEE_NOT_FOUND','virtual employee not found'));
    const evaluations=await query(`SELECT * FROM factory_virtual_employee_evaluations WHERE employee_id=$1 ORDER BY period_end DESC,created_at DESC`,[employee.id]);
    const metrics=(await query(`SELECT
      COUNT(*)::int AS total_tasks,
      COUNT(*) FILTER(WHERE status IN('COMPLETED','HANDED_OFF'))::int AS completed_tasks,
      COUNT(*) FILTER(WHERE status='FAILED')::int AS failed_tasks,
      COUNT(*) FILTER(WHERE requires_human)::int AS gated_tasks,
      COUNT(*) FILTER(WHERE status='WAITING_APPROVAL')::int AS waiting_approval
      FROM factory_virtual_employee_tasks WHERE employee_id=$1`,[employee.id])).rows[0];
    const training=(await query(`SELECT COUNT(*)::int AS total_runs,
      COUNT(*) FILTER(WHERE result='PASSED')::int AS passed_runs,
      COALESCE(ROUND(AVG(score) FILTER(WHERE score IS NOT NULL),2),0) AS average_score
      FROM factory_virtual_employee_training_runs WHERE employee_id=$1`,[employee.id])).rows[0];
    res.json(envelope({items:evaluations.rows,metrics,training}));
  }catch(e){res.status(500).json(errorEnvelope('EMPLOYEE_EVALUATION_LIST_FAILED',e.message));}
});
app.post('/api/factory/virtual-employees/:id/evaluations', async (req,res)=>{
  try {
    await factoryVirtualEmployeesReady;
    const employee=getFactoryVirtualEmployee(req.params.id),p=req.body||{};
    if(!employee)return res.status(404).json(errorEnvelope('VIRTUAL_EMPLOYEE_NOT_FOUND','virtual employee not found'));
    const score=(name)=>Math.max(0,Math.min(100,Number(p[name]??0)));
    const values=['taskCompletionScore','qualityScore','efficiencyScore','complianceScore','collaborationScore','supervisorScore'].map(score);
    if(values.some(v=>!Number.isFinite(v)))return res.status(400).json(errorEnvelope('EMPLOYEE_EVALUATION_SCORE_INVALID','all scores must be numbers from 0 to 100'));
    const total=Number((values[0]*.15+values[1]*.25+values[2]*.15+values[3]*.20+values[4]*.10+values[5]*.15).toFixed(2));
    const grade=total>=90?'A':total>=80?'B':total>=70?'C':total>=60?'D':'E';
    const stage=['PROBATION','REGULAR','COACHING'].includes(String(p.employmentStage||'').toUpperCase())?String(p.employmentStage).toUpperCase():'REGULAR';
    const row=(await query(`INSERT INTO factory_virtual_employee_evaluations(employee_id,period_start,period_end,employment_stage,task_completion_score,quality_score,efficiency_score,compliance_score,collaboration_score,supervisor_score,total_score,grade,strengths,improvement_plan,evaluator)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,[employee.id,p.periodStart,p.periodEnd,stage,...values,total,grade,String(p.strengths||''),String(p.improvementPlan||''),req.user?.username||'manager'])).rows[0];
    await query(`INSERT INTO factory_virtual_employee_events(employee_id,event_type,detail,actor) VALUES($1,'EVALUATION_DRAFTED',$2::jsonb,$3)`,[employee.id,JSON.stringify({evaluationId:row.id,total,grade}),req.user?.username||'manager']);
    res.status(201).json(mutateEnvelope(row));
  }catch(e){res.status(400).json(errorEnvelope('EMPLOYEE_EVALUATION_CREATE_FAILED',e.message));}
});
app.post('/api/factory/virtual-employees/evaluations/:evaluationId/approve', async (req,res)=>{
  try {
    await factoryVirtualEmployeesReady;
    const row=(await query(`UPDATE factory_virtual_employee_evaluations SET status='APPROVED',approved_by=$1,approved_at=NOW() WHERE id=$2 AND status='DRAFT' RETURNING *`,[req.user?.username||'manager',req.params.evaluationId])).rows[0];
    if(!row)return res.status(409).json(errorEnvelope('EMPLOYEE_EVALUATION_APPROVAL_INVALID','evaluation is unavailable or already approved'));
    await query(`INSERT INTO factory_virtual_employee_events(employee_id,event_type,detail,actor) VALUES($1,'EVALUATION_APPROVED',$2::jsonb,$3)`,[row.employee_id,JSON.stringify({evaluationId:row.id,total:row.total_score,grade:row.grade}),req.user?.username||'manager']);
    res.json(mutateEnvelope(row));
  }catch(e){res.status(409).json(errorEnvelope('EMPLOYEE_EVALUATION_APPROVAL_FAILED',e.message));}
});
app.get('/api/factory/virtual-employees/:id', async (req, res) => {
  try {
    await factoryVirtualEmployeesReady;
    const employee = getFactoryVirtualEmployee(req.params.id);
    if (!employee) return res.status(404).json(errorEnvelope('VIRTUAL_EMPLOYEE_NOT_FOUND', 'virtual employee not found'));
    const tasks = await query(`SELECT * FROM factory_virtual_employee_tasks WHERE employee_id=$1 ORDER BY created_at DESC LIMIT 100`, [employee.id]);
    res.json(envelope({ ...employee, tasks: tasks.rows }));
  } catch (e) { res.status(500).json(errorEnvelope('VIRTUAL_EMPLOYEE_READ_FAILED', e.message)); }
});
app.post('/api/factory/virtual-employees/:id/tasks', async (req, res) => {
  try {
    await factoryVirtualEmployeesReady;
    const employee = getFactoryVirtualEmployee(req.params.id), p = req.body || {};
    if (!employee) return res.status(404).json(errorEnvelope('VIRTUAL_EMPLOYEE_NOT_FOUND', 'virtual employee not found'));
    const actorCheck = serviceActorFor(req, employee.id);
    if (!actorCheck.ok) return res.status(403).json(errorEnvelope(actorCheck.code, 'virtual employee credential rejected'));
    const actor = actorCheck.actor;
    const taskType = String(p.taskType || '').trim().toUpperCase(), title = String(p.title || '').trim();
    if (!taskType || !title) return res.status(400).json(errorEnvelope('VIRTUAL_EMPLOYEE_TASK_REQUIRED', 'taskType and title are required'));
    if (!employee.capabilities.includes(taskType)) return res.status(400).json(errorEnvelope('VIRTUAL_EMPLOYEE_CAPABILITY_DENIED', `${employee.id} cannot execute ${taskType}`));
    const humanGate = String(p.humanGate || '').trim();
    if (humanGate && !employee.humanGates.includes(humanGate)) return res.status(400).json(errorEnvelope('VIRTUAL_EMPLOYEE_GATE_INVALID', 'humanGate is not registered for this employee'));
    const requiresHuman = Boolean(humanGate || p.requiresHuman);
    const row = (await query(`INSERT INTO factory_virtual_employee_tasks(employee_id,task_type,title,domain,status,priority,input,requires_human,human_gate,requested_by)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10) RETURNING *`, [employee.id, taskType, title, employee.domain, requiresHuman ? 'WAITING_APPROVAL' : 'OPEN', String(p.priority || 'NORMAL').toUpperCase(), JSON.stringify(p.input || {}), requiresHuman, humanGate || null, actor])).rows[0];
    await query(`INSERT INTO factory_virtual_employee_events(employee_id,task_id,event_type,detail,actor) VALUES($1,$2,'TASK_CREATED',$3::jsonb,$4)`, [employee.id,row.id,JSON.stringify({ taskType, requiresHuman, humanGate: humanGate || null, serviceIdentity: actorCheck.service }),actor]);
    res.status(201).json(mutateEnvelope(row));
  } catch (e) { res.status(400).json(errorEnvelope('VIRTUAL_EMPLOYEE_TASK_CREATE_FAILED', e.message)); }
});
// Capability contract for one role: which skills, the real permission key
// behind each, the human gate blocking its write side, and the MCP servers it
// may call. The 21 positions that live only in `ve_reporting_lines` answer
// here too, so dispatch tooling has one place to ask.
app.get('/api/factory/virtual-employees/:id/capabilities', (req, res) => {
  try {
    const caps = capabilitiesFor(req.params.id);
    if (!caps) return res.status(404).json(errorEnvelope('ROLE_NOT_DECLARED', `no capability row for ${req.params.id}`));
    const employee = getFactoryVirtualEmployee(req.params.id);
    res.json(envelope({ ...caps,
      registry: employee ? { level: employee.level, domain: employee.domain, mode: employee.mode, humanGates: employee.humanGates } : null,
      rule: 'kind=write 的技能只产出带人工门的草稿任务；ve: 身份不能批准，批准人必须是具名人类' }));
  } catch (e) { res.status(400).json(errorEnvelope('VE_CAPABILITIES_FAILED', e.message)); }
});
// Whole-org contract self-audit. `problems` must stay at zero: a skill whose
// gate is not registered on the role would be refused at approval time, which
// means the contract promised something the runtime cannot deliver.
app.get('/api/factory/virtual-employees/capabilities/summary', (_req, res) => {
  try {
    const audit = auditCapabilities({ registryEntries: FACTORY_VIRTUAL_EMPLOYEES });
    res.json(envelope({ ...audit, declaredRoles: ALL_ROLE_IDS.length, mcpServers: Object.keys(MCP_SERVERS).length }));
  } catch (e) { res.status(500).json(errorEnvelope('VE_CAPABILITY_AUDIT_FAILED', e.message)); }
});
app.post('/api/factory/virtual-employees/:id/service-token', (req, res) => {
  try {
    const employee = getFactoryVirtualEmployee(req.params.id);
    if (!employee) return res.status(404).json(errorEnvelope('VIRTUAL_EMPLOYEE_NOT_FOUND', 'virtual employee not found'));
    const human = humanDomainPermission(req, employee);
    if (!human.ok) return res.status(human.code === 'UNAUTHORIZED' ? 401 : 403).json(errorEnvelope(human.code, human.required ? `Missing required permission: ${human.required}` : 'a virtual employee cannot act as a human principal'));
    const ttlSeconds = Number(req.body?.ttlSeconds || 3600);
    const token = mintServiceToken(employee.id, 'task:create', ttlSeconds);
    res.json(envelope({ employeeId: employee.id, token, tokenType: 'VE_SERVICE', scope: ['task:create'], expiresIn: ttlSeconds, issuedBy: req.user?.username || 'system' }));
  } catch (e) { res.status(400).json(errorEnvelope('VE_TOKEN_ISSUE_FAILED', e.message)); }
});
app.post('/api/factory/virtual-employees/tasks/:taskId/approve', async (req, res) => {
  try {
    await factoryVirtualEmployeesReady;
    const found = (await query(`SELECT * FROM factory_virtual_employee_tasks WHERE id=$1`, [req.params.taskId])).rows[0];
    if (!found) return res.status(404).json(errorEnvelope('TASK_NOT_FOUND', 'task not found'));
    // One approval path for HTTP and CLI (`agent/approval.js`): human identity,
    // domain permission, gate contract, conditional UPDATE, then the advance.
    const result = await approveTask({ query, task: found, employee: getFactoryVirtualEmployee(found.employee_id),
      actor: req.user?.username, permissions: req.user?.permissions || [], serviceToken: hasServiceToken(req),
      writeback: process.env.VE_WRITEBACK !== 'off' });
    if (!result.ok) {
      const status = result.code === 'UNAUTHORIZED' ? 401
        : ['FORBIDDEN', 'VE_CANNOT_APPROVE', 'VE_CANNOT_ACT_AS_HUMAN'].includes(result.code) ? 403 : 409;
      const message = result.required ? `Missing required permission: ${result.required}`
        : result.code === 'VE_CANNOT_APPROVE' ? 'a virtual employee cannot approve its own gate'
        : `approval rejected: ${result.code}`;
      return res.status(status).json(errorEnvelope(result.code, message));
    }
    if (result.task.employee_id === 'WMS-RECEIVING-VIRTUAL-01') {
      neuralBroadcast({ from: result.task.employee_id, to: 'wms_receiving_archify', type: 'WMS_RECEIVING_EMPLOYEE_STATUS', priority: 'info', payload: { taskId: result.task.id, taskType: result.task.task_type, title: result.task.title, status: 'OPEN', input: result.task.input, approvedBy: result.task.approved_by } });
    }
    res.json({ ...mutateEnvelope(result.task), writeback: result.writeback });
  } catch (e) { res.status(409).json(errorEnvelope('VIRTUAL_EMPLOYEE_APPROVAL_FAILED', e.message)); }
});
app.get('/api/factory/virtual-employees/events/audit', async (req, res) => {
  try { await factoryVirtualEmployeesReady; const r = await query(`SELECT * FROM factory_virtual_employee_events WHERE ($1='' OR employee_id=$1) ORDER BY created_at DESC LIMIT 500`, [String(req.query.employeeId || '')]); res.json(listEnvelope(r.rows)); }
  catch (e) { res.status(500).json(errorEnvelope('VIRTUAL_EMPLOYEE_AUDIT_FAILED', e.message)); }
});
app.post('/api/factory/virtual-employees/:id/wechat', async (req,res)=>{try{
  await factoryVirtualEmployeesReady;const employee=getFactoryVirtualEmployee(req.params.id),p=req.body||{};if(!employee)return res.status(404).json(errorEnvelope('VIRTUAL_EMPLOYEE_NOT_FOUND','virtual employee not found'));
  const subject=String(p.subject||'').trim(),message=String(p.message||'').trim(),priority=String(p.priority||'NORMAL').toUpperCase();if(!subject||!message)return res.status(400).json(errorEnvelope('VIRTUAL_EMPLOYEE_WECHAT_REQUIRED','subject and message are required'));if(!['NORMAL','WARNING','CRITICAL'].includes(priority))return res.status(400).json(errorEnvelope('VIRTUAL_EMPLOYEE_WECHAT_PRIORITY_INVALID','invalid priority'));
  const result=await sendVirtualEmployeeWechat({employeeId:employee.id,subject,message,entityRef:String(p.entityRef||''),priority});await query(`INSERT INTO factory_virtual_employee_events(employee_id,event_type,detail,actor) VALUES($1,'WECHAT_MESSAGE_ATTEMPTED',$2::jsonb,$3)`,[employee.id,JSON.stringify({subject,priority,entityRef:p.entityRef||null,...result}),req.user?.username||employee.id]);
  res.status(result.sent?200:202).json(mutateEnvelope(result));
}catch(e){res.status(502).json(errorEnvelope('VIRTUAL_EMPLOYEE_WECHAT_FAILED',e.message));}});

let receivingVirtualEmployeeBusy = false;
function broadcastReceivingEmployee(payload) {
  neuralBroadcast({
    from: 'WMS-RECEIVING-VIRTUAL-01',
    to: 'wms_receiving_archify',
    type: 'WMS_RECEIVING_EMPLOYEE_STATUS',
    priority: payload.status === 'WAITING_APPROVAL' ? 'warning' : 'info',
    payload
  });
}
async function runReceivingVirtualEmployee() {
  if (receivingVirtualEmployeeBusy) return { skipped: true, reason: 'already_running' };
  receivingVirtualEmployeeBusy = true;
  const employeeId = 'WMS-RECEIVING-VIRTUAL-01';
  try {
    broadcastReceivingEmployee({ phase: 'SCANNING', status: 'RUNNING', message: 'Scanning unfinished receiving lots' });
    await Promise.all([factoryVirtualEmployeesReady, receivingQrRegistrationReady]);
    const config=(await query(`SELECT enabled FROM factory_virtual_employee_configs WHERE employee_id=$1`,[employeeId])).rows[0];
    if(config?.enabled===false)return {skipped:true,reason:'employee_disabled'};
    const lots = await query(`SELECT ml.id,ml.lot_no,ml.po_no,ml.received_qty,ml.iqc_status,ml.storage_location_id,
      m.code AS material_code,COALESCE(s.code,'') AS supplier_code,sl.code AS location_code,
      q.material_qr,q.document_no,q.msd_level,q.location_code AS qr_location,q.status AS qr_status,q.quantity AS qr_quantity
      FROM material_lots ml JOIN materials m ON m.id=ml.material_id
      LEFT JOIN suppliers s ON s.id=ml.supplier_id LEFT JOIN storage_locations sl ON sl.id=ml.storage_location_id
      LEFT JOIN wms_receiving_qr_registrations q ON q.material_lot_id=ml.id
      WHERE ml.iqc_status IN('pending','hold') ORDER BY ml.received_at ASC NULLS LAST LIMIT 200`);
    let created = 0, readyForIqc = 0, exceptions = 0;
    for (const lot of lots.rows) {
      let taskType = 'RECEIVING_VALIDATE', title = `核对收料批次 ${lot.lot_no}`, requiresHuman = false, humanGate = null;
      const missing = [];
      if (!lot.po_no) missing.push('PO');
      if (!lot.supplier_code) missing.push('supplier');
      if (!(Number(lot.received_qty) > 0)) missing.push('received quantity');
      if (missing.length) { requiresHuman = true; humanGate = 'receive_variance'; title = `收料资料异常 ${lot.lot_no}: ${missing.join(', ')}`; exceptions += 1; }
      else if (!lot.material_qr) { taskType = 'LABEL_PLAN'; title = `生成并打印箱 QR ${lot.lot_no}`; }
      else if (!lot.qr_location && !lot.location_code) { taskType = 'LOCATION_BIND'; title = `扫描并绑定仓位 ${lot.lot_no}`; }
      else if (lot.qr_status === 'IQC_PENDING') { taskType = 'IQC_HANDOFF'; title = `已收料，交接 IQC ${lot.lot_no}`; readyForIqc += 1; }
      const taskKey = `RECEIVING:${lot.id}:${taskType}`;
      const input = { materialLotId: lot.id, lotNo: lot.lot_no, poNo: lot.po_no, materialCode: lot.material_code, supplierCode: lot.supplier_code, receivedQty: Number(lot.received_qty || 0), registeredQty: Number(lot.qr_quantity || 0), materialQr: lot.material_qr, documentNo: lot.document_no, msl: lot.msd_level, locationCode: lot.qr_location || lot.location_code, missing };
      const result = await query(`INSERT INTO factory_virtual_employee_tasks(task_key,employee_id,task_type,title,domain,status,priority,input,requires_human,human_gate,requested_by)
        VALUES($1,$2,$3,$4,'wms',$5,$6,$7::jsonb,$8,$9,'WMS-RECEIVING-VIRTUAL-01')
        ON CONFLICT(task_key) WHERE task_key IS NOT NULL DO UPDATE SET title=EXCLUDED.title,input=EXCLUDED.input,requires_human=EXCLUDED.requires_human,human_gate=EXCLUDED.human_gate,updated_at=NOW()
        RETURNING id,(xmax=0) AS inserted`, [taskKey,employeeId,taskType,title,requiresHuman?'WAITING_APPROVAL':taskType==='IQC_HANDOFF'?'DONE':'OPEN',requiresHuman?'HIGH':'NORMAL',JSON.stringify(input),requiresHuman,humanGate]);
      broadcastReceivingEmployee({ taskId: result.rows[0]?.id, taskType, title, status: requiresHuman ? 'WAITING_APPROVAL' : taskType === 'IQC_HANDOFF' ? 'DONE' : 'OPEN', input });
      if (result.rows[0]?.inserted) {
        created += 1;
        await query(`INSERT INTO factory_virtual_employee_events(employee_id,task_id,event_type,detail,actor) VALUES($1,$2,'RECEIVING_STAGE_DETECTED',$3::jsonb,$1)`, [employeeId,result.rows[0].id,JSON.stringify({ taskType, lotNo: lot.lot_no, missing })]);
      }
    }
    const summary = { scanned: lots.rowCount, created, readyForIqc, exceptions, runAt: new Date().toISOString() };
    await query(`INSERT INTO factory_virtual_employee_events(employee_id,event_type,detail,actor) VALUES($1,'SCAN_COMPLETED',$2::jsonb,$1)`, [employeeId,JSON.stringify(summary)]);
    if (!lots.rowCount) broadcastReceivingEmployee({ phase: 'IDLE', status: 'IDLE', ...summary });
    else broadcastReceivingEmployee({ phase: 'SCAN_COMPLETED', status: 'COMPLETED', ...summary });
    return summary;
  } finally { receivingVirtualEmployeeBusy = false; }
}
app.post('/api/factory/virtual-employees/WMS-RECEIVING-VIRTUAL-01/run-now', async (_req,res) => {
  try { res.json(mutateEnvelope(await runReceivingVirtualEmployee())); }
  catch (e) { res.status(409).json(errorEnvelope('RECEIVING_VIRTUAL_EMPLOYEE_FAILED',e.message)); }
});
app.get('/api/factory/virtual-employees/WMS-RECEIVING-VIRTUAL-01/work-queue', async (_req,res) => {
  try { await factoryVirtualEmployeesReady; const r=await query(`SELECT * FROM factory_virtual_employee_tasks WHERE employee_id='WMS-RECEIVING-VIRTUAL-01' ORDER BY CASE status WHEN 'WAITING_APPROVAL' THEN 0 WHEN 'OPEN' THEN 1 ELSE 2 END,created_at DESC LIMIT 200`); res.json(listEnvelope(r.rows)); }
  catch(e){res.status(500).json(errorEnvelope('RECEIVING_VIRTUAL_QUEUE_FAILED',e.message));}
});
const receivingVirtualEmployeeInterval = Math.max(60000,Number(process.env.RECEIVING_AGENT_INTERVAL_MS || 300000));
setInterval(() => { void runReceivingVirtualEmployee().catch(error => console.error('[WMS-RECEIVING-VIRTUAL-01]',error.message)); },receivingVirtualEmployeeInterval);
}
