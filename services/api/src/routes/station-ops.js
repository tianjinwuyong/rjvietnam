// Station operations (/api/station/*, /api/journey/*, /api/ng-closed-loop), moved out
// of services/api/server.js.
//
// 35 registrations: the operator command that routes NG material between stations, the
// assembly ATE bank test, handover alarms, pass shortages and returns, retest control,
// aging records, packaging boxes and pallets, QR→work-order binding, SN and box journey
// queries, and the scrap approval chain.
//
// `recentStationEvents` is a module-level array in server.js that the delete route
// MUTATES in place (splice). It is injected by reference for the same reason
// deliveryWatchCache is in the pmc module: a copy would keep the route working while
// silently breaking every reader that shares the real one.
export function registerStationOpsRoutes(app, deps) {
  const {
    query, errorEnvelope, authenticateJWT, neuralBroadcast, readStationBuckets,
    commitStationBucket, projectStationProductionEvent, recordSnJourney,
    stationHandoverReady, stationHandoverAlarmReady, passShortageReady, passReturnReady,
    stationRetestReady, stationAgingHistoryReady, packagingBoxReady, packagingBoxAuditReady,
    snJourneyReady, boxJourneyReady, palletBindingReady, qrWorkOrderReady,
  } = deps;

app.post("/api/station/operator-command", async (req, res) => {
  const {
    action, sourceStationCode, destinationStationCode,
    batchId, sn, destinationBucket = "confirmed_ng", disposition,
  } = req.body ?? {};
  if (!action || !sourceStationCode || (!batchId && !sn)) {
    return res.status(400).json(errorEnvelope("VALIDATION", "action, sourceStationCode and batchId/sn required"));
  }
  try {
    const source = await readStationBuckets(sourceStationCode);
    const matches = item => batchId ? String(item.batchId || "") === String(batchId) : item.sn === sn;
    if (action === "RELEASE_CONFIRMED") {
      const released = source.confirmed_ng.filter(matches);
      source.confirmed_ng = source.confirmed_ng.filter(item => !matches(item));
      await commitStationBucket(sourceStationCode, "confirmed_ng", source.confirmed_ng);
      return res.json({ ok: true, action, affected: released.length });
    }
    if (action === "ACCEPT_TRANSFER" && destinationStationCode) {
      const destination = await readStationBuckets(destinationStationCode);
      const incoming = destination.pending_ng.filter(item => matches(item) && item.transferStatus === "WAITING_RECEIPT");
      if (!incoming.length) return res.status(404).json(errorEnvelope("NOT_FOUND", "waiting transfer not found"));
      const acceptedAt = Date.now();
      await stationHandoverReady;
      await query(`UPDATE station_handover_transfers SET status='COMPLETED',received_at=NOW(),accepted_by=$4
        WHERE batch_id=$1 AND source_station=$2 AND destination_station=$3 AND status='WAITING_RECEIPT'`,
        [String(batchId || ""), sourceStationCode, destinationStationCode, req.body.acceptedBy || destinationStationCode]);
      destination.pending_ng = destination.pending_ng.map(item => matches(item)
        ? { ...item, transferStatus: "RECEIVED", receivedAt: acceptedAt, acceptedBy: req.body.acceptedBy || destinationStationCode }
        : item);
      source.pending_ng = source.pending_ng.filter(item => !matches(item));
      source.confirmed_ng = source.confirmed_ng.filter(item => !matches(item));
      source.pass = source.pass.filter(item => !matches(item));
      await commitStationBucket(destinationStationCode, "pending_ng", destination.pending_ng);
      await commitStationBucket(destinationStationCode, "process", [{ stage: "TRANSFER_RECEIVED", batchId, sourceStationCode, acceptedAt }]);
      await commitStationBucket(sourceStationCode, "pending_ng", source.pending_ng);
      await commitStationBucket(sourceStationCode, "confirmed_ng", source.confirmed_ng);
      await commitStationBucket(sourceStationCode, "pass", source.pass);
      await commitStationBucket(sourceStationCode, "process", [{ stage: "HANDOVER_COMPLETED", batchId, destinationStationCode, acceptedAt }]);
      return res.json({ ok: true, action, batchId, accepted: incoming.length, acceptedAt });
    }
    if (action !== "MIGRATE_BATCH" || !destinationStationCode) {
      return res.status(400).json(errorEnvelope("VALIDATION", "unsupported operator command"));
    }
    const destination = await readStationBuckets(destinationStationCode);
    const ngUnits = source.confirmed_ng.filter(matches);
    const passUnits = source.pass.filter(matches);
    source.confirmed_ng = source.confirmed_ng.filter(item => !matches(item));
    source.pass = source.pass.filter(item => !matches(item));
    let routedNg = ngUnits.map(item => ({
      ...item,
      disposition: disposition || item.disposition,
      originStationCode: item.originStationCode || sourceStationCode,
      returnStationCode: sourceStationCode,
      isConfirmed: destinationBucket === "confirmed_ng",
      time: Date.now(),
    }));
    const requiresTransferReceipt = Boolean(destinationStationCode);
    const requiresReturnReceipt = disposition === "return_source" && sourceStationCode === "manu_rework";
    if (requiresTransferReceipt) {
      routedNg = routedNg.map(item => ({ ...item,
        transferStatus: "WAITING_RECEIPT", sentAt: Date.now(),
        sourceStationCode, destinationStationCode,
      }));
    }
    if (destinationStationCode === "manu_depanel") {
      const sourceKind = sourceStationCode === "manu_ict" ? "ICT" : "FCT";
      const sameMotherboard = destination[destinationBucket].filter(item =>
        String(item.batchId || item.sn) === String(batchId || sn));
      const otherSourceExists = sameMotherboard.some(item => sourceKind === "ICT"
        ? ["FCT_ONLY_NG", "ICT_FCT_NG"].includes(item.defectCode)
        : ["ICT_ONLY_NG", "ICT_FCT_NG"].includes(item.defectCode));
      const defectCode = otherSourceExists ? "ICT_FCT_NG" : `${sourceKind}_ONLY_NG`;
      const description = otherSourceExists
        ? "NG at both ICT and FCT → Depanel ICT+FCT NG BOX"
        : `${sourceKind} Confirmed NG → Depanel ${sourceKind} NG BOX`;
      if (otherSourceExists) {
        destination[destinationBucket] = destination[destinationBucket].map(item =>
          String(item.batchId || item.sn) === String(batchId || sn)
            ? { ...item, defectCode: "ICT_FCT_NG", defectDescription: description }
            : item);
      }
      routedNg = routedNg.map(item => ({ ...item, defectCode, defectDescription: description,
        sourceStationCode, destinationStationCode }));
    }
    destination[destinationBucket] = destination[destinationBucket].filter(item => !routedNg.some(row => row.sn === item.sn));
    destination[destinationBucket].push(...routedNg);
    destination.pass = destination.pass.filter(item => !passUnits.some(row => row.sn === item.sn));
    destination.pass.push(...passUnits.map(item => ({
      ...item, stationCode: destinationStationCode,
      sourceStationCode, destinationStationCode, time: Date.now(),
      ...(requiresTransferReceipt ? { transferStatus: "WAITING_RECEIPT", sentAt: Date.now() } : {}),
    })));
    if (requiresTransferReceipt) {
      const members = [...routedNg, ...passUnits];
      const transferBatchId = String(batchId || sn || "");
      await stationHandoverReady;
      await query(`INSERT INTO station_handover_transfers
        (batch_id,source_station,destination_station,destination_type,motherboard,member_count,status,sent_at,received_at,accepted_by,alarmed_at)
        VALUES ($1,$2,$3,$4,$5,$6,'WAITING_RECEIPT',NOW(),NULL,NULL,NULL)
        ON CONFLICT(batch_id,source_station,destination_station) DO UPDATE SET
          destination_type=EXCLUDED.destination_type,motherboard=EXCLUDED.motherboard,member_count=EXCLUDED.member_count,
          status='WAITING_RECEIPT',sent_at=NOW(),received_at=NULL,accepted_by=NULL,alarmed_at=NULL`,
        [transferBatchId, sourceStationCode, destinationStationCode,
         String(disposition || "NG_ROUTE").toUpperCase(),
         JSON.stringify({ batchId: transferBatchId, subBoards: members }), members.length]);
      await commitStationBucket(sourceStationCode, "process", [{ stage: requiresReturnReceipt ? "REPAIR_RETURN_WAITING_RECEIPT" : "NG_ROUTE_WAITING_RECEIPT",
        batchId: transferBatchId, destinationStationCode, memberCount: members.length, updatedAt: Date.now() }]);
      await commitStationBucket(destinationStationCode, "process", [{ stage: requiresReturnReceipt ? "REPAIR_RETURN_INCOMING" : "NG_TRANSFER_INCOMING",
        batchId: transferBatchId, sourceStationCode, memberCount: members.length, updatedAt: Date.now() }]);
      neuralBroadcast({ from: "mes_server", to: "*", type: requiresReturnReceipt ? "REPAIR_RETURN_WAITING_RECEIPT" : "TRANSFER_WAITING_RECEIPT",
        stationCode: sourceStationCode, payload: { batchId: transferBatchId, sourceStationCode,
          destinationStationCode, memberCount: members.length }, priority: "critical" });
    }
    await commitStationBucket(sourceStationCode, "confirmed_ng", source.confirmed_ng);
    await commitStationBucket(sourceStationCode, "pass", source.pass);
    await commitStationBucket(destinationStationCode, destinationBucket, destination[destinationBucket]);
    await commitStationBucket(destinationStationCode, "pass", destination.pass);
    return res.json({ ok: true, action, ngMoved: routedNg.length, passMoved: passUnits.length });
  } catch (error) {
    res.status(500).json(errorEnvelope("COMMAND_FAILED", error.message));
  }
});

app.post("/api/station/assembly-ate/test-position",async(req,res)=>{
  try{
    const side=String(req.body?.side||'').trim().toUpperCase();
    const operator=String(req.body?.operator||'OPERATOR').trim();
    if(!['L','R'].includes(side))return res.status(400).json(errorEnvelope('INVALID_ATE_BANK','side must be L or R'));
    const channels=Array.from({length:8},(_,index)=>`${side}${index+1}`);
    const requestedAt=Date.now();
    await commitStationBucket('manu_assem_ate','process',[{stage:'BANK_TEST_REQUESTED',side,channels,
      operator,requestedAt,awaitingExcelResults:true,independentProducts:true}]);
    neuralBroadcast({from:'mes_server',to:'manu_assem_ate',type:'ASSEMBLY_ATE_TEST_BANK_REQUESTED',
      priority:'critical',stationCode:'manu_assem_ate',payload:{side,channels,operator,requestedAt,
        expectedExcelChannels:channels,independentProducts:true}});
    const testTime=new Date(requestedAt).toISOString();
    const runId=`SIM-${requestedAt}`;
    const results=[];
    for(let index=0;index<channels.length;index+=1){
      const channel=channels[index];
      const sn=`ASM${String(requestedAt).slice(-8)}${side}${index+1}`;
      const result=index===5?'FAIL':'PASS';
      const row={channel,sn,result,testTime,errorCode:result==='FAIL'?'ATE_SIM_NG':'0',
        testDurationSeconds:Number((1.2+index*0.17).toFixed(2)),runId,independentProduct:true,simulation:true};
      results.push(row);
      if(result==='PASS')await projectStationProductionEvent(`${runId}:${channel}`,'manu_assem_ate','SN_SCAN',{
        ...row,batchId:sn,eventType:'assembly_ate_bank_test'});
      else await projectStationProductionEvent(`${runId}:${channel}`,'manu_assem_ate','NG_DEFECT',{
        ...row,batchId:sn,overallResult:'FAIL',subBoards:[{...row,slot:index+1}],eventType:'assembly_ate_bank_test'});
    }
    neuralBroadcast({from:'manu_assem_ate',to:'*',type:'ASSEMBLY_ATE_BANK_TEST_COMPLETED',priority:'info',
      stationCode:'manu_assem_ate',payload:{side,runId,testTime,results,passCount:7,failCount:1}});
    res.json({ok:true,side,channels,status:'COMPLETED',requestedAt,testTime,runId,results,passCount:7,failCount:1});
  }catch(error){res.status(500).json(errorEnvelope('ATE_POSITION_TEST_REQUEST_FAILED',error.message));}
});

app.get("/api/station/handovers", async (req, res) => {
  try {
    await stationHandoverAlarmReady;
    const values = [];
    const clauses = [];
    if (req.query.stationCode) {
      values.push(String(req.query.stationCode));
      clauses.push(`(source_station=$${values.length} OR destination_station=$${values.length})`);
    }
    if (req.query.status) {
      values.push(String(req.query.status));
      clauses.push(`status=$${values.length}`);
    }
    const result = await query(`SELECT h.transfer_id AS "transferId",h.batch_id AS "batchId",
      h.source_station AS "sourceStation",h.destination_station AS "destinationStation",
      h.destination_type AS "destinationType",h.member_count AS "memberCount",h.status,
      h.sent_at AS "sentAt",h.received_at AS "receivedAt",h.accepted_by AS "acceptedBy",h.alarmed_at AS "alarmedAt",
      ack.acknowledged_at AS "alarmAcknowledgedAt",ack.acknowledged_by AS "alarmAcknowledgedBy",h.motherboard
      FROM station_handover_transfers h LEFT JOIN station_handover_alarm_ack ack ON ack.transfer_id=h.transfer_id
      ${clauses.length ? `WHERE ${clauses.map(clause=>clause.replaceAll('source_station','h.source_station').replaceAll('destination_station','h.destination_station').replaceAll('status','h.status')).join(" AND ")}` : ""}
      ORDER BY sent_at DESC LIMIT 500`, values);
    res.json({ ok: true, items: result.rows });
  } catch (error) {
    res.status(500).json(errorEnvelope("HANDOVER_QUERY_FAILED", error.message));
  }
});

app.get('/api/station/pass-shortages',async(req,res)=>{
  try{await passShortageReady;const status=String(req.query.status||'').trim();const params=[];
    const where=status?(params.push(status),`WHERE status=$1`):'';
    const result=await query(`SELECT shortage_id AS "shortageId",source_station AS "sourceStation",
      destination_station AS "destinationStation",batch_id AS "batchId",expected_count AS "expectedCount",
      actual_count AS "actualCount",missing_sns AS "missingSns",reason_code AS "reasonCode",reason_detail AS "reasonDetail",
      status,reported_by AS "reportedBy",detected_at AS "detectedAt",explained_at AS "explainedAt",
      resolved_at AS "resolvedAt",alarm_acknowledged_at AS "alarmAcknowledgedAt",
      alarm_acknowledged_by AS "alarmAcknowledgedBy" FROM station_pass_shortages ${where}
      ORDER BY detected_at DESC LIMIT 1000`,params);res.json({ok:true,items:result.rows});
  }catch(error){res.status(500).json(errorEnvelope('PASS_SHORTAGE_QUERY_FAILED',error.message));}
});
app.get('/api/station/retest/status',async(req,res)=>{try{await stationRetestReady;const station=String(req.query.stationCode||''),sn=String(req.query.sn||'').toUpperCase();if(!station||!sn)return res.status(400).json(errorEnvelope('VALIDATION','stationCode and sn required'));const q=await query(`SELECT station_code AS "stationCode",execution_station AS "executionStation",sn,batch_id AS "batchId",first_failed_at AS "firstFailedAt",attempts_used AS "attemptsUsed",max_attempts AS "maxAttempts",armed,armed_at AS "armedAt",permission_by AS "permissionBy",last_result AS "lastResult" FROM station_retest_control WHERE (station_code=$1 OR ($1='manu_agingcab' AND station_code IN('manu_hivolt_ate','manu_package_ate'))) AND UPPER(sn)=UPPER($2) ORDER BY updated_at DESC LIMIT 1`,[station,sn]);res.json({ok:true,item:q.rows[0]||null});}catch(error){res.status(500).json(errorEnvelope('RETEST_STATUS_FAILED',error.message));}});

app.get('/api/station/aging-records',async(req,res)=>{try{
  await stationAgingHistoryReady;
  const sn=String(req.query.sn||'').trim().toUpperCase();
  const limit=Math.min(Math.max(Number(req.query.limit)||200,1),1000);
  const current=await query(`SELECT sn,batch_id AS "batchId",station_code AS "stationCode",
    aging_started_at AS "agingStartedAt",aging_deadline_at AS "agingDeadlineAt",latest_result AS "latestResult",
    status,ng_detected_at AS "ngDetectedAt",completed_at AS "completedAt",updated_at AS "updatedAt"
    FROM station_aging_control WHERE ($1='' OR UPPER(sn)=UPPER($1)) ORDER BY updated_at DESC LIMIT $2`,[sn,limit]);
  const events=await query(`SELECT aging_event_id AS "eventId",sn,batch_id AS "batchId",event_type AS "eventType",
    result,station_code AS "stationCode",source_type AS "sourceType",aging_started_at AS "agingStartedAt",
    aging_deadline_at AS "agingDeadlineAt",event_at AS "eventAt",destination_station AS "destinationStation",detail
    FROM station_aging_events WHERE ($1='' OR UPPER(sn)=UPPER($1)) ORDER BY event_at DESC,aging_event_id DESC LIMIT $2`,[sn,limit]);
  res.json({ok:true,current:current.rows,events:events.rows});
}catch(error){res.status(500).json(errorEnvelope('AGING_RECORDS_FAILED',error.message));}});
app.post('/api/station/retest/mode',async(req,res)=>{try{await stationRetestReady;const p=req.body||{},station=String(p.stationCode||''),actor=String(p.actor||'OPERATOR');if(!station)return res.status(400).json(errorEnvelope('VALIDATION','stationCode required'));const oneShot=Boolean(p.oneShot);if(Boolean(p.enabled)&&!oneShot)return res.status(403).json(errorEnvelope('MES_POLICY_REQUIRED','retest limits are configured in MES; unlimited mode is not permitted'));await query(`INSERT INTO station_retest_mode(station_code,enabled,changed_at,changed_by) VALUES($1,FALSE,NOW(),$2) ON CONFLICT(station_code) DO UPDATE SET enabled=FALSE,changed_at=excluded.changed_at,changed_by=excluded.changed_by`,[station,actor]);await query(`INSERT INTO station_retest_audit(station_code,sn,action,actor,detail) VALUES($1,'*',$2,$3,$4)`,[station,oneShot?'RETEST_REQUESTED':'RETEST_MODE_DISABLED',actor,JSON.stringify({oneShot,source:'MES_POLICY'})]);res.json({ok:true,stationCode:station,enabled:false,oneShot});}catch(error){res.status(500).json(errorEnvelope('RETEST_MODE_FAILED',error.message));}});
app.get('/api/station/retest/mode',async(req,res)=>{try{await stationRetestReady;const station=String(req.query.stationCode||'');if(!station)return res.status(400).json(errorEnvelope('VALIDATION','stationCode required'));const row=(await query(`SELECT station_code AS "stationCode",enabled,changed_at AS "changedAt",changed_by AS "changedBy" FROM station_retest_mode WHERE station_code=$1`,[station])).rows[0];res.json({ok:true,item:row||{stationCode:station,enabled:false}});}catch(error){res.status(500).json(errorEnvelope('RETEST_MODE_FAILED',error.message));}});
app.post('/api/station/retest/arm',async(req,res)=>{try{await stationRetestReady;const p=req.body||{};const station=String(p.stationCode||''),sn=String(p.sn||'').toUpperCase(),actor=String(p.actor||'OPERATOR');if(!station||!sn)return res.status(400).json(errorEnvelope('VALIDATION','stationCode and sn required'));
  const unlimitedMode=false;
  const specialOrigins=['manu_hivolt_ate','manu_package_ate'];
  let configuredLimit=specialOrigins.includes(station)?3:2;
  try { const published=(await query(`SELECT configuration FROM mes_route_configurations WHERE status='PUBLISHED' LIMIT 1`)).rows[0]?.configuration; const policy=(published?.ngPolicies||[]).find((item)=>Array.isArray(item.appliesTo)&&item.appliesTo.includes(station)); if(policy?.action?.retestLimit!==undefined) configuredLimit=Math.max(0,Number(policy.action.retestLimit)||0); } catch (_) {}
  if(station!=='manu_agingcab')await query(`INSERT INTO station_retest_control(station_code,sn,batch_id,first_failed_at,max_attempts) VALUES($1,$2,$3,COALESCE($4::timestamptz,NOW()),$5) ON CONFLICT(station_code,sn) DO NOTHING`,[station,sn,p.batchId||null,p.firstFailedAt||null,configuredLimit]);
  const state=(await query(`SELECT *,NOW()-first_failed_at AS age FROM station_retest_control WHERE UPPER(sn)=UPPER($2)
    AND (station_code=$1 OR ($1='manu_agingcab' AND station_code=ANY($3::text[]))) ORDER BY updated_at DESC LIMIT 1`,[station,sn,specialOrigins])).rows[0];
  if(!state)return res.status(409).json(errorEnvelope('RETEST_SOURCE_NOT_FOUND','no high-voltage/package ATE retest record for this SN'));
  if(!unlimitedMode&&specialOrigins.includes(state.station_code)&&state.attempts_used>=1&&station!=='manu_agingcab')return res.status(409).json({ok:false,code:'AGING_CAB_RETEST_REQUIRED',destinationStation:'manu_agingcab',nextAttempt:state.attempts_used+1});
  if(!unlimitedMode&&specialOrigins.includes(state.station_code)&&state.attempts_used<1&&station==='manu_agingcab')return res.status(409).json({ok:false,code:'FIRST_RETEST_REQUIRED_AT_ORIGIN',originStation:state.station_code});
  if(!unlimitedMode&&state.attempts_used>=state.max_attempts)return res.status(409).json({ok:false,code:'NO_RETEST_CHANCE',remaining:0,destinationRequired:true});
  const overdue=Date.now()-new Date(state.first_failed_at).getTime()>2*60*60*1000;if(!unlimitedMode&&overdue&&!p.permissionBy)return res.status(403).json({ok:false,code:'RETEST_PERMISSION_REQUIRED',overdue:true,remaining:state.max_attempts-state.attempts_used});
  const executionStation=specialOrigins.includes(state.station_code)&&state.attempts_used>=1?'manu_agingcab':state.station_code;
  const armed=await query(`UPDATE station_retest_control SET armed=TRUE,execution_station=$3,armed_at=NOW(),armed_by=$4,permission_by=COALESCE($5,permission_by),permission_reason=COALESCE($6,permission_reason),updated_at=NOW() WHERE station_code=$1 AND sn=$2 RETURNING attempts_used,max_attempts,batch_id`,[state.station_code,sn,executionStation,actor,p.permissionBy||null,p.permissionReason||null]);const attempt=armed.rows[0].attempts_used+1;
  await query(`INSERT INTO station_retest_audit(station_code,sn,batch_id,action,attempt_no,actor,detail) VALUES($1,$2,$3,'ARMED',$4,$5,$6)`,[state.station_code,sn,armed.rows[0].batch_id,attempt,actor,JSON.stringify({overdue,permissionBy:p.permissionBy||null,executionStation,unlimitedMode})]);res.json({ok:true,armed:true,originStation:state.station_code,executionStation,attempt,unlimitedMode,remaining:unlimitedMode?null:Math.max(0,armed.rows[0].max_attempts-attempt)});
 }catch(error){res.status(500).json(errorEnvelope('RETEST_ARM_FAILED',error.message));}});
app.post('/api/station/retest/complete',async(req,res)=>{try{await stationRetestReady;const p=req.body||{},station=String(p.stationCode||''),sn=String(p.sn||'').toUpperCase(),result=String(p.result||'REVIEWED').toUpperCase();const done=await query(`UPDATE station_retest_control SET attempts_used=attempts_used+1,armed=FALSE,armed_at=NULL,last_result=$3,last_completed_at=NOW(),updated_at=NOW() WHERE (station_code=$1 OR execution_station=$1) AND sn=$2 AND armed=TRUE RETURNING station_code,attempts_used,max_attempts,batch_id`,[station,sn,result]);if(!done.rows.length)return res.status(409).json(errorEnvelope('RETEST_NOT_ARMED','press retest before scan/test'));const row=done.rows[0];await query(`INSERT INTO station_retest_audit(station_code,sn,batch_id,action,attempt_no,actor,result,detail) VALUES($1,$2,$3,'COMPLETED',$4,$5,$6,$7)`,[row.station_code,sn,row.batch_id,row.attempts_used,p.actor||'OPERATOR',result,JSON.stringify({...p.detail,executionStation:station})]);const confirmedNg=result==='FAIL'&&row.attempts_used>=row.max_attempts;res.json({ok:true,originStation:row.station_code,executionStation:station,attemptsUsed:row.attempts_used,remaining:row.max_attempts-row.attempts_used,confirmedNg,maintenanceAllowed:confirmedNg});}catch(error){res.status(500).json(errorEnvelope('RETEST_COMPLETE_FAILED',error.message));}});
app.post('/api/station/pass-shortages',async(req,res)=>{
  try{await passShortageReady;const p=req.body||{};const expected=Number(p.expectedCount||0),actual=Number(p.actualCount||0);
    if(!p.sourceStation||!p.destinationStation||expected<=actual)return res.status(400).json(errorEnvelope('VALIDATION','sourceStation, destinationStation and expectedCount > actualCount required'));
    const created=await query(`INSERT INTO station_pass_shortages(source_station,destination_station,batch_id,expected_count,actual_count,missing_sns,reported_by)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING shortage_id AS "shortageId"`,[p.sourceStation,p.destinationStation,p.batchId||null,expected,actual,JSON.stringify(p.missingSns||[]),p.reportedBy||null]);
    const payload={shortageId:created.rows[0].shortageId,batchId:p.batchId,sourceStation:p.sourceStation,destinationStation:p.destinationStation,
      expectedCount:expected,actualCount:actual,shortageCount:expected-actual,missingSns:p.missingSns||[]};
    neuralBroadcast({from:'mes_server',to:'*',type:'PASS_SHORTAGE_ALARM',priority:'critical',stationCode:p.destinationStation,payload});
    res.status(201).json({ok:true,item:payload});
  }catch(error){res.status(500).json(errorEnvelope('PASS_SHORTAGE_CREATE_FAILED',error.message));}
});
app.post('/api/station/pass-shortages/:id/explain',async(req,res)=>{
  try{await passShortageReady;const reasonCode=String(req.body?.reasonCode||'');const allowed=['TEST_USE','IN_TRANSFER','TEMP_STORAGE','REPAIR_QUALITY_HOLD','SCRAP_PENDING','OTHER'];
    if(!allowed.includes(reasonCode)||!String(req.body?.reasonDetail||'').trim())return res.status(400).json(errorEnvelope('VALIDATION','valid reasonCode and reasonDetail required'));
    const result=await query(`UPDATE station_pass_shortages SET reason_code=$2,reason_detail=$3,reported_by=$4,
      status='EXPLAINED',explained_at=NOW() WHERE shortage_id=$1 AND status IN('OPEN','EXPLAINED') RETURNING shortage_id`,
      [req.params.id,reasonCode,String(req.body.reasonDetail).trim(),req.body.reportedBy||'MES']);
    if(!result.rows.length)return res.status(409).json(errorEnvelope('INVALID_STATE','shortage is already resolved'));
    res.json({ok:true});
  }catch(error){res.status(500).json(errorEnvelope('PASS_SHORTAGE_EXPLAIN_FAILED',error.message));}
});
app.post('/api/station/pass-shortages/:id/acknowledge-alarm',async(req,res)=>{
  try{await passShortageReady;const updated=await query(`UPDATE station_pass_shortages SET alarm_acknowledged_at=NOW(),alarm_acknowledged_by=$2
    WHERE shortage_id=$1 AND status<>'RESOLVED' RETURNING destination_station`,[req.params.id,req.body?.actor||'MES_MANUAL_RELEASE']);
    const stationCode=updated.rows[0]?.destination_station;neuralBroadcast({from:'mes_server',to:'*',type:'PASS_SHORTAGE_ALARM_RELEASE',priority:'info',stationCode,payload:{shortageId:req.params.id,stationCode,stillOpen:true}});res.json({ok:true});
  }catch(error){res.status(500).json(errorEnvelope('PASS_SHORTAGE_ACK_FAILED',error.message));}
});
app.post('/api/station/pass-shortages/:id/resolve',async(req,res)=>{
  try{await passShortageReady;const result=await query(`UPDATE station_pass_shortages SET status='RESOLVED',resolved_at=NOW()
    WHERE shortage_id=$1 AND reason_code IS NOT NULL AND status<>'RESOLVED' RETURNING shortage_id`,[req.params.id]);
    if(!result.rows.length)return res.status(409).json(errorEnvelope('REASON_REQUIRED','explain the shortage before resolution'));res.json({ok:true});
  }catch(error){res.status(500).json(errorEnvelope('PASS_SHORTAGE_RESOLVE_FAILED',error.message));}
});
app.get('/api/station/pass-returns',async(_req,res)=>{try{await passReturnReady;const r=await query(`SELECT return_id AS "returnId",shortage_id AS "shortageId",source_station AS "sourceStation",destination_station AS "destinationStation",batch_id AS "batchId",sns,quantity,reason,status,requested_by AS "requestedBy",requested_at AS "requestedAt",approved_by AS "approvedBy",approved_at AS "approvedAt",received_at AS "receivedAt",received_by AS "receivedBy" FROM station_pass_return_requests ORDER BY requested_at DESC LIMIT 1000`);res.json({ok:true,items:r.rows});}catch(error){res.status(500).json(errorEnvelope('PASS_RETURN_QUERY_FAILED',error.message));}});
app.get('/api/station/packaging-boxes',async(req,res)=>{try{await packagingBoxReady;const search=String(req.query.search||'').trim();const params=search?[`%${search}%`]:[];const where=search?'WHERE container_id ILIKE $1 OR work_order_code ILIKE $1 OR items::text ILIKE $1':'';const r=await query(`SELECT container_id AS "containerId",work_order_code AS "workOrderCode",station_code AS "stationCode",capacity,current_count AS "currentCount",status,items,created_at AS "createdAt",updated_at AS "updatedAt",sealed_at AS "sealedAt" FROM station_packaging_boxes ${where} ORDER BY updated_at DESC LIMIT 1000`,params);res.json({ok:true,items:r.rows});}catch(error){res.status(500).json(errorEnvelope('PACKAGING_BOX_QUERY_FAILED',error.message));}});
app.get('/api/station/packaging-box-audit',async(req,res)=>{try{await packagingBoxAuditReady;const container=String(req.query.containerId||'').trim().toUpperCase(),sn=String(req.query.sn||'').trim().toUpperCase();const r=await query(`SELECT audit_id AS "auditId",container_id AS "containerId",product_sn AS "productSn",action,actor,detail,created_at AS "createdAt" FROM station_packaging_box_audit WHERE ($1='' OR UPPER(container_id)=UPPER($1)) AND ($2='' OR UPPER(product_sn)=UPPER($2)) ORDER BY created_at DESC LIMIT 2000`,[container,sn]);res.json({ok:true,items:r.rows});}catch(error){res.status(500).json(errorEnvelope('PACKAGING_AUDIT_QUERY_FAILED',error.message));}});
// SN行程查询 API
app.get('/api/journey/sn/:sn',async(req,res)=>{try{await snJourneyReady;const sn=String(req.params.sn||'').trim().toUpperCase();const [events,defects,repairs]=await Promise.all([query(`SELECT journey_id AS "journeyId",sn,batch_id AS "batchId",work_order_code AS "workOrderCode",event_type AS "eventType",event_stage AS "eventStage",station_code AS "stationCode",station_name AS "stationName",result,defect_code AS "defectCode",defect_description AS "defectDescription",operator,actor,detail,event_at AS "eventAt" FROM sn_journey_events WHERE UPPER(sn)=UPPER($1) ORDER BY event_at ASC`,[sn]),query(`SELECT id AS "ngDefectId",sn,station_code AS "stationCode",defect_code AS "defectCode",result,repair_status AS "repairStatus",operator,created_at AS "createdAt" FROM ng_defect_records WHERE UPPER(sn)=UPPER($1) ORDER BY created_at ASC`,[sn]),query(`SELECT repair_work_order_id AS "repairWorkOrderId",work_order_no AS "workOrderNo",batch_id AS "batchId",ng_sn AS "ngSn",source_station AS "sourceStation",status,repair_result AS "repairResult",repair_operator AS "repairOperator",repair_started_at AS "repairStartedAt",repair_completed_at AS "repairCompletedAt",created_at AS "createdAt" FROM station_repair_work_orders WHERE UPPER(ng_sn)=UPPER($1) ORDER BY created_at ASC`,[sn])]);res.json({ok:true,sn,pastEvents:events.rows,ngDefectRecords:defects.rows,repairWorkOrders:repairs.rows});}catch(error){res.status(500).json(errorEnvelope('SN_JOURNEY_QUERY_FAILED',error.message));}});
// SN行程列表查询
app.get('/api/journey/sns',async(req,res)=>{try{await snJourneyReady;const wo=String(req.query.workOrderCode||'').trim();const stage=String(req.query.stage||'').trim();const status=String(req.query.status||'').trim();const limit=Math.min(Number(req.query.limit||100),500);let params=[],where=['1=1'];if(wo){params.push(wo);where.push(`work_order_code=$${params.length}`);}if(stage){params.push(stage);where.push(`event_stage=$${params.length}`);}if(status){params.push(status);where.push(`(SELECT journey_status FROM sn_journey_view WHERE sn=sn_journey_events.sn LIMIT 1)=$${params.length}`);}const r=await query(`SELECT DISTINCT ON(sn) sn,batch_id AS "batchId",work_order_code AS "workOrderCode",(SELECT journey_status FROM sn_journey_view WHERE sn=sn_journey_events.sn LIMIT 1) AS "journeyStatus",(SELECT event_type FROM sn_journey_events e2 WHERE e2.sn=sn_journey_events.sn ORDER BY event_at DESC LIMIT 1) AS "lastEvent",(SELECT event_at FROM sn_journey_events e3 WHERE e3.sn=sn_journey_events.sn ORDER BY event_at DESC LIMIT 1) AS "lastEventAt" FROM sn_journey_events WHERE ${where.join(' AND ')} ORDER BY sn,event_at DESC`,params);res.json({ok:true,items:r.rows.slice(0,limit)});}catch(error){res.status(500).json(errorEnvelope('SN_JOURNEY_LIST_FAILED',error.message));}});

// SN进站报到 — 记录LINE_ENTRY事件到sn_journey_events，供进出平衡分析用
app.post('/api/station/:code/arrive',async(req,res)=>{try{const stationCode=String(req.params.code||'').trim().toLowerCase();const{sn,workOrderCode,operator,batchId}=req.body||{};if(!sn)return res.status(400).json(errorEnvelope('VALIDATION','sn required'));const normalizedSn=String(sn).trim().toUpperCase();// 查询工站信息
let stationName=stationCode;try{const st=await query(`SELECT name_zh FROM stations WHERE LOWER(code)=LOWER($1) LIMIT 1`,[stationCode]);if(st.rows.length)stationName=st.rows[0].name_zh;}catch(_){}// 查询工单信息
let wo=workOrderCode||'';if(!wo&&normalizedSn){try{const w=await query(`SELECT w.work_order_code FROM pcb_serials p JOIN work_orders w ON p.work_order_id=w.id WHERE UPPER(p.serial_no)=UPPER($1) LIMIT 1`,[normalizedSn]);if(w.rows.length)wo=w.rows[0].work_order_code;}catch(_){}}await recordSnJourney({sn:normalizedSn,batchId:batchId||null,workOrderCode:wo,eventType:'LINE_ENTRY',eventStage:'ENTER',stationCode,stationName,result:'ENTERED',defectCode:null,defectDescription:null,operator:operator||null,actor:null,detail:{报到来源:'API'}});res.json({ok:true,sn:normalizedSn,stationCode,stationName,workOrderCode:wo,eventType:'LINE_ENTRY'});}catch(error){res.status(500).json(errorEnvelope('STATION_ARRIVE_FAILED',error.message));}});
// 箱行程查询 API
app.get('/api/journey/box/:containerId',async(req,res)=>{try{await boxJourneyReady;const containerId=String(req.params.containerId||'').trim().toUpperCase();const r=await query(`SELECT journey_id AS "journeyId",container_id AS "containerId",work_order_code AS "workOrderCode",pallet_code AS "palletCode",event_type AS "eventType",event_stage AS "eventStage",location_code AS "locationCode",location_name AS "locationName",next_location_code AS "nextLocationCode",next_location_name AS "nextLocationName",operator,actor,detail,event_at AS "eventAt" FROM box_journey_records WHERE UPPER(container_id)=UPPER($1) ORDER BY event_at ASC`,[containerId]);res.json({ok:true,containerId,pastEvents:r.rows});}catch(error){res.status(500).json(errorEnvelope('BOX_JOURNEY_QUERY_FAILED',error.message));}});
// 箱行程列表查询
app.get('/api/journey/boxes',async(req,res)=>{try{await boxJourneyReady;const wo=String(req.query.workOrderCode||'').trim();const stage=String(req.query.stage||'').trim();const pallet=String(req.query.palletCode||'').trim();const limit=Math.min(Number(req.query.limit||100),500);let params=[],where=['1=1'];if(wo){params.push(wo);where.push(`work_order_code=$${params.length}`);}if(stage){params.push(stage);where.push(`event_stage=$${params.length}`);}if(pallet){params.push(pallet);where.push(`pallet_code=$${params.length}`);}const r=await query(`SELECT DISTINCT ON(container_id) container_id AS "containerId",work_order_code AS "workOrderCode",pallet_code AS "palletCode",(SELECT logistics_status FROM box_journey_view WHERE container_id=box_journey_records.container_id LIMIT 1) AS "logisticsStatus",(SELECT event_type FROM box_journey_records b2 WHERE b2.container_id=box_journey_records.container_id ORDER BY event_at DESC LIMIT 1) AS "lastEvent",(SELECT event_at FROM box_journey_records b3 WHERE b3.container_id=box_journey_records.container_id ORDER BY event_at DESC LIMIT 1) AS "lastEventAt" FROM box_journey_records WHERE ${where.join(' AND ')} ORDER BY container_id,event_at DESC`,params);res.json({ok:true,items:r.rows.slice(0,limit)});}catch(error){res.status(500).json(errorEnvelope('BOX_JOURNEY_LIST_FAILED',error.message));}});

// NG闭环状态查询 — 所有NG板的完整闭环链路
app.get('/api/ng-closed-loop',async(req,res)=>{try{await snJourneyReady;const wo=String(req.query.workOrderCode||'').trim();const station=String(req.query.stationCode||'').trim();const limit=Math.min(Number(req.query.limit||200),500);let ngParams=[],ngWhere=['1=1'];if(wo){ngParams.push(wo);ngWhere.push(`work_order_code=$${ngParams.length}`);}if(station){ngParams.push(station);ngWhere.push(`station_code=$${ngParams.length}`);}const ngRecords=await query(`SELECT DISTINCT ON(n.sn) n.ng_defect_id AS "ngDefectId",n.sn,n.batch_id AS "batchId",n.line_name AS "lineName",n.station_code AS "stationCode",n.defect_code AS "defectCode",n.defect_description AS "defectDescription",n.result,n.repair_status AS "repairStatus",n.created_at AS "ngDetectedAt" FROM ng_defect_records n WHERE n.result='fail' AND COALESCE(n.repair_status,'pending') NOT IN('repaired','scrapped') ${ngWhere.join(' AND ')} ORDER BY n.sn,n.created_at DESC`,ngParams);const sns=ngRecords.rows.map(r=>r.sn);let repairWos=[],revivalRecords=[],ngGuardStatus=[];if(sns.length>0){const[woResult,revResult,guardResult]=await Promise.all([query(`SELECT repair_work_order_id AS "repairWorkOrderId",work_order_no AS "workOrderNo",ng_sn AS "ngSn",source_station AS "sourceStation",status,repair_result AS "repairResult",repair_started_at AS "repairStartedAt",repair_completed_at AS "repairCompletedAt" FROM station_repair_work_orders WHERE UPPER(ng_sn)=ANY($1::text[])`,[sns]),query(`SELECT revival_id AS "revivalId",sn,approval_status AS "approvalStatus",revived_at AS "revivedAt" FROM ng_revival_audit WHERE UPPER(sn)=ANY($1::text[]) AND approval_status IN('RETURN_PENDING','APPROVED','PENDING_QUALITY','PENDING_LINE_LEADER')`,[sns]),query(`WITH active_ng AS(SELECT sn,'ng_defect' AS src,'DEFECT_RECORD' AS ngState FROM ng_defect_records WHERE UPPER(sn)=ANY($1::text[]) AND result='fail' UNION ALL SELECT UPPER(COALESCE(item->>'sn','')),s.station_code,CASE WHEN s.bucket_name='confirmed_ng' THEN 'CONFIRMED_NG' ELSE 'PENDING_NG' END FROM station_bucket_snapshots s CROSS JOIN LATERAL jsonb_array_elements(s.payload) item WHERE s.bucket_name IN('pending_ng','confirmed_ng') AND UPPER(COALESCE(item->>'sn',''))=ANY($1::text[])) SELECT sn,src AS "ngSource",ngState FROM active_ng`,[sns])]);repairWos=woResult.rows;revivalRecords=revResult.rows;ngGuardStatus=guardResult.rows;}const items=ngRecords.rows.map(ng=>{const repair=repairWos.filter(w=>String(w.ngSn||'').toUpperCase()===String(ng.sn||'').toUpperCase());const revival=revivalRecords.filter(r=>String(r.sn||'').toUpperCase()===String(ng.sn||'').toUpperCase());const guard=ngGuardStatus.filter(g=>String(g.sn||'').toUpperCase()===String(ng.sn||'').toUpperCase());let loopStatus='OPEN';if(guard.some(g=>g.ngState==='CONFIRMED_NG'))loopStatus='BLOCKED';else if(repair.some(r=>r.status==='REPAIR_IN_PROGRESS'))loopStatus='UNDER_REPAIR';else if(revival.some(r=>r.approvalStatus==='RETURN_PENDING'))loopStatus='RETURN_PENDING';else if(repair.some(r=>r.repairResult==='repaired')&&!guard.length)loopStatus='REVIVED';else if(repair.some(r=>r.repairResult==='scrapped'))loopStatus='SCRAPPED';return{...ng,repairWorkOrders:repair,revivalAudit:revival,ngGuardStatus:guard,loopStatus};});res.json({ok:true,total:items.length,items:items.slice(0,limit)});}catch(error){res.status(500).json(errorEnvelope('NG_CLOSED_LOOP_QUERY_FAILED',error.message));}});

// SN行程计划查询 — 基于工艺路线，返回计划节点序列（含NG分叉、维修、报废等计划节点）
app.get('/api/journey/plan/sn/:sn',async(req,res)=>{try{const sn=String(req.params.sn||'').trim().toUpperCase();if(!sn)return res.status(400).json(errorEnvelope('VALIDATION','sn required'));const workOrderCode=String(req.query.workOrderCode||'').trim();const productCode=String(req.query.productCode||'').trim();let routeId=null;let planSteps=[];// 查找SN对应的工艺路线
if(workOrderCode){const wo=await query(`SELECT route_id,product_code FROM work_orders WHERE work_order_code=$1`,[workOrderCode]);if(wo.rows.length){routeId=wo.rows[0].route_id;}}if(!routeId&&productCode){const pr=await query(`SELECT id FROM process_routes WHERE product_code=$1 AND status='active' ORDER BY revision DESC LIMIT 1`,[productCode]);if(pr.rows.length)routeId=pr.rows[0].id;}if(!routeId){const pcb=await query(`SELECT w.route_id,w.product_code FROM pcb_serials p JOIN work_orders w ON p.work_order_id=w.id WHERE UPPER(p.serial_no)=UPPER($1)`,[sn]);if(pcb.rows.length){routeId=pcb.rows[0].route_id;}}if(!routeId)return res.status(404).json(errorEnvelope('ROUTE_NOT_FOUND','工艺路线未找到，请提供workOrderCode或productCode'))// 获取工艺路线步骤
const steps=await query(`SELECT prs.step_no,prs.station_type,prs.required_scan,prs.required_inspection,prs.output_rule,s.code AS station_code,s.name_zh AS station_name FROM process_route_steps prs LEFT JOIN stations s ON s.id=prs.station_id WHERE prs.route_id=$1 ORDER BY prs.step_no`,[routeId]);// 生成计划节点序列
const planNodes=[];for(const step of steps.rows){const node={stepNo:step.step_no,stationType:step.station_type,stationCode:step.station_code,stationName:step.station_name,requiredScan:step.required_scan,requiredInspection:step.required_inspection,// 分叉定义
exits:[],// 该工站可能的退出路径
nextSteps:[]};// 如果output_rule包含NG相关，添加NG分叉
if(step.output_rule&&(step.output_rule.includes('ng')||step.output_rule.includes('reject'))){node.exits.push({type:'NG',label:'NG退出（报废/维修）',targetStage:'REPAIR',description:'NG时进入维修流程或报废'});}// 如果是测试工站（ICT/FCT），添加NG分叉
if(step.station_type&&(step.station_type.includes('ict')||step.station_type.includes('fct')||step.station_type.includes('test'))){node.exits.push({type:'NG',label:'NG退出（报废/维修）',targetStage:'REPAIR',description:'测试失败进入维修流程'});}planNodes.push(node);}// 添加维修节点（在任何NG之后可能出现的）
const repairNode={stepNo:999,stationType:'repair',stationCode:'manu_rework',stationName:'维修站',requiredScan:true,requiredInspection:false,exits:[{type:'RETURN',label:'返回产线复测',targetStage:'LINE',description:'维修完成后返回原工站复测'},{type:'SCRAP',label:'报废',targetStage:'DESTRUCTION',description:'维修失败报废'}],nextSteps:[],isRepair:true};planNodes.push(repairNode);// 添加包装节点
const packNode={stepNo:1000,stationType:'packaging',stationCode:'manu_case_binding',stationName:'包装工位',requiredScan:true,requiredInspection:false,exits:[],nextSteps:[],isPackaging:true};planNodes.push(packNode);// 添加最终的NG/报废/样品退出选项
for(let i=0;i<planNodes.length;i++){if(planNodes[i].stationType&&(planNodes[i].stationType.includes('ict')||planNodes[i].stationType.includes('fct')||planNodes[i].stationType.includes('test'))){planNodes[i].exits.push({type:'SAMPLE',label:'留样',targetStage:'SAMPLE',description:'抽取样品'});planNodes[i].exits.push({type:'SCRAP',label:'报废',targetStage:'DESTRUCTION',description:'直接报废'});}}res.json({ok:true,sn,workOrderCode,productCode,planNodes,totalSteps:planNodes.length});}catch(error){res.status(500).json(errorEnvelope('SN_PLAN_QUERY_FAILED',error.message));}});

// 箱行程计划查询 — 基于物流路线，返回计划节点序列
app.get('/api/journey/plan/box/:containerId',async(req,res)=>{try{const containerId=String(req.params.containerId||'').trim().toUpperCase();const workOrderCode=String(req.query.workOrderCode||'').trim();// 标准箱物流计划节点
const planNodes=[{stepNo:1,eventType:'ONLINE',eventStage:'PRODUCTION',locationCode:'manu_case_binding',locationName:'包装工位',description:'产品包装入箱',exits:[{type:'PALLETIZING',label:'上栈板',targetStage:'WAREHOUSE',description:'箱上栈板'}]},{stepNo:2,eventType:'PALLETIZING',eventStage:'WAREHOUSE',locationCode:'manu_pallet_binding',locationName:'栈板工位',description:'箱上栈板',exits:[{type:'WAREHOUSE_IN',label:'入库',targetStage:'WAREHOUSE',description:'栈板入库'}]},{stepNo:3,eventType:'WAREHOUSE_IN',eventStage:'WAREHOUSE',locationCode:'WH_STAGING',locationName:'仓库暂存区',description:'仓库入库',exits:[{type:'STORAGE',label:'存放',targetStage:'WAREHOUSE',description:'库存存放'},{type:'TRANSFER',label:'场内转移',targetStage:'WAREHOUSE',description:'厂内转移'}]},{stepNo:4,eventType:'STORAGE',eventStage:'WAREHOUSE',locationCode:'WH_STORAGE',locationName:'仓库存储区',description:'库存存储',exits:[{type:'EXPORT',label:'出口',targetStage:'DISTRIBUTION',description:'出库出口'},{type:'MOVE',label:'转移',targetStage:'WAREHOUSE',description:'库位转移'}]},{stepNo:5,eventType:'EXPORT',eventStage:'DISTRIBUTION',locationCode:'WH_OUTBOUND',locationName:'出库月台',description:'出库装车',exits:[{type:'IN_TRANSIT',label:'在途',targetStage:'DISTRIBUTION',description:'运输中'}]},{stepNo:6,eventType:'IN_TRANSIT',eventStage:'DISTRIBUTION',locationCode:'IN_TRANSIT',locationName:'运输中',description:'运输中',exits:[{type:'SOLD',label:'售出送达',targetStage:'COMPLETED',description:'客户签收'},{type:'RETURN_REQUEST',label:'退货',targetStage:'RETURN',description:'客户退货'}]},{stepNo:7,eventType:'SOLD',eventStage:'COMPLETED',locationCode:'CUSTOMER',locationName:'客户',description:'销售完成',exits:[{type:'RETURN_REQUEST',label:'退货',targetStage:'RETURN',description:'需要退货'}]},{stepNo:8,eventType:'RETURN_REQUEST',eventStage:'RETURN',locationCode:'RETURN_CENTER',locationName:'退货中心',description:'退货处理',exits:[{type:'RETURN_INBOUND',label:'退货入库',targetStage:'RETURN',description:'退货验收入库'},{type:'DESTROY',label:'销毁',targetStage:'DESTRUCTION',description:'退货销毁'}]},{stepNo:9,eventType:'RETURN_INBOUND',eventStage:'RETURN',locationCode:'WH_RETURN',locationName:'退货仓库',description:'退货入库',exits:[{type:'RETURN_REPAIR',label:'返厂维修',targetStage:'REPAIR',description:'退回工厂维修'},{type:'DESTROY',label:'销毁',targetStage:'DESTRUCTION',description:'直接销毁'}]},{stepNo:10,eventType:'RETURN_REPAIR',eventStage:'REPAIR',locationCode:'manu_rework',locationName:'维修站',description:'返厂维修',exits:[{type:'RE_WAREHOUSE',label:'重新入库',targetStage:'WAREHOUSE',description:'维修后重新入库'},{type:'DESTROY',label:'销毁',targetStage:'DESTRUCTION',description:'维修失败销毁'}]}];res.json({ok:true,containerId,workOrderCode,planNodes,totalSteps:planNodes.length});}catch(error){res.status(500).json(errorEnvelope('BOX_PLAN_QUERY_FAILED',error.message));}});
app.get('/api/station/pallets',async(_req,res)=>{try{await palletBindingReady;const r=await query(`SELECT p.pallet_code AS "palletCode",p.work_order_code AS "workOrderCode",p.station_code AS "stationCode",p.target_cartons AS "targetCartons",p.status,p.created_at AS "createdAt",p.sealed_at AS "sealedAt",COUNT(pc.container_id)::int AS "cartonCount",COALESCE(jsonb_agg(pc.container_id) FILTER(WHERE pc.container_id IS NOT NULL),'[]'::jsonb) AS cartons FROM station_pallets p LEFT JOIN station_pallet_cartons pc ON pc.pallet_code=p.pallet_code GROUP BY p.pallet_code ORDER BY p.updated_at DESC LIMIT 1000`);res.json({ok:true,items:r.rows});}catch(error){res.status(500).json(errorEnvelope('PALLET_QUERY_FAILED',error.message));}});
app.post('/api/station/pallets',async(req,res)=>{try{await Promise.all([palletBindingReady,qrWorkOrderReady]);const p=req.body||{},code=String(p.palletCode||'').trim().toUpperCase(),wo=String(p.workOrderCode||'');if(!code||!wo||Number(p.targetCartons||0)<1)return res.status(400).json(errorEnvelope('VALIDATION','palletCode,workOrderCode,targetCartons required'));await query(`INSERT INTO station_pallets(pallet_code,work_order_code,station_code,target_cartons,created_by) VALUES($1,$2,$3,$4,$5)`,[code,wo,p.stationCode||'manu_pallet_binding',Number(p.targetCartons),p.createdBy||'OPERATOR']);await query(`INSERT INTO station_qr_workorder_bindings(qr_code,qr_type,work_order_code,station_code,bound_by) VALUES($1,'PALLET_QR',$2,$3,$4) ON CONFLICT(qr_code) DO NOTHING`,[code,wo,p.stationCode||'manu_pallet_binding',p.createdBy||'OPERATOR']);await query(`INSERT INTO station_pallet_audit(pallet_code,action,actor,detail) VALUES($1,'CREATED',$2,$3)`,[code,p.createdBy||'OPERATOR',JSON.stringify({workOrderCode:wo,targetCartons:Number(p.targetCartons)})]);res.status(201).json({ok:true,palletCode:code});}catch(error){res.status(409).json(errorEnvelope('PALLET_CREATE_FAILED',error.message));}});
app.post('/api/station/pallets/:code/cartons',async(req,res)=>{try{await Promise.all([palletBindingReady,packagingBoxReady]);const pallet=(await query(`SELECT * FROM station_pallets WHERE pallet_code=$1`,[req.params.code])).rows[0];if(!pallet||pallet.status!=='loading')return res.status(409).json(errorEnvelope('PALLET_NOT_LOADING','pallet missing or sealed'));const before=Number((await query(`SELECT COUNT(*)::int count FROM station_pallet_cartons WHERE pallet_code=$1`,[req.params.code])).rows[0].count);if(before>=pallet.target_cartons)return res.status(409).json(errorEnvelope('PALLET_OVER_CAPACITY','target carton count reached'));const box=(await query(`SELECT * FROM station_packaging_boxes WHERE container_id=$1`,[req.body?.containerId])).rows[0];if(!box||!['full','sealed'].includes(box.status))return res.status(409).json(errorEnvelope('CARTON_NOT_SEALED','carton must be sealed'));if(box.work_order_code!==pallet.work_order_code)return res.status(409).json(errorEnvelope('WORK_ORDER_MISMATCH','carton and pallet work orders differ'));const sns=(Array.isArray(box.items)?box.items:[]).map(x=>String(typeof x==='string'?x:x?.sn||'').toUpperCase()).filter(Boolean);if(sns.length){const blocked=await query(`SELECT item->>'sn' sn FROM station_bucket_snapshots s CROSS JOIN LATERAL jsonb_array_elements(s.payload) item WHERE s.bucket_name='confirmed_ng' AND UPPER(COALESCE(item->>'sn',''))=ANY($1::text[]) LIMIT 1`,[sns]);if(blocked.rows.length)return res.status(409).json(errorEnvelope('PALLET_CONTAINS_NG',`confirmed NG ${blocked.rows[0].sn} cannot enter pallet`));const pending=await query(`SELECT transfer_id FROM station_handover_transfers WHERE status='WAITING_RECEIPT' AND motherboard::text ILIKE ANY($1::text[]) LIMIT 1`,[sns.map(sn=>`%${sn}%`)]);if(pending.rows.length)return res.status(409).json(errorEnvelope('PALLET_HAS_PENDING_HANDOVER','carton contains product with unfinished handover'));}await query(`INSERT INTO station_pallet_cartons(pallet_code,container_id,added_by) VALUES($1,$2,$3)`,[req.params.code,box.container_id,req.body?.addedBy||'OPERATOR']);await query(`INSERT INTO station_pallet_audit(pallet_code,action,actor,detail) VALUES($1,'CARTON_ADDED',$2,$3)`,[req.params.code,req.body?.addedBy||'OPERATOR',JSON.stringify({containerId:box.container_id,snCount:sns.length})]);const count=before+1;res.json({ok:true,count,remaining:pallet.target_cartons-count});}catch(error){const duplicate=error.code==='23505';res.status(409).json(errorEnvelope(duplicate?'CARTON_ALREADY_ON_PALLET':'PALLET_CARTON_ADD_FAILED',duplicate?'carton is already bound to a pallet':error.message));}});
app.post('/api/station/pallets/:code/seal',async(req,res)=>{try{await palletBindingReady;const p=(await query(`SELECT p.target_cartons,COUNT(pc.container_id)::int count,COALESCE(SUM(b.current_count),0)::int units,BOOL_AND(b.status IN('full','sealed')) all_sealed FROM station_pallets p LEFT JOIN station_pallet_cartons pc ON pc.pallet_code=p.pallet_code LEFT JOIN station_packaging_boxes b ON b.container_id=pc.container_id WHERE p.pallet_code=$1 AND p.status='loading' GROUP BY p.pallet_code`,[req.params.code])).rows[0];if(!p||p.count!==p.target_cartons)return res.status(409).json(errorEnvelope('PALLET_COUNT_MISMATCH','target carton quantity not reached'));if(!p.all_sealed)return res.status(409).json(errorEnvelope('PALLET_HAS_OPEN_CARTON','all cartons must be sealed'));await query(`UPDATE station_pallets SET status='sealed',sealed_at=NOW(),updated_at=NOW() WHERE pallet_code=$1`,[req.params.code]);await query(`INSERT INTO station_pallet_audit(pallet_code,action,actor,detail) VALUES($1,'SEALED',$2,$3)`,[req.params.code,req.body?.actor||'OPERATOR',JSON.stringify({cartonCount:p.count,unitCount:p.units})]);res.json({ok:true,cartonCount:p.count,unitCount:p.units});}catch(error){res.status(500).json(errorEnvelope('PALLET_SEAL_FAILED',error.message));}});
app.get('/api/station/qr-workorders',async(req,res)=>{try{await qrWorkOrderReady;const station=String(req.query.stationCode||'');const lineCode=String(req.query.lineCode||'L001').trim().toUpperCase();const params=station?[station]:[];const where=station?'WHERE station_code=$1':'';const bindingWhere=station?'WHERE "stationCode"=$1':'';const bindingsSql=`WITH combined AS (SELECT qr_code AS "qrCode",qr_type AS "qrType",work_order_code AS "workOrderCode",station_code AS "stationCode",bound_by AS "boundBy",bound_at AS "boundAt",status,detail FROM station_qr_workorder_bindings UNION ALL SELECT codes.qr_code,codes.qr_type,COALESCE(j.work_order_code,a.work_order_code,'UNRESOLVED'),p.station_code,p.operator,p.created_at,CASE WHEN COALESCE(j.work_order_code,a.work_order_code) IS NULL THEN 'WORK_ORDER_PENDING' ELSE 'ACTIVE' END,jsonb_build_object('pcbaSn',p.pcb_sn,'shellSn',p.shell_sn,'source','pcb_shell_bindings') FROM pcb_shell_bindings p CROSS JOIN LATERAL (VALUES (p.pcb_sn,'BOARD_QR'),(p.shell_sn,'SHELL_QR')) codes(qr_code,qr_type) LEFT JOIN LATERAL (SELECT e.work_order_code FROM sn_journey_events e WHERE UPPER(e.sn) IN (UPPER(p.pcb_sn),UPPER(p.shell_sn)) AND NULLIF(e.work_order_code,'') IS NOT NULL ORDER BY e.event_at DESC LIMIT 1) j ON TRUE LEFT JOIN station_active_workorders a ON a.station_code=p.station_code AND a.status='ACTIVE' WHERE NOT EXISTS (SELECT 1 FROM station_qr_workorder_bindings m WHERE UPPER(m.qr_code)=UPPER(codes.qr_code))) SELECT * FROM combined ${bindingWhere} ORDER BY "boundAt" DESC LIMIT 2000`;const [active,bindings,trace,available]=await Promise.all([query(`SELECT station_code AS "stationCode",work_order_code AS "workOrderCode",selected_by AS "selectedBy",selected_at AS "selectedAt",status FROM station_active_workorders ${where} ORDER BY selected_at DESC`,params),query(bindingsSql,params),query(`SELECT trace_id AS "traceId",qr_code AS "qrCode",work_order_code AS "workOrderCode",station_code AS "stationCode",event_type AS "eventType",result,scanned_at AS "scannedAt" FROM station_qr_workorder_trace ${where} ORDER BY scanned_at DESC LIMIT 2000`,params),query(`SELECT wo.code AS "workOrderCode",wo.status,wo.planned_qty AS "plannedQty",wo.completed_qty AS "completedQty",p.code AS "productCode",p.name_zh AS "productNameZh",pl.internal_code AS "lineCode",wo.created_at AS "createdAt" FROM work_orders wo JOIN products p ON p.id=wo.product_id JOIN production_lines pl ON pl.id=wo.line_id WHERE UPPER(pl.internal_code)=UPPER($1) AND LOWER(wo.status) IN ('released','running') ORDER BY CASE LOWER(wo.status) WHEN 'running' THEN 0 ELSE 1 END,wo.created_at ASC LIMIT 50`,[lineCode])]);res.json({ok:true,available:available.rows,active:active.rows,items:bindings.rows,trace:trace.rows,meta:{lineCode,count:available.rows.length}});}catch(error){res.status(500).json(errorEnvelope('QR_WORKORDER_QUERY_FAILED',error.message));}});
app.post('/api/station/active-workorder',async(req,res)=>{try{await qrWorkOrderReady;const station=String(req.body?.stationCode||''),workOrder=String(req.body?.workOrderCode||'');if(!station||!workOrder)return res.status(400).json(errorEnvelope('VALIDATION','stationCode and workOrderCode required'));await query(`INSERT INTO station_active_workorders(station_code,work_order_code,selected_by) VALUES($1,$2,$3) ON CONFLICT(station_code) DO UPDATE SET work_order_code=EXCLUDED.work_order_code,selected_by=EXCLUDED.selected_by,selected_at=NOW(),status='ACTIVE'`,[station,workOrder,req.body?.selectedBy||'MES']);res.json({ok:true,stationCode:station,workOrderCode:workOrder});}catch(error){res.status(500).json(errorEnvelope('ACTIVE_WORKORDER_FAILED',error.message));}});
app.post('/api/station/qr-workorders/bind',async(req,res)=>{try{await qrWorkOrderReady;const p=req.body||{},qr=String(p.qrCode||'').trim().toUpperCase(),station=String(p.stationCode||'');let workOrder=String(p.workOrderCode||'');if(!qr||!station)return res.status(400).json(errorEnvelope('VALIDATION','qrCode and stationCode required'));if(!workOrder){const active=await query(`SELECT work_order_code FROM station_active_workorders WHERE station_code=$1 AND status='ACTIVE'`,[station]);workOrder=active.rows[0]?.work_order_code||'';}if(!workOrder)return res.status(409).json(errorEnvelope('WORK_ORDER_REQUIRED','select active work order before scanning QR'));const existing=await query(`SELECT work_order_code FROM station_qr_workorder_bindings WHERE qr_code=$1`,[qr]);if(existing.rows.length&&existing.rows[0].work_order_code!==workOrder)return res.status(409).json(errorEnvelope('QR_WORK_ORDER_CONFLICT',`QR already belongs to ${existing.rows[0].work_order_code}`));await query(`INSERT INTO station_qr_workorder_bindings(qr_code,qr_type,work_order_code,station_code,bound_by,detail) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(qr_code) DO UPDATE SET station_code=EXCLUDED.station_code,status='ACTIVE',detail=EXCLUDED.detail`,[qr,p.qrType||'PRODUCT',workOrder,station,p.boundBy||station,JSON.stringify(p.detail||{})]);res.json({ok:true,qrCode:qr,workOrderCode:workOrder});}catch(error){res.status(500).json(errorEnvelope('QR_WORKORDER_BIND_FAILED',error.message));}});
app.post('/api/station/pass-returns',async(req,res)=>{try{await passReturnReady;const p=req.body||{};const sns=Array.isArray(p.sns)?p.sns.map(String).filter(Boolean):[];
  if(!p.sourceStation||!p.destinationStation||!p.reason||!sns.length)return res.status(400).json(errorEnvelope('VALIDATION','sourceStation,destinationStation,reason and sns required'));
  const r=await query(`INSERT INTO station_pass_return_requests(shortage_id,source_station,destination_station,batch_id,sns,quantity,reason,requested_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING return_id AS "returnId"`,[p.shortageId||null,p.sourceStation,p.destinationStation,p.batchId||null,JSON.stringify(sns),sns.length,p.reason,p.requestedBy||'STATION']);res.status(201).json({ok:true,returnId:r.rows[0].returnId});
 }catch(error){res.status(500).json(errorEnvelope('PASS_RETURN_CREATE_FAILED',error.message));}});
app.post('/api/station/pass-returns/:id/approve',async(req,res)=>{try{await Promise.all([passReturnReady,stationHandoverReady]);const approvedBy=String(req.body?.approvedBy||'MES');
  const updated=await query(`UPDATE station_pass_return_requests SET status='WAITING_RECEIPT',approved_by=$2,approved_at=NOW() WHERE return_id=$1 AND status='PENDING_MES_APPROVAL' RETURNING *`,[req.params.id,approvedBy]);
  if(!updated.rows.length)return res.status(409).json(errorEnvelope('INVALID_STATE','return request is not pending approval'));const x=updated.rows[0];const batch=String(x.batch_id||`PASS-RETURN-${x.return_id}`);const boards=x.sns.map(sn=>({sn,result:'PASS'}));
  await query(`INSERT INTO station_handover_transfers(batch_id,source_station,destination_station,destination_type,motherboard,member_count,status,sent_at) VALUES($1,$2,$3,'PASS_RETURN',$4,$5,'WAITING_RECEIPT',NOW()) ON CONFLICT(batch_id,source_station,destination_station) DO UPDATE SET destination_type='PASS_RETURN',motherboard=EXCLUDED.motherboard,member_count=EXCLUDED.member_count,status='WAITING_RECEIPT',sent_at=NOW(),received_at=NULL,accepted_by=NULL,alarmed_at=NULL`,[batch,x.source_station,x.destination_station,JSON.stringify({batchId:batch,subBoards:boards,passReturnId:x.return_id}),boards.length]);
  neuralBroadcast({from:'mes_server',to:'*',type:'PASS_RETURN_WAITING_RECEIPT',priority:'critical',stationCode:x.source_station,payload:{returnId:x.return_id,batchId:batch,sourceStation:x.source_station,destinationStation:x.destination_station,quantity:boards.length,timeoutSeconds:120}});res.json({ok:true});
 }catch(error){res.status(500).json(errorEnvelope('PASS_RETURN_APPROVE_FAILED',error.message));}});

app.post("/api/station/handovers/:id/acknowledge-alarm",authenticateJWT,async(req,res)=>{
  try{
    await stationHandoverAlarmReady;
    const actor=String(req.body?.actor||"MES_MANUAL_RELEASE").trim();
    const active=await query(`SELECT transfer_id AS "transferId",batch_id AS "batchId",source_station AS "sourceStation",
      destination_station AS "destinationStation" FROM station_handover_transfers
      WHERE transfer_id=$1 AND status='WAITING_RECEIPT' AND alarmed_at IS NOT NULL`,[req.params.id]);
    if(!active.rows.length)return res.status(409).json(errorEnvelope("ALARM_NOT_ACTIVE","handover alarm is not active"));
    await query(`INSERT INTO station_handover_alarm_ack(transfer_id,acknowledged_at,acknowledged_by)
      VALUES($1,NOW(),$2) ON CONFLICT(transfer_id) DO UPDATE SET acknowledged_at=NOW(),acknowledged_by=EXCLUDED.acknowledged_by`,[req.params.id,actor]);
    const result={rows:[{...active.rows[0],alarmAcknowledgedAt:new Date().toISOString()}]};
    if(!result.rows.length)return res.status(409).json(errorEnvelope("ALARM_NOT_ACTIVE","handover alarm is not active"));
    const row=result.rows[0];
    neuralBroadcast({from:'mes_server',to:'*',type:'HANDOVER_ALARM_ACKNOWLEDGED',priority:'info',
      stationCode:row.sourceStation,payload:{...row,actor,stillWaitingReceipt:true}});
    res.json({ok:true,item:{...row,actor,stillWaitingReceipt:true}});
  }catch(error){res.status(500).json(errorEnvelope("HANDOVER_ALARM_ACK_FAILED",error.message));}
});
}
