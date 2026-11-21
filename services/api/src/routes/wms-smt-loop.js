// Canonical SMT-material closed loop (/api/wms/smt-loop/*), moved out of
// services/api/server.js.
//
// 30 registrations. WMS owns physical stock and reels, MES owns execution and
// consumption facts, and this surface exposes one reconciled view over both: dashboard,
// material classification and change requests, work-order reconciliation, exception
// resolution, returns and receipt, and the non-IQC receipt check chain.
//
// Pure registrations with no module-level statements in the block -- the maintenance/pmc
// shape. registerWmsSmtLoopRoutes is invoked at the line the block used to occupy.
export function registerWmsSmtLoopRoutes(app, deps) {
  const { pgPool, requirePermission, envelope, errorEnvelope, mutateEnvelope, listEnvelope, randomUUID } = deps;


// Canonical SMT-material closed loop. WMS owns physical stock and reels;
// MES owns execution/consumption facts; this API exposes one reconciled view.
app.get("/api/wms/smt-loop/dashboard",requirePermission("wms.view"),async(req,res)=>{
  try{
    const [summary,events,exceptions]=await Promise.all([
      pgPool.query(`SELECT
        (SELECT COUNT(*)::int FROM material_process_classifications WHERE process_domain='SMT_MATERIAL' AND status='ACTIVE') classified_materials,
        (SELECT COUNT(*)::int FROM smt_loading_sessions WHERE status IN('LOADING','READY')) active_loading_sessions,
        (SELECT COUNT(*)::int FROM feeder_binding_events WHERE status='active') active_bindings,
        (SELECT COALESCE(SUM(placed_qty),0)::bigint FROM npm_material_consumption_events) placed_qty,
        (SELECT COUNT(*)::int FROM npm_material_consumption_events WHERE reconciliation_status<>'MATCHED') unmatched_consumption,
        (SELECT COUNT(*)::int FROM smt_material_flow_exceptions WHERE status IN('OPEN','INVESTIGATING')) open_exceptions`),
      pgPool.query(`SELECT * FROM smt_material_flow_events ORDER BY occurred_at DESC,id DESC LIMIT 100`),
      pgPool.query(`SELECT * FROM smt_material_flow_exceptions WHERE status IN('OPEN','INVESTIGATING')
        ORDER BY CASE severity WHEN 'CRITICAL' THEN 1 WHEN 'BLOCK' THEN 2 ELSE 3 END,detected_at DESC LIMIT 100`)
    ]);
    res.json(mutateEnvelope({summary:summary.rows[0],events:events.rows,exceptions:exceptions.rows}));
  }catch(error){res.status(500).json(errorEnvelope("SMT_LOOP_DASHBOARD_FAILED",error.message));}
});

app.get("/api/wms/smt-loop/materials",requirePermission("wms.view"),async(req,res)=>{
  try{
    const rows=await pgPool.query(`SELECT m.id,m.code,m.name_zh,m.name_en,m.name_vi,
      COALESCE(c.process_domain,'UNCLASSIFIED') process_domain,c.tracking_level,c.consumption_source,
      c.requires_feeder,c.requires_msd_control,c.status,c.updated_at
      FROM materials m LEFT JOIN material_process_classifications c ON c.material_id=m.id
      WHERE ($1::text IS NULL OR COALESCE(c.process_domain,'UNCLASSIFIED')=$1)
      ORDER BY m.code LIMIT 1000`,[req.query.domain||null]);
    res.json(listEnvelope(rows.rows));
  }catch(error){res.status(500).json(errorEnvelope("SMT_MATERIAL_LIST_FAILED",error.message));}
});

app.post("/api/wms/smt-loop/materials/:materialId/classify",requirePermission("wms.write"),async(req,res)=>{
  try{
    const p=req.body?.payload??req.body??{},domain=String(p.processDomain??"").toUpperCase();
    if(!["SMT_MATERIAL","NON_SMT_MATERIAL"].includes(domain))return res.status(400).json(errorEnvelope("VALIDATION","SMT_MATERIAL or NON_SMT_MATERIAL required"));
    const row=(await pgPool.query(`INSERT INTO material_process_classifications
      (material_id,process_domain,tracking_level,consumption_source,requires_feeder,requires_msd_control,classified_by,reason)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT(material_id) DO UPDATE SET process_domain=EXCLUDED.process_domain,tracking_level=EXCLUDED.tracking_level,
      consumption_source=EXCLUDED.consumption_source,requires_feeder=EXCLUDED.requires_feeder,
      requires_msd_control=EXCLUDED.requires_msd_control,classified_by=EXCLUDED.classified_by,
      reason=EXCLUDED.reason,updated_at=NOW() RETURNING *`,
      [req.params.materialId,domain,p.trackingLevel??(domain==="SMT_MATERIAL"?"REEL_SN":"LOT"),
       p.consumptionSource??(domain==="SMT_MATERIAL"?"NPM":"MES"),Boolean(p.requiresFeeder??domain==="SMT_MATERIAL"),
       Boolean(p.requiresMsdControl),String(p.actor??req.user?.username??"WMS"),String(p.reason??"Material process classification")])).rows[0];
    res.json(mutateEnvelope(row));
  }catch(error){res.status(409).json(errorEnvelope("SMT_MATERIAL_CLASSIFY_FAILED",error.message));}
});

app.get("/api/wms/smt-loop/work-orders/:code/reconciliation",requirePermission("wms.view"),async(req,res)=>{
  try{
    const code=req.params.code;
    const [bindings,consumption,exceptions]=await Promise.all([
      pgPool.query(`SELECT machine_code,slot_no,feeder_code,material_code,material_sn,lot_no,qty,
        consumed_qty,placed_qty,rejected_qty,status,bound_at,unbound_at
        FROM feeder_binding_events WHERE work_order_code=$1 ORDER BY machine_code,slot_no,bound_at`,[code]),
      pgPool.query(`SELECT material_sn,COALESCE(SUM(pickup_qty),0)::bigint pickup_qty,
        COALESCE(SUM(placed_qty),0)::bigint placed_qty,COALESCE(SUM(rejected_qty),0)::bigint rejected_qty,
        BOOL_AND(reconciliation_status='MATCHED') reconciled
        FROM npm_material_consumption_events WHERE work_order_code=$1 GROUP BY material_sn ORDER BY material_sn`,[code]),
      pgPool.query(`SELECT * FROM smt_material_flow_exceptions WHERE work_order_code=$1 ORDER BY detected_at DESC`,[code])
    ]);
    const closed=exceptions.rows.every(x=>["RESOLVED","VOIDED"].includes(x.status))&&consumption.rows.every(x=>x.reconciled);
    res.json(mutateEnvelope({workOrderCode:code,closed,bindings:bindings.rows,consumption:consumption.rows,exceptions:exceptions.rows}));
  }catch(error){res.status(500).json(errorEnvelope("SMT_RECONCILIATION_FAILED",error.message));}
});

app.post("/api/wms/smt-loop/exceptions/:id/resolve",requirePermission("wms.execute"),async(req,res)=>{
  try{
    const p=req.body?.payload??req.body??{};
    if(!String(p.resolution??"").trim())return res.status(400).json(errorEnvelope("VALIDATION","Resolution is required"));
    const row=(await pgPool.query(`UPDATE smt_material_flow_exceptions SET status='RESOLVED',resolved_at=NOW(),
      resolved_by=$2,resolution=$3 WHERE id=$1 AND status IN('OPEN','INVESTIGATING') RETURNING *`,
      [req.params.id,String(p.actor??req.user?.username??"WMS"),String(p.resolution)])).rows[0];
    if(!row)return res.status(404).json(errorEnvelope("NOT_FOUND","Open exception not found"));
    res.json(mutateEnvelope(row));
  }catch(error){res.status(409).json(errorEnvelope("SMT_EXCEPTION_RESOLVE_FAILED",error.message));}
});

app.post("/api/wms/smt-loop/classification-changes",requirePermission("wms.write"),async(req,res)=>{
  try{
    const p=req.body?.payload??req.body??{};
    const current=(await pgPool.query("SELECT process_domain FROM material_process_classifications WHERE material_id=$1",[p.materialId])).rows[0];
    const no=`MCL-${new Date().toISOString().slice(0,10).replaceAll("-","")}-${randomUUID().slice(0,6).toUpperCase()}`;
    const row=(await pgPool.query(`INSERT INTO material_classification_change_requests
      (request_no,material_id,from_domain,to_domain,proposed_tracking_level,proposed_consumption_source,evidence,effective_from,requested_by,reason)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [no,p.materialId,current?.process_domain??null,String(p.toDomain).toUpperCase(),p.trackingLevel,p.consumptionSource,
       JSON.stringify(p.evidence??[]),p.effectiveFrom,String(p.actor??req.user?.username??"WMS"),p.reason])).rows[0];
    res.status(201).json(mutateEnvelope(row));
  }catch(error){res.status(409).json(errorEnvelope("CLASSIFICATION_CHANGE_CREATE_FAILED",error.message));}
});

app.post("/api/wms/smt-loop/classification-changes/:id/decision",requirePermission("wms.write"),async(req,res)=>{
  const client=await pgPool.connect();try{
    const p=req.body?.payload??req.body??{},role=String(p.approvalRole??"").toUpperCase(),decision=String(p.decision??"").toUpperCase();
    await client.query("BEGIN");const item=(await client.query("SELECT * FROM material_classification_change_requests WHERE id=$1 AND status='PENDING_APPROVAL' FOR UPDATE",[req.params.id])).rows[0];
    if(!item||!["WMS_MANAGER","ENGINEERING","PMC_MANAGER"].includes(role))throw new Error("Pending request or approval role not found");
    await client.query(`INSERT INTO material_classification_change_approvals(request_id,approval_role,decision,actor,comment)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(request_id,approval_role) DO UPDATE SET decision=EXCLUDED.decision,actor=EXCLUDED.actor,comment=EXCLUDED.comment,decided_at=NOW()`,
      [item.id,role,decision,String(p.actor??role),String(p.comment??"Reviewed")]);
    const approvals=(await client.query("SELECT approval_role,decision FROM material_classification_change_approvals WHERE request_id=$1",[item.id])).rows;
    const required=["WMS_MANAGER","ENGINEERING","PMC_MANAGER"];
    const status=decision==="REJECT"?"REJECTED":required.every(x=>approvals.some(a=>a.approval_role===x&&a.decision==="APPROVE"))?"APPROVED":"PENDING_APPROVAL";
    const row=(await client.query("UPDATE material_classification_change_requests SET status=$2 WHERE id=$1 RETURNING *",[item.id,status])).rows[0];
    await client.query("COMMIT");res.json(mutateEnvelope(row));
  }catch(error){await client.query("ROLLBACK").catch(()=>{});res.status(409).json(errorEnvelope("CLASSIFICATION_CHANGE_DECISION_FAILED",error.message));}finally{client.release();}
});

app.post("/api/wms/smt-loop/classification-changes/:id/apply",requirePermission("wms.execute"),async(req,res)=>{
  const client=await pgPool.connect();try{
    const p=req.body?.payload??req.body??{};await client.query("BEGIN");
    const item=(await client.query("SELECT * FROM material_classification_change_requests WHERE id=$1 AND status='APPROVED' AND effective_from<=NOW() FOR UPDATE",[req.params.id])).rows[0];
    if(!item)throw new Error("Approved and effective request not found");
    await client.query(`INSERT INTO material_process_classifications(material_id,process_domain,tracking_level,consumption_source,requires_feeder,classified_by,reason)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(material_id) DO UPDATE SET process_domain=EXCLUDED.process_domain,
      tracking_level=EXCLUDED.tracking_level,consumption_source=EXCLUDED.consumption_source,requires_feeder=EXCLUDED.requires_feeder,
      classified_by=EXCLUDED.classified_by,reason=EXCLUDED.reason,updated_at=NOW()`,
      [item.material_id,item.to_domain,item.proposed_tracking_level,item.proposed_consumption_source,item.to_domain==="SMT_MATERIAL",String(p.actor??"WMS_MANAGER"),item.reason]);
    const row=(await client.query("UPDATE material_classification_change_requests SET status='APPLIED' WHERE id=$1 RETURNING *",[item.id])).rows[0];
    await client.query("COMMIT");res.json(mutateEnvelope(row));
  }catch(error){await client.query("ROLLBACK").catch(()=>{});res.status(409).json(errorEnvelope("CLASSIFICATION_CHANGE_APPLY_FAILED",error.message));}finally{client.release();}
});

app.post("/api/wms/smt-loop/returns",requirePermission("wms.execute"),async(req,res)=>{
  try{
    const p=req.body?.payload??req.body??{};
    const b=(await pgPool.query("SELECT * FROM feeder_binding_events WHERE id=$1 AND status='unbound'",[p.bindingId])).rows[0];
    if(!b)throw new Error("Unbound feeder record not found");
    const no=`SMTR-${new Date().toISOString().slice(0,10).replaceAll("-","")}-${randomUUID().slice(0,6).toUpperCase()}`;
    const theoretical=Math.max(Number(b.qty)-Number(b.consumed_qty??0),0);
    const row=(await pgPool.query(`INSERT INTO smt_material_return_handovers
      (handover_no,binding_id,work_order_code,material_code,material_sn,lot_no,theoretical_qty,quality_verdict,sent_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [no,b.id,b.work_order_code,b.material_code,b.material_sn,b.lot_no,theoretical,p.qualityVerdict??"PASS",String(p.actor??"OPERATOR")])).rows[0];
    res.status(201).json(mutateEnvelope(row));
  }catch(error){res.status(409).json(errorEnvelope("SMT_RETURN_CREATE_FAILED",error.message));}
});

app.post("/api/wms/smt-loop/returns/:id/receive",requirePermission("wms.execute"),async(req,res)=>{
  try{
    const p=req.body?.payload??req.body??{},actual=Number(p.actualQty);
    const current=(await pgPool.query("SELECT * FROM smt_material_return_handovers WHERE id=$1 AND status='WAITING_WMS_RECEIPT'",[req.params.id])).rows[0];
    if(!current)throw new Error("Waiting return handover not found");
    const same=Math.abs(Number(current.theoretical_qty)-actual)<0.0001,status=same?"RECEIVED":"VARIANCE_REVIEW";
    const row=(await pgPool.query(`UPDATE smt_material_return_handovers SET actual_qty=$2,status=$3,received_by=$4,received_at=NOW(),
      variance_reason=$5 WHERE id=$1 RETURNING *`,[current.id,actual,status,String(p.actor??"WMS"),p.varianceReason??null])).rows[0];
    res.json(mutateEnvelope(row));
  }catch(error){res.status(409).json(errorEnvelope("SMT_RETURN_RECEIVE_FAILED",error.message));}
});

app.get("/api/wms/smt-loop/authority-rules",requirePermission("wms.view"),async(_req,res)=>{
  try{res.json(listEnvelope((await pgPool.query("SELECT * FROM data_fact_authority_rules ORDER BY fact_type")).rows));}
  catch(error){res.status(500).json(errorEnvelope("AUTHORITY_RULES_FAILED",error.message));}
});

app.post("/api/wms/smt-loop/work-orders/:code/exceptional-closure",requirePermission("wms.execute"),async(req,res)=>{
  try{
    const p=req.body?.payload??req.body??{},code=req.params.code;
    const [exceptions,returns,unmatched]=await Promise.all([
      pgPool.query("SELECT * FROM smt_material_flow_exceptions WHERE work_order_code=$1 AND status IN('OPEN','INVESTIGATING')",[code]),
      pgPool.query("SELECT * FROM smt_material_return_handovers WHERE work_order_code=$1 AND status<>'RECEIVED'",[code]),
      pgPool.query("SELECT * FROM npm_material_consumption_events WHERE work_order_code=$1 AND reconciliation_status<>'MATCHED'",[code])
    ]);
    const snapshot={exceptions:exceptions.rows,returns:returns.rows,unmatchedConsumption:unmatched.rows};
    if(!exceptions.rowCount&&!returns.rowCount&&!unmatched.rowCount)return res.status(409).json(errorEnvelope("NORMAL_CLOSURE_REQUIRED","No unresolved SMT condition requires exceptional closure"));
    const no=`SMTC-${new Date().toISOString().slice(0,10).replaceAll("-","")}-${randomUUID().slice(0,6).toUpperCase()}`;
    const row=(await pgPool.query(`INSERT INTO smt_exceptional_closure_requests
      (request_no,work_order_code,unresolved_snapshot,cost_impact,reason,requested_by)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [no,code,JSON.stringify(snapshot),Number(p.costImpact??0),p.reason,String(p.actor??req.user?.username??"WMS")])).rows[0];
    res.status(201).json(mutateEnvelope(row));
  }catch(error){res.status(409).json(errorEnvelope("SMT_EXCEPTIONAL_CLOSURE_CREATE_FAILED",error.message));}
});

app.post("/api/wms/smt-loop/exceptional-closures/:id/decision",requirePermission("wms.execute"),async(req,res)=>{
  const client=await pgPool.connect();try{
    const p=req.body?.payload??req.body??{},role=String(p.approvalRole??"").toUpperCase(),decision=String(p.decision??"").toUpperCase();
    await client.query("BEGIN");const item=(await client.query("SELECT * FROM smt_exceptional_closure_requests WHERE id=$1 AND status='PENDING_APPROVAL' FOR UPDATE",[req.params.id])).rows[0];
    if(!item||!item.required_roles.includes(role))throw new Error("Required role or pending request not found");
    const approvals=(Array.isArray(item.approvals)?item.approvals:[]).filter(x=>x.role!==role);
    approvals.push({role,decision,actor:String(p.actor??role),comment:String(p.comment??"Reviewed"),at:new Date().toISOString()});
    const status=decision==="REJECT"?"REJECTED":item.required_roles.every(r=>approvals.some(a=>a.role===r&&a.decision==="APPROVE"))?"APPROVED":"PENDING_APPROVAL";
    const row=(await client.query("UPDATE smt_exceptional_closure_requests SET approvals=$2,status=$3 WHERE id=$1 RETURNING *",
      [item.id,JSON.stringify(approvals),status])).rows[0];
    await client.query("COMMIT");res.json(mutateEnvelope(row));
  }catch(error){await client.query("ROLLBACK").catch(()=>{});res.status(409).json(errorEnvelope("SMT_EXCEPTIONAL_CLOSURE_DECISION_FAILED",error.message));}finally{client.release();}
});

app.get("/api/wms/non-smt/dashboard",requirePermission("wms.view"),async(_req,res)=>{
  try{
    const [summary,events,exceptions,returns]=await Promise.all([
      pgPool.query(`SELECT
        (SELECT COUNT(*)::int FROM material_process_classifications WHERE process_domain='NON_SMT_MATERIAL' AND status='ACTIVE') classified_materials,
        (SELECT COUNT(*)::int FROM non_smt_material_profiles WHERE status='ACTIVE') configured_materials,
        (SELECT COUNT(*)::int FROM non_smt_unit_bindings WHERE status='ACTIVE') active_unit_bindings,
        (SELECT COUNT(*)::int FROM non_smt_return_handovers WHERE status='WAITING_WMS_RECEIPT') pending_returns,
        (SELECT COUNT(*)::int FROM non_smt_material_exceptions WHERE status IN('OPEN','INVESTIGATING')) open_exceptions,
        (SELECT COUNT(*)::int FROM non_smt_work_order_reconciliations WHERE result='FAIL') failed_reconciliations`),
      pgPool.query("SELECT * FROM non_smt_material_events ORDER BY occurred_at DESC,id DESC LIMIT 100"),
      pgPool.query(`SELECT * FROM non_smt_material_exceptions WHERE status IN('OPEN','INVESTIGATING')
        ORDER BY CASE severity WHEN 'CRITICAL' THEN 1 WHEN 'BLOCK' THEN 2 ELSE 3 END,detected_at DESC LIMIT 100`),
      pgPool.query("SELECT * FROM non_smt_return_handovers WHERE status<>'RECEIVED' ORDER BY sent_at DESC LIMIT 100")
    ]);
    res.json(mutateEnvelope({summary:summary.rows[0],events:events.rows,exceptions:exceptions.rows,returns:returns.rows}));
  }catch(error){res.status(500).json(errorEnvelope("NON_SMT_DASHBOARD_FAILED",error.message));}
});

app.post("/api/wms/non-smt/materials/:materialId/profile",requirePermission("wms.execute"),async(req,res)=>{
  const client=await pgPool.connect();try{
    const p=req.body?.payload??req.body??{},mode=String(p.trackingMode??"").toUpperCase();
    const defaults={
      DIRECT_SN:["EACH_UNIT","UNIT_SCAN"],DIRECT_LOT:["LOT_CHANGE","STATION_COUNT"],
      PACKAGING_UNIT:["EACH_PACKAGE","PACKAGE_BIND"],INDIRECT_CONSUMABLE:["ISSUE_RETURN","WEIGHT_DELTA"]
    };
    if(!defaults[mode])throw new Error("Unsupported non-SMT tracking mode");
    await client.query("BEGIN");
    await client.query(`INSERT INTO material_process_classifications
      (material_id,process_domain,tracking_level,consumption_source,requires_feeder,classified_by,reason)
      VALUES($1,'NON_SMT_MATERIAL',$2,'STATION',FALSE,$3,$4)
      ON CONFLICT(material_id) DO UPDATE SET process_domain='NON_SMT_MATERIAL',tracking_level=EXCLUDED.tracking_level,
      consumption_source='STATION',requires_feeder=FALSE,classified_by=EXCLUDED.classified_by,reason=EXCLUDED.reason,updated_at=NOW()`,
      [req.params.materialId,mode==="DIRECT_SN"?"REEL_SN":mode==="PACKAGING_UNIT"?"CONTAINER":mode==="DIRECT_LOT"?"LOT":"BULK",String(p.actor??req.user?.username??"WMS"),String(p.reason??"Non-SMT profile")]);
    const row=(await client.query(`INSERT INTO non_smt_material_profiles
      (material_id,tracking_mode,scan_policy,consumption_method,warning_tolerance_percent,requires_quality_release,configured_by,reason)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT(material_id) DO UPDATE SET tracking_mode=EXCLUDED.tracking_mode,scan_policy=EXCLUDED.scan_policy,
      consumption_method=EXCLUDED.consumption_method,warning_tolerance_percent=EXCLUDED.warning_tolerance_percent,
      requires_quality_release=EXCLUDED.requires_quality_release,configured_by=EXCLUDED.configured_by,
      reason=EXCLUDED.reason,version_no=non_smt_material_profiles.version_no+1,updated_at=NOW() RETURNING *`,
      [req.params.materialId,mode,p.scanPolicy??defaults[mode][0],p.consumptionMethod??defaults[mode][1],
       Number(p.warningTolerancePercent??0),p.requiresQualityRelease!==false,String(p.actor??req.user?.username??"WMS"),String(p.reason??"Non-SMT profile")])).rows[0];
    await client.query("COMMIT");res.json(mutateEnvelope(row));
  }catch(error){await client.query("ROLLBACK").catch(()=>{});res.status(409).json(errorEnvelope("NON_SMT_PROFILE_FAILED",error.message));}finally{client.release();}
});

app.post("/api/wms/non-smt/validate",requirePermission("wms.execute"),async(req,res)=>{
  try{
    const p=req.body?.payload??req.body??{};
    const row=(await pgPool.query(`SELECT wo.id work_order_id,wo.code work_order_code,wo.status work_order_status,
      m.id material_id,m.code material_code,m.name_zh,bl.qty_per,bl.loss_rate,np.tracking_mode,np.scan_policy,
      np.consumption_method,np.requires_quality_release
      FROM work_orders wo JOIN bom_lines bl ON bl.bom_id=wo.bom_id JOIN materials m ON m.id=bl.material_id
      JOIN material_process_classifications pc ON pc.material_id=m.id AND pc.process_domain='NON_SMT_MATERIAL' AND pc.status='ACTIVE'
      JOIN non_smt_material_profiles np ON np.material_id=m.id AND np.status='ACTIVE'
      WHERE wo.code=$1 AND m.code=$2 LIMIT 1`,[p.workOrderCode,p.materialCode])).rows[0];
    if(!row){
      const no=`NSM-MISMATCH-${randomUUID().slice(0,8).toUpperCase()}`;
      await pgPool.query(`INSERT INTO non_smt_material_exceptions
        (exception_no,exception_type,severity,work_order_code,station_code,material_code,material_sn,source_ref,detail)
        VALUES($1,'MATERIAL_MISMATCH','BLOCK',$2,$3,$4,$5,$6,$7)`,
        [no,p.workOrderCode,p.stationCode,p.materialCode,p.materialSn??null,p.sourceEventId??null,JSON.stringify(p)]);
      return res.status(409).json(errorEnvelope("NON_SMT_BOM_MISMATCH","Material is not an active non-SMT BOM item for this work order"));
    }
    if(row.tracking_mode==="DIRECT_SN"&&p.materialSn){
      const used=(await pgPool.query("SELECT product_sn,status FROM non_smt_unit_bindings WHERE material_sn=$1 AND status='ACTIVE'",[p.materialSn])).rows[0];
      if(used)return res.status(409).json(errorEnvelope("DUPLICATE_BINDING",`Material SN is already bound to ${used.product_sn}`));
    }
    res.json(mutateEnvelope({...row,validated:true}));
  }catch(error){res.status(500).json(errorEnvelope("NON_SMT_VALIDATE_FAILED",error.message));}
});

app.post("/api/wms/non-smt/events",requirePermission("wms.execute"),async(req,res)=>{
  const client=await pgPool.connect();try{
    const p=req.body?.payload??req.body??{},qty=Number(p.qty??0);
    await client.query("BEGIN");
    const existing=(await client.query("SELECT * FROM non_smt_material_events WHERE source_event_id=$1 FOR UPDATE",[p.sourceEventId])).rows[0];
    if(existing){
      const same=existing.event_type===p.eventType&&existing.work_order_code===p.workOrderCode
        &&existing.material_code===p.materialCode&&String(existing.material_sn??"")===String(p.materialSn??"")
        &&String(existing.lot_no??"")===String(p.lotNo??"")&&Number(existing.qty)===qty;
      if(!same){
        await client.query(`INSERT INTO non_smt_material_exceptions
          (exception_no,exception_type,severity,work_order_code,station_code,material_code,material_sn,source_ref,detail)
          VALUES($1,'DATA_CONFLICT','CRITICAL',$2,$3,$4,$5,$6,$7) ON CONFLICT(exception_no) DO UPDATE SET detail=EXCLUDED.detail,detected_at=NOW(),status='OPEN'`,
          [`NSM-CONFLICT-${String(p.sourceEventId).replace(/[^A-Za-z0-9_-]/g,"").slice(0,24)}`,p.workOrderCode,p.stationCode,p.materialCode,p.materialSn??null,p.sourceEventId,JSON.stringify({original:existing,conflicting:p})]);
        await client.query("COMMIT");return res.status(409).json(errorEnvelope("NON_SMT_EVENT_ID_CONFLICT","Same event ID has different immutable content"));
      }
      await client.query("UPDATE non_smt_material_events SET duplicate_delivery_count=duplicate_delivery_count+1,last_duplicate_at=NOW() WHERE id=$1",[existing.id]);
      await client.query("COMMIT");return res.json(mutateEnvelope({...existing,duplicate:true}));
    }
    const material=(await client.query(`SELECT m.id,np.tracking_mode FROM materials m JOIN non_smt_material_profiles np ON np.material_id=m.id
      WHERE m.code=$1 AND np.status='ACTIVE'`,[p.materialCode])).rows[0];
    if(!material)throw new Error("Active non-SMT material profile not found");
    const bomMatch=(await client.query(`SELECT 1 FROM work_orders wo JOIN bom_lines bl ON bl.bom_id=wo.bom_id
      WHERE wo.code=$1 AND bl.material_id=$2`,[p.workOrderCode,material.id])).rows[0];
    if(!bomMatch){
      await client.query(`INSERT INTO non_smt_material_exceptions
        (exception_no,exception_type,severity,work_order_code,station_code,material_code,material_sn,source_ref,detail)
        VALUES($1,'MATERIAL_MISMATCH','BLOCK',$2,$3,$4,$5,$6,$7)`,
        [`NSM-BOM-${randomUUID().slice(0,8).toUpperCase()}`,p.workOrderCode,p.stationCode??null,p.materialCode,p.materialSn??null,p.sourceEventId,JSON.stringify(p)]);
      await client.query("COMMIT");
      return res.status(409).json(errorEnvelope("NON_SMT_BOM_MISMATCH","Event material is not in the work-order BOM"));
    }
    const row=(await client.query(`INSERT INTO non_smt_material_events
      (source_event_id,event_type,tracking_mode,work_order_code,station_code,material_id,material_code,material_sn,lot_no,
       package_code,product_sn,qty,uom,actor,source_system,offline_lease_id,raw_payload,occurred_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [p.sourceEventId,String(p.eventType).toUpperCase(),material.tracking_mode,p.workOrderCode,p.stationCode??null,material.id,p.materialCode,
       p.materialSn??null,p.lotNo??null,p.packageCode??null,p.productSn??null,qty,p.uom??null,String(p.actor??"OPERATOR"),
       p.sourceSystem??"STATION",p.offlineLeaseId??null,JSON.stringify(p),p.occurredAt??new Date()])).rows[0];
    if(["BOUND"].includes(row.event_type)&&["DIRECT_SN","PACKAGING_UNIT"].includes(material.tracking_mode)){
      if(!p.materialSn||!p.productSn)throw new Error("Material SN/package code and product SN are required for unit binding");
      await client.query(`INSERT INTO non_smt_unit_bindings
        (work_order_code,material_id,material_code,material_sn,product_sn,binding_type,bound_event_id)
        VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [p.workOrderCode,material.id,p.materialCode,p.materialSn,p.productSn,material.tracking_mode==="PACKAGING_UNIT"?"PACKAGING":"COMPONENT",row.id]);
    }
    await client.query("COMMIT");res.status(201).json(mutateEnvelope(row));
  }catch(error){await client.query("ROLLBACK").catch(()=>{});res.status(409).json(errorEnvelope("NON_SMT_EVENT_FAILED",error.message));}finally{client.release();}
});

app.post("/api/wms/non-smt/returns",requirePermission("wms.execute"),async(req,res)=>{
  try{
    const p=req.body?.payload??req.body??{},no=`NSMR-${new Date().toISOString().slice(0,10).replaceAll("-","")}-${randomUUID().slice(0,6).toUpperCase()}`;
    const material=(await pgPool.query("SELECT id FROM materials WHERE code=$1",[p.materialCode])).rows[0];
    if(!material)throw new Error("Material not found");
    const row=(await pgPool.query(`INSERT INTO non_smt_return_handovers
      (handover_no,work_order_code,material_id,material_code,material_sn,lot_no,theoretical_qty,sent_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [no,p.workOrderCode,material.id,p.materialCode,p.materialSn??null,p.lotNo??null,Number(p.theoreticalQty),String(p.actor??"OPERATOR")])).rows[0];
    res.status(201).json(mutateEnvelope(row));
  }catch(error){res.status(409).json(errorEnvelope("NON_SMT_RETURN_CREATE_FAILED",error.message));}
});

app.post("/api/wms/non-smt/returns/:id/receive",requirePermission("wms.execute"),async(req,res)=>{
  try{
    const p=req.body?.payload??req.body??{},current=(await pgPool.query("SELECT * FROM non_smt_return_handovers WHERE id=$1 AND status='WAITING_WMS_RECEIPT'",[req.params.id])).rows[0];
    if(!current)throw new Error("Waiting return not found");
    const actual=Number(p.actualQty),variance=actual-Number(current.theoretical_qty),status=Math.abs(variance)<0.0001?"RECEIVED":"VARIANCE_REVIEW";
    const row=(await pgPool.query(`UPDATE non_smt_return_handovers SET actual_qty=$2,status=$3,received_by=$4,received_at=NOW(),variance_reason=$5
      WHERE id=$1 RETURNING *`,[current.id,actual,status,String(p.actor??"WMS"),p.varianceReason??null])).rows[0];
    if(status==="VARIANCE_REVIEW")await pgPool.query(`INSERT INTO non_smt_material_exceptions
      (exception_no,exception_type,severity,work_order_code,material_code,material_sn,source_ref,detail)
      VALUES($1,'QUANTITY_VARIANCE','BLOCK',$2,$3,$4,$5,$6)`,
      [`NSM-RETURN-${current.id}`,current.work_order_code,current.material_code,current.material_sn,current.handover_no,JSON.stringify({theoretical:current.theoretical_qty,actual,variance})]);
    res.json(mutateEnvelope(row));
  }catch(error){res.status(409).json(errorEnvelope("NON_SMT_RETURN_RECEIVE_FAILED",error.message));}
});

app.post("/api/wms/non-smt/work-orders/:code/reconcile",requirePermission("wms.execute"),async(req,res)=>{
  const client=await pgPool.connect();try{
    const code=req.params.code;await client.query("BEGIN");
    const wo=(await client.query("SELECT id,bom_id,planned_qty FROM work_orders WHERE code=$1",[code])).rows[0];
    if(!wo)throw new Error("Work order not found");
    const lines=(await client.query(`SELECT m.id material_id,m.code,bl.qty_per,bl.loss_rate,np.warning_tolerance_percent
      FROM bom_lines bl JOIN materials m ON m.id=bl.material_id JOIN non_smt_material_profiles np ON np.material_id=m.id
      WHERE bl.bom_id=$1 AND np.status='ACTIVE'`,[wo.bom_id])).rows;
    const results=[];
    for(const line of lines){
      const totals=(await client.query(`SELECT
        COALESCE(SUM(qty) FILTER(WHERE event_type='ISSUED'),0) issued,
        COALESCE(SUM(qty) FILTER(WHERE event_type='CONSUMED'),0) consumed,
        COALESCE(SUM(qty) FILTER(WHERE event_type='RETURN_RECEIVED'),0) returned,
        COALESCE(SUM(qty) FILTER(WHERE event_type='SCRAPPED'),0) scrapped
        FROM non_smt_material_events WHERE work_order_code=$1 AND material_id=$2`,[code,line.material_id])).rows[0];
      const required=Number(line.qty_per)*(1+Number(line.loss_rate))*Number(wo.planned_qty);
      const variance=Number(totals.issued)-Number(totals.consumed)-Number(totals.returned)-Number(totals.scrapped);
      const warning=Math.abs(required)*Number(line.warning_tolerance_percent)/100;
      const result=Math.abs(variance)<0.000001?"PASS":Math.abs(variance)<=warning?"WARNING":"FAIL";
      const row=(await client.query(`INSERT INTO non_smt_work_order_reconciliations
        (work_order_code,material_id,bom_required_qty,issued_qty,consumed_qty,returned_qty,scrapped_qty,variance_qty,result,detail)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT(work_order_code,material_id) DO UPDATE SET bom_required_qty=EXCLUDED.bom_required_qty,issued_qty=EXCLUDED.issued_qty,
        consumed_qty=EXCLUDED.consumed_qty,returned_qty=EXCLUDED.returned_qty,scrapped_qty=EXCLUDED.scrapped_qty,
        variance_qty=EXCLUDED.variance_qty,result=EXCLUDED.result,detail=EXCLUDED.detail,checked_at=NOW() RETURNING *`,
        [code,line.material_id,required,totals.issued,totals.consumed,totals.returned,totals.scrapped,variance,result,JSON.stringify({materialCode:line.code,warningTolerance:warning})])).rows[0];
      results.push(row);
    }
    await client.query("COMMIT");res.json(mutateEnvelope({workOrderCode:code,closed:results.every(x=>x.result==="PASS"),results}));
  }catch(error){await client.query("ROLLBACK").catch(()=>{});res.status(409).json(errorEnvelope("NON_SMT_RECONCILE_FAILED",error.message));}finally{client.release();}
});

app.get("/api/wms/non-iqc/dashboard",requirePermission("wms.view"),async(_req,res)=>{
  try{
    const [summary,receipts,issues,loans,dispositions]=await Promise.all([
      pgPool.query(`SELECT
        (SELECT COUNT(*)::int FROM non_iqc_material_profiles WHERE status='ACTIVE') active_materials,
        (SELECT COUNT(*)::int FROM non_iqc_receipts WHERE status='QUARANTINED') quarantined_receipts,
        (SELECT COUNT(*)::int FROM non_iqc_issue_requests WHERE status='PENDING_APPROVAL') pending_issues,
        (SELECT COUNT(*)::int FROM non_iqc_loans WHERE status IN('BORROWED','OVERDUE') AND expected_return_at<NOW()) overdue_loans,
        (SELECT COUNT(*)::int FROM non_iqc_receipt_dispositions WHERE status='PENDING_RECEIPT') pending_handovers,
        (SELECT COUNT(*)::int FROM non_iqc_receipts WHERE status='WAITING_CLOSURE') waiting_closure`),
      pgPool.query("SELECT * FROM non_iqc_receipts ORDER BY received_at DESC LIMIT 100"),
      pgPool.query("SELECT * FROM non_iqc_issue_requests WHERE status NOT IN('CLOSED','CANCELLED') ORDER BY created_at DESC LIMIT 100"),
      pgPool.query("SELECT * FROM non_iqc_loans WHERE status<>'CLOSED' ORDER BY expected_return_at LIMIT 100"),
      pgPool.query("SELECT * FROM non_iqc_receipt_dispositions WHERE status='PENDING_RECEIPT' ORDER BY sent_at LIMIT 100")
    ]);
    res.json(envelope({summary:summary.rows[0],receipts:receipts.rows,issues:issues.rows,loans:loans.rows,dispositions:dispositions.rows}));
  }catch(error){res.status(500).json(errorEnvelope("NON_IQC_DASHBOARD_FAILED",error.message));}
});

app.post("/api/wms/non-iqc/materials/:materialCode/profile",requirePermission("wms.execute"),async(req,res)=>{
  const client=await pgPool.connect();try{
    const p=req.body?.payload??req.body??{};
    if(!p.materialDomain||!p.responsibleDomain||!p.controlMode||!p.reason)throw new Error("Material domain, responsible domain, control mode, and reason are required");
    const required=["QUALITY_MANAGER","ENGINEERING","PROCUREMENT"];
    const approvals=Array.isArray(p.approvals)?p.approvals:[];
    const approvedRoles=new Set(approvals.filter(x=>String(x.decision??"").toUpperCase()==="APPROVED").map(x=>String(x.role??"").toUpperCase()));
    if(!required.every(role=>approvedRoles.has(role)))throw new Error(`Classification approvals required: ${required.join(", ")}`);
    await client.query("BEGIN");
    const previous=(await client.query("SELECT * FROM non_iqc_material_profiles WHERE material_code=$1 FOR UPDATE",[req.params.materialCode])).rows[0]??null;
    const row=(await client.query(`INSERT INTO non_iqc_material_profiles
      (material_code,material_domain,responsible_domain,control_mode,requires_expiry_control,requires_certificate,
       min_stock,max_stock,reorder_point,issue_approval_level,configured_by,reason)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT(material_code) DO UPDATE SET material_domain=EXCLUDED.material_domain,responsible_domain=EXCLUDED.responsible_domain,
      control_mode=EXCLUDED.control_mode,requires_expiry_control=EXCLUDED.requires_expiry_control,
      requires_certificate=EXCLUDED.requires_certificate,min_stock=EXCLUDED.min_stock,max_stock=EXCLUDED.max_stock,
      reorder_point=EXCLUDED.reorder_point,issue_approval_level=EXCLUDED.issue_approval_level,
      configured_by=EXCLUDED.configured_by,reason=EXCLUDED.reason,version_no=non_iqc_material_profiles.version_no+1,updated_at=NOW() RETURNING *`,
      [req.params.materialCode,p.materialDomain,p.responsibleDomain,p.controlMode,!!p.requiresExpiryControl,!!p.requiresCertificate,
       Number(p.minStock??0),p.maxStock==null?null:Number(p.maxStock),Number(p.reorderPoint??0),p.issueApprovalLevel??"SUPERVISOR",
       String(p.actor??"WMS"),p.reason])).rows[0];
    await client.query(`INSERT INTO non_iqc_inventory_controls(material_code)VALUES($1) ON CONFLICT(material_code) DO NOTHING`,[req.params.materialCode]);
    await client.query(`INSERT INTO material_iqc_classification_changes
      (change_no,material_code,previous_classification,new_classification,previous_profile,new_profile,reason,approvals,requested_by)
      VALUES($1,$2,$3,'NON_IQC',$4,$5,$6,$7,$8)`,
      [`IQCC-${Date.now()}-${randomUUID().slice(0,5).toUpperCase()}`,req.params.materialCode,previous?"NON_IQC":null,
       previous?JSON.stringify(previous):null,JSON.stringify(row),p.reason,JSON.stringify(approvals),String(p.actor??"WMS")]);
    await client.query("COMMIT");
    res.status(201).json(mutateEnvelope(row));
  }catch(error){await client.query("ROLLBACK").catch(()=>{});res.status(409).json(errorEnvelope("NON_IQC_PROFILE_FAILED",error.message));}finally{client.release();}
});

app.post("/api/wms/non-iqc/receipts",requirePermission("wms.execute"),async(req,res)=>{
  const client=await pgPool.connect(),p=req.body?.payload??req.body??{};try{
    await client.query("BEGIN");
    if(!p.sourceEventId)throw new Error("sourceEventId is required");
    const duplicate=(await client.query("SELECT * FROM non_iqc_receipts WHERE source_event_id=$1",[p.sourceEventId])).rows[0];
    if(duplicate){await client.query("ROLLBACK");return res.json(mutateEnvelope({...duplicate,duplicateDelivery:true}));}
    const profile=(await client.query("SELECT * FROM non_iqc_material_profiles WHERE material_code=$1 AND status='ACTIVE' FOR UPDATE",[p.materialCode])).rows[0];
    if(!profile)throw new Error("Active non-IQC material profile not found");
    const required=[p.poMatch,p.materialMatch,p.quantityMatch,p.visualPass,p.dateValid,p.documentsComplete];
    const allPassed=required.every(x=>x===true);
    const no=`NIQC-${Date.now()}-${randomUUID().slice(0,5).toUpperCase()}`;
    const row=(await client.query(`INSERT INTO non_iqc_receipts
      (receipt_no,source_event_id,purchase_order_code,supplier_code,material_code,supplier_lot_no,production_date,expiry_date,received_qty,uom,
       po_match,material_match,quantity_match,visual_pass,date_valid,documents_complete,evidence,status,received_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
      [no,p.sourceEventId,p.purchaseOrderCode,p.supplierCode,p.materialCode,p.supplierLotNo??null,p.productionDate??null,p.expiryDate??null,
       Number(p.receivedQty),p.uom??"PCS",!!p.poMatch,!!p.materialMatch,!!p.quantityMatch,!!p.visualPass,!!p.dateValid,
       !!p.documentsComplete,JSON.stringify(p.evidence??[]),allPassed?"AVAILABLE":"QUARANTINED",String(p.actor??"WMS_RECEIVER")])).rows[0];
    if(allPassed)await client.query(`UPDATE non_iqc_inventory_controls SET on_hand_qty=on_hand_qty+$2,
      available_qty=available_qty+$2,last_movement_at=NOW(),updated_at=NOW() WHERE material_code=$1`,[p.materialCode,Number(p.receivedQty)]);
    else await client.query(`UPDATE non_iqc_inventory_controls SET on_hand_qty=on_hand_qty+$2,
      quarantined_qty=quarantined_qty+$2,last_movement_at=NOW(),updated_at=NOW() WHERE material_code=$1`,[p.materialCode,Number(p.receivedQty)]);
    await client.query("INSERT INTO non_iqc_governance_audit(entity_type,entity_id,event_type,actor,detail)VALUES('RECEIPT',$1,$2,$3,$4)",
      [row.id,allPassed?"RECEIPT_AVAILABLE":"RECEIPT_QUARANTINED",String(p.actor??"WMS_RECEIVER"),JSON.stringify({checks:{po:p.poMatch,material:p.materialMatch,quantity:p.quantityMatch,visual:p.visualPass,date:p.dateValid,documents:p.documentsComplete}})]);
    await client.query("COMMIT");res.status(201).json(mutateEnvelope(row));
  }catch(error){
    await client.query("ROLLBACK").catch(()=>{});
    if(error.code==="23505"&&p.sourceEventId){
      const duplicate=(await client.query("SELECT * FROM non_iqc_receipts WHERE source_event_id=$1",[p.sourceEventId])).rows[0];
      if(duplicate)return res.json(mutateEnvelope({...duplicate,duplicateDelivery:true}));
    }
    res.status(409).json(errorEnvelope("NON_IQC_RECEIPT_FAILED",error.message));
  }finally{client.release();}
});

app.post("/api/wms/non-iqc/receipts/:id/dispositions",requirePermission("wms.execute"),async(req,res)=>{
  const client=await pgPool.connect();try{
    const p=req.body?.payload??req.body??{},items=Array.isArray(p.items)?p.items:[];await client.query("BEGIN");
    const receipt=(await client.query("SELECT * FROM non_iqc_receipts WHERE id=$1 FOR UPDATE",[req.params.id])).rows[0];
    if(!receipt||!items.length)throw new Error("Receipt and disposition items are required");
    const total=items.reduce((sum,x)=>sum+Number(x.qty??0),0);
    if(Math.abs(total-Number(receipt.received_qty))>0.0001)throw new Error("Disposition quantity must equal received quantity");
    const rows=[];
    for(const item of items){
      const risky=["ACCEPT_VARIANCE","CONCESSION","SCRAP"].includes(String(item.type));
      if(risky&&(!Array.isArray(item.approvals)||item.approvals.length<2))throw new Error(`${item.type} requires documented approvals`);
      rows.push((await client.query(`INSERT INTO non_iqc_receipt_dispositions
        (receipt_id,disposition_type,qty,document_no,destination,approvals,sent_by)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [receipt.id,item.type,Number(item.qty),item.documentNo,item.destination??null,JSON.stringify(item.approvals??[]),String(p.actor??"WMS")])).rows[0]);
    }
    await client.query("UPDATE non_iqc_receipts SET status='DISPOSITION',updated_at=NOW() WHERE id=$1",[receipt.id]);
    await client.query("COMMIT");res.status(201).json(mutateEnvelope({receiptId:receipt.id,items:rows}));
  }catch(error){await client.query("ROLLBACK").catch(()=>{});res.status(409).json(errorEnvelope("NON_IQC_DISPOSITION_FAILED",error.message));}finally{client.release();}
});

app.post("/api/wms/non-iqc/dispositions/:id/receive",requirePermission("wms.execute"),async(req,res)=>{
  const client=await pgPool.connect();try{
    const p=req.body?.payload??req.body??{};await client.query("BEGIN");
    const item=(await client.query(`UPDATE non_iqc_receipt_dispositions SET status='RECEIVED',received_by=$2,received_at=NOW()
      WHERE id=$1 AND status='PENDING_RECEIPT' RETURNING *`,[req.params.id,String(p.actor??"RECEIVER")])).rows[0];
    if(!item)throw new Error("Pending disposition not found");
    const receipt=(await client.query("SELECT material_code FROM non_iqc_receipts WHERE id=$1",[item.receipt_id])).rows[0];
    if(item.disposition_type==="ACCEPTED")await client.query(`UPDATE non_iqc_inventory_controls SET
      quarantined_qty=GREATEST(0,quarantined_qty-$2),available_qty=available_qty+$2,updated_at=NOW() WHERE material_code=$1`,[receipt.material_code,item.qty]);
    if(["RETURN","SCRAP"].includes(item.disposition_type))await client.query(`UPDATE non_iqc_inventory_controls SET
      on_hand_qty=GREATEST(0,on_hand_qty-$2),quarantined_qty=GREATEST(0,quarantined_qty-$2),updated_at=NOW() WHERE material_code=$1`,[receipt.material_code,item.qty]);
    await client.query("COMMIT");res.json(mutateEnvelope(item));
  }catch(error){await client.query("ROLLBACK").catch(()=>{});res.status(409).json(errorEnvelope("NON_IQC_DISPOSITION_RECEIVE_FAILED",error.message));}finally{client.release();}
});

app.post("/api/wms/non-iqc/issues",requirePermission("wms.execute"),async(req,res)=>{
  const p=req.body?.payload??req.body??{};try{
    if(!p.sourceEventId||!p.purposeType||!p.purposeRef||!p.costCenter)throw new Error("sourceEventId, purpose, and cost center are required");
    const duplicate=(await pgPool.query("SELECT * FROM non_iqc_issue_requests WHERE source_event_id=$1",[p.sourceEventId])).rows[0];
    if(duplicate)return res.json(mutateEnvelope({...duplicate,duplicateDelivery:true}));
    const profile=(await pgPool.query("SELECT * FROM non_iqc_material_profiles WHERE material_code=$1 AND status='ACTIVE'",[p.materialCode])).rows[0];
    if(!profile)throw new Error("Active non-IQC material profile not found");
    const no=`NIR-${Date.now()}-${randomUUID().slice(0,5).toUpperCase()}`;
    const row=(await pgPool.query(`INSERT INTO non_iqc_issue_requests
      (request_no,source_event_id,material_code,qty,uom,purpose_type,purpose_ref,cost_center,requester,required_approval_level)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [no,p.sourceEventId,p.materialCode,Number(p.qty),p.uom??"PCS",p.purposeType,p.purposeRef,p.costCenter,String(p.requester),profile.issue_approval_level])).rows[0];
    res.status(201).json(mutateEnvelope(row));
  }catch(error){
    if(error.code==="23505"&&p.sourceEventId){
      const duplicate=(await pgPool.query("SELECT * FROM non_iqc_issue_requests WHERE source_event_id=$1",[p.sourceEventId])).rows[0];
      if(duplicate)return res.json(mutateEnvelope({...duplicate,duplicateDelivery:true}));
    }
    res.status(409).json(errorEnvelope("NON_IQC_ISSUE_REQUEST_FAILED",error.message));
  }
});

app.post("/api/wms/non-iqc/issues/:id/approve",requirePermission("wms.execute"),async(req,res)=>{
  try{
    const p=req.body?.payload??req.body??{},decision=String(p.decision??"").toUpperCase();
    if(!["APPROVED","REJECTED"].includes(decision))throw new Error("Decision must be APPROVED or REJECTED");
    const request=(await pgPool.query("SELECT * FROM non_iqc_issue_requests WHERE id=$1 AND status='PENDING_APPROVAL'",[req.params.id])).rows[0];
    if(!request)throw new Error("Pending issue request not found");
    if(String(p.actor)===String(request.requester))throw new Error("Requester cannot approve own request");
    const approvals=[{role:p.actorRole,actor:p.actor,decision,at:new Date().toISOString()}];
    const row=(await pgPool.query(`UPDATE non_iqc_issue_requests SET status=$2,approvals=$3 WHERE id=$1 RETURNING *`,
      [request.id,decision,JSON.stringify(approvals)])).rows[0];
    res.json(mutateEnvelope(row));
  }catch(error){res.status(409).json(errorEnvelope("NON_IQC_ISSUE_APPROVAL_FAILED",error.message));}
});

app.post("/api/wms/non-iqc/issues/:id/issue",requirePermission("wms.execute"),async(req,res)=>{
  const client=await pgPool.connect();try{
    const p=req.body?.payload??req.body??{};await client.query("BEGIN");
    const request=(await client.query("SELECT * FROM non_iqc_issue_requests WHERE id=$1 AND status='APPROVED' FOR UPDATE",[req.params.id])).rows[0];
    if(!request)throw new Error("Approved issue request not found");
    const inventory=(await client.query("SELECT * FROM non_iqc_inventory_controls WHERE material_code=$1 FOR UPDATE",[request.material_code])).rows[0];
    if(!inventory||Number(inventory.available_qty)<Number(request.qty))throw new Error("Insufficient available inventory");
    const profile=(await client.query("SELECT * FROM non_iqc_material_profiles WHERE material_code=$1",[request.material_code])).rows[0];
    await client.query(`UPDATE non_iqc_inventory_controls SET on_hand_qty=on_hand_qty-$2,available_qty=available_qty-$2,
      last_movement_at=NOW(),updated_at=NOW() WHERE material_code=$1`,[request.material_code,request.qty]);
    const row=(await client.query("UPDATE non_iqc_issue_requests SET status='ISSUED',issued_by=$2,issued_at=NOW() WHERE id=$1 RETURNING *",
      [request.id,String(p.actor??"WMS")])).rows[0];
    let loan=null;
    if(profile.control_mode==="RETURNABLE"||profile.control_mode==="ASSET"){
      if(!p.itemIdentifier||!p.expectedReturnAt)throw new Error("Returnable item identifier and expected return time are required");
      loan=(await client.query(`INSERT INTO non_iqc_loans(loan_no,issue_request_id,item_identifier,borrower,expected_return_at)
        VALUES($1,$2,$3,$4,$5) RETURNING *`,[`NIL-${Date.now()}-${randomUUID().slice(0,5).toUpperCase()}`,request.id,p.itemIdentifier,request.requester,p.expectedReturnAt])).rows[0];
    }
    await client.query("COMMIT");res.json(mutateEnvelope({request:row,loan}));
  }catch(error){await client.query("ROLLBACK").catch(()=>{});res.status(409).json(errorEnvelope("NON_IQC_ISSUE_FAILED",error.message));}finally{client.release();}
});

app.post("/api/wms/non-iqc/loans/:id/return",requirePermission("wms.execute"),async(req,res)=>{
  const client=await pgPool.connect();try{
    const p=req.body?.payload??req.body??{},condition=String(p.condition??"GOOD").toUpperCase();await client.query("BEGIN");
    const loan=(await client.query("SELECT * FROM non_iqc_loans WHERE id=$1 AND status IN('BORROWED','OVERDUE') FOR UPDATE",[req.params.id])).rows[0];
    if(!loan)throw new Error("Open loan not found");
    const request=(await client.query("SELECT * FROM non_iqc_issue_requests WHERE id=$1",[loan.issue_request_id])).rows[0];
    const returned=condition==="GOOD";
    const row=(await client.query(`UPDATE non_iqc_loans SET actual_return_at=NOW(),return_condition=$2,
      status=$3,loss_resolution=$4 WHERE id=$1 RETURNING *`,
      [loan.id,condition,returned?"RETURNED":condition==="LOST"?"LOST":"DAMAGED",p.lossResolution??null])).rows[0];
    if(returned)await client.query(`UPDATE non_iqc_inventory_controls SET on_hand_qty=on_hand_qty+$2,available_qty=available_qty+$2,
      last_movement_at=NOW(),updated_at=NOW() WHERE material_code=$1`,[request.material_code,request.qty]);
    if(!returned&&!p.lossResolution)throw new Error("Damaged or lost return requires a loss resolution");
    await client.query("COMMIT");res.json(mutateEnvelope(row));
  }catch(error){await client.query("ROLLBACK").catch(()=>{});res.status(409).json(errorEnvelope("NON_IQC_LOAN_RETURN_FAILED",error.message));}finally{client.release();}
});

app.post("/api/wms/non-iqc/receipts/:id/closure-check",requirePermission("wms.execute"),async(req,res)=>{
  const client=await pgPool.connect();try{
    const p=req.body?.payload??req.body??{};await client.query("BEGIN");
    const receipt=(await client.query("SELECT * FROM non_iqc_receipts WHERE id=$1 FOR UPDATE",[req.params.id])).rows[0];
    if(!receipt)throw new Error("Receipt not found");
    const disposition=(await client.query(`SELECT COALESCE(SUM(qty),0) qty,
      COALESCE(BOOL_AND(status IN('RECEIVED','COMPLETED')),FALSE) received
      FROM non_iqc_receipt_dispositions WHERE receipt_id=$1`,[receipt.id])).rows[0];
    const noDisposition=Number(disposition.qty)===0&&receipt.status==="AVAILABLE";
    const checks=[
      ["RECEIPT_QUANTITY_BALANCED",noDisposition||Math.abs(Number(disposition.qty)-Number(receipt.received_qty))<0.0001],
      ["DIFFERENCES_RESOLVED",receipt.status!=="QUARANTINED"],
      ["ISSUES_PURPOSE_BOUND",p.issuesPurposeBound===true],
      ["RETURNABLES_CLOSED",p.returnablesClosed===true],
      ["RETURNS_EXCHANGES_RECEIVED",noDisposition||disposition.received===true],
      ["WMS_PHYSICAL_MATCH",p.wmsPhysicalMatch===true],
      ["USAGE_SYSTEMS_SYNCHRONIZED",p.usageSystemsSynchronized===true],
      ["FINANCE_POSTED",p.financePosted===true],
      ["ALARMS_EXCEPTIONS_CLOSED",p.alarmsClosed===true],
      ["AUDIT_COMPLETE",p.auditComplete===true]
    ];
    for(const [type,pass] of checks)await client.query(`INSERT INTO non_iqc_closure_checks(receipt_id,check_type,result)
      VALUES($1,$2,$3) ON CONFLICT(receipt_id,check_type) DO UPDATE SET result=EXCLUDED.result,checked_at=NOW()`,
      [receipt.id,type,pass?"PASS":"FAIL"]);
    const closed=checks.every(x=>x[1]===true);
    await client.query("UPDATE non_iqc_receipts SET status=$2,updated_at=NOW() WHERE id=$1",[receipt.id,closed?"CLOSED":"WAITING_CLOSURE"]);
    await client.query("COMMIT");res.json(mutateEnvelope({receiptId:receipt.id,closed,checks:checks.map(([type,pass])=>({type,result:pass?"PASS":"FAIL"}))}));
  }catch(error){await client.query("ROLLBACK").catch(()=>{});res.status(409).json(errorEnvelope("NON_IQC_CLOSURE_FAILED",error.message));}finally{client.release();}
});
}
