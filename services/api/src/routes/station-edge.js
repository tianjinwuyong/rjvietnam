// ============================================================================
// 工位边缘路由（station edge）—— 从 server.js 整段搬迁
// （refactor-plan-2026-11-21 阶段3轮3）。两段：
//   registerStationEdgeRoutes  = 原 server.js 5405-6115（20 路由：拦截/工单请求/
//     维护交接/NG 复活审计/SN 守卫与注册/sync 对账与冲突）。
//   registerStationScrapRoutes = 原 server.js 6135-6414（10 路由：统一报废审批链/
//     驻留统计/工位数据清除）。
// 挂载位置是语义的一部分：两段都注册在 app.use("/api", api) 与 app 级鉴权闸门
// 之上（server.js 原行号处各留一行 register 调用），不经 JWT 门 —— 与搬迁前逐条一致。
// query/errorEnvelope/createHash/neuralBroadcast 直接 import；其余依赖经 deps 注入。
// authenticateJWT 在 server.js 声明于挂载点之下（TDZ），由 server.js 侧转发闭包注入
// （station-ops 先例）。recentStationEvents 按引用注入：delete 路由原地 splice。
// ============================================================================
import { query } from "../db.js";
import { errorEnvelope } from "../shared/helpers.js";
import { createHash } from "node:crypto";
import { neuralBroadcast } from "../shared/neural-bus.js";
import { canonicalStationCode } from "../shared/station-identity.js";

