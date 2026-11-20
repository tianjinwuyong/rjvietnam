// QMS (IQC) routes, moved out of services/api/server.js.
//
// 23 registrations plus the IQC virtual-employee machinery they depend on: the LLM
// provider options, the guidance loader, the material history query, the PowerShell
// command table and the cron that runs the virtual employee on an interval.
//
// Unlike routes/maintenance.js and routes/pmc.js this block was NOT purely
// registrations -- it interleaved seven module-level declarations with the routes.
// Eight of the nine names are referenced nowhere else in server.js, so they move with
// the block; `iqcDefectLoopReady` is used 12 times outside it, so it is injected.
// Everything lives inside registerQmsRoutes, which the caller invokes exactly once at
// the line the block used to occupy, so the closures and the interval behave as before.
export function registerQmsRoutes(app, deps) {
  const {
    query, pgPool, requirePermission, envelope, errorEnvelope, mutateEnvelope, listEnvelope,
    iqcDefectLoopReady, IQC_VIRTUAL_EMPLOYEE, IQC_VIRTUAL_HARNESS, advanceInspectionLevelServer,
    rememberIqcMemory, searchIqcMemory, getIqcMemoryContext, runIqcVirtualEmployee, askIqcLlm,
    execFileAsync,
  } = deps;

app.get('/qms/iqc/inspection-levels', requirePermission('quality.view'), async (req, res) => {
  try { await iqcDefectLoopReady; const p=String(req.query.supplierCode||'').trim(), m=String(req.query.materialCode||'').trim(); const r=await query(`SELECT * FROM qms_iqc_inspection_states WHERE ($1='' OR supplier_code=$1) AND ($2='' OR material_code=$2) ORDER BY updated_at DESC LIMIT 500`,[p,m]); res.json(listEnvelope(r.rows)); }
  catch(e){ res.status(500).json(errorEnvelope('IQC_LEVEL_LIST_FAILED',e.message)); }
});
const IQC_LLM_PROVIDER_OPTIONS = Object.freeze([
  { value:'minimax',label:'MiniMax',defaultModel:'MiniMax-M2.7',credentialEnv:'MINIMAX_API_KEY' },
  { value:'ollama',label:'Ollama (local)',defaultModel:'qwen2.5:7b',credentialEnv:null },
  { value:'openai-compatible',label:'OpenAI-compatible',defaultModel:'gpt-4o-mini',credentialEnv:'OPENAI_API_KEY' },
  { value:'deepseek',label:'DeepSeek',defaultModel:'deepseek-chat',credentialEnv:'DEEPSEEK_API_KEY' },
  { value:'hermes',label:'Hermes CLI',defaultModel:'configured-default',credentialEnv:null },
  { value:'opencode',label:'OpenCode CLI',defaultModel:'configured-default',credentialEnv:null },
  { value:'pi',label:'Pi CLI',defaultModel:'configured-default',credentialEnv:null },
]);
async function getIqcLlmConfig(){
  await iqcDefectLoopReady;
  const row=(await query(`SELECT employee_id,enabled,provider,model,base_url,credential_env,timeout_ms,updated_by,updated_at FROM qms_iqc_virtual_employee_config WHERE employee_id='IQC-VIRTUAL-01'`)).rows[0];
  return { employeeId:row.employee_id,enabled:row.enabled,provider:row.provider,model:row.model,baseUrl:row.base_url||'',credentialEnv:row.credential_env||'',credentialConfigured:row.credential_env?Boolean(String(process.env[row.credential_env]||'').trim()):true,timeoutMs:row.timeout_ms,updatedBy:row.updated_by,updatedAt:row.updated_at };
}
app.get('/qms/iqc/virtual-employee', requirePermission('quality.view'), async (_req, res) => { try { const llmConfig=await getIqcLlmConfig(); res.json(envelope({ ...IQC_VIRTUAL_EMPLOYEE, provider:llmConfig.provider, model:llmConfig.model, enabled:llmConfig.enabled, llmConfig, providerOptions:IQC_LLM_PROVIDER_OPTIONS, harness: IQC_VIRTUAL_HARNESS })); } catch(e){res.status(500).json(errorEnvelope('IQC_AGENT_CONFIG_READ_FAILED',e.message));} });
app.put('/qms/iqc/virtual-employee/llm-config', requirePermission('quality.execute'), async (req,res)=>{try{
  await iqcDefectLoopReady;const p=req.body||{},provider=String(p.provider||'').toLowerCase(),option=IQC_LLM_PROVIDER_OPTIONS.find(item=>item.value===provider);
  if(!option)return res.status(400).json(errorEnvelope('IQC_LLM_PROVIDER_INVALID','Unsupported IQC LLM provider'));
  const model=String(p.model||option.defaultModel).trim().slice(0,160);if(!model)return res.status(400).json(errorEnvelope('IQC_LLM_MODEL_REQUIRED','model is required'));
  const baseUrl=String(p.baseUrl||'').trim();if(baseUrl&&!/^https?:\/\/[^\s]+$/i.test(baseUrl))return res.status(400).json(errorEnvelope('IQC_LLM_BASE_URL_INVALID','baseUrl must be an http(s) URL'));
  const credentialEnv=option.credentialEnv||null,timeoutMs=Math.min(300000,Math.max(5000,Number(p.timeoutMs||120000))),actor=req.user?.username||p.operator||'quality';
  await query(`UPDATE qms_iqc_virtual_employee_config SET enabled=$1,provider=$2,model=$3,base_url=$4,credential_env=$5,timeout_ms=$6,updated_by=$7,updated_at=NOW() WHERE employee_id='IQC-VIRTUAL-01'`,[p.enabled!==false,provider,model,baseUrl||null,credentialEnv,timeoutMs,actor]);
  res.json(mutateEnvelope({...(await getIqcLlmConfig()),providerOptions:IQC_LLM_PROVIDER_OPTIONS}));
}catch(e){res.status(409).json(errorEnvelope('IQC_LLM_CONFIG_UPDATE_FAILED',e.message));}});
async function getActiveIqcGuidance(guidanceKey = 'SMT_IQC') {
  await iqcDefectLoopReady;
  const r = await query(`SELECT id,file_name,version_no,workbook FROM qms_iqc_guidance_documents WHERE guidance_key=$1 AND status='ACTIVE' ORDER BY activated_at DESC LIMIT 1`, [guidanceKey]);
  if (!r.rows[0]) throw new Error('No ACTIVE IQC Excel guidance is configured');
  const workbook = r.rows[0].workbook || {};
  const templateResult = await query(`SELECT id,file_name,version_no,workbook FROM qms_iqc_guidance_documents WHERE guidance_key=$1 AND status='ACTIVE' ORDER BY activated_at DESC LIMIT 1`, [`${guidanceKey}_TEMPLATE`]);
  const templateDocument = templateResult.rows[0] || null;
  const templateWorkbook = templateDocument?.workbook || {};
  const sheets = Array.isArray(workbook.sheets) ? workbook.sheets : [];
  const templateSheets = Array.isArray(templateWorkbook.sheets) ? templateWorkbook.sheets : [];
  const allRows = sheets.flatMap(sheet => Array.isArray(sheet.rows) ? sheet.rows : []);
  const templateRows = templateSheets.flatMap(sheet => Array.isArray(sheet.rows) ? sheet.rows : []);
  const text = allRows.flatMap(row => Array.isArray(row) ? row.map(cell => String(cell ?? '').trim()).filter(Boolean) : []);
  const templateText = templateRows.flatMap(row => Array.isArray(row) ? row.map(cell => String(cell ?? '').trim()).filter(Boolean) : []);
  const samplingRows = [...(workbook.samplingRows || []), ...allRows.filter(row => Array.isArray(row) && row.some(cell => /\d+\s*[~～至-]\s*\d+/.test(String(cell ?? ''))))];
  const approvedItemPattern = /合格供应商|出货检验报告|出货报告|标签内容核对|外箱完好|缩水|模具印|划伤|披锋|同色点|异色点|脏污|异物|色差|燃烧测试|盐雾测试|球击测试|球压测试|RoHS|无卤测试|第三方环保测试报告|焊端|电气测试|电阻测试|电容测试|MSD|ESD/i;
  const headingPattern = /抽样方案|正常检验一次抽样方案|加严检验一次抽样方案|放宽检验一次抽样方案|特殊检验水平|一般检验水平|表示箭头|使用箭头|检验属性|检验内容\/标准|判定标准&测试结果/i;
  const inspectionItems = [...new Set([
    ...(templateWorkbook.inspectionItems || []),
    ...templateText.filter(value => approvedItemPattern.test(value) && !headingPattern.test(value)),
  ])].slice(0, 100);
  const levelRules = text.filter(value => /8\.2\.[1-5]|正常检查|加严检查|放宽检查|免检|暂停检查/.test(value));
  return { ...workbook, sheets: [...sheets, ...templateSheets], samplingRows, inspectionItems, levelRules, fileName: `${r.rows[0].file_name} (${r.rows[0].version_no})`, inspectionTemplateFileName: templateDocument ? `${templateDocument.file_name} (${templateDocument.version_no})` : null, guidanceDocumentId: r.rows[0].id, guidanceVersion: r.rows[0].version_no, learnedAt: new Date().toISOString() };
}
async function getIqcMaterialHistory(materialCode, supplierCode = '') {
  const r = await query(`SELECT supplier_code,material_code,lot_no,result,level_before,level_after,transition,inspection_date,source_file,abnormal_type,operator,created_at
    FROM qms_iqc_inspection_level_events WHERE material_code=$1 AND ($2='' OR supplier_code=$2) ORDER BY created_at DESC LIMIT 100`, [String(materialCode || '').trim(), String(supplierCode || '').trim()]);
  return r.rows;
}
app.post('/qms/iqc/virtual-employee/learn-guidance', requirePermission('quality.execute'), async (req, res) => { try { const guidance = await getActiveIqcGuidance(req.body?.guidanceKey); const row = await rememberIqcMemory(query, { memoryType: 'AUTHORITATIVE_GUIDANCE', materialCode: req.body?.materialCode, sourceType: 'ACTIVE_IQC_EXCEL', sourceId: String(guidance.guidanceDocumentId), content: { fileName: guidance.fileName, version: guidance.guidanceVersion, sheets: guidance.sheets.map(sheet => sheet.name), samplingRows: guidance.samplingRows, inspectionItems: guidance.inspectionItems, levelRules: guidance.levelRules }, createdBy: req.user?.username || 'iqc-virtual-01' }); res.json(mutateEnvelope({ guidance, memory: row })); } catch (e) { res.status(409).json(errorEnvelope('IQC_GUIDANCE_LEARN_FAILED', e.message)); } });
app.post('/qms/iqc/virtual-employee/plan', requirePermission('quality.execute'), async (req, res) => { try { const guidance = await getActiveIqcGuidance(req.body?.guidanceKey); const history = await getIqcMaterialHistory(req.body?.materialCode, req.body?.supplierCode); const plan = await runIqcVirtualEmployee({ ...(req.body || {}), guidance, history }); res.json(mutateEnvelope({ ...plan, historyCount: history.length, guidance: { fileName: guidance.fileName, id: guidance.guidanceDocumentId } })); } catch (e) { res.status(409).json(errorEnvelope('IQC_VIRTUAL_PLAN_FAILED', e.message)); } });
app.post('/qms/iqc/virtual-employee/advice', requirePermission('quality.execute'), async (req, res) => { try { const guidance = await getActiveIqcGuidance(req.body?.guidanceKey); const memoryContext = await getIqcMemoryContext(query, req.body || {}); const llmConfig=await getIqcLlmConfig(); if(!llmConfig.enabled)return res.status(409).json(errorEnvelope('IQC_VIRTUAL_EMPLOYEE_DISABLED','IQC virtual employee is disabled')); const advice = await askIqcLlm({ ...(req.body || {}), guidance, memoryContext, llmConfig }); await rememberIqcMemory(query, { memoryType: 'TASK_EPISODE', materialCode: req.body?.materialCode, lotNo: req.body?.lotNo, sourceType: 'VIRTUAL_EMPLOYEE_ADVICE', content: { question: req.body?.question || '', pageContext: String(req.body?.pageContext || '').slice(0, 2000), provider:advice.provider, model:advice.model, response: advice.output }, createdBy: req.user?.username || 'iqc-virtual-01' }); res.json(mutateEnvelope({ ...advice, memoryCount: memoryContext.length, guidance: { fileName: guidance.fileName, id: guidance.guidanceDocumentId } })); } catch (e) { if (String(e.message || '').includes('No ACTIVE IQC')) return res.status(409).json(errorEnvelope('IQC_GUIDANCE_REQUIRED', e.message)); const llmConfig=await getIqcLlmConfig().catch(()=>null); res.json(mutateEnvelope({ provider:llmConfig?.provider||'minimax', model:llmConfig?.model||process.env.IQC_LLM_MODEL||'configured-model', output: { summary: 'IQC-VIRTUAL-01 cannot access the configured LLM. No inspection result or inventory release was generated.', requiredTests: [], missingEvidence: ['Configured LLM response or real inspection evidence'], recommendation: 'WAIT_FOR_REAL_EVIDENCE', nextAction: 'Check the selected provider configuration and enter real PDA/tester results.', actionArguments: {}, humanApprovalRequired: true, blockedReason: String(e.message || 'LLM unavailable') }, degraded: true })); } });
const IQC_POWERSHELL_COMMANDS = Object.freeze({
  check_agent_runtime: "Get-Date; Get-Process -Name node,ollama -ErrorAction SilentlyContinue | Select-Object ProcessName,Id,CPU",
  inspect_active_guidance: "Write-Output 'Use /qms/iqc/guidance-documents for ACTIVE Excel guidance; no filesystem mutation is permitted.'",
  inspect_iqc_page: "Write-Output 'IQC page inspection is read-only; use the authenticated WMS API for data.'",
});
app.post('/qms/iqc/virtual-employee/powershell', requirePermission('quality.execute'), async (req, res) => {
  const commandId = String(req.body?.commandId || '').trim();
  if (!Object.prototype.hasOwnProperty.call(IQC_POWERSHELL_COMMANDS, commandId)) return res.status(400).json(errorEnvelope('IQC_POWERSHELL_COMMAND_DENIED', 'only approved IQC read-only command IDs are allowed'));
  try {
    const result = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', IQC_POWERSHELL_COMMANDS[commandId]], { windowsHide: true, timeout: 10000, maxBuffer: 200000 });
    res.json(mutateEnvelope({ agent: 'IQC-VIRTUAL-01', commandId, stdout: result.stdout, stderr: result.stderr, readOnly: true }));
  } catch (e) { res.status(409).json(errorEnvelope('IQC_POWERSHELL_FAILED', e.message)); }
});
app.get('/qms/iqc/virtual-employee/memory', requirePermission('quality.view'), async (req, res) => { try { await iqcDefectLoopReady; const rows = await searchIqcMemory(query, req.query || {}); res.json(listEnvelope(rows)); } catch (e) { res.status(500).json(errorEnvelope('IQC_MEMORY_LIST_FAILED', e.message)); } });
app.post('/qms/iqc/virtual-employee/memory', requirePermission('quality.execute'), async (req, res) => { try { await iqcDefectLoopReady; const row = await rememberIqcMemory(query, { ...(req.body || {}), createdBy: req.user?.username || req.body?.createdBy || 'quality' }); res.status(201).json(mutateEnvelope(row)); } catch (e) { res.status(400).json(errorEnvelope('IQC_MEMORY_WRITE_FAILED', e.message)); } });
app.post('/qms/iqc/virtual-employee/memory/:id/approve', requirePermission('quality.execute'), async (req, res) => { try { await iqcDefectLoopReady; const r = await query(`UPDATE qms_iqc_virtual_memory SET memory_type='APPROVED_KNOWLEDGE',approval_status='APPROVED',approved_by=$1,approved_at=NOW() WHERE id=$2 AND memory_type='LEARNING_CANDIDATE' AND approval_status='CANDIDATE' RETURNING *`, [req.user?.username || req.body?.operator || 'quality', req.params.id]); if (!r.rows[0]) return res.status(409).json(errorEnvelope('IQC_MEMORY_APPROVAL_INVALID', 'only a learning candidate can be approved')); res.json(mutateEnvelope(r.rows[0])); } catch (e) { res.status(409).json(errorEnvelope('IQC_MEMORY_APPROVAL_FAILED', e.message)); } });
let iqcVirtualCronBusy = false;
async function runIqcVirtualCron() {
  if (iqcVirtualCronBusy) return { skipped: true, reason: 'already_running' };
  iqcVirtualCronBusy = true;
  try {
    await iqcDefectLoopReady;
    const guidance = await getActiveIqcGuidance();
    const pending = await query(`SELECT q.material_lot_id,ml.lot_no,m.code AS material_code,s.code AS supplier_code,
      COALESCE(q.quantity,ml.received_qty) AS quantity,q.source_type,q.warehouse_code,q.location_code,
      EXTRACT(EPOCH FROM (NOW()-q.updated_at))/60 AS waiting_minutes
      FROM wms_receiving_qr_registrations q JOIN material_lots ml ON ml.id=q.material_lot_id JOIN materials m ON m.id=ml.material_id
      LEFT JOIN suppliers s ON s.id=ml.supplier_id WHERE q.status='IQC_PENDING' ORDER BY q.updated_at ASC LIMIT 100`);
    let planned = 0;
    const taskTypes = [];
    for (const row of pending.rows) {
      const overdue = Number(row.waiting_minutes || 0) >= 120;
      const history = await getIqcMaterialHistory(row.material_code, row.supplier_code);
      const plan = await runIqcVirtualEmployee({ lotNo: row.lot_no, materialCode: row.material_code, batchSize: row.quantity, guidance, history });
      const taskType = overdue ? 'OVERDUE_IQC_REVIEW' : 'GENERATE_IQC_PLAN';
      const taskTitle = overdue ? `IQC超时待办：${row.lot_no}` : `生成IQC检验计划：${row.lot_no}`;
      await query(`INSERT INTO qms_iqc_virtual_tasks(task_key,task_type,title,lot_no,material_code,supplier_code,payload,status,requires_human,priority)
        VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,'OPEN',$8,$9) ON CONFLICT(task_key) DO UPDATE SET payload=EXCLUDED.payload,priority=EXCLUDED.priority`,
        [`${taskType}:${row.material_lot_id}:${new Date().toISOString().slice(0,10)}`, taskType, taskTitle, row.lot_no, row.material_code, row.supplier_code,
          JSON.stringify({ sourceType: row.source_type, warehouse: row.warehouse_code, location: row.location_code, quantity: row.quantity, waitingMinutes: row.waiting_minutes, historyCount: history.length, guidance: guidance.fileName, plan }), overdue, overdue ? 'HIGH' : 'NORMAL']);
      await rememberIqcMemory(query, { memoryType: 'TASK_EPISODE', materialCode: row.material_code, lotNo: row.lot_no, sourceType: 'IQC_AGENT_CRON', sourceId: String(row.material_lot_id), content: { stage: 'scheduled_plan', plan, guidance: guidance.fileName }, createdBy: 'iqc-virtual-01' });
      planned += 1; taskTypes.push(taskType);
    }
    const manual = await query(`SELECT supplier_code,material_code,level,counters FROM qms_iqc_inspection_states WHERE (level='SUSPENDED' OR (level='REDUCED' AND COALESCE((counters->>'reducedAccepts')::int,0)>=10)) ORDER BY updated_at DESC LIMIT 100`);
    for (const row of manual.rows) {
      const taskType = row.level === 'SUSPENDED' ? 'SUPPLIER_IMPROVEMENT_CONFIRMATION' : 'EXEMPTION_APPROVAL_REVIEW';
      await query(`INSERT INTO qms_iqc_virtual_tasks(task_key,task_type,title,material_code,supplier_code,payload,requires_human,priority)
        VALUES($1,$2,$3,$4,$5,$6::jsonb,TRUE,'HIGH') ON CONFLICT(task_key) DO UPDATE SET payload=EXCLUDED.payload,status=CASE WHEN qms_iqc_virtual_tasks.status='DONE' THEN 'DONE' ELSE 'OPEN' END`,
        [`${taskType}:${row.supplier_code}:${row.material_code}`, taskType, taskType === 'SUPPLIER_IMPROVEMENT_CONFIRMATION' ? '等待供应商质量改进确认' : '等待主管免检审批', row.material_code, row.supplier_code, JSON.stringify({ level: row.level, counters: row.counters, requiredAction: taskType === 'SUPPLIER_IMPROVEMENT_CONFIRMATION' ? '人工确认质量改进完成后转加严' : '主管确认连续10批合格且无投诉后转免检' })]);
      taskTypes.push(taskType);
    }
    await rememberIqcMemory(query, { memoryType: 'TASK_EPISODE', sourceType: 'IQC_AGENT_CRON', content: { runAt: new Date().toISOString(), pendingCount: pending.rowCount, planned }, createdBy: 'iqc-virtual-01' });
    return { pendingCount: pending.rowCount, planned, taskTypes, manualGateTasks: manual.rowCount, guidance: guidance.fileName };
  } finally { iqcVirtualCronBusy = false; }
}
app.post('/qms/iqc/virtual-employee/run-now', requirePermission('quality.execute'), async (_req, res) => { try { res.json(mutateEnvelope(await runIqcVirtualCron())); } catch (e) { res.status(409).json(errorEnvelope('IQC_AGENT_CRON_FAILED', e.message)); } });
app.get('/qms/iqc/virtual-employee/tasks', requirePermission('quality.view'), async (req, res) => { try { await iqcDefectLoopReady; const status = String(req.query.status || 'OPEN'); const r = await query(`SELECT * FROM qms_iqc_virtual_tasks WHERE ($1='' OR status=$1) ORDER BY CASE priority WHEN 'HIGH' THEN 0 ELSE 1 END,scheduled_at LIMIT 200`, [status]); res.json(listEnvelope(r.rows)); } catch (e) { res.status(500).json(errorEnvelope('IQC_AGENT_TASK_LIST_FAILED', e.message)); } });
app.post('/qms/iqc/virtual-employee/tasks/assign', requirePermission('quality.execute'), async (req, res) => { try { await iqcDefectLoopReady; const p = req.body || {}; const title = String(p.title || '').trim(); if (!title) return res.status(400).json(errorEnvelope('IQC_AGENT_TASK_REQUIRED', 'title is required')); const key = String(p.taskKey || `MANUAL:${Date.now()}:${Math.random().toString(36).slice(2,8)}`); const r = await query(`INSERT INTO qms_iqc_virtual_tasks(task_key,task_type,title,lot_no,material_code,supplier_code,payload,status,requires_human,priority,assigned_to,assigned_by,due_at,instructions) VALUES($1,'MANUAL_ASSIGNMENT',$2,$3,$4,$5,$6::jsonb,'ASSIGNED',FALSE,$7,$8,$9,$10,$11) RETURNING *`, [key,title,p.lotNo||null,p.materialCode||null,p.supplierCode||null,JSON.stringify(p.payload||{}),String(p.priority||'NORMAL').toUpperCase(),String(p.assignedTo||'IQC-VIRTUAL-01'),req.user?.username||p.assignedBy||'quality',p.dueAt||null,String(p.instructions||'')]); res.status(201).json(mutateEnvelope(r.rows[0])); } catch (e) { res.status(400).json(errorEnvelope('IQC_AGENT_TASK_ASSIGN_FAILED', e.message)); } });
app.post('/qms/iqc/virtual-employee/tasks/:id/complete', requirePermission('quality.execute'), async (req, res) => { try { await iqcDefectLoopReady; const r = await query(`UPDATE qms_iqc_virtual_tasks SET status='DONE',completed_at=NOW(),completion_summary=$1 WHERE id=$2 AND status IN('ASSIGNED','OPEN','IN_PROGRESS') RETURNING *`, [String(req.body?.completionSummary||''), req.params.id]); if (!r.rows[0]) return res.status(409).json(errorEnvelope('IQC_AGENT_TASK_COMPLETE_INVALID', 'task is not open')); res.json(mutateEnvelope(r.rows[0])); } catch (e) { res.status(409).json(errorEnvelope('IQC_AGENT_TASK_COMPLETE_FAILED', e.message)); } });
const iqcVirtualCronInterval = Math.max(60000, Number(process.env.IQC_AGENT_INTERVAL_MS || 900000));
setInterval(() => { void runIqcVirtualCron().catch(error => console.error('[IQC-VIRTUAL-CRON]', error.message)); }, iqcVirtualCronInterval);
app.get('/qms/iqc/guidance-documents', requirePermission('quality.view'), async (_req,res)=>{try{await iqcDefectLoopReady;const r=await query(`SELECT id,guidance_key,file_name,version_no,status,workbook,imported_by,imported_at,activated_by,activated_at,deleted_by,deleted_at FROM qms_iqc_guidance_documents WHERE guidance_key='SMT_IQC' AND status<>'DELETED' ORDER BY CASE WHEN status='ACTIVE' THEN 0 ELSE 1 END, imported_at DESC`);res.json(listEnvelope(r.rows));}catch(e){res.status(500).json(errorEnvelope('IQC_GUIDANCE_LIST_FAILED',e.message));}});
app.post('/qms/iqc/guidance-documents', requirePermission('quality.execute'), async (req,res)=>{
  const p=req.body||{}, fileName=String(p.fileName||'').trim(), key=String(p.guidanceKey||'SMT_IQC').trim(), operator=String(p.operator||req.user?.username||'operator'), versionNo=String(p.versionNo||`V-${new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14)}-${Date.now().toString().slice(-5)}`).trim().slice(0,40);
  if(!fileName||!p.workbook) return res.status(400).json(errorEnvelope('IQC_GUIDANCE_REQUIRED','fileName and workbook are required'));
  try {
    await iqcDefectLoopReady;
    await query(`UPDATE qms_iqc_guidance_documents SET status='IDLE',activated_by=$2,activated_at=NOW() WHERE guidance_key=$1 AND status='ACTIVE'`,[key,operator]);
    const r=await query(`
      INSERT INTO qms_iqc_guidance_documents
        (guidance_key,file_name,version_no,status,workbook,imported_by,activated_by,activated_at,deleted_by,deleted_at)
      VALUES ($1,$2,$3,'ACTIVE',$4::jsonb,$5,$5,NOW(),NULL,NULL)
      ON CONFLICT (guidance_key,version_no) DO UPDATE SET
        file_name=EXCLUDED.file_name,
        status='ACTIVE',
        workbook=EXCLUDED.workbook,
        imported_by=EXCLUDED.imported_by,
        imported_at=NOW(),
        activated_by=EXCLUDED.activated_by,
        activated_at=NOW(),
        deleted_by=NULL,
        deleted_at=NULL
      RETURNING id,guidance_key,file_name,version_no,status,workbook,imported_by,imported_at,activated_by,activated_at
    `,[key,fileName,versionNo,JSON.stringify(p.workbook),operator]);
    return res.status(201).json(mutateEnvelope(r.rows[0]));
  } catch(e) { return res.status(409).json(errorEnvelope('IQC_GUIDANCE_IMPORT_FAILED',e.message)); }
});
app.post('/qms/iqc/guidance-documents/:id/activate', requirePermission('quality.execute'), async (req,res)=>{const id=Number(req.params.id),operator=String(req.body?.operator||req.user?.username||'quality');if(!Number.isInteger(id))return res.status(400).json(errorEnvelope('IQC_GUIDANCE_ID_REQUIRED','valid guidance document id required'));const client=await pgPool.connect();try{await iqcDefectLoopReady;await client.query('BEGIN');const d=(await client.query(`SELECT * FROM qms_iqc_guidance_documents WHERE id=$1 FOR UPDATE`,[id])).rows[0];if(!d||d.status==='DELETED')throw new Error('guidance document is unavailable');await client.query(`UPDATE qms_iqc_guidance_documents SET status='IDLE' WHERE guidance_key=$1 AND status='ACTIVE'`,[d.guidance_key]);const r=(await client.query(`UPDATE qms_iqc_guidance_documents SET status='ACTIVE',activated_by=$1,activated_at=NOW(),deleted_by=NULL,deleted_at=NULL WHERE id=$2 RETURNING id,guidance_key,file_name,version_no,status,activated_by,activated_at`,[operator,id])).rows[0];await client.query('COMMIT');res.json(mutateEnvelope(r));}catch(e){await client.query('ROLLBACK');res.status(409).json(errorEnvelope('IQC_GUIDANCE_ACTIVATE_FAILED',e.message));}finally{client.release();}});
app.post('/qms/iqc/guidance-documents/:id/idle', requirePermission('quality.execute'), async (req,res)=>{const id=Number(req.params.id),operator=String(req.body?.operator||req.user?.username||'quality');try{await iqcDefectLoopReady;const r=await query(`UPDATE qms_iqc_guidance_documents SET status='IDLE',activated_by=$1,activated_at=NOW() WHERE id=$2 AND status='ACTIVE' RETURNING id,guidance_key,file_name,version_no,status`,[operator,id]);if(!r.rows[0])return res.status(409).json(errorEnvelope('IQC_GUIDANCE_IDLE_INVALID','only the active guidance can be set idle'));res.json(mutateEnvelope(r.rows[0]));}catch(e){res.status(409).json(errorEnvelope('IQC_GUIDANCE_IDLE_FAILED',e.message));}});
app.delete('/qms/iqc/guidance-documents/:id', requirePermission('quality.execute'), async (req,res)=>{const id=Number(req.params.id),operator=String(req.body?.operator||req.user?.username||'quality');try{await iqcDefectLoopReady;const r=await query(`UPDATE qms_iqc_guidance_documents SET status='DELETED',deleted_by=$1,deleted_at=NOW() WHERE id=$2 AND status<>'ACTIVE' AND status<>'DELETED' RETURNING id,guidance_key,file_name,version_no,status,deleted_by,deleted_at`,[operator,id]);if(!r.rows[0])return res.status(409).json(errorEnvelope('IQC_GUIDANCE_DELETE_INVALID','active guidance cannot be deleted; set it idle or activate another version first'));res.json(mutateEnvelope(r.rows[0]));}catch(e){res.status(409).json(errorEnvelope('IQC_GUIDANCE_DELETE_FAILED',e.message));}});
app.get('/qms/iqc/inspection-level-events', requirePermission('quality.view'), async (_req,res)=>{try{await iqcDefectLoopReady;const r=await query(`SELECT * FROM qms_iqc_inspection_level_events ORDER BY created_at DESC LIMIT 500`);res.json(listEnvelope(r.rows));}catch(e){res.status(500).json(errorEnvelope('IQC_LEVEL_EVENT_LIST_FAILED',e.message));}});
app.get('/qms/iqc/inspection-manual-events', requirePermission('quality.view'), async (_req,res)=>{try{await iqcDefectLoopReady;const r=await query(`SELECT * FROM qms_iqc_inspection_manual_events ORDER BY created_at DESC LIMIT 500`);res.json(listEnvelope(r.rows));}catch(e){res.status(500).json(errorEnvelope('IQC_MANUAL_EVENT_LIST_FAILED',e.message));}});
app.post('/qms/iqc/inspection-levels/:action', requirePermission('quality.execute'), async (req,res)=>{
  const action=String(req.params.action||''), p=req.body||{}, s=String(p.supplierCode||'').trim(), m=String(p.materialCode||'').trim(), operator=String(p.operator||req.user?.username||'quality');
  if(!s||!m||!['approve-exempt','abnormal-return','supplier-improvement'].includes(action)) return res.status(400).json(errorEnvelope('IQC_LEVEL_MANUAL_REQUIRED','supplierCode, materialCode and valid manual action are required'));
  const client=await pgPool.connect();
  try {
    await iqcDefectLoopReady; await client.query('BEGIN');
    const before=(await client.query(`SELECT * FROM qms_iqc_inspection_states WHERE supplier_code=$1 AND material_code=$2 FOR UPDATE`,[s,m])).rows[0];
    if(!before) throw new Error('inspection state does not exist');
    if(action==='approve-exempt' && !String(p.reason||'').trim()) throw new Error('主管批准免检必须填写无生产投诉、无售后不良的确认依据');
    if(action==='approve-exempt' && (before.level!=='REDUCED' || Number(before.counters?.reducedAccepts||0)<10)) throw new Error('放宽检验必须连续10批合格后才可申请主管批准免检');
    const eligible=action==='approve-exempt'?before.level==='REDUCED':action==='abnormal-return'?['REDUCED','EXEMPT'].includes(before.level):before.level==='SUSPENDED';
    if(!eligible) throw new Error('state is not eligible for this manual action');
    const next=action==='approve-exempt'?'EXEMPT':action==='abnormal-return'?'NORMAL':'TIGHTENED';
    const counters={normalWindowBatches:0,normalWindowRejects:0,normalConsecutiveAccepts:0,tightenedAccepts:0,tightenedRejects:0,reducedAccepts:0};
    const updated=(await client.query(`UPDATE qms_iqc_inspection_states SET level=$1,counters=$2::jsonb,updated_at=NOW() WHERE id=$3 RETURNING *`,[next,JSON.stringify(counters),before.id])).rows[0];
    await client.query(`INSERT INTO qms_iqc_inspection_manual_events(supplier_code,material_code,action,level_before,level_after,reason,operator) VALUES($1,$2,$3,$4,$5,$6,$7)`,[s,m,action,before.level,next,p.reason||null,operator]);
    await client.query('COMMIT'); res.json(mutateEnvelope(updated));
  } catch(e) { await client.query('ROLLBACK'); res.status(409).json(errorEnvelope('IQC_LEVEL_MANUAL_FAILED',e.message)); }
  finally { client.release(); }
});
app.post('/qms/iqc/inspection-levels/record', requirePermission('quality.execute'), async (req,res) => {
  const p=req.body||{}, supplier=String(p.supplierCode||'').trim(), material=String(p.materialCode||'').trim(), lot=String(p.lotNo||'').trim(), result=String(p.result||'').toUpperCase();
  if(!supplier||!material||!lot||!['PASS','FAIL'].includes(result)) return res.status(400).json(errorEnvelope('IQC_LEVEL_RESULT_REQUIRED','supplierCode, materialCode, lotNo and PASS/FAIL result are required'));
  const client=await pgPool.connect();
  try { await iqcDefectLoopReady; await client.query('BEGIN'); await client.query(`INSERT INTO qms_iqc_inspection_states(supplier_code,material_code) VALUES($1,$2) ON CONFLICT(supplier_code,material_code) DO NOTHING`,[supplier,material]); const before=(await client.query(`SELECT * FROM qms_iqc_inspection_states WHERE supplier_code=$1 AND material_code=$2 FOR UPDATE`,[supplier,material])).rows[0]; const next=advanceInspectionLevelServer(before.level,before.counters,result); const updated=(await client.query(`UPDATE qms_iqc_inspection_states SET level=$1,counters=$2::jsonb,updated_at=NOW() WHERE id=$3 RETURNING *`,[next.level,JSON.stringify(next.counters),before.id])).rows[0]; await client.query(`INSERT INTO qms_iqc_inspection_level_events(supplier_code,material_code,lot_no,result,level_before,level_after,transition,inspection_date,source_file,abnormal_type,operator) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[supplier,material,lot,result,before.level,next.level,next.transition,p.inspectionDate||null,p.sourceFile||null,p.abnormalType||null,String(p.operator||'iqc')]); await client.query('COMMIT'); res.status(201).json(mutateEnvelope({state:updated,levelBefore:before.level,transition:next.transition,nextProcedure:next.level})); }
  catch(e){await client.query('ROLLBACK');res.status(409).json(errorEnvelope('IQC_LEVEL_RECORD_FAILED',e.message));} finally{client.release();}
});
}