export function registerStationEdgeRoutes(app, deps) {
  const {
    acceptWaitingHandoverByScan, appendImmutableAudit, commitStationBucket,
    confirmedMotherboardLayoutReady, factorySnMasterReady, immutableAuditReady,
    ngRevivalAuditColumnsReady, passShortageReady, readStationBuckets,
    registerRouteAlias, stationConflictAuditReady, stationConflictColumnsReady,
    stationConflictMeetingReady, stationConflictReady, stationHandoverReady,
    stationInterceptionReady, stationInventoryReady, stationNgReleaseReady,
    stationRepairMaterialReady, stationRepairWorkOrderReady, stationRetestReady,
    stationRouteProgressReady, stationRouteRequestReady, stationSnRegistryReady,
    stationSnapshotTableReady, stationSyncIndexesReady, vietnamProductionDate,
  } = deps;

app.get("/api/station/interceptions",async(req,res)=>{
  try{
    await stationInterceptionReady;
    const station=String(req.query.stationCode||"").trim();
    const interceptionType=String(req.query.interceptionType||"").trim();
    const limit=Math.max(1,Math.min(5000,Number(req.query.limit)||1000));
    const params=[];const conditions=[];
    if(station){params.push(station);conditions.push(`scanned_station=$${params.length}`);}
    if(interceptionType){params.push(interceptionType);conditions.push(`interception_type=$${params.length}`);}
    const where=conditions.length?`WHERE ${conditions.join(" AND ")}`:"";
    const itemParams=[...params,limit];
    const [items,summary]=await Promise.all([
      query(`SELECT interception_id AS "interceptionId",sn,batch_id AS "batchId",
        interception_type AS "interceptionType",source_station AS "sourceStation",
        destination_station AS "destinationStation",scanned_station AS "scannedStation",
        detail,status,intercepted_at AS "interceptedAt",released_at AS "releasedAt",release_reason AS "releaseReason"
        FROM station_interception_events ${where} ORDER BY intercepted_at DESC LIMIT $${itemParams.length}`,itemParams),
      query(`SELECT interception_type AS "interceptionType",status,COUNT(*)::int AS count
        FROM station_interception_events ${where} GROUP BY interception_type,status ORDER BY interception_type,status`,params)
    ]);
    res.json({ok:true,items:items.rows,summary:summary.rows});
  }catch(error){res.status(500).json(errorEnvelope("INTERCEPTION_QUERY_FAILED",error.message));}
});

app.get("/api/station/route-requests",async(req,res)=>{
  try{
    await stationRouteRequestReady;
    const destination=String(req.query.destinationStation||"").trim();
    const source=String(req.query.sourceStation||"").trim();
    const status=String(req.query.status||"").trim();const params=[];const conditions=[];
    if(destination){params.push(destination);conditions.push(`destination_station=$${params.length}`);}
    if(source){params.push(source);conditions.push(`source_station=$${params.length}`);}
    if(status){params.push(status);conditions.push(`status=$${params.length}`);}
    const result=await query(`SELECT request_id AS "requestId",('RH-'||TO_CHAR(submitted_at AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYYMMDD')||'-'||LPAD(request_id::text,6,'0')) AS "billNo",
      (SELECT work_order_no FROM station_repair_work_orders rwo WHERE rwo.route_request_id=station_route_requests.request_id) AS "repairWorkOrderNo",batch_id AS "batchId",source_station AS "sourceStation",
      destination_code AS destination,destination_station AS "destinationStation",workflow_code AS "workflowCode",
      motherboard,status,submitted_by AS "submittedBy",submitted_at AS "submittedAt",processed_at AS "processedAt",
      completed_at AS "completedAt",repair_started_at AS "repairStartedAt",repair_alarm_at AS "repairAlarmAt",
      CASE WHEN repair_started_at IS NULL THEN NULL ELSE EXTRACT(EPOCH FROM (COALESCE(completed_at,NOW())-repair_started_at))::int END AS "repairElapsedSeconds",
      notification_status AS "notificationStatus",detail
      FROM station_route_requests ${conditions.length?`WHERE ${conditions.join(" AND ")}`:""}
      ORDER BY submitted_at DESC LIMIT 1000`,params);
    res.json({ok:true,items:result.rows});
  }catch(error){res.status(500).json(errorEnvelope("ROUTE_REQUEST_QUERY_FAILED",error.message));}
});

app.post("/api/station/maintenance-handovers",async(req,res)=>{
  try{
    await Promise.all([stationRouteRequestReady,stationHandoverReady,stationRepairWorkOrderReady]);
    const payload=req.body||{};
    const sourceStation=String(payload.sourceStation||payload.stationCode||"").trim();
    const sourceStationName=String(payload.sourceStationName||sourceStation).trim();
    const ngSn=String(payload.ngSn||payload.sn||"").trim().toUpperCase();
    const batchId=String(payload.batchId||ngSn).trim();
    const members=Array.isArray(payload.members)?payload.members:[];
    const motherboard=payload.motherboard||{batchId,mainSn:ngSn,subBoards:(members.length?members:[{sn:ngSn,result:'FAIL'}])};
    const firstDetectedAtMs=Number(payload.firstDetectedAt||payload.detectedAt||Date.now());
    const repairDeadlineAtMs=Number(payload.repairDeadlineAt||firstDetectedAtMs+30*60*1000);
    if(!sourceStation||!ngSn)return res.status(400).json(errorEnvelope('VALIDATION','sourceStation and ngSn required'));
    if(sourceStation==='manu_assem_ate'){
      const confirmedBy=String(payload.confirmedBy||payload.submittedBy||'').trim();
      const confirmedRole=String(payload.confirmedRole||payload.submittedRole||'').trim().toUpperCase();
      if(!confirmedBy||!['OPERATOR','QC'].includes(confirmedRole))return res.status(403).json(errorEnvelope(
        'OPERATOR_OR_QC_CONFIRMATION_REQUIRED','Assembly ATE NG migration requires confirmer identity and OPERATOR/QC role'));
    }
    if(sourceStation==='manu_fct')return res.status(409).json(errorEnvelope('FCT_MUST_ROUTE_DEPANEL',
      'FCT confirmed NG must go to depanel first; repair WO can only be confirmed by depanel'));
    if(sourceStation==='manu_depanel'){
      const depanelState=await readStationBuckets('manu_depanel');
      const selected=depanelState.confirmed_ng.find(item=>String(item.sn||'').trim().toUpperCase()===ngSn||String(item.batchId||'')===batchId);
      const defectType=String(payload.defectType||payload.defectCode||selected?.defectCode||'').trim().toUpperCase();
      const validationRoutes={ICT_ONLY_NG:['manu_ict'],FCT_ONLY_NG:['manu_fct'],ICT_FCT_NG:['manu_ict','manu_fct']};
      const returnStations=validationRoutes[defectType];
      if(!selected)return res.status(409).json(errorEnvelope('DEPANEL_CONFIRMED_NG_NOT_FOUND','SN must exist in the Depanel confirmed NG box before maintenance handover'));
      if(!returnStations)return res.status(422).json(errorEnvelope('DEPANEL_NG_TYPE_REQUIRED','Depanel NG type must be ICT_ONLY_NG, FCT_ONLY_NG, or ICT_FCT_NG'));
      motherboard.subBoards=(Array.isArray(motherboard.subBoards)?motherboard.subBoards:[{sn:ngSn,result:'FAIL'}]).map(board=>({
        ...board,defectCode:defectType,ngType:defectType,originStationCode:'manu_depanel',returnStationCode:returnStations[0],
        returnStations,validationRoute:returnStations,validationRule:returnStations.length>1?'ICT_THEN_FCT':'ORIGIN_TEST_POSITION_ONLY'}));
      motherboard.depanelNgType=defectType;
      motherboard.validationRoute=returnStations;
    }
    if(sourceStation==='manu_package_ate'){
      await stationRetestReady;
      const retest=(await query(`SELECT attempts_used,max_attempts,last_result FROM station_retest_control WHERE station_code=$1 AND UPPER(sn)=UPPER($2)`,[sourceStation,ngSn])).rows[0];
      if(!retest||retest.attempts_used<3)return res.status(409).json({ok:false,code:'AGING_CAB_RETESTS_REQUIRED',
        message:'第二次和第三次复测必须在老化柜完成后才能送维修',destinationStation:'manu_agingcab',
        attemptsUsed:Number(retest?.attempts_used||0),requiredAttempts:3});
      motherboard.subBoards=(Array.isArray(motherboard.subBoards)?motherboard.subBoards:[{sn:ngSn,result:'FAIL'}]).map(board=>({
        ...board,originStationCode:'manu_package_ate',returnStationCode:'manu_agingcab',
        returnStations:['manu_agingcab'],validationRoute:['manu_agingcab','manu_package_ate'],
        validationRule:'REPAIR_RETURN_TO_AGING_THEN_PACKAGING_ATE'}));
      motherboard.returnStationCode='manu_agingcab';
      motherboard.validationRoute=['manu_agingcab','manu_package_ate'];
    }
    if(sourceStation==='manu_hivolt_ate'){
      motherboard.subBoards=(Array.isArray(motherboard.subBoards)?motherboard.subBoards:[{sn:ngSn,result:'FAIL'}]).map(board=>({
        ...board,originStationCode:'manu_hivolt_ate',returnStationCode:'manu_agingcab',
        returnStations:['manu_agingcab'],validationRoute:['manu_agingcab','manu_hivolt_ate'],
        validationRule:'REPAIR_RETURN_TO_AGING_THEN_HIGHVOLT'}));
      motherboard.returnStationCode='manu_agingcab';
      motherboard.validationRoute=['manu_agingcab','manu_hivolt_ate'];
    }
    const existing=await query(`SELECT request_id,submitted_at FROM station_route_requests WHERE batch_id=$1 AND source_station=$2
      AND destination_station='manu_rework' AND status IN('WAITING_RECEIPT','REPAIR_IN_PROGRESS') ORDER BY submitted_at DESC LIMIT 1`,[batchId,sourceStation]);
    let requestId,submittedAt;
    if(existing.rows.length){requestId=existing.rows[0].request_id;submittedAt=existing.rows[0].submitted_at;}
    else{
      const created=await query(`INSERT INTO station_route_requests
        (batch_id,source_station,destination_code,destination_station,workflow_code,motherboard,status,submitted_by,processed_at,notification_status,detail,first_discovered_at,repair_deadline_at)
        VALUES($1,$2,'MAINTENANCE','manu_rework','MES_REPAIR_HANDOVER',$3,'WAITING_RECEIPT',$4,NOW(),'SENT',$5,TO_TIMESTAMP($6::double precision/1000.0),TO_TIMESTAMP($7::double precision/1000.0))
        RETURNING request_id,submitted_at`,[batchId,sourceStation,JSON.stringify(motherboard),payload.submittedBy||payload.operator||sourceStation,
        JSON.stringify({sourceStationName,ngSn,clickedAt:payload.clickedAt||Date.now(),...payload}),firstDetectedAtMs,repairDeadlineAtMs]);
      requestId=created.rows[0].request_id;submittedAt=created.rows[0].submitted_at;
      await query(`INSERT INTO station_handover_transfers(batch_id,source_station,destination_station,destination_type,motherboard,member_count,status,sent_at)
        VALUES($1,$2,'manu_rework','MAINTENANCE',$3,$4,'WAITING_RECEIPT',NOW())
        ON CONFLICT(batch_id,source_station,destination_station) DO UPDATE SET motherboard=EXCLUDED.motherboard,
        member_count=EXCLUDED.member_count,status='WAITING_RECEIPT',sent_at=NOW(),received_at=NULL,accepted_by=NULL,alarmed_at=NULL`,
        [batchId,sourceStation,JSON.stringify(motherboard),Math.max(1,members.length)]);
    }
    const dateCode=new Date(new Date(submittedAt).getTime()+7*60*60*1000).toISOString().slice(0,10).replaceAll('-','');
    const billNo=`RH-${dateCode}-${String(requestId).padStart(6,'0')}`;
    const repairWorkOrderNo=`RWO-${dateCode}-${String(requestId).padStart(6,'0')}`;
    await query(`INSERT INTO station_repair_work_orders(work_order_no,route_request_id,batch_id,ng_sn,source_station,source_station_name,motherboard,created_by,first_discovered_at,repair_deadline_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,TO_TIMESTAMP($9::double precision/1000.0),TO_TIMESTAMP($10::double precision/1000.0)) ON CONFLICT(route_request_id) DO NOTHING`,[repairWorkOrderNo,requestId,batchId,ngSn,sourceStation,sourceStationName,JSON.stringify(motherboard),payload.submittedBy||payload.operator||sourceStation,firstDetectedAtMs,repairDeadlineAtMs]);
    const retestHistory=(await query(`SELECT station_code AS "originStation",attempt_no AS "attemptNo",actor,result,
      detail->>'executionStation' AS "executionStation",created_at AS "testedAt" FROM station_retest_audit
      WHERE UPPER(sn)=UPPER($1) AND action='COMPLETED' ORDER BY created_at`,[ngSn])).rows;
    await query(`UPDATE station_repair_work_orders SET retest_history=$2,updated_at=NOW() WHERE route_request_id=$1`,[requestId,JSON.stringify(retestHistory)]);
    if(sourceStation==='manu_assem_ate'){
      const assembly=await readStationBuckets(sourceStation);
      const maintenance=await readStationBuckets('manu_rework');
      const matchesAssemblyNg=item=>String(item.sn||'').trim().toUpperCase()===ngSn||
        String(item.batchId||'')===batchId;
      const migrating=assembly.confirmed_ng.filter(matchesAssemblyNg);
      if(!migrating.length&&!existing.rows.length)return res.status(409).json(errorEnvelope(
        'CONFIRMED_NG_NOT_FOUND','selected product is no longer in the Assembly ATE confirmed NG box'));
      assembly.confirmed_ng=assembly.confirmed_ng.filter(item=>!matchesAssemblyNg(item));
      const incoming=(migrating.length?migrating:[{sn:ngSn,batchId,result:'FAIL',isConfirmed:true}]).map(item=>({
        ...item,originStationCode:sourceStation,returnStationCode:sourceStation,
        sourceStationCode:sourceStation,destinationStationCode:'manu_rework',
        transferStatus:'WAITING_RECEIPT',repairWorkOrderNo,sentAt:Date.now(),
        confirmedBy:payload.confirmedBy||payload.submittedBy,
        confirmedRole:String(payload.confirmedRole||payload.submittedRole||'').toUpperCase(),
      }));
      maintenance.pending_ng=maintenance.pending_ng.filter(item=>
        !incoming.some(row=>String(row.sn||'').toUpperCase()===String(item.sn||'').toUpperCase()));
      maintenance.pending_ng.push(...incoming);
      await commitStationBucket(sourceStation,'confirmed_ng',assembly.confirmed_ng);
      await commitStationBucket(sourceStation,'process',[{stage:'NG_MIGRATED_TO_MAINTENANCE',batchId,ngSn,
        repairWorkOrderNo,confirmedBy:payload.confirmedBy||payload.submittedBy,updatedAt:Date.now()}]);
      await commitStationBucket('manu_rework','pending_ng',maintenance.pending_ng);
      await commitStationBucket('manu_rework','process',[{stage:'MAINTENANCE_WORK_ORDER_WAITING_RECEIPT',batchId,ngSn,
        sourceStationCode:sourceStation,repairWorkOrderNo,updatedAt:Date.now()}]);
    }
    if(sourceStation==='manu_supersonic'){
      const supersonic=await readStationBuckets(sourceStation);
      const maintenance=await readStationBuckets('manu_rework');
      const matches=item=>String(item.sn||'').trim().toUpperCase()===ngSn||String(item.batchId||'')===batchId;
      const migrating=supersonic.confirmed_ng.filter(matches);
      if(!migrating.length&&!existing.rows.length)return res.status(409).json(errorEnvelope(
        'SUPERSONIC_CONFIRMED_NG_NOT_FOUND','selected product is no longer in the Supersonic confirmed NG box'));
      supersonic.confirmed_ng=supersonic.confirmed_ng.filter(item=>!matches(item));
      const incoming=(migrating.length?migrating:[{sn:ngSn,batchId,result:'FAIL',isConfirmed:true}]).map(item=>({
        ...item,originStationCode:sourceStation,returnStationCode:sourceStation,
        returnStations:[sourceStation],validationRoute:[sourceStation],returnRequired:true,
        sourceStationCode:sourceStation,destinationStationCode:'manu_rework',
        transferStatus:'WAITING_RECEIPT',repairWorkOrderNo,sentAt:Date.now()}));
      maintenance.pending_ng=maintenance.pending_ng.filter(item=>
        !incoming.some(row=>String(row.sn||'').toUpperCase()===String(item.sn||'').toUpperCase()));
      maintenance.pending_ng.push(...incoming);
      await commitStationBucket(sourceStation,'confirmed_ng',supersonic.confirmed_ng);
      await commitStationBucket(sourceStation,'process',[{stage:'NG_MIGRATED_TO_MAINTENANCE',batchId,ngSn,
        repairWorkOrderNo,returnStationCode:sourceStation,updatedAt:Date.now()}]);
      await commitStationBucket('manu_rework','pending_ng',maintenance.pending_ng);
      await commitStationBucket('manu_rework','process',[{stage:'MAINTENANCE_WORK_ORDER_WAITING_RECEIPT',batchId,ngSn,
        sourceStationCode:sourceStation,returnStationCode:sourceStation,repairWorkOrderNo,updatedAt:Date.now()}]);
    }
    if(sourceStation==='manu_hivolt_ate'){
      const highVolt=await readStationBuckets(sourceStation);
      const maintenance=await readStationBuckets('manu_rework');
      const matches=item=>String(item.sn||'').trim().toUpperCase()===ngSn||String(item.batchId||'')===batchId;
      const migrating=[...highVolt.pending_ng.filter(matches),...highVolt.confirmed_ng.filter(matches)];
      if(!migrating.length&&!existing.rows.length)return res.status(409).json(errorEnvelope(
        'HIVOLT_NG_NOT_FOUND','selected SN is no longer in either High-Voltage NG box'));
      highVolt.pending_ng=highVolt.pending_ng.filter(item=>!matches(item));
      highVolt.confirmed_ng=highVolt.confirmed_ng.filter(item=>!matches(item));
      const incoming=(migrating.length?migrating:[{sn:ngSn,batchId,result:'FAIL'}]).map(item=>({
        ...item,originStationCode:'manu_hivolt_ate',returnStationCode:'manu_agingcab',
        validationRoute:['manu_agingcab','manu_hivolt_ate'],destinationStationCode:'manu_rework',
        transferStatus:'WAITING_RECEIPT',repairWorkOrderNo,sentAt:Date.now()}));
      maintenance.pending_ng=maintenance.pending_ng.filter(item=>!incoming.some(row=>String(row.sn||'').toUpperCase()===String(item.sn||'').toUpperCase()));
      maintenance.pending_ng.push(...incoming);
      await commitStationBucket(sourceStation,'pending_ng',highVolt.pending_ng);
      await commitStationBucket(sourceStation,'confirmed_ng',highVolt.confirmed_ng);
      await commitStationBucket(sourceStation,'process',[{stage:'NG_MIGRATED_TO_MAINTENANCE',batchId,ngSn,
        repairWorkOrderNo,returnStationCode:'manu_agingcab',updatedAt:Date.now()}]);
      await commitStationBucket('manu_rework','pending_ng',maintenance.pending_ng);
    }
    if(sourceStation==='manu_package_ate'){
      const packing=await readStationBuckets(sourceStation);
      const maintenance=await readStationBuckets('manu_rework');
      const matches=item=>String(item.sn||'').trim().toUpperCase()===ngSn||String(item.batchId||'')===batchId;
      const migrating=packing.confirmed_ng.filter(matches);
      if(!migrating.length&&!existing.rows.length)return res.status(409).json(errorEnvelope(
        'PACKAGING_ATE_NG_NOT_FOUND','selected SN is no longer in the Packaging ATE NG box'));
      packing.confirmed_ng=packing.confirmed_ng.filter(item=>!matches(item));
      packing.pending_ng=packing.pending_ng.filter(item=>!matches(item));
      const incoming=(migrating.length?migrating:[{sn:ngSn,batchId,result:'FAIL'}]).map(item=>({
        ...item,originStationCode:'manu_package_ate',returnStationCode:'manu_agingcab',
        validationRoute:['manu_agingcab','manu_package_ate'],destinationStationCode:'manu_rework',
        transferStatus:'WAITING_RECEIPT',repairWorkOrderNo,sentAt:Date.now()}));
      maintenance.pending_ng=maintenance.pending_ng.filter(item=>!incoming.some(row=>String(row.sn||'').toUpperCase()===String(item.sn||'').toUpperCase()));
      maintenance.pending_ng.push(...incoming);
      await commitStationBucket(sourceStation,'pending_ng',packing.pending_ng);
      await commitStationBucket(sourceStation,'confirmed_ng',packing.confirmed_ng);
      await commitStationBucket(sourceStation,'process',[{stage:'NG_MIGRATED_TO_MAINTENANCE',batchId,ngSn,
        repairWorkOrderNo,returnStationCode:'manu_agingcab',updatedAt:Date.now()}]);
      await commitStationBucket('manu_rework','pending_ng',maintenance.pending_ng);
    }
    if(sourceStation==='manu_depanel'){
      const depanel=await readStationBuckets('manu_depanel');
      depanel.confirmed_ng=depanel.confirmed_ng.filter(item=>
        String(item.sn||'').trim().toUpperCase()!==ngSn);
      const transferRecord={stage:'NG_TRANSFERRED_TO_MAINTENANCE',sn:ngSn,batchId,
        transferBatchId:payload.transferBatchId||'',repairWorkOrderNo,requestId,
        confirmedBy:payload.confirmedBy||payload.submittedBy||'',
        confirmedRole:payload.confirmedRole||payload.submittedRole||'',
        oldestNgDetectedAt:payload.oldestNgDetectedAt||firstDetectedAtMs,
        dispatchDeadlineAt:payload.dispatchDeadlineAt||firstDetectedAtMs+20*60*1000,
        repairDeadlineAt:repairDeadlineAtMs,updatedAt:Date.now()};
      depanel.process=[transferRecord,...depanel.process].slice(0,1000);
      await commitStationBucket('manu_depanel','confirmed_ng',depanel.confirmed_ng);
      await commitStationBucket('manu_depanel','process',depanel.process);
    }
    if(['manu_agingcab','manu_case_binding','manu_outer_box_binding','manu_pallet_binding'].includes(sourceStation)){
      const sourceState=await readStationBuckets(sourceStation);
      const maintenance=await readStationBuckets('manu_rework');
      const matches=item=>String(item.sn||'').trim().toUpperCase()===ngSn||String(item.batchId||'')===batchId;
      const migrating=[...sourceState.pending_ng.filter(matches),...sourceState.confirmed_ng.filter(matches)];
      if(!migrating.length&&!existing.rows.length)return res.status(409).json(errorEnvelope(
        'CONFIRMED_NG_NOT_FOUND','selected SN is no longer in the source station NG box'));
      sourceState.pending_ng=sourceState.pending_ng.filter(item=>!matches(item));
      sourceState.confirmed_ng=sourceState.confirmed_ng.filter(item=>!matches(item));
      const incoming=(migrating.length?migrating:[{sn:ngSn,batchId,result:'FAIL'}]).map(item=>({
        ...item,originStationCode:sourceStation,returnStationCode:sourceStation,
        returnStations:[sourceStation],validationRoute:[sourceStation],returnRequired:true,
        sourceStationCode:sourceStation,destinationStationCode:'manu_rework',
        transferStatus:'WAITING_RECEIPT',repairWorkOrderNo,sentAt:Date.now()}));
      maintenance.pending_ng=maintenance.pending_ng.filter(item=>
        !incoming.some(row=>String(row.sn||'').toUpperCase()===String(item.sn||'').toUpperCase()));
      maintenance.pending_ng.push(...incoming);
      await commitStationBucket(sourceStation,'pending_ng',sourceState.pending_ng);
      await commitStationBucket(sourceStation,'confirmed_ng',sourceState.confirmed_ng);
      await commitStationBucket(sourceStation,'process',[{stage:'NG_MIGRATED_TO_MAINTENANCE',batchId,ngSn,
        repairWorkOrderNo,repairDeadlineAt:repairDeadlineAtMs,updatedAt:Date.now()}]);
      await commitStationBucket('manu_rework','pending_ng',maintenance.pending_ng);
      await commitStationBucket('manu_rework','process',[{stage:'MAINTENANCE_WORK_ORDER_WAITING_RECEIPT',batchId,ngSn,
        sourceStationCode:sourceStation,returnStationCode:sourceStation,repairWorkOrderNo,
        repairDeadlineAt:repairDeadlineAtMs,updatedAt:Date.now()}]);
    }
    const eventPayload={billNo,repairWorkOrderNo,requestId,batchId,ngSn,sourceStation,sourceStationName,destinationStation:'manu_rework',submittedAt,firstDetectedAt:firstDetectedAtMs,repairDeadlineAt:repairDeadlineAtMs,status:'WAITING_RECEIPT',motherboard,retestHistory};
    neuralBroadcast({from:'mes_server',to:'*',type:'MAINTENANCE_HANDOVER_BILL_CREATED',priority:'critical',stationCode:sourceStation,payload:eventPayload});
    neuralBroadcast({from:'mes_server',to:sourceStation,type:'ORIGIN_NG_MIGRATION_CONFIRMED',priority:'important',stationCode:sourceStation,payload:eventPayload});
    neuralBroadcast({from:'mes_server',to:'manu_rework',type:'MAINTENANCE_NG_TASK_RECEIVED',priority:'critical',stationCode:'manu_rework',payload:eventPayload});
    res.status(existing.rows.length?200:201).json({ok:true,...eventPayload,duplicate:existing.rows.length>0});
  }catch(error){res.status(500).json(errorEnvelope('MAINTENANCE_HANDOVER_CREATE_FAILED',error.message));}
});

app.post("/api/station/maintenance-handovers/receive",async(req,res)=>{
  try{
    const sn=String(req.body?.sn||req.body?.ngSn||'').trim().toUpperCase();
    const stationCode=String(req.body?.stationCode||'manu_rework').trim();
    if(stationCode!=='manu_rework'||!sn)return res.status(400).json(errorEnvelope('VALIDATION','maintenance stationCode and scanned sn required'));
    const accepted=await acceptWaitingHandoverByScan(stationCode,sn);
    if(!accepted){
      neuralBroadcast({from:'mes_server',to:'*',type:'MAINTENANCE_RECEIPT_REJECTED',priority:'critical',stationCode,
        payload:{sn,reason:'NO_WAITING_REPAIR_WORK_ORDER',message:'扫描SN没有等待接收的维修工单'}});
      return res.status(409).json(errorEnvelope('NO_WAITING_REPAIR_WORK_ORDER','scanned SN does not belong to a waiting repair work order'));
    }
    const workOrder=await query(`SELECT work_order_no AS "repairWorkOrderNo",status,received_at AS "receivedAt",repair_started_at AS "repairStartedAt",retest_history AS "retestHistory"
      FROM station_repair_work_orders WHERE batch_id=$1 ORDER BY created_at DESC LIMIT 1`,[accepted.batchId]);
    const result={...accepted,...(workOrder.rows[0]||{}),status:'REPAIR_IN_PROGRESS'};
    neuralBroadcast({from:'mes_server',to:'*',type:'MAINTENANCE_WORK_ORDER_ACCEPTED',priority:'info',stationCode,payload:result});
    res.json({ok:true,...result});
  }catch(error){res.status(500).json(errorEnvelope('MAINTENANCE_RECEIPT_FAILED',error.message));}
});

app.get("/api/station/maintenance-handovers",async(req,res)=>{
  try{
    await stationRouteRequestReady;
    const source=String(req.query.sourceStation||"").trim();
    const destination=String(req.query.destinationStation||"").trim();
    const status=String(req.query.status||"").trim();
    const params=[];const conditions=[];
    if(source){params.push(source);conditions.push(`source_station=$${params.length}`);}
    if(destination){params.push(destination);conditions.push(`destination_station=$${params.length}`);}
    if(status){params.push(status);conditions.push(`status=$${params.length}`);}
    const result=await query(`SELECT request_id AS "requestId",
      ('RH-'||TO_CHAR(submitted_at AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYYMMDD')||'-'||LPAD(request_id::text,6,'0')) AS "billNo",
      (SELECT work_order_no FROM station_repair_work_orders rwo WHERE rwo.route_request_id=station_route_requests.request_id) AS "repairWorkOrderNo",
      batch_id AS "batchId",source_station AS "sourceStation",
      destination_station AS "destinationStation",workflow_code AS "workflowCode",
      motherboard,status,submitted_by AS "submittedBy",submitted_at AS "submittedAt",
      processed_at AS "processedAt",completed_at AS "completedAt",
      repair_started_at AS "repairStartedAt",repair_alarm_at AS "repairAlarmAt",
      notification_status AS "notificationStatus",detail
      FROM station_route_requests ${conditions.length?`WHERE ${conditions.join(" AND ")}`:""}
      ORDER BY submitted_at DESC LIMIT 1000`,params);
    res.json({ok:true,items:result.rows});
  }catch(error){res.status(500).json(errorEnvelope("MAINTENANCE_HANDOVER_QUERY_FAILED",error.message));}
});

app.get("/api/station/ng-revival/audit",async(req,res)=>{
  try{
    const stationCode=String(req.query.stationCode||"").trim();
    if(!stationCode)return res.status(400).json(errorEnvelope('VALIDATION','stationCode required'));
    const sn=String(req.query.sn||"").trim().toUpperCase();
    const limit=Math.min(Number(req.query.limit)||50,200);
    // snCond 随 sn 过滤条件改写：原为 const(HEAD 即如此,带 ?sn= 直接 TypeError),
    // 搬迁修正为 let；$3 补 ::text 类型注记,否则 pg 无法推断占位符类型(HEAD 的
    // 第二处潜伏错误)。
    const params=[stationCode];let snCond="";
    if(sn){params.push(sn);snCond=`AND UPPER(payload->>'sn'::text)=UPPER($${params.length}::text)`;}
    const [revivalEvents,retestRows]=await Promise.all([
      query(`SELECT event_id AS "eventId",payload,station_code AS "stationCode",
        received_at AS "createdAt" FROM station_production_events
        WHERE station_code=$1 AND event_type IN('NG_REVIVED_RECEIVED','REPAIR_COMPLETE','REPAIR_STEP_CONFIRMED','REPAIR_TEST_COMPLETED','REPAIR_SCRAPPED') ${snCond}
        ORDER BY received_at DESC LIMIT $${params.length+1}`,[...params,limit]),
      query(`SELECT sn,batch_id AS "batchId",station_code AS "stationCode",
        armed,armed_at AS "armedAt",permission_by AS "permissionBy",
        last_result AS "lastResult",attempts_used AS "attemptsUsed",
        max_attempts AS "maxAttempts",updated_at AS "updatedAt"
        FROM station_retest_control WHERE station_code=$1 ${sn?`AND UPPER(sn)=UPPER($${2})`:""}
        ORDER BY updated_at DESC LIMIT $${params.length+1}`,[...params,limit])
    ]);
    const items=(retestRows.rows||[]).map(r=>({
      sn:r.sn,batchId:r.batchId,stationCode:r.stationCode,
      retestArmed:r.armed,retestArmedAt:r.armedAt,permissionBy:r.permissionBy,
      lastResult:r.lastResult,attemptsUsed:r.attemptsUsed,maxAttempts:r.maxAttempts,
      updatedAt:r.updatedAt,
      revivalEvents:revivalEvents.rows.filter(e=>String(e.payload?.sn||'').toUpperCase()===String(r.sn||'').toUpperCase())
    }));
    res.json({ok:true,items});
  }catch(error){res.status(500).json(errorEnvelope("NG_REVIVAL_AUDIT_FAILED",error.message));}
});

app.post("/api/station/maintenance-work-orders/:workOrderNo/complete",async(req,res)=>{
  try{
    await Promise.all([stationRepairWorkOrderReady,stationRepairMaterialReady,ngRevivalAuditColumnsReady]);
    const checked=req.body?.completed===true;
    const operator=String(req.body?.operator||'REPAIR_OPERATOR').trim();
    const repairMethod=String(req.body?.repairMethod||'').trim();
    const repairResult=String(req.body?.repairResult||'repaired').trim().toLowerCase();
    const materials=Array.isArray(req.body?.materials)?req.body.materials:[];
    const materialsConfirmed=req.body?.materialsConfirmed===true;
    if(!checked||!repairMethod)return res.status(400).json(errorEnvelope('COMPLETION_CONFIRMATION_REQUIRED','completed checkbox and repairMethod required'));
    if(!materialsConfirmed)return res.status(400).json(errorEnvelope('MATERIAL_USAGE_CONFIRMATION_REQUIRED','confirm replaced materials; submit an empty list when none were replaced'));
    if(materials.some(item=>!Number.isFinite(Number(item?.quantity))||Number(item.quantity)<=0))
      return res.status(400).json(errorEnvelope('INVALID_MATERIAL_QUANTITY','every replaced material quantity must be greater than zero'));
    const updated=await query(`UPDATE station_repair_work_orders SET status=$2,repair_completed_at=NOW(),repair_operator=$3,
      repair_method=$4,repair_result=$5,updated_at=NOW() WHERE work_order_no=$1 AND status='REPAIR_IN_PROGRESS' RETURNING *`,
      [req.params.workOrderNo,repairResult==='repaired'?'PENDING_QUALITY':'SCRAPPED',operator,repairMethod,repairResult]);
    if(!updated.rows.length)return res.status(409).json(errorEnvelope('INVALID_WORK_ORDER_STATE','repair work order is not in progress'));
    const wo=updated.rows[0];
    for(const item of materials)await query(`INSERT INTO station_repair_material_usage
      (work_order_no,ng_sn,material_code,material_name,quantity,unit,operator,detail)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[wo.work_order_no,wo.ng_sn,String(item.materialCode||''),
        String(item.materialName||''),Number(item.quantity),String(item.unit||'PCS'),operator,JSON.stringify(item)]);
    if(repairResult==='repaired'){
      const boards=Array.isArray(wo.motherboard?.subBoards)?wo.motherboard.subBoards:[];
      const ngBoards=boards.filter(board=>String(board.result||'').toUpperCase()!=='PASS');
      const targets=ngBoards.length?ngBoards:[{sn:wo.ng_sn,defectCode:'NG'}];
      for(const board of targets){
        const sn=String(board.sn||'').trim();if(!sn)continue;
        const exists=await query(`SELECT revival_id FROM ng_revival_audit WHERE sn=$1 AND batch_id=$2
          AND approval_status IN('PENDING_QUALITY','PENDING_LINE_LEADER','APPROVED','RETURN_PENDING') LIMIT 1`,[sn,wo.batch_id]);
        if(!exists.rows.length)await query(`INSERT INTO ng_revival_audit
          (sn,batch_id,origin_station,defect_code,repair_result,return_station,operator_name,approval_status,revived_at)
          VALUES($1,$2,$3,$4,'repaired',$6,$5,'PENDING_QUALITY',NOW())`,
          [sn,wo.batch_id,wo.source_station,board.defectCode||board.defect_code||'NG',operator,
           (Array.isArray(board.returnStations)&&board.returnStations[0])||wo.source_station]);
      }
    }
    const payload={repairWorkOrderNo:wo.work_order_no,batchId:wo.batch_id,ngSn:wo.ng_sn,sourceStation:wo.source_station,
      repairResult,status:repairResult==='repaired'?'PENDING_QUALITY':'SCRAPPED',repairCompletedAt:wo.repair_completed_at,
      materialsConfirmed:true,materials};
    neuralBroadcast({from:'mes_server',to:'*',type:'MAINTENANCE_WORK_ORDER_COMPLETED',priority:'critical',stationCode:'manu_rework',payload});
    res.json({ok:true,...payload,approvalRequired:repairResult==='repaired'});
  }catch(error){res.status(500).json(errorEnvelope('MAINTENANCE_WORK_ORDER_COMPLETE_FAILED',error.message));}
});

app.get('/api/station/maintenance-work-orders/:workOrderNo/materials',async(req,res)=>{
  try{await stationRepairMaterialReady;const rows=await query(`SELECT usage_id AS "usageId",work_order_no AS "workOrderNo",
    ng_sn AS "ngSn",material_code AS "materialCode",material_name AS "materialName",quantity,unit,operator,
    detail,recorded_at AS "recordedAt" FROM station_repair_material_usage WHERE work_order_no=$1 ORDER BY recorded_at,usage_id`,
    [req.params.workOrderNo]);res.json({ok:true,items:rows.rows});
  }catch(error){res.status(500).json(errorEnvelope('REPAIR_MATERIAL_QUERY_FAILED',error.message));}
});

app.get('/api/station/ng-releases',async(req,res)=>{
  try{await stationNgReleaseReady;const station=String(req.query.stationCode||'').trim();if(!station)return res.status(400).json(errorEnvelope('VALIDATION','stationCode required'));
    const rows=await query(`SELECT e.release_id AS "releaseId",e.sn,e.batch_id AS "batchId",e.origin_station AS "originStation",
      e.release_reason AS "releaseReason",e.released_at AS "releasedAt" FROM station_ng_release_events e
      LEFT JOIN station_ng_release_ack a ON a.release_id=e.release_id AND a.station_code=$1
      WHERE a.release_id IS NULL ORDER BY e.release_id LIMIT 500`,[station]);res.json({ok:true,items:rows.rows});
  }catch(error){res.status(500).json(errorEnvelope('NG_RELEASE_QUERY_FAILED',error.message));}
});
app.post('/api/station/ng-releases/:id/ack',async(req,res)=>{
  try{await stationNgReleaseReady;const station=String(req.body?.stationCode||'').trim();if(!station)return res.status(400).json(errorEnvelope('VALIDATION','stationCode required'));
    await query(`INSERT INTO station_ng_release_ack(release_id,station_code,local_rows_removed) VALUES($1,$2,$3)
      ON CONFLICT(release_id,station_code) DO UPDATE SET local_rows_removed=EXCLUDED.local_rows_removed,acknowledged_at=NOW()`,
      [req.params.id,station,Number(req.body?.localRowsRemoved||0)]);res.json({ok:true});
  }catch(error){res.status(500).json(errorEnvelope('NG_RELEASE_ACK_FAILED',error.message));}
});

app.get("/api/station/sn-registry",async(req,res)=>{
  try{
    await stationSnRegistryReady;
    const scope=String(req.query.scope||"today").toLowerCase();
    const station=String(req.query.stationCode||"").trim();const search=String(req.query.search||"").trim();
    const conditions=[scope==="history"?"production_date < (NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date":"production_date = (NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date"];
    const params=[];
    if(station){params.push(station);conditions.push(`station_code=$${params.length}`);}
    if(search){params.push(`%${search}%`);conditions.push(`sn ILIKE $${params.length}`);}
    const [items,summary]=await Promise.all([
      query(`SELECT station_code AS "stationCode",sn,source_type AS "sourceType",production_date AS "productionDate",
        first_seen_at AS "firstSeenAt",last_seen_at AS "lastSeenAt",test_count AS "testCount",first_event_id AS "firstEventId"
        FROM station_sn_registry WHERE ${conditions.join(" AND ")} ORDER BY production_date DESC,first_seen_at DESC LIMIT 2000`,params),
      query(`SELECT COUNT(*) FILTER(WHERE production_date=(NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)::int AS today,
        COUNT(*) FILTER(WHERE production_date<(NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)::int AS history,
        COUNT(DISTINCT sn)::int AS unique FROM station_sn_registry`)
    ]);
    res.json({ok:true,scope,timezone:"Asia/Ho_Chi_Minh",summary:summary.rows[0],items:items.rows});
  }catch(error){res.status(500).json(errorEnvelope("SN_REGISTRY_QUERY_FAILED",error.message));}
});

app.get("/api/station/sn-guard",async(req,res)=>{
  try{
    await factorySnMasterReady;
    const meta=await query(`SELECT COUNT(*)::int AS count,
      COALESCE(FLOOR(EXTRACT(EPOCH FROM MAX(last_seen_at))*1000),0)::bigint AS version
      FROM factory_sn_master WHERE production_date=(NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`);
    const version=Number(meta.rows[0]?.version||0)+Number(meta.rows[0]?.count||0);
    if(Number(req.query.version||-1)===version)return res.json({ok:true,unchanged:true,version,count:Number(meta.rows[0]?.count||0)});
    const rows=await query(`SELECT sn FROM factory_sn_master
      WHERE production_date=(NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AND current_status='ACTIVE' ORDER BY sn`);
    res.json({ok:true,unchanged:false,timezone:"Asia/Ho_Chi_Minh",version,count:rows.rows.length,items:rows.rows.map(row=>row.sn)});
  }catch(error){res.status(500).json(errorEnvelope("SN_GUARD_QUERY_FAILED",error.message));}
});

// Point lookup used by station data sources before accepting a new SN. The
// subsequent SN_SCAN insert remains the atomic final duplicate check.
app.get("/api/station/sn-guard/check/:sn",async(req,res)=>{
  try{
    await Promise.all([factorySnMasterReady,stationSnRegistryReady]);
    const sn=String(req.params.sn||"").trim().toUpperCase();
    const stationCode=String(req.query.stationCode||"").trim().toLowerCase();
    if(!sn)return res.status(400).json(errorEnvelope("VALIDATION","sn required"));
    const found=await query(`SELECT sn,production_date AS "productionDate",
      first_source_station AS "firstSourceStation",current_status AS "currentStatus"
      FROM factory_sn_master WHERE UPPER(sn)=UPPER($1) LIMIT 1`,[sn]);
    const processed=stationCode?(await query(`SELECT station_code,sn,production_date AS "productionDate",
      first_seen_at AS "firstSeenAt",last_seen_at AS "lastSeenAt",test_count AS "testCount"
      FROM station_sn_registry WHERE station_code=$1 AND UPPER(sn)=UPPER($2) LIMIT 1`,[stationCode,sn])).rows:[];
    res.json({ok:true,sn,stationCode:stationCode||null,expected:found.rows.length>0,
      duplicate:stationCode?processed.length>0:found.rows.length>0,
      record:found.rows[0]||null,processedRecord:processed[0]||null});
  }catch(error){res.status(500).json(errorEnvelope("SN_GUARD_CHECK_FAILED",error.message));}
});

// MES expectation manifest is deliberately separate from station processing
// history. Downloading an expected SN must never create a duplicate record.
app.get("/api/station/expected-sns",async(req,res)=>{
  try{
    await Promise.all([factorySnMasterReady,stationSnRegistryReady]);
    const stationCode=String(req.query.stationCode||"").trim().toLowerCase();
    if(!stationCode)return res.status(400).json(errorEnvelope("VALIDATION","stationCode required"));
    const rows=await query(`SELECT m.sn,m.production_date AS "productionDate",
      m.first_source_station AS "sourceStation",m.last_seen_at AS "manifestUpdatedAt",
      (r.sn IS NOT NULL) AS processed
      FROM factory_sn_master m LEFT JOIN station_sn_registry r
        ON r.station_code=$1 AND UPPER(r.sn)=UPPER(m.sn)
      WHERE m.production_date=(NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
        AND m.current_status='ACTIVE' ORDER BY m.sn`,[stationCode]);
    const version=rows.rows.reduce((value,row)=>Math.max(value,new Date(row.manifestUpdatedAt).getTime()||0),0)+rows.rows.length;
    res.json({ok:true,stationCode,version,count:rows.rows.length,items:rows.rows});
  }catch(error){res.status(500).json(errorEnvelope("EXPECTED_SN_MANIFEST_FAILED",error.message));}
});

setInterval(async()=>{
  try {
    await stationSnapshotTableReady;
    const result=await query(`SELECT COALESCE(SUM(jsonb_array_length(payload)),0)::int AS count,
      COALESCE(MAX(version),0)::bigint AS version FROM station_bucket_snapshots WHERE bucket_name='confirmed_ng'`);
    neuralBroadcast({from:"mes_server",to:"*",type:"NG_GUARD_HEARTBEAT",priority:"info",
      payload:{active:true,count:Number(result.rows[0]?.count||0),version:Number(result.rows[0]?.version||0),
        timestamp:Date.now(),silent:true,alarm:false}});
  }catch(error){console.error('[NG GUARD HEARTBEAT]',error.message);}
},15*1000).unref();

app.post("/api/station/sync/reconcile", async (req, res) => {
  try {
    await Promise.all([stationSnapshotTableReady, stationConflictColumnsReady, stationSyncIndexesReady]);
    const stationCode = String(req.body?.stationCode || "").trim();
    const dataset = String(req.body?.dataset || "").trim();
    const localPayload = Array.isArray(req.body?.localPayload) ? req.body.localPayload : [];
    const localVersion = Number(req.body?.localVersion || 0);
    if (!stationCode || !dataset) return res.status(400).json(errorEnvelope("VALIDATION", "stationCode and dataset required"));
    const current = await query(`SELECT version,payload FROM station_bucket_snapshots WHERE station_code=$1 AND bucket_name=$2`, [stationCode, dataset]);
    const mesVersion = Number(current.rows[0]?.version || 0);
    const mesPayload = Array.isArray(current.rows[0]?.payload) ? current.rows[0].payload : [];
    const comparisonKey=String(req.body?.comparisonKey||"").trim();
    const normalize=value=>comparisonKey ? [...new Set(value.map(item=>String(item?.[comparisonKey]||"").trim().toUpperCase()).filter(Boolean))].sort() : value;
    const localComparable=normalize(localPayload),mesComparable=normalize(mesPayload);
    const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
    const localHash = digest(localComparable), mesHash = digest(mesComparable);
    await stationInventoryReady;
    await query(`INSERT INTO station_inventory_checks(station_code,dataset,local_count,mes_count,local_version,mes_version,
      local_hash,mes_hash,status,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [stationCode,dataset,localComparable.length,mesComparable.length,localVersion,mesVersion,localHash,mesHash,
       localHash===mesHash?"MATCH":"MISMATCH",JSON.stringify({reportedBy:req.body?.reportedBy||stationCode})]);
    // ICT/FCT SQLite is authoritative for what the equipment actually parsed.
    // Reconciliation restores lost MES projections after an outage/reset. It
    // does not create a duplicate at downstream stations and FCT may only
    // restore members already identified by an ICT motherboard.
    if(dataset==='sn_records'&&['manu_ict','manu_fct'].includes(stationCode)){
      await Promise.all([factorySnMasterReady,stationSnRegistryReady,stationRouteProgressReady,confirmedMotherboardLayoutReady]);
      const station=(await query(`SELECT line_code,sequence_order FROM station_sequences WHERE station_code=$1
        ORDER BY CASE WHEN $1 LIKE 'manu_%' AND line_code='L004' THEN 0 ELSE 1 END LIMIT 1`,[stationCode])).rows[0];
      if(!station)return res.status(409).json(errorEnvelope('STATION_SEQUENCE_NOT_CONFIGURED',stationCode));
      let restored=0,skipped=0;
      for(const item of localPayload){
        const sn=String(item?.sn||'').trim().toUpperCase();if(!sn)continue;
      if(stationCode==='manu_fct'||stationCode==='auto_fct'){
          const table=stationCode==='auto_fct'?'station_confirmed_motherboard_layouts_auto':'station_confirmed_motherboard_layouts';
          const identity=await query(`SELECT 1 FROM ${table} WHERE status='ACTIVE'
            AND ict_batch_id IS NOT NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements(members) m
              WHERE UPPER(COALESCE(m->>'sn',''))=$1) LIMIT 1`,[sn]);
          if(!identity.rows.length){skipped++;continue;}
        }
        const rawTime=item.testTime||item.time||Date.now();
        const productionDate=vietnamProductionDate(rawTime)||vietnamProductionDate(Date.now());
        const eventId=`sqlite-reconcile:${stationCode}:${sn}:${String(item.batchId||'')}`;
        await query(`INSERT INTO station_sn_registry(station_code,sn,source_type,production_date,first_event_id)
          VALUES($1,$2,'SQLITE_RECONCILE',$3,$4) ON CONFLICT(station_code,sn) DO UPDATE
          SET last_seen_at=NOW(),test_count=GREATEST(station_sn_registry.test_count,1)`,
          [stationCode,sn,productionDate,eventId]);
        if(stationCode==='manu_ict')await query(`INSERT INTO factory_sn_master
          (sn,production_date,first_source_station,first_source_type,first_test_time)
          VALUES($1,$2,$3,'SQLITE_RECONCILE',NOW()) ON CONFLICT(sn) DO UPDATE
          SET last_seen_at=NOW(),current_status='ACTIVE'`,[sn,productionDate,stationCode]);
        const result=String(item.result||'PASS').toUpperCase();
        const failed=['FAIL','NG','CONFIRMED_NG'].includes(result);
        await registerRouteAlias(sn,sn,'SQLITE_RECONCILE',{stationCode,batchId:item.batchId||null});
        await query(`INSERT INTO station_sn_route_progress
          (root_sn,station_code,line_code,sequence_order,source_sn,status,result,source_event_id,detail)
          VALUES($1,$2,$3,$4,$1,$5,$6,$7,$8) ON CONFLICT(root_sn,station_code) DO UPDATE
          SET status=EXCLUDED.status,result=EXCLUDED.result,source_event_id=EXCLUDED.source_event_id,
          completed_at=NOW(),detail=station_sn_route_progress.detail||EXCLUDED.detail`,
          [sn,stationCode,station.line_code,Number(station.sequence_order),failed?'NG_COMPLETED':'COMPLETED',
           result,eventId,JSON.stringify({source:'LOCAL_SQLITE_RECONCILIATION',batchId:item.batchId||null,slot:item.slot||item.channel||null})]);
        restored++;
      }
      await commitStationBucket(stationCode,dataset,localPayload);
      return res.json({ok:true,consistent:true,reconciled:true,stationCode,dataset,restored,skipped,
        localVersion,mesVersion:localVersion});
    }
    if (localHash === mesHash) return res.json({ ok: true, consistent: true, stationCode, dataset, localVersion, mesVersion });
    if(dataset==='pass' && localComparable.length<mesComparable.length){
      await passShortageReady;
      const localSet=new Set(localComparable);const missingSns=mesComparable.filter(sn=>!localSet.has(sn));
      const openShortage=await query(`SELECT shortage_id FROM station_pass_shortages WHERE destination_station=$1
        AND status<>'RESOLVED' AND missing_sns=$2::jsonb ORDER BY detected_at DESC LIMIT 1`,[stationCode,JSON.stringify(missingSns)]);
      if(!openShortage.rows.length){
        const shortage=await query(`INSERT INTO station_pass_shortages(source_station,destination_station,batch_id,
          expected_count,actual_count,missing_sns,reported_by) VALUES($1,$2,NULL,$3,$4,$5,'MES_RECONCILIATION')
          RETURNING shortage_id AS "shortageId"`,[`${stationCode}:MES_SNAPSHOT`,stationCode,mesComparable.length,localComparable.length,JSON.stringify(missingSns)]);
        neuralBroadcast({from:'mes_server',to:'*',type:'PASS_SHORTAGE_ALARM',priority:'critical',stationCode,
          payload:{shortageId:shortage.rows[0].shortageId,sourceStation:`${stationCode}:MES_SNAPSHOT`,destinationStation:stationCode,
            expectedCount:mesComparable.length,actualCount:localComparable.length,shortageCount:missingSns.length,missingSns}});
      }
    }
    const existing = await query(`SELECT conflict_id AS "conflictId",status,severity,
      meeting_required AS "meetingRequired",detected_at AS "detectedAt"
      FROM station_data_conflicts WHERE station_code=$1 AND dataset=$2 AND local_hash=$3 AND mes_hash=$4
      AND status='PENDING_INVESTIGATION' ORDER BY detected_at DESC LIMIT 1`,
      [stationCode,dataset,localHash,mesHash]);
    if(existing.rows.length) return res.status(409).json({ok:false,consistent:false,deduplicated:true,conflict:existing.rows[0]});
    const differenceSize = Math.abs(localPayload.length - mesPayload.length);
    const severity = ["confirmed_ng","scrap"].includes(dataset) || differenceSize >= 12 ? "IMPORTANT" : "NORMAL";
    const conflict = await query(`INSERT INTO station_data_conflicts
      (station_code,dataset,local_version,mes_version,local_hash,mes_hash,local_payload,mes_payload,severity,meeting_required)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING conflict_id AS "conflictId",status,severity,meeting_required AS "meetingRequired",detected_at AS "detectedAt"`,
      [stationCode,dataset,localVersion,mesVersion,localHash,mesHash,JSON.stringify(localPayload),JSON.stringify(mesPayload),severity,severity!=="NORMAL"]);
    await appendImmutableAudit("station_data_conflict_audit","conflict_id",conflict.rows[0].conflictId,
      "CONFLICT_DETECTED","SYSTEM",{stationCode,dataset,localVersion,mesVersion,localHash,mesHash});
    neuralBroadcast({ from: "mes_server", to: "*", type: "STATION_DATA_CONFLICT", stationCode,
      payload: { conflictId: conflict.rows[0].conflictId, dataset, localVersion, mesVersion }, priority: "critical" });
    res.status(409).json({ ok: false, consistent: false, conflict: conflict.rows[0] });
  } catch (error) { res.status(500).json(errorEnvelope("RECONCILE_FAILED", error.message)); }
});

app.get("/api/station/sync/inventory", async (req,res)=>{
  try { await stationInventoryReady; const station=String(req.query.stationCode||"");
    const result=await query(`SELECT check_id AS "checkId",station_code AS "stationCode",dataset,
      local_count AS "localCount",mes_count AS "mesCount",local_version AS "localVersion",mes_version AS "mesVersion",
      local_hash AS "localHash",mes_hash AS "mesHash",status,details,checked_at AS "checkedAt"
      FROM station_inventory_checks ${station?"WHERE station_code=$1":""} ORDER BY checked_at DESC LIMIT 1000`,station?[station]:[]);
    res.json({ok:true,items:result.rows});
  } catch(error){res.status(500).json(errorEnvelope("INVENTORY_QUERY_FAILED",error.message));}
});

// MES scheduled inventory: verifies that every station/dataset has reported recently.
setInterval(async()=>{
  try {
    await Promise.all([stationInventoryReady,stationSnapshotTableReady]);
    const snapshots=await query(`SELECT station_code,bucket_name,version,payload FROM station_bucket_snapshots`);
    for(const row of snapshots.rows){
      const last=await query(`SELECT checked_at FROM station_inventory_checks WHERE station_code=$1 AND dataset=$2 ORDER BY checked_at DESC LIMIT 1`,[row.station_code,row.bucket_name]);
      if(!last.rows.length||Date.now()-new Date(last.rows[0].checked_at).getTime()>15*60*1000){
        const payload={stationCode:row.station_code,dataset:row.bucket_name,mesVersion:Number(row.version),mesCount:Array.isArray(row.payload)?row.payload.length:0,message:"本地盘点超过15分钟未上报"};
        // Inventory freshness belongs to MES management. It must never trigger
        // an operator alarm at QR Binding or another production scanner.
        neuralBroadcast({from:"mes_server",to:"mes_management",type:"STATION_INVENTORY_OVERDUE",
          stationCode:row.station_code,payload:{...payload,silent:true,alarm:false},priority:"warning"});
      }
    }
  }catch(error){console.error("[STATION INVENTORY]",error.message);}
},5*60*1000).unref();

// Keep inventory evidence bounded; conflict, audit and production ledgers remain immutable.
setInterval(async()=>{
  try {
    await stationInventoryReady;
    await query(`DELETE FROM station_inventory_checks WHERE checked_at < NOW() - INTERVAL '365 days'`);
  } catch(error) { console.error('[station inventory retention]',error.message); }
},24*60*60*1000).unref();

app.get("/api/station/sync/conflicts", async (req, res) => {
  try {
    await stationConflictReady;
    const status = String(req.query.status || "").trim();
    const result = await query(`SELECT conflict_id AS "conflictId",station_code AS "stationCode",dataset,
      local_version AS "localVersion",mes_version AS "mesVersion",local_hash AS "localHash",mes_hash AS "mesHash",
      local_payload AS "localPayload",mes_payload AS "mesPayload",status,detected_at AS "detectedAt",
      investigated_by AS "investigatedBy",investigation_note AS "investigationNote",resolution,resolved_at AS "resolvedAt",
      severity,meeting_required AS "meetingRequired"
      FROM station_data_conflicts ${status ? "WHERE status=$1" : ""} ORDER BY detected_at DESC LIMIT 500`, status ? [status] : []);
    res.json({ ok: true, items: result.rows });
  } catch (error) { res.status(500).json(errorEnvelope("CONFLICT_QUERY_FAILED", error.message)); }
});

app.get("/api/station/sync/conflicts/:id/audit", async (req, res) => {
  try {
    await stationConflictAuditReady;
    const result = await query(`SELECT audit_id AS "auditId",conflict_id AS "conflictId",action,actor,detail,
      created_at AS "createdAt" FROM station_data_conflict_audit WHERE conflict_id=$1 ORDER BY created_at`, [Number(req.params.id)]);
    res.json({ ok: true, items: result.rows });
  } catch (error) { res.status(500).json(errorEnvelope("CONFLICT_AUDIT_FAILED", error.message)); }
});

app.post("/api/station/sync/conflicts/:id/meeting-vote", async (req, res) => {
  try {
    await Promise.all([stationConflictMeetingReady, immutableAuditReady]);
    const conflictId=Number(req.params.id), role=String(req.body?.role||"").toUpperCase();
    const voter=String(req.body?.voter||"").trim(), decision=String(req.body?.decision||"").toUpperCase();
    const opinion=String(req.body?.opinion||"").trim(), meetingNo=String(req.body?.meetingNo||"").trim();
    if(!conflictId||!voter||!opinion||!meetingNo||!["QUALITY","PRODUCTION","MES_IT","FACTORY_MANAGER"].includes(role)||!["APPROVE","REJECT"].includes(decision))
      return res.status(400).json(errorEnvelope("VALIDATION","meetingNo, role, voter, decision and opinion required"));
    const result=await query(`INSERT INTO station_data_conflict_meeting_votes(conflict_id,meeting_no,voter_role,voter_name,decision,opinion)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(conflict_id,voter_role,voter_name) DO UPDATE SET decision=EXCLUDED.decision,
      opinion=EXCLUDED.opinion,voted_at=NOW() RETURNING *`,[conflictId,meetingNo,role,voter,decision,opinion]);
    await appendImmutableAudit("station_data_conflict_audit","conflict_id",conflictId,"MEETING_VOTE",voter,{meetingNo,role,decision,opinion});
    res.json({ok:true,item:result.rows[0]});
  } catch(error){res.status(500).json(errorEnvelope("MEETING_VOTE_FAILED",error.message));}
});

app.post("/api/station/sync/conflicts/:id/resolve", async (req, res) => {
  try {
    await stationConflictReady;
    const conflictId = Number(req.params.id);
    const correctSource = String(req.body?.correctSource || "").toUpperCase();
    const investigator = String(req.body?.investigator || "").trim();
    const note = String(req.body?.note || "").trim();
    if (!conflictId || !investigator || !note || !["LOCAL", "MES", "MERGED"].includes(correctSource))
      return res.status(400).json(errorEnvelope("VALIDATION", "correctSource, investigator and note required"));
    const found = await query(`SELECT * FROM station_data_conflicts WHERE conflict_id=$1 AND status='PENDING_INVESTIGATION'`, [conflictId]);
    if (!found.rows.length) return res.status(409).json(errorEnvelope("INVALID_STATE", "conflict is not pending"));
    const row = found.rows[0];
    if (row.meeting_required) {
      await stationConflictMeetingReady;
      const votes = await query(`SELECT voter_role,decision FROM station_data_conflict_meeting_votes WHERE conflict_id=$1`,[conflictId]);
      const required = row.severity === "CRITICAL" ? ["QUALITY","PRODUCTION","MES_IT","FACTORY_MANAGER"] : ["QUALITY","PRODUCTION","MES_IT"];
      const approved = new Set(votes.rows.filter(v=>v.decision==="APPROVE").map(v=>v.voter_role));
      if (votes.rows.some(v=>v.decision==="REJECT") || required.some(role=>!approved.has(role)))
        return res.status(409).json(errorEnvelope("MEETING_APPROVAL_REQUIRED",`required unanimous roles: ${required.join(",")}`));
    }
    const resolvedPayload = correctSource === "LOCAL" ? row.local_payload
      : correctSource === "MES" ? row.mes_payload
      : (Array.isArray(req.body?.mergedPayload) ? req.body.mergedPayload : null);
    if (!resolvedPayload) return res.status(400).json(errorEnvelope("VALIDATION", "mergedPayload required"));
    if (correctSource !== "MES") await commitStationBucket(row.station_code, row.dataset, resolvedPayload);
    await query(`UPDATE station_data_conflicts SET status='RESOLVED',investigated_by=$2,
      investigation_note=$3,resolution=$4,resolved_at=NOW() WHERE conflict_id=$1`,
      [conflictId, investigator, note, correctSource]);
    await appendImmutableAudit("station_data_conflict_audit","conflict_id",conflictId,
      "INVESTIGATED_AND_RESOLVED",investigator,{correctSource,note,
        before:{localVersion:row.local_version,mesVersion:row.mes_version},
        resolvedRecordCount:Array.isArray(resolvedPayload)?resolvedPayload.length:0});
    neuralBroadcast({ from: "mes_server", to: "*", type: "STATION_DATA_CONFLICT_RESOLVED", stationCode: row.station_code,
      payload: { conflictId, dataset: row.dataset, correctSource, investigator, note }, priority: "critical" });
    res.json({ ok: true, conflictId, correctSource });
  } catch (error) { res.status(500).json(errorEnvelope("CONFLICT_RESOLVE_FAILED", error.message)); }
});
}

export function registerStationScrapRoutes(app, deps) {
  const {
    RESIDENCE_TIMEOUT_MINUTES, authenticateJWT, canonicalMesStationCode,
    closeStationResidence, commitStationBucket, mesIntegrityReady,
    packagingBoxAuditReady, packagingBoxMappingReady, palletBindingReady,
    readStationBuckets, recentStationEvents, resolveRouteRoot,
    stationAgingHistoryReady, stationHandoverReady, stationRepairWorkOrderReady,
    stationResidenceReady, stationRouteProgressReady, stationScrapAssessmentReady,
    stationScrapAuditReady, stationScrapColumnsReady,
  } = deps;

// Unified production scrap workflow for every manual/automatic station.
// The product remains locked in confirmed NG until both MES approvals finish.
app.get("/api/station/scrap-requests", async (req, res) => {
  try {
    await stationScrapColumnsReady;
    const values = [];
    const clauses = [];
    if (req.query.stationCode) { values.push(String(req.query.stationCode)); clauses.push(`station_code=$${values.length}`); }
    if (req.query.status) { values.push(String(req.query.status)); clauses.push(`status=$${values.length}`); }
    const result = await query(`SELECT request_id AS "requestId",batch_id AS "batchId",
      station_code AS "stationCode",motherboard,status,request_reason AS "requestReason",
      requested_at AS "requestedAt",quality_approver AS "qualityApprover",
      quality_approved_at AS "qualityApprovedAt",quality_reason AS "qualityReason",
      line_leader AS "lineLeader",line_leader_approved_at AS "lineLeaderApprovedAt",
      line_leader_reason AS "lineLeaderReason",rejected_by AS "rejectedBy",rejected_at AS "rejectedAt"
      ,reason_code AS "reasonCode",reason_detail AS "reasonDetail",applicant,
      responsible_person AS "responsiblePerson",equipment_no AS "equipmentNo",
      mes_approver AS "mesApprover",mes_approved_at AS "mesApprovedAt"
      FROM station_scrap_requests ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
      ORDER BY requested_at DESC LIMIT 500`, values);
    res.json({ ok: true, items: result.rows });
  } catch (error) { res.status(500).json(errorEnvelope("SCRAP_QUERY_FAILED", error.message)); }
});

app.get("/api/station/scrap-requests/:id/audit", async (req, res) => {
  try {
    await stationScrapAuditReady;
    const result = await query(`SELECT audit_id AS "auditId",request_id AS "requestId",action,actor,detail,
      created_at AS "createdAt" FROM station_scrap_audit WHERE request_id=$1 ORDER BY created_at`, [Number(req.params.id)]);
    res.json({ ok: true, items: result.rows });
  } catch (error) { res.status(500).json(errorEnvelope("SCRAP_AUDIT_FAILED", error.message)); }
});

app.get("/api/station/scrap-assessments", async (_req, res) => {
  try {
    await stationScrapAssessmentReady;
    const result = await query(`SELECT assessment_id AS "assessmentId",request_id AS "requestId",
      responsibility_type AS "responsibilityType",responsible_person AS "responsiblePerson",department,
      equipment_no AS "equipmentNo",score,deduction_amount AS "deductionAmount",
      assessment_result AS "assessmentResult",assessment_note AS "assessmentNote",
      assessed_by AS "assessedBy",assessed_at AS "assessedAt",created_at AS "createdAt"
      FROM station_scrap_assessments ORDER BY created_at DESC LIMIT 1000`);
    res.json({ ok: true, items: result.rows });
  } catch (error) { res.status(500).json(errorEnvelope("SCRAP_ASSESSMENT_QUERY_FAILED", error.message)); }
});

app.put("/api/station/scrap-requests/:id/assessment", authenticateJWT, async (req, res) => {
  try {
    await Promise.all([stationScrapColumnsReady, stationScrapAssessmentReady, stationScrapAuditReady]);
    const requestId = Number(req.params.id);
    const actor = String(req.body?.assessedBy || "").trim();
    if (!requestId || !actor) return res.status(400).json(errorEnvelope("VALIDATION", "assessedBy required"));
    const exists = await query(`SELECT request_id FROM station_scrap_requests WHERE request_id=$1`, [requestId]);
    if (!exists.rows.length) return res.status(404).json(errorEnvelope("NOT_FOUND", "scrap request not found"));
    const result = await query(`INSERT INTO station_scrap_assessments
      (request_id,responsibility_type,responsible_person,department,equipment_no,score,deduction_amount,
       assessment_result,assessment_note,assessed_by,assessed_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
      ON CONFLICT(request_id) DO UPDATE SET responsibility_type=EXCLUDED.responsibility_type,
       responsible_person=EXCLUDED.responsible_person,department=EXCLUDED.department,equipment_no=EXCLUDED.equipment_no,
       score=EXCLUDED.score,deduction_amount=EXCLUDED.deduction_amount,assessment_result=EXCLUDED.assessment_result,
       assessment_note=EXCLUDED.assessment_note,assessed_by=EXCLUDED.assessed_by,assessed_at=NOW() RETURNING *`,
      [requestId, req.body?.responsibilityType || "PENDING", req.body?.responsiblePerson || null,
       req.body?.department || null, req.body?.equipmentNo || null, Number(req.body?.score || 0),
       Number(req.body?.deductionAmount || 0), req.body?.assessmentResult || "RECORDED",
       req.body?.assessmentNote || null, actor]);
    await query(`INSERT INTO station_scrap_audit(request_id,action,actor,detail) VALUES($1,'ASSESSMENT_RECORDED',$2,$3)`,
      [requestId, actor, JSON.stringify(req.body || {})]);
    res.json({ ok: true, item: result.rows[0] });
  } catch (error) { res.status(500).json(errorEnvelope("SCRAP_ASSESSMENT_FAILED", error.message)); }
});

app.post("/api/station/scrap-requests/:id/approve", authenticateJWT, async (req, res) => {
  try {
    await stationScrapColumnsReady;
    const requestId = Number(req.params.id);
    const role = String(req.body?.role || "").toUpperCase();
    const approver = String(req.body?.approver || "").trim();
    const reason = String(req.body?.reason || "").trim();
    if (!requestId || !approver || !reason || !["QUALITY", "LINE_LEADER", "MES_MANAGER"].includes(role))
      return res.status(400).json(errorEnvelope("VALIDATION", "role, approver and reason are required"));
    const current = await query(`SELECT * FROM station_scrap_requests WHERE request_id=$1`, [requestId]);
    if (!current.rows.length) return res.status(404).json(errorEnvelope("NOT_FOUND", "scrap request not found"));
    const record = current.rows[0];
    if (role === "QUALITY") {
      if (record.status !== "PENDING_QUALITY") return res.status(409).json(errorEnvelope("INVALID_STATE", "quality approval is not pending"));
      const updated = await query(`UPDATE station_scrap_requests SET status='PENDING_LINE_LEADER',
        quality_approver=$2,quality_reason=$3,quality_approved_at=NOW() WHERE request_id=$1 RETURNING *`,
        [requestId, approver, reason]);
      neuralBroadcast({ from: "mes_server", to: "*", type: "SCRAP_QUALITY_APPROVED",
        stationCode: record.station_code, payload: { requestId, batchId: record.batch_id, approver }, priority: "critical" });
      return res.json({ ok: true, item: updated.rows[0] });
    }
    if (role === "MES_MANAGER" && record.status !== "PENDING_MES_APPROVAL")
      return res.status(409).json(errorEnvelope("INVALID_STATE", "MES approval is not pending"));
    if (role === "LINE_LEADER" && record.status !== "PENDING_LINE_LEADER")
      return res.status(409).json(errorEnvelope("INVALID_STATE", "line-leader approval is not pending"));
    const state = await readStationBuckets(record.station_code);
    const matches = item => String(item.batchId || item.sn || "") === String(record.batch_id);
    const sns = [
      ...(Array.isArray(record.motherboard?.subBoards) ? record.motherboard.subBoards.map(board => board.sn) : []),
      ...state.pending_ng.filter(matches).map(item => item.sn), ...state.confirmed_ng.filter(matches).map(item => item.sn),
    ].filter(Boolean);
    state.pending_ng = state.pending_ng.filter(item => !matches(item));
    state.confirmed_ng = state.confirmed_ng.filter(item => !matches(item));
    state.pass = state.pass.filter(item => !matches(item));
    const updated = await query(`UPDATE station_scrap_requests SET status='SCRAPPED_HELD',
      mes_approver=CASE WHEN $4='MES_MANAGER' THEN $2 ELSE mes_approver END,
      mes_approved_at=CASE WHEN $4='MES_MANAGER' THEN NOW() ELSE mes_approved_at END,
      line_leader=CASE WHEN $4='LINE_LEADER' THEN $2 ELSE line_leader END,
      line_leader_reason=$3,line_leader_approved_at=CASE WHEN $4='LINE_LEADER' THEN NOW() ELSE line_leader_approved_at END
      WHERE request_id=$1 RETURNING *`, [requestId, approver, reason, role]);
    state.scrap = state.scrap.filter(item => String(item.batchId || item.sn || "") !== String(record.batch_id));
    state.scrap.push({ batchId: record.batch_id, stationCode: record.station_code, status: "SCRAPPED_HELD",
      requestReason: record.request_reason, scrappedAt: Date.now(), motherboard: record.motherboard,
      subBoards: record.motherboard?.subBoards || [], sns });
    await Promise.all([
      commitStationBucket(record.station_code, "pending_ng", state.pending_ng),
      commitStationBucket(record.station_code, "confirmed_ng", state.confirmed_ng),
      commitStationBucket(record.station_code, "pass", state.pass),
      commitStationBucket(record.station_code, "scrap", state.scrap),
      commitStationBucket(record.station_code, "process", [{ stage: "SCRAP_COMPLETED", requestId,
        batchId: record.batch_id, approver, reason, updatedAt: Date.now() }]),
      closeStationResidence(record.station_code, record.batch_id, sns),
    ]);
    await stationScrapAuditReady;
    await query(`INSERT INTO station_scrap_audit(request_id,action,actor,detail)
      VALUES($1,'MES_APPROVED_AND_HELD',$2,$3)`, [requestId, approver, JSON.stringify({ reason, role, sns })]);
    neuralBroadcast({ from: "mes_server", to: "*", type: "SCRAP_COMPLETED", stationCode: record.station_code,
      payload: { requestId, batchId: record.batch_id, sns, approver }, priority: "critical" });
    res.json({ ok: true, item: updated.rows[0], removedSnCount: sns.length });
  } catch (error) { res.status(500).json(errorEnvelope("SCRAP_APPROVAL_FAILED", error.message)); }
});

app.post("/api/station/scrap-requests/:id/reject", authenticateJWT, async (req, res) => {
  try {
    await stationScrapColumnsReady;
    const requestId = Number(req.params.id);
    const approver = String(req.body?.approver || "").trim();
    const reason = String(req.body?.reason || "").trim();
    if (!requestId || !approver || !reason) return res.status(400).json(errorEnvelope("VALIDATION", "approver and reason are required"));
    const result = await query(`UPDATE station_scrap_requests SET status='REJECTED',rejected_by=$2,
      rejected_at=NOW(),line_leader_reason=$3 WHERE request_id=$1 AND status IN ('PENDING_QUALITY','PENDING_LINE_LEADER') RETURNING *`,
      [requestId, approver, reason]);
    if (!result.rows.length) return res.status(409).json(errorEnvelope("INVALID_STATE", "scrap request cannot be rejected"));
    const row = result.rows[0];
    await commitStationBucket(row.station_code, "process", [{ stage: "SCRAP_REJECTED", requestId,
      batchId: row.batch_id, approver, reason, updatedAt: Date.now() }]);
    neuralBroadcast({ from: "mes_server", to: "*", type: "SCRAP_REJECTED", stationCode: row.station_code,
      payload: { requestId, batchId: row.batch_id, approver, reason }, priority: "critical" });
    res.json({ ok: true, item: row });
  } catch (error) { res.status(500).json(errorEnvelope("SCRAP_REJECT_FAILED", error.message)); }
});

app.get("/api/station/residence-stats", async (req, res) => {
  try {
    await stationResidenceReady;
    const stationCode = canonicalMesStationCode(req.query.stationCode, String(req.query.lineDomain || '').trim().toUpperCase());
    const values = stationCode ? [stationCode] : [];
    const filter = stationCode ? "WHERE station_code=$1" : "";
    const summary = await query(`SELECT station_code AS "stationCode",COUNT(*)::int AS "visits",
      COUNT(*) FILTER (WHERE is_ng)::int AS "ngVisits",
      COUNT(*) FILTER (WHERE NOT is_ng)::int AS "passIn",
      COUNT(*) FILTER (WHERE NOT is_ng AND status='LEFT_STATION')::int AS "passOut",
      COUNT(*) FILTER (WHERE NOT is_ng AND status='IN_STATION')::int AS "passBalance",
      COUNT(*) FILTER (WHERE status='IN_STATION')::int AS "currentCount",
      COUNT(*) FILTER (WHERE status='IN_STATION' AND is_ng)::int AS "currentNgCount",
      ROUND(AVG(COALESCE(duration_seconds,EXTRACT(EPOCH FROM (NOW()-entered_at)))))::int AS "avgSeconds",
      MAX(COALESCE(duration_seconds,EXTRACT(EPOCH FROM (NOW()-entered_at))))::int AS "maxSeconds"
      FROM station_product_residence ${filter} GROUP BY station_code ORDER BY station_code`, values);
    const current = await query(`SELECT residence_id AS "residenceId",sn,batch_id AS "batchId",
      station_code AS "stationCode",product_state AS "productState",defect_code AS "defectCode",is_ng AS "isNg",
      entered_at AS "enteredAt",EXTRACT(EPOCH FROM (NOW()-entered_at))::int AS "seconds"
      FROM station_product_residence ${filter ? `${filter} AND` : "WHERE"} status='IN_STATION'
      ORDER BY entered_at ASC LIMIT 1000`, values);
    const history = await query(`SELECT residence_id AS "residenceId",sn,batch_id AS "batchId",
      station_code AS "stationCode",product_state AS "productState",defect_code AS "defectCode",is_ng AS "isNg",
      entered_at AS "enteredAt",exited_at AS "exitedAt",next_station_code AS "nextStationCode",
      next_residence_id AS "nextResidenceId",
      COALESCE(duration_seconds,EXTRACT(EPOCH FROM (NOW()-entered_at))::int) AS "seconds",status
      FROM station_product_residence ${filter} ORDER BY entered_at DESC LIMIT 1000`, values);
    res.json({ ok: true, thresholdMinutes: RESIDENCE_TIMEOUT_MINUTES,
      summary: summary.rows, current: current.rows, history: history.rows });
  } catch (error) {
    res.status(500).json(errorEnvelope("RESIDENCE_STATS_FAILED", error.message));
  }
});

app.get('/api/mes/overall-balance',async(_req,res)=>{try{
  await Promise.all([stationResidenceReady,mesIntegrityReady]);
  const [balance,alerts]=await Promise.all([query(`SELECT ss.station_code AS "stationCode",ss.sequence_order AS "sequenceOrder",
    COUNT(r.residence_id)::int AS "totalIn",
    COUNT(r.residence_id) FILTER(WHERE r.status='LEFT_STATION')::int AS "totalOut",
    COUNT(r.residence_id) FILTER(WHERE r.status='IN_STATION')::int AS "currentWip",
    COUNT(r.residence_id) FILTER(WHERE r.status NOT IN('LEFT_STATION','IN_STATION'))::int AS "approvedOrExceptional",
    (COUNT(r.residence_id)-COUNT(r.residence_id) FILTER(WHERE r.status='LEFT_STATION')-
      COUNT(r.residence_id) FILTER(WHERE r.status='IN_STATION')-
      COUNT(r.residence_id) FILTER(WHERE r.status NOT IN('LEFT_STATION','IN_STATION')))::int AS discrepancy,
    COUNT(r.residence_id) FILTER(WHERE r.status='LEFT_STATION' AND r.next_station_code IS NOT NULL AND r.next_residence_id IS NULL)::int AS "missingNextReceipt"
    FROM station_sequences ss LEFT JOIN station_product_residence r ON r.station_code=ss.station_code
    WHERE ss.line_code='MANUAL-LINE' GROUP BY ss.station_code,ss.sequence_order ORDER BY ss.sequence_order`),query(`SELECT alert_id AS "alertId",alert_type AS "alertType",station_code AS "stationCode",
    entity_id AS "entityId",severity,status,detail,first_detected_at AS "firstDetectedAt",last_detected_at AS "lastDetectedAt"
    FROM station_mes_integrity_alerts WHERE status='OPEN' ORDER BY CASE severity WHEN 'critical' THEN 0 ELSE 1 END,last_detected_at DESC`)]);
  const total=balance.rows.reduce((sum,row)=>sum+Math.abs(Number(row.discrepancy||0))+Number(row.missingNextReceipt||0),0);
  res.json({ok:true,balanced:total===0&&alerts.rows.length===0,totalDiscrepancy:total,stations:balance.rows,openAlerts:alerts.rows});
}catch(error){res.status(500).json(errorEnvelope('OVERALL_BALANCE_FAILED',error.message));}});

app.get('/api/mes/lineage/:identity',async(req,res)=>{try{
  await Promise.all([stationRouteProgressReady,stationResidenceReady,stationHandoverReady,stationAgingHistoryReady,
    packagingBoxAuditReady,packagingBoxMappingReady,palletBindingReady,stationRepairWorkOrderReady]);
  const identity=String(req.params.identity||'').trim().toUpperCase();
  if(!identity)return res.status(400).json(errorEnvelope('VALIDATION','identity required'));
  let root=await resolveRouteRoot(identity);
  const box=(await query(`SELECT b.container_id,b.items FROM station_packaging_boxes b
    WHERE UPPER(b.container_id)=UPPER($1) OR b.items @> jsonb_build_array($1::text)
      OR EXISTS(SELECT 1 FROM station_packaging_box_items bi
        WHERE bi.container_id=b.container_id AND UPPER(bi.product_sn)=UPPER($1))
    LIMIT 1`,[identity])).rows[0];
  if(box&&identity===String(box.container_id).toUpperCase()){
    const first=Array.isArray(box.items)?box.items[0]:null;if(first)root=await resolveRouteRoot(typeof first==='string'?first:first?.sn);
  }
  const [aliases,route,residence,handovers,aging,containers,repairs]=await Promise.all([
    query(`SELECT alias_sn AS "aliasSn",alias_type AS "aliasType",detail,created_at AS "createdAt"
      FROM station_sn_identity_alias WHERE root_sn=$1 OR alias_sn=$1 ORDER BY created_at`,[root]),
    query(`SELECT station_code AS "stationCode",sequence_order AS "sequenceOrder",source_sn AS "sourceSn",status,result,
      completed_at AS "completedAt",detail FROM station_sn_route_progress WHERE root_sn=$1 ORDER BY sequence_order,completed_at`,[root]),
    query(`SELECT residence_id AS "residenceId",sn,batch_id AS "batchId",station_code AS "stationCode",product_state AS "productState",
      is_ng AS "isNg",entered_at AS "enteredAt",exited_at AS "exitedAt",next_station_code AS "nextStationCode",status
      FROM station_product_residence WHERE UPPER(sn)=UPPER($1) ORDER BY entered_at`,[root]),
    query(`SELECT transfer_id AS "transferId",batch_id AS "batchId",source_station AS "sourceStation",destination_station AS "destinationStation",
      destination_type AS "destinationType",status,sent_at AS "sentAt",received_at AS "receivedAt"
      FROM station_handover_transfers WHERE motherboard::text ILIKE $1 ORDER BY sent_at`,[`%${root}%`]),
    query(`SELECT event_type AS "eventType",result,station_code AS "stationCode",event_at AS "eventAt",
      destination_station AS "destinationStation",detail FROM station_aging_events WHERE UPPER(sn)=UPPER($1) ORDER BY event_at`,[root]),
    query(`SELECT container_id AS "containerId",work_order_code AS "workOrderCode",capacity,current_count AS "currentCount",status,
      created_at AS "createdAt",sealed_at AS "sealedAt" FROM station_packaging_boxes WHERE items @> jsonb_build_array($1::text)`,[root]),
    query(`SELECT work_order_no AS "workOrderNo",source_station AS "sourceStation",status,created_at AS "createdAt",
      received_at AS "receivedAt",repair_completed_at AS "repairCompletedAt",repair_result AS "repairResult"
      FROM station_repair_work_orders WHERE UPPER(ng_sn)=UPPER($1) ORDER BY created_at`,[root])]);
  const current=residence.rows.find(row=>row.status==='IN_STATION')||null;
  const lastRoute=route.rows[route.rows.length-1]||null;
  const nextExpected=lastRoute?(await query(`SELECT station_code AS "stationCode" FROM station_sequences
    WHERE line_code='MANUAL-LINE' AND sequence_order>$1 ORDER BY sequence_order LIMIT 1`,[lastRoute.sequenceOrder])).rows[0]||null:null;
  const pallets=containers.rows.length?await query(`SELECT pc.container_id AS "containerId",pc.pallet_code AS "palletCode",p.status,
    p.work_order_code AS "workOrderCode",pc.added_at AS "addedAt" FROM station_pallet_cartons pc JOIN station_pallets p ON p.pallet_code=pc.pallet_code
    WHERE pc.container_id=ANY($1::text[])`,[containers.rows.map(row=>row.containerId)]):{rows:[]};
  const familyContainer=box?.container_id||containers.rows[0]?.containerId||null;
  const siblingProducts=familyContainer?(await query(`SELECT product_sn AS "sn",slot_position AS "slotPosition"
    FROM station_packaging_box_items WHERE container_id=$1 ORDER BY slot_position`,[familyContainer])).rows:[];
  const familyPallet=familyContainer?(await query(`SELECT pc.pallet_code AS "palletCode",p.status,p.work_order_code AS "workOrderCode"
    FROM station_pallet_cartons pc JOIN station_pallets p ON p.pallet_code=pc.pallet_code
    WHERE pc.container_id=$1 LIMIT 1`,[familyContainer])).rows[0]||null:null;
  const siblingCartons=familyPallet?(await query(`SELECT container_id AS "containerId",added_at AS "addedAt"
    FROM station_pallet_cartons WHERE pallet_code=$1 ORDER BY added_at`,[familyPallet.palletCode])).rows:[];
  res.json({ok:true,identity,rootSn:root,origin:route.rows[0]||residence.rows[0]||null,currentLocation:current,
    nextExpectedStation:current?.nextStationCode?{stationCode:current.nextStationCode}:nextExpected,
    aliases:aliases.rows,route:route.rows,residence:residence.rows,handovers:handovers.rows,aging:aging.rows,
    containers:containers.rows,pallets:pallets.rows,repairs:repairs.rows,
    family:{scannedQr:identity,motherQr:root,containerId:familyContainer,pallet:familyPallet,
      siblingProducts,siblingCartons},
    provenanceComplete:Boolean((route.rows[0]||residence.rows[0])&&(current||nextExpected||pallets.rows.length))});
}catch(error){res.status(500).json(errorEnvelope('LINEAGE_QUERY_FAILED',error.message));}});

app.delete("/api/station/data/:stationCode", async (req, res) => {
  const stationCode = String(req.params.stationCode || "").trim();
  if (!stationCode) return res.status(400).json(errorEnvelope("VALIDATION", "stationCode required"));
  try {
    await query("DELETE FROM station_bucket_snapshots WHERE station_code=$1", [stationCode]);
    for (let index = recentStationEvents.length - 1; index >= 0; index -= 1) {
      if (recentStationEvents[index]?.stationCode === stationCode) recentStationEvents.splice(index, 1);
    }
    neuralBroadcast({
      from: "mes_server", to: "*", type: "STATION_DATA_CLEARED", stationCode,
      payload: { stationCode, cleared: true }, priority: "info",
    });
    res.json({ ok: true, stationCode, cleared: true });
  } catch (e) {
    res.status(500).json(errorEnvelope("SERVER_ERROR", e.message));
  }
});
}

// ============================================================================
// 工位桶快照/库存上报/NG 守卫（bucket snapshot）—— 从 server.js 整段搬迁
// （refactor-plan-2026-11-21 阶段3轮3续）。原位置：server.js 4765-5277（7 路由：
// inventory PUT/GET、bucket-snapshots PUT/GET、database-management、ng-guard、
// ng-special-exemption）。挂载在 app.use("/api",api) 与鉴权闸门之上,位置语义不变。
// LEGACY_BUCKET_STATION_ALIASES / stationBucketSnapshotCache 全仓只在本段使用,
// 随段迁入(缓存原地改写,与搬迁前同一份对象)。canonicalStationCode 直接 import。
// ============================================================================
export function registerStationBucketRoutes(app, deps) {
  const {
    domainLineCode, stationDomain, stationHeartbeatSnapshot,
    mesManagerInstructionReady, stationNgDispatchAlarmReady, stationAgingHistoryReady,
    stationConflictColumnsReady, stationHandoverReady, stationInterceptionReady,
    stationInventoryReady, stationRepairWorkOrderReady, stationRouteProgressReady,
    stationRouteRequestReady, stationSnapshotTableReady,
  } = deps;

// ── P0-2: /api/station/inventory/{station} ─ bucket snapshot via unified body ─
// Rework Core (and other Cores) push a consolidated payload here.
app.put("/api/station/inventory/:stationCode", async (req, res) => {
  try {
    const stationCode = String(req.params.stationCode || "").trim().toLowerCase();
    if (!stationCode) return res.status(400).json(errorEnvelope("VALIDATION", "stationCode required"));
    const payload = req.body?.payload || {};
    await query(`CREATE TABLE IF NOT EXISTS station_inventory_snapshots (
      station_code VARCHAR(64) PRIMARY KEY,
      sn_records JSONB NOT NULL DEFAULT '[]'::jsonb,
      pass JSONB NOT NULL DEFAULT '[]'::jsonb,
      pending_ng JSONB NOT NULL DEFAULT '[]'::jsonb,
      confirmed_ng JSONB NOT NULL DEFAULT '[]'::jsonb,
      stats JSONB NOT NULL DEFAULT '[]'::jsonb,
      version BIGINT NOT NULL DEFAULT 1,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`).catch(()=>{});
    const version = Date.now();
    await query(`INSERT INTO station_inventory_snapshots
      (station_code,sn_records,pass,pending_ng,confirmed_ng,stats,version,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,NOW())
      ON CONFLICT(station_code) DO UPDATE SET
        sn_records=EXCLUDED.sn_records, pass=EXCLUDED.pass,
        pending_ng=EXCLUDED.pending_ng, confirmed_ng=EXCLUDED.confirmed_ng,
        stats=EXCLUDED.stats, version=EXCLUDED.version, updated_at=NOW()`, [
      stationCode,
      JSON.stringify(payload.sn_records || []),
      JSON.stringify(payload.pass || []),
      JSON.stringify(payload.pending_ng || []),
      JSON.stringify(payload.confirmed_ng || []),
      JSON.stringify(payload.stats || []),
      version
    ]);
    res.json({ ok: true, stationCode, version });
  } catch (e) {
    res.status(500).json(errorEnvelope("INVENTORY_SNAPSHOT_FAILED", e.message));
  }
});

app.get("/api/station/inventory/:stationCode", async (req, res) => {
  try {
    const stationCode = String(req.params.stationCode || "").trim().toLowerCase();
    const r = await query(`SELECT * FROM station_inventory_snapshots WHERE station_code=$1`, [stationCode]);
    res.json(r.rows[0] ? { ok: true, ...r.rows[0] } : { ok: true, stationCode, items: [] });
  } catch (e) {
    res.status(500).json(errorEnvelope("INVENTORY_QUERY_FAILED", e.message));
  }
});

query(`CREATE TABLE IF NOT EXISTS station_bucket_snapshots (
  station_code VARCHAR(64) NOT NULL,
  bucket_name VARCHAR(64) NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  payload JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (station_code,bucket_name))
`).catch(e => console.error("station_bucket_snapshots init:", e.message));

const LEGACY_BUCKET_STATION_ALIASES = Object.freeze({
  manu_aoi:'manu_aio', manu_qrbinding:'manu_shellbinding',
  manu_assembly:'manu_assem_ate', manu_hivolt:'manu_hivolt_ate',
  manu_packing:'manu_package_ate', manu_case:'manu_case_binding',
  manu_outer_box_binding:'manu_case_binding', manu_pallet:'manu_pallet_binding',
  auto_ate_left:'auto_package_ate', auto_ate_right:'auto_package_ate'
});

app.put("/api/station/bucket-snapshots/:stationCode/:bucketName", async (req, res) => {
  const requestedStationCode = String(req.params.stationCode || '').trim().toLowerCase();
  const stationCode = LEGACY_BUCKET_STATION_ALIASES[requestedStationCode]
    || canonicalStationCode(requestedStationCode, domainLineCode(stationDomain(requestedStationCode)));
  const bucketName = String(req.params.bucketName || '').trim().toLowerCase();
  const payload = req.body?.payload ?? [];
  const domain = stationDomain(stationCode);
  const claimedDomain = String(req.body?.domain || '').trim().toLowerCase();
  if (domain && claimedDomain && claimedDomain !== domain)
    return res.status(409).json(errorEnvelope('DOMAIN_MISMATCH', `${stationCode} belongs to ${domain}`));
  const records = Array.isArray(payload) ? payload : [payload];
  const foreign = records.find(item => {
    const embedded = String(item?.stationCode || item?.sourceStationCode || '').trim();
    const embeddedDomain = stationDomain(embedded);
    return embeddedDomain && domain && embeddedDomain !== domain;
  });
  if (foreign)
    return res.status(409).json(errorEnvelope('CROSS_DOMAIN_BUCKET_WRITE_DENIED', `${stationCode} cannot store another line's station payload`));
  try {
    const result = await query(`
      INSERT INTO station_bucket_snapshots (station_code,bucket_name,version,payload)
      VALUES ($1,$2,1,$3)
      ON CONFLICT (station_code,bucket_name) DO UPDATE SET
        version=station_bucket_snapshots.version+1,payload=EXCLUDED.payload,updated_at=NOW()
      RETURNING station_code,bucket_name,version,updated_at`,
      [stationCode, bucketName, JSON.stringify(payload)]
    );
    const row = result.rows[0];
    // A write must make the short-lived polling cache stale immediately.
    if (typeof stationBucketSnapshotCache !== 'undefined') {
      stationBucketSnapshotCache.expiresAt = 0;
      stationBucketSnapshotCache.value = null;
    }
    const snapshotEvent = {
      from: "mes_server", to: "*", type: "BUCKET_SNAPSHOT_UPDATE",
      stationCode,
      payload: {
        stationCode,
        bucketName,
        version: Number(row.version),
        records: payload,
        updatedAt: row.updated_at,
      },
      priority: "info",
    };
    neuralBroadcast(snapshotEvent);
    res.json({ ok: true, stationCode, bucketName, version: Number(row.version), updatedAt: row.updated_at });
  } catch (e) {
    res.status(500).json(errorEnvelope("SERVER_ERROR", e.message));
  }
});

// MES 3D clients poll this endpoint from several tabs at once.  Snapshot
// payloads can be large, so coalesce concurrent identical reads and briefly
// reuse the completed result instead of opening one PostgreSQL query per tab.
let stationBucketSnapshotCache = { key: "", expiresAt: 0, value: null, pending: null };

app.get("/api/station/bucket-snapshots", async (req, res) => {
  try {
    const domain = String(req.query.domain || '').trim().toLowerCase();
    if (domain && !['smt','auto','manual'].includes(domain))
      return res.status(400).json(errorEnvelope('VALIDATION', 'domain must be smt, auto or manual'));
    const prefix = domain === 'smt' ? 'smt_%' : domain === 'auto' ? 'auto_%' : domain === 'manual' ? 'manu_%' : null;
    const key = domain || 'all';
    const now = Date.now();
    if (stationBucketSnapshotCache.key === key && stationBucketSnapshotCache.expiresAt > now && stationBucketSnapshotCache.value) {
      return res.json(stationBucketSnapshotCache.value);
    }
    if (stationBucketSnapshotCache.key !== key || !stationBucketSnapshotCache.pending) {
      stationBucketSnapshotCache = {
        key,
        expiresAt: 0,
        value: null,
        pending: query(`SELECT station_code AS "stationCode",bucket_name AS "bucketName",version,payload,updated_at AS "updatedAt"
          FROM station_bucket_snapshots WHERE ($1::text IS NULL OR station_code LIKE $1 OR ($1='manu_%' AND station_code='wave_solder'))
          ORDER BY station_code,CASE WHEN bucket_name='simulation' THEN 0 ELSE 1 END,bucket_name`, [prefix])
          .then(result => {
            const value = { ok: true, items: result.rows };
            stationBucketSnapshotCache.value = value;
            stationBucketSnapshotCache.expiresAt = Date.now() + 1500;
            return value;
          })
          .finally(() => { stationBucketSnapshotCache.pending = null; })
      };
    }
    res.json(await stationBucketSnapshotCache.pending);
  } catch (e) {
    res.status(500).json(errorEnvelope("SERVER_ERROR", e.message));
  }
});

app.get("/api/station/database-management", async (_req, res) => {
  try {
    await Promise.all([stationSnapshotTableReady, stationInventoryReady, stationConflictColumnsReady]);
    const result = await query(`
      WITH station_catalog AS (
        SELECT DISTINCT ON (station_code) station_code,line_code,sequence_order,station_name_zh
        FROM station_sequences ORDER BY station_code,sequence_order
      ), station_codes AS (
        SELECT station_code FROM station_catalog UNION SELECT station_code FROM station_bucket_snapshots
        UNION SELECT station_code FROM station_inventory_checks UNION SELECT station_code FROM station_data_conflicts
      ), snapshot_stats AS (
        SELECT station_code,COUNT(*)::int dataset_count,
          COALESCE(SUM(CASE WHEN jsonb_typeof(payload)='array' THEN jsonb_array_length(payload) ELSE 1 END),0)::int mes_record_count,
          MAX(updated_at) latest_snapshot_at,ARRAY_AGG(bucket_name ORDER BY bucket_name) datasets
        FROM station_bucket_snapshots GROUP BY station_code
      ), latest_inventory AS (
        SELECT DISTINCT ON (station_code,dataset) station_code,dataset,local_count,mes_count,status,checked_at
        FROM station_inventory_checks ORDER BY station_code,dataset,checked_at DESC
      ), inventory_stats AS (
        SELECT station_code,COUNT(*)::int inventory_dataset_count,COALESCE(SUM(local_count),0)::int local_count,
          COALESCE(SUM(mes_count),0)::int inventory_mes_count,
          COUNT(*) FILTER (WHERE status NOT IN ('CONSISTENT','MATCHED','OK'))::int mismatch_count,
          MAX(checked_at) latest_inventory_at FROM latest_inventory GROUP BY station_code
      ), conflict_stats AS (
        SELECT station_code,COUNT(*) FILTER (WHERE status='PENDING_INVESTIGATION')::int open_conflicts
        FROM station_data_conflicts GROUP BY station_code
      )
      SELECT c.station_code AS "stationCode",s.line_code AS "lineCode",s.sequence_order AS "sequenceOrder",
        s.station_name_zh AS "stationName",COALESCE(ss.dataset_count,0) AS "datasetCount",
        COALESCE(ss.datasets,ARRAY[]::varchar[]) AS datasets,COALESCE(i.inventory_dataset_count,0) AS "inventoryDatasetCount",
        COALESCE(i.local_count,0) AS "localCount",COALESCE(i.inventory_mes_count,ss.mes_record_count,0) AS "mesCount",
        COALESCE(i.mismatch_count,0) AS "mismatchCount",COALESCE(cf.open_conflicts,0) AS "openConflicts",
        ss.latest_snapshot_at AS "latestSnapshotAt",i.latest_inventory_at AS "latestInventoryAt"
      FROM station_codes c LEFT JOIN station_catalog s ON s.station_code=c.station_code
      LEFT JOIN snapshot_stats ss ON ss.station_code=c.station_code LEFT JOIN inventory_stats i ON i.station_code=c.station_code
      LEFT JOIN conflict_stats cf ON cf.station_code=c.station_code
      ORDER BY COALESCE(s.line_code,'ZZZ'),COALESCE(s.sequence_order,9999),c.station_code`);
    const now = Date.now();
    const items = result.rows.map(row => {
      const heartbeat = stationHeartbeatSnapshot.get(row.stationCode);
      const latestSignal = Math.max(heartbeat?.receivedAt || 0,
        row.latestInventoryAt ? new Date(row.latestInventoryAt).getTime() : 0,
        row.latestSnapshotAt ? new Date(row.latestSnapshotAt).getTime() : 0);
      const ageMs = latestSignal ? now - latestSignal : Number.POSITIVE_INFINITY;
      const status = heartbeat && now-heartbeat.receivedAt < 45_000 ? "ONLINE" : ageMs < 15*60_000 ? "STALE" : "OFFLINE";
      return {...row,localCount:Number(row.localCount),mesCount:Number(row.mesCount),datasetCount:Number(row.datasetCount),
        inventoryDatasetCount:Number(row.inventoryDatasetCount),mismatchCount:Number(row.mismatchCount),openConflicts:Number(row.openConflicts),status,
        heartbeatAt:heartbeat?new Date(heartbeat.receivedAt).toISOString():null,latestSignalAt:latestSignal?new Date(latestSignal).toISOString():null};
    });
    const count = status => items.filter(item => item.status===status).length;
    res.json({ok:true,generatedAt:new Date(now).toISOString(),thresholds:{onlineSeconds:45,staleMinutes:15},
      summary:{stations:items.length,online:count("ONLINE"),stale:count("STALE"),offline:count("OFFLINE"),
        mismatched:items.filter(item=>item.mismatchCount>0).length,conflicts:items.reduce((sum,item)=>sum+item.openConflicts,0)},items});
  } catch(error) { res.status(500).json(errorEnvelope("STATION_DATABASE_MANAGEMENT_FAILED",error.message)); }
});

app.get('/api/mes/managers/status',async(_req,res)=>{
  try{
    await Promise.all([stationRouteProgressReady,stationInterceptionReady,stationHandoverReady,
      stationRouteRequestReady,stationRepairWorkOrderReady,stationNgDispatchAlarmReady]);
    const [route,routeBlocks,ng,handover,repair,identity,guards]=await Promise.all([
      query(`SELECT COUNT(*)::int total,COUNT(DISTINCT root_sn)::int products,
        MAX(completed_at) last_activity FROM station_sn_route_progress`),
      query(`SELECT COUNT(*)::int open,MAX(intercepted_at) last_activity
        FROM station_interception_events WHERE interception_type='OUT_OF_SEQUENCE' AND status='OPEN'`),
      query(`SELECT COALESCE(SUM(jsonb_array_length(payload)),0)::int active,
        MAX(updated_at) last_activity FROM station_bucket_snapshots WHERE bucket_name='confirmed_ng'`),
      query(`SELECT COUNT(*) FILTER(WHERE status='WAITING_RECEIPT')::int waiting,
        COUNT(*) FILTER(WHERE status='WAITING_RECEIPT' AND alarmed_at IS NOT NULL)::int overdue,
        MAX(COALESCE(received_at,sent_at)) last_activity FROM station_handover_transfers`),
      query(`SELECT COUNT(*) FILTER(WHERE status='WAITING_RECEIPT')::int waiting,
        COUNT(*) FILTER(WHERE status='REPAIR_IN_PROGRESS')::int repairing,
        COUNT(*) FILTER(WHERE repair_deadline_at<=NOW() AND status NOT IN('COMPLETED','REVIVED','SCRAPPED'))::int overdue,
        MAX(updated_at) last_activity FROM station_repair_work_orders`),
      query(`SELECT COUNT(*)::int aliases,COUNT(DISTINCT root_sn)::int products,MAX(created_at) last_activity
        FROM station_sn_identity_alias`),
      query(`SELECT COUNT(*) FILTER(WHERE status='OPEN')::int open,
        COUNT(*) FILTER(WHERE status='OPEN' AND interception_type IN('TODAY_DUPLICATE','HISTORICAL_DUPLICATE','CONFIRMED_NG'))::int critical,
        MAX(intercepted_at) last_activity FROM station_interception_events`)
    ]);
    const now=Date.now();
    const card=(code,name,metrics,lastActivity,critical=0)=>({code,name,
      status:Number(critical)>0?'attention':'working',metrics,lastActivity:lastActivity||null,
      reportedAt:now});
    res.json({ok:true,reportedAt:now,managers:[
      card('ROUTE_MANAGER','Route Sequence Manager',{products:route.rows[0].products,completedSteps:route.rows[0].total,blocked:routeBlocks.rows[0].open},routeBlocks.rows[0].last_activity||route.rows[0].last_activity,routeBlocks.rows[0].open),
      card('NG_MANAGER','NG Lifecycle Manager',{activeNg:ng.rows[0].active},ng.rows[0].last_activity,ng.rows[0].active),
      card('HANDOVER_MANAGER','Handover Manager',{waiting:handover.rows[0].waiting,overdue:handover.rows[0].overdue},handover.rows[0].last_activity,handover.rows[0].overdue),
      card('MAINTENANCE_MANAGER','Maintenance WO Manager',{waiting:repair.rows[0].waiting,repairing:repair.rows[0].repairing,overdue:repair.rows[0].overdue},repair.rows[0].last_activity,repair.rows[0].overdue),
      card('IDENTITY_MANAGER','Canonical Identity Manager',{aliases:identity.rows[0].aliases,products:identity.rows[0].products},identity.rows[0].last_activity),
      card('GUARD_MANAGER','DUP / NG Guard',{open:guards.rows[0].open,critical:guards.rows[0].critical},guards.rows[0].last_activity,guards.rows[0].critical)
    ]});
  }catch(error){res.status(500).json(errorEnvelope('MES_MANAGER_STATUS_FAILED',error.message));}
});

app.get('/api/mes/managers/instructions',async(_req,res)=>{
  try{
    await mesManagerInstructionReady;
    const result=await query(`SELECT instruction_id AS "instructionId",manager_code AS "managerCode",
      command,instructed_by AS "instructedBy",note,status,created_at AS "createdAt",
      completed_at AS "completedAt",result FROM mes_manager_instructions
      ORDER BY created_at DESC LIMIT 100`);
    res.json({ok:true,items:result.rows});
  }catch(error){res.status(500).json(errorEnvelope('MES_MANAGER_INSTRUCTIONS_FAILED',error.message));}
});

app.post('/api/mes/managers/instructions',async(req,res)=>{
  try{
    await mesManagerInstructionReady;
    const managerCode=String(req.body?.managerCode||'').trim().toUpperCase();
    const command=String(req.body?.command||'').trim().toUpperCase();
    const instructedBy=String(req.body?.instructedBy||'').trim();
    const note=String(req.body?.note||'').trim();
    const managers=new Set(['ROUTE_MANAGER','NG_MANAGER','HANDOVER_MANAGER','MAINTENANCE_MANAGER','IDENTITY_MANAGER','GUARD_MANAGER']);
    const commands=new Set(['REPORT_NOW','RUN_AUDIT','RECONCILE']);
    if(!managers.has(managerCode)||!commands.has(command)||!instructedBy)
      return res.status(400).json(errorEnvelope('VALIDATION','valid managerCode, command and instructedBy required'));
    const created=(await query(`INSERT INTO mes_manager_instructions
      (manager_code,command,instructed_by,note,status) VALUES($1,$2,$3,$4,'ACCEPTED')
      RETURNING instruction_id,created_at`,[managerCode,command,instructedBy,note])).rows[0];
    const payload={instructionId:created.instruction_id,managerCode,command,instructedBy,note,
      createdAt:created.created_at,prohibitsOverride:true};
    neuralBroadcast({from:'mes_manager_console',to:managerCode,type:'MES_MANAGER_INSTRUCTION',
      stationCode:'mes',payload,priority:command==='RUN_AUDIT'?'critical':'info'});
    await query(`UPDATE mes_manager_instructions SET status='COMPLETED',completed_at=NOW(),
      result=$2 WHERE instruction_id=$1`,[created.instruction_id,JSON.stringify({broadcast:true,accepted:true})]);
    res.status(201).json({ok:true,...payload,status:'COMPLETED'});
  }catch(error){res.status(500).json(errorEnvelope('MES_MANAGER_INSTRUCTION_FAILED',error.message));}
});

app.get("/api/station/ng-guard", async (_req,res)=>{
  try {
    await stationSnapshotTableReady;
    await stationAgingHistoryReady;
    const [result,aging]=await Promise.all([
      query(`SELECT station_code AS "stationCode",bucket_name AS "bucketName",version,payload,updated_at AS "updatedAt"
        FROM station_bucket_snapshots WHERE bucket_name IN ('pending_ng','confirmed_ng')
          AND jsonb_array_length(payload)>0 ORDER BY station_code,bucket_name`),
      query(`WITH aging_ng AS (
        SELECT sn,batch_id AS "batchId",status,latest_result AS result,
          ng_detected_at AS "ngDetectedAt",updated_at AS "updatedAt"
          FROM station_aging_control WHERE status='NG_MARKED'
        UNION ALL
        SELECT UPPER(TRIM(payload->>'sn')) AS sn,
          COALESCE(NULLIF(payload->>'batchId',''),UPPER(TRIM(payload->>'sn'))) AS "batchId",
          'NG_MARKED' AS status,'NG' AS result,received_at AS "ngDetectedAt",received_at AS "updatedAt"
          FROM station_production_events
          WHERE station_code='manu_agingcab' AND event_type='STATION_NG_MARKED'
            AND COALESCE(TRIM(payload->>'sn'),'')<>''
            AND NOT EXISTS (SELECT 1 FROM station_production_events picked
              WHERE picked.event_type='STATION_NG_PICKED'
                AND UPPER(TRIM(picked.payload->>'sn'))=UPPER(TRIM(station_production_events.payload->>'sn')))
      ) SELECT DISTINCT ON(sn) * FROM aging_ng ORDER BY sn,"updatedAt" DESC`)
    ]);
    const candidates=result.rows.flatMap(row=>(Array.isArray(row.payload)?row.payload:[]).map(item=>{
      const stationResults=Array.isArray(item.stationResults)?item.stationResults:[];
      // Ensure row.stationCode is always represented in stationResults for this SN
      const rowStationCode=String(row.stationCode||'');
      if(rowStationCode&&!stationResults.some(s=>String(s.stationCode||'')===rowStationCode)){
        stationResults.push({stationCode:rowStationCode,results:['FAIL'],finalResult:'FAIL',testCount:1});
      }
      return{
        ...item,sn:String(item.sn||'').trim().toUpperCase(),
        sourceStationCode:item.sourceStationCode||row.stationCode,
        stationResults,ngState:row.bucketName==='confirmed_ng'?'CONFIRMED_NG':'PENDING_NG',
        bucketName:row.bucketName,bucketVersion:Number(row.version)
      };
    })).concat(aging.rows.map(item=>({
      ...item,sn:String(item.sn||'').trim().toUpperCase(),sourceStationCode:'manu_agingcab',
      destinationStationCode:'manu_hivolt_ate',ngState:'NG_MARKED',markedOnly:true,
      destinationNgBox:'AGING_NG_BOX',destinationNgBoxLabel:'老化 NG 箱 / AGING NG BOX',
      blockingSuppressedAtSource:true,pickOutRequiredDownstream:true
    })));
    // Safety fallback: an unresolved MES NG must remain an active stop guard
    // even if the station_bucket_snapshots writer missed its update.
    const unresolvedResult = await query(`
      SELECT sn, station_code AS "sourceStationCode",
        defect_code AS "defectCode", created_at AS "firstDetectedAt",
        repair_status AS "repairStatus"
      FROM ng_defect_records
      WHERE LOWER(COALESCE(result,''))='fail'
        AND LOWER(COALESCE(repair_status,'pending')) NOT IN ('repaired','scrapped')
    `);
    for (const ng of unresolvedResult.rows) {
      const sn = String(ng.sn || '').trim().toUpperCase();
      if (!sn) continue;
      candidates.push({
        sn,
        batchId: sn,
        sourceStationCode: ng.sourceStationCode || 'UNKNOWN',
        stationResults: [{ stationCode: ng.sourceStationCode || 'UNKNOWN', results: ['FAIL'], finalResult: 'FAIL', testCount: 1 }],
        result: 'FAIL',
        defectCode: ng.defectCode || 'NG',
        defectDescription: 'NG',
        firstDetectedAt: ng.firstDetectedAt,
        ngState: 'CONFIRMED_NG',
        bucketName: 'confirmed_ng',
        bucketVersion: 0,
        fallbackFromNgDefectRecords: true,
      });
    }
    // Some machine integrations write the canonical NG fact to the SN journey
    // ledger before the legacy ng_defect_records projection is available.
    // Keep those unclosed NG_DEFECT events blocking as well.
    const unresolvedJourneyNg = await query(`
      SELECT e.sn, e.batch_id AS "batchId", e.station_code AS "sourceStationCode",
        e.defect_code AS "defectCode", e.defect_description AS "defectDescription",
        e.event_at AS "firstDetectedAt"
      FROM sn_journey_events e
      WHERE e.event_type='NG_DEFECT'
        AND NOT EXISTS (
          SELECT 1 FROM sn_journey_events closed
          WHERE UPPER(closed.sn)=UPPER(e.sn)
            AND closed.event_type IN ('NG_PICKED','NG_REPAIRED','NG_REVIVED','NG_SCRAPPED')
            AND closed.event_at >= e.event_at
        )
    `);
    for (const ng of unresolvedJourneyNg.rows) {
      const sn = String(ng.sn || '').trim().toUpperCase();
      if (!sn) continue;
      candidates.push({
        sn,
        batchId: ng.batchId || sn,
        sourceStationCode: ng.sourceStationCode || 'UNKNOWN',
        stationResults: [{ stationCode: ng.sourceStationCode || 'UNKNOWN', results: ['FAIL'], finalResult: 'FAIL', testCount: 1 }],
        result: 'FAIL',
        defectCode: ng.defectCode || 'NG',
        defectDescription: ng.defectDescription || 'NG',
        firstDetectedAt: ng.firstDetectedAt,
        ngState: 'CONFIRMED_NG',
        bucketName: 'confirmed_ng',
        bucketVersion: 0,
        fallbackFromJourneyLedger: true,
      });
    }
    // Active station residence is the final safety source for machine results.
    // If the unit is still IN_STATION with is_ng=true, it must be blocked even
    // when the legacy NG table and journey projection are incomplete.
    const activeNgResidence = await query(`
      SELECT p.source_sn AS sn, r.batch_id AS "batchId",
        p.station_code AS "sourceStationCode", p.result,
        p.completed_at AS "firstDetectedAt", p.detail
      FROM station_sn_route_progress p
      JOIN station_product_residence r
        ON UPPER(r.sn)=UPPER(p.source_sn)
      WHERE r.is_ng=true
        AND r.status='IN_STATION'
        AND (UPPER(COALESCE(p.status,''))='NG_COMPLETED'
          OR LOWER(COALESCE(p.result,'')) IN ('fail','ng'))
    `);
    for (const ng of activeNgResidence.rows) {
      const sn = String(ng.sn || '').trim().toUpperCase();
      if (!sn) continue;
      candidates.push({
        sn,
        batchId: ng.batchId || sn,
        sourceStationCode: ng.sourceStationCode || 'UNKNOWN',
        stationResults: [{ stationCode: ng.sourceStationCode || 'UNKNOWN', results: ['FAIL'], finalResult: 'FAIL', testCount: 1 }],
        result: 'FAIL',
        defectCode: 'ACTIVE_NG_RESIDENCE',
        defectDescription: 'NG unit remains in station',
        firstDetectedAt: ng.firstDetectedAt,
        ngState: 'CONFIRMED_NG',
        bucketName: 'confirmed_ng',
        bucketVersion: 0,
        fallbackFromActiveResidence: true,
      });
    }
    const rank={PENDING_NG:1,NG_MARKED:2,CONFIRMED_NG:3};
    const bySn=new Map();
    for(const item of candidates){
      if(!item.sn)continue;
      const previous=bySn.get(item.sn);
      if(!previous){
        bySn.set(item.sn,item);
      } else if((rank[item.ngState]||0)>(rank[previous.ngState]||0)){
        bySn.set(item.sn,item);
      } else if(item.ngState===previous.ngState){
        // Same ngState — union stationResults so no station is lost, regardless of source
        const prevResults=Array.isArray(previous.stationResults)?previous.stationResults:[];
        const currResults=Array.isArray(item.stationResults)?item.stationResults:[];
        const prevSrc=String(previous.sourceStationCode||'');
        const currSrc=String(item.sourceStationCode||'');
        const prevIct=/ict/i.test(prevSrc);
        const prevFct=/fct/i.test(prevSrc);
        const currIct=/ict/i.test(currSrc);
        const currFct=/fct/i.test(currSrc);
        // Debug: print deduplication
        if(item.sn&&(item.sn.includes('DUAL-')||item.sn.includes('FCT')||item.sn.includes('ICT'))){
          console.error(`[NG-DEDUP] sn=${item.sn} prevSrc=${prevSrc} currSrc=${currSrc} prevResults=${JSON.stringify(prevResults.map(r=>r.stationCode))} currResults=${JSON.stringify(currResults.map(r=>r.stationCode))}`);
        }
        // Deduplicate by stationCode
        const seen=new Set();
        const merged=[];
        for(const r of [...prevResults,...currResults]){
          const key=String(r.stationCode||'');
          if(key&&!seen.has(key)){seen.add(key);merged.push(r);}
        }
        bySn.set(item.sn,{
          ...previous,
          sourceStationCode:prevIct&&prevFct?prevSrc:(currIct&&currFct?currSrc:prevIct?'manu_ict':prevFct?'manu_fct':currSrc),
          stationResults:merged,
        });
      }
    }
    const items=[...bySn.values()];
    // The bucket version alone is not globally monotonic: a busy station can
    // have a lower version than an older, high-volume station.  Include the
    // snapshot update time so any newly changed source station advances the
    // MES→Agent NG cursor and is delivered on the next poll.
    const version=Math.max(0,...result.rows.map(r=>Number(r.version)||0),
      ...result.rows.map(r=>new Date(r.updatedAt||0).getTime()||0),
      ...aging.rows.map(r=>new Date(r.updatedAt||0).getTime()||0));

    // NG异常消失检测：检查ng_defect_records中未完成闭环的SN是否还在ng-guard中
    // 如果一个SN在ng_defect_records中标记为NG，但在ng-guard中消失了，且没有对应的STATION_NG_PICKED或NG_REVIVED事件，则触发报警
    const activeGuardSns=new Set(items.map(i=>i.sn));
    const unresolvedNgs=await query(`SELECT sn,id AS "ngDefectId",station_code AS "stationCode",defect_code AS "defectCode",created_at AS "createdAt" FROM ng_defect_records WHERE LOWER(COALESCE(result,''))='fail' AND LOWER(COALESCE(repair_status,'pending')) NOT IN('repaired','scrapped') AND created_at > NOW()-INTERVAL '24 hours'`);
    const alerts=[];
    for(const ng of unresolvedNgs.rows){
      if(!activeGuardSns.has(ng.sn)){
        // SN不在ng-guard中，检查是否有闭环事件
        const closedEvent=await query(`SELECT 1 FROM sn_journey_events WHERE UPPER(sn)=UPPER($1) AND event_type IN('NG_PICKED','NG_REPAIRED','NG_REVIVED','NG_SCRAPPED') AND event_at>=$2 LIMIT 1`,[ng.sn,ng.createdAt]);
        if(!closedEvent.rows.length){
          // 无闭环事件，触发异常消失报警
          alerts.push({type:'NG_GONE',sn:ng.sn,ngDefectId:ng.ngDefectId,stationCode:ng.stationCode,defectCode:ng.defectCode,detectedAt:ng.createdAt,message:`NG记录异常消失: SN=${ng.sn} 在${ng.stationCode}产生NG但在ng-guard中消失且无闭环记录`});
        }
      }
    }
    if(alerts.length>0){
      neuralBroadcast({from:'mes_ng_registry',to:'*',type:'NG_GONE_ALARM',priority:'critical',stationCode:'mes',payload:{alerts,count:alerts.length}});
    }

    res.json({ok:true,active:true,count:items.length,version,scope:'ALL_STATION_NG',items,alerts:alerts.length>0?alerts:undefined});
  } catch(error){res.status(500).json(errorEnvelope("NG_GUARD_QUERY_FAILED",error.message));}
});

// NG special exemptions are centrally approved in MES. They are intentionally
// limited to ultrasonic-origin NG and expire eight hours after approval.
app.get("/api/station/ng-special-exemption", async (req,res)=>{
  try{
    const sn=String(req.query?.sn||"").trim().toUpperCase();
    const stationCode=String(req.query?.stationCode||"").trim().toLowerCase();
    if(!sn||stationCode!=="manu_case_binding")
      return res.status(400).json(errorEnvelope("VALIDATION","sn and manu_case_binding stationCode are required"));
    await query(`UPDATE ng_special_exemptions SET status='EXPIRED'
      WHERE status='ACTIVE' AND expires_at<=NOW()`);
    const item=(await query(`SELECT exemption_id AS "exemptionId",sn,source_station AS "sourceStation",
      reason,approved_by_username AS "approvedByUsername",approved_by_name AS "approvedByName",
      approved_at AS "approvedAt",expires_at AS "expiresAt",status
      FROM ng_special_exemptions WHERE UPPER(sn)=$1 AND status='ACTIVE'
        AND expires_at>NOW() AND source_station IN('manu_supersonic','supersonic')
      ORDER BY approved_at DESC LIMIT 1`,[sn])).rows[0]||null;
    res.json({ok:true,active:Boolean(item),item});
  }catch(error){res.status(500).json(errorEnvelope("NG_EXEMPTION_STATION_QUERY_FAILED",error.message));}
});
}

