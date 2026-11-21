// IQC control loop (/quality/iqc-loop/*), moved out of services/api/server.js.
//
// 14 registrations: the control-lot intake, measurements, the disposition decision and its
// receipt, retest and its decision, concessions and their approval, CAPA, exception
// closure and the ten-check lot closure.
//
// Pure registrations, no module-level statements in the block.
export function registerQualityIqcLoopRoutes(app, deps) {
  const { pgPool, requirePermission, errorEnvelope, mutateEnvelope, randomUUID } = deps;

app.get("/quality/iqc-loop/dashboard",requirePermission("wms.view"),async(_req,res)=>{
  try{
    const [summary,lots,dispositions,capas]=await Promise.all([
      pgPool.query(`SELECT
        COUNT(*) FILTER(WHERE status NOT IN('CLOSED','EXCEPTION_CLOSED'))::int open_lots,
        COUNT(*) FILTER(WHERE status IN('HOLD','REJECT','RETEST_PENDING','CONCESSION_PENDING'))::int blocked_lots,
        COUNT(*) FILTER(WHERE status NOT IN('CLOSED','EXCEPTION_CLOSED') AND due_at<NOW())::int overdue_lots,
        COUNT(*) FILTER(WHERE status='WAITING_CLOSURE')::int waiting_closure,
        COALESCE(AVG(EXTRACT(EPOCH FROM(COALESCE(decision_at,NOW())-created_at))/60),0)::numeric(12,2) avg_decision_minutes
        FROM iqc_control_lots`),
      pgPool.query("SELECT * FROM iqc_control_lots ORDER BY created_at DESC LIMIT 100"),
      pgPool.query("SELECT * FROM iqc_quantity_dispositions WHERE status='PENDING_RECEIPT' ORDER BY sent_at LIMIT 100"),
      pgPool.query("SELECT * FROM supplier_quality_capa WHERE status<>'CLOSED' ORDER BY containment_due_at LIMIT 100")
    ]);
    res.json(mutateEnvelope({summary:summary.rows[0],lots:lots.rows,dispositions:dispositions.rows,capas:capas.rows}));
  }catch(error){res.status(500).json(errorEnvelope("IQC_LOOP_DASHBOARD_FAILED",error.message));}
});

app.post("/quality/iqc-loop/lots",requirePermission("wms.execute"),async(req,res)=>{
  const client=await pgPool.connect();try{
    const p=req.body?.payload??req.body??{};await client.query("BEGIN");
    const incoming=(await client.query("SELECT * FROM wms_incoming_records WHERE id=$1 FOR UPDATE",[p.incomingRecordId])).rows[0];
    if(!incoming)throw new Error("Incoming record not found");
    const risk=p.criticalMaterial||p.regulatoryMaterial?"CRITICAL":p.newSupplier||p.newMaterial||p.recentFailure?"HIGH":"NORMAL";
    const mode=p.exemptApproved?"EXEMPT":risk==="CRITICAL"?"FULL":risk==="HIGH"?"TIGHTENED":p.reducedApproved?"REDUCED":"NORMAL";
    const qty=Number(incoming.quantity_received),sample=mode==="FULL"?Math.ceil(qty):mode==="EXEMPT"?0:
      mode==="TIGHTENED"?Math.min(Math.ceil(qty),Math.max(32,Math.ceil(Math.sqrt(qty)*3))):
      mode==="REDUCED"?Math.min(Math.ceil(qty),Math.max(5,Math.ceil(Math.sqrt(qty)))):
      Math.min(Math.ceil(qty),Math.max(13,Math.ceil(Math.sqrt(qty)*2)));
    const hours=p.urgent?1:risk==="CRITICAL"?2:4,no=`IQC-${new Date().toISOString().slice(0,10).replaceAll("-","")}-${randomUUID().slice(0,6).toUpperCase()}`;
    const row=(await client.query(`INSERT INTO iqc_control_lots
      (inspection_lot_no,incoming_record_id,supplier_code,material_code,supplier_lot_no,production_date,expiry_date,
       receipt_batch,received_qty,uom,risk_level,inspection_mode,sample_size,due_at,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW()+make_interval(hours=>$14::int),$15) RETURNING *`,
      [no,incoming.id,incoming.supplier_code,incoming.material_code,incoming.lot_no,incoming.production_date,incoming.expiry_date,
       incoming.batch_code||`RECEIPT-${incoming.id}`,qty,incoming.quantity_unit||"PCS",risk,mode,sample,hours,String(p.actor??req.user?.username??"IQC")])).rows[0];
    await client.query("UPDATE wms_incoming_records SET inspection_status='in_progress',updated_at=NOW() WHERE id=$1",[incoming.id]);
    await client.query("INSERT INTO iqc_governance_audit(control_lot_id,event_type,actor,detail)VALUES($1,'CONTROL_LOT_CREATED',$2,$3)",
      [row.id,String(p.actor??"IQC"),JSON.stringify({risk,mode,sample})]);
    await client.query("COMMIT");res.status(201).json(mutateEnvelope(row));
  }catch(error){await client.query("ROLLBACK").catch(()=>{});res.status(409).json(errorEnvelope("IQC_CONTROL_LOT_CREATE_FAILED",error.message));}finally{client.release();}
});

app.post("/quality/iqc-loop/lots/:id/measurements",requirePermission("wms.execute"),async(req,res)=>{
  try{
    const p=req.body?.payload??req.body??{};
    if(!p.equipmentCalibrationValid)return res.status(409).json(errorEnvelope("EQUIPMENT_CALIBRATION_EXPIRED","Calibrated equipment is required"));
    if(!p.inspectorQualified)return res.status(409).json(errorEnvelope("INSPECTOR_NOT_QUALIFIED","Qualified inspector is required"));
    const value=p.measuredValue==null?null:Number(p.measuredValue),pass=p.result?String(p.result).toUpperCase()==="PASS":
      (value!=null&&(p.lowerLimit==null||value>=Number(p.lowerLimit))&&(p.upperLimit==null||value<=Number(p.upperLimit)));
    const row=(await pgPool.query(`INSERT INTO iqc_measurement_results
      (control_lot_id,sample_no,inspection_item,standard_version,lower_limit,upper_limit,measured_value,text_result,result,
       equipment_code,equipment_calibration_valid,inspector_id,inspector_qualified,environment,attachments)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE,$11,TRUE,$12,$13) RETURNING *`,
      [req.params.id,p.sampleNo,p.inspectionItem,p.standardVersion,p.lowerLimit??null,p.upperLimit??null,value,p.textResult??null,
       pass?"PASS":"FAIL",p.equipmentCode??null,String(p.inspectorId),JSON.stringify(p.environment??{}),JSON.stringify(p.attachments??[])])).rows[0];
    await pgPool.query("UPDATE iqc_control_lots SET status='INSPECTING',inspector_id=$2,updated_at=NOW() WHERE id=$1",[req.params.id,p.inspectorId]);
    res.status(201).json(mutateEnvelope(row));
  }catch(error){res.status(409).json(errorEnvelope("IQC_MEASUREMENT_FAILED",error.message));}
});

app.post("/quality/iqc-loop/lots/:id/decision",requirePermission("wms.execute"),async(req,res)=>{
  const client=await pgPool.connect();try{
    const p=req.body?.payload??req.body??{},decision=String(p.decision??"").toUpperCase();
    if(!["PASS","REJECT","HOLD","SORTING","REWORK"].includes(decision))throw new Error("Unsupported IQC decision");
    await client.query("BEGIN");const lot=(await client.query("SELECT * FROM iqc_control_lots WHERE id=$1 FOR UPDATE",[req.params.id])).rows[0];
    if(!lot)throw new Error("IQC lot not found");
    const measured=(await client.query("SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE result='FAIL')::int failed FROM iqc_measurement_results WHERE control_lot_id=$1",[lot.id])).rows[0];
    if(lot.inspection_mode!=="EXEMPT"&&measured.total<lot.sample_size)throw new Error(`Sample incomplete: ${measured.total}/${lot.sample_size}`);
    if(decision==="PASS"&&measured.failed>0)throw new Error("Failed measurements require disposition, retest approval, or concession");
    const row=(await client.query("UPDATE iqc_control_lots SET status=$2,decision=$2,decision_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *",[lot.id,decision])).rows[0];
    await client.query("INSERT INTO iqc_governance_audit(control_lot_id,event_type,actor,detail)VALUES($1,'DECISION_RECORDED',$2,$3)",
      [lot.id,String(p.actor??"QUALITY"),JSON.stringify({decision,failedMeasurements:measured.failed})]);
    await client.query("COMMIT");res.json(mutateEnvelope(row));
  }catch(error){await client.query("ROLLBACK").catch(()=>{});res.status(409).json(errorEnvelope("IQC_DECISION_FAILED",error.message));}finally{client.release();}
});

app.post("/quality/iqc-loop/lots/:id/dispositions",requirePermission("wms.execute"),async(req,res)=>{
  const client=await pgPool.connect();try{
    const p=req.body?.payload??req.body??{},items=Array.isArray(p.items)?p.items:[];await client.query("BEGIN");
    const lot=(await client.query("SELECT * FROM iqc_control_lots WHERE id=$1 FOR UPDATE",[req.params.id])).rows[0];
    if(!lot||!items.length)throw new Error("IQC lot and disposition items are required");
    const total=items.reduce((n,x)=>n+Number(x.qty??0),0);
    if(Math.abs(total-Number(lot.received_qty))>0.0001)throw new Error(`Disposition quantity ${total} must equal received quantity ${lot.received_qty}`);
    const rows=[];
    for(const item of items)rows.push((await client.query(`INSERT INTO iqc_quantity_dispositions
      (control_lot_id,disposition_type,qty,internal_lot_no,document_no,destination,sent_by)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [lot.id,item.type,Number(item.qty),item.internalLotNo??null,item.documentNo,item.destination??null,String(p.actor??"IQC")])).rows[0]);
    await client.query("UPDATE iqc_control_lots SET status='DISPOSITION',updated_at=NOW() WHERE id=$1",[lot.id]);
    await client.query("COMMIT");res.status(201).json(mutateEnvelope({controlLotId:lot.id,items:rows}));
  }catch(error){await client.query("ROLLBACK").catch(()=>{});res.status(409).json(errorEnvelope("IQC_DISPOSITION_FAILED",error.message));}finally{client.release();}
});

app.post("/quality/iqc-loop/dispositions/:id/receive",requirePermission("wms.execute"),async(req,res)=>{
  try{
    const p=req.body?.payload??req.body??{};
    const row=(await pgPool.query(`UPDATE iqc_quantity_dispositions SET status='RECEIVED',received_by=$2,received_at=NOW()
      WHERE id=$1 AND status='PENDING_RECEIPT' RETURNING *`,[req.params.id,String(p.actor??"RECEIVER")])).rows[0];
    if(!row)return res.status(404).json(errorEnvelope("NOT_FOUND","Pending disposition not found"));res.json(mutateEnvelope(row));
  }catch(error){res.status(409).json(errorEnvelope("IQC_DISPOSITION_RECEIVE_FAILED",error.message));}
});

app.post("/quality/iqc-loop/lots/:id/retest",requirePermission("wms.execute"),async(req,res)=>{
  try{
    const p=req.body?.payload??req.body??{},no=`IQCR-${Date.now()}-${randomUUID().slice(0,5).toUpperCase()}`;
    const row=(await pgPool.query(`INSERT INTO iqc_retest_requests(request_no,control_lot_id,reason,evidence,requested_by)
      VALUES($1,$2,$3,$4,$5) RETURNING *`,[no,req.params.id,p.reason,JSON.stringify(p.evidence??[]),String(p.actor??"IQC")])).rows[0];
    await pgPool.query("UPDATE iqc_control_lots SET status='RETEST_PENDING',updated_at=NOW() WHERE id=$1",[req.params.id]);
    res.status(201).json(mutateEnvelope(row));
  }catch(error){res.status(409).json(errorEnvelope("IQC_RETEST_REQUEST_FAILED",error.message));}
});

app.post("/quality/iqc-loop/retests/:id/decision",requirePermission("wms.execute"),async(req,res)=>{
  const client=await pgPool.connect();try{
    const p=req.body?.payload??req.body??{},decision=String(p.decision??"").toUpperCase();
    if(!["APPROVED","REJECTED"].includes(decision))throw new Error("Retest decision must be APPROVED or REJECTED");
    if(String(p.actorRole??"").toUpperCase()!=="QUALITY_MANAGER")throw new Error("Only QUALITY_MANAGER may approve or reject retest");
    await client.query("BEGIN");
    const row=(await client.query(`UPDATE iqc_retest_requests SET status=$2,approved_by=$3,approved_at=NOW()
      WHERE id=$1 AND status='PENDING_APPROVAL' RETURNING *`,[req.params.id,decision,String(p.actor??"QUALITY_MANAGER")])).rows[0];
    if(!row)throw new Error("Pending retest request not found");
    await client.query("UPDATE iqc_control_lots SET status=$2,updated_at=NOW() WHERE id=$1",
      [row.control_lot_id,decision==="APPROVED"?"INSPECTING":"REJECT"]);
    await client.query("INSERT INTO iqc_governance_audit(control_lot_id,event_type,actor,detail)VALUES($1,'RETEST_DECIDED',$2,$3)",
      [row.control_lot_id,String(p.actor??"QUALITY_MANAGER"),JSON.stringify({requestNo:row.request_no,decision})]);
    await client.query("COMMIT");res.json(mutateEnvelope(row));
  }catch(error){await client.query("ROLLBACK").catch(()=>{});res.status(409).json(errorEnvelope("IQC_RETEST_DECISION_FAILED",error.message));}finally{client.release();}
});

app.post("/quality/iqc-loop/lots/:id/concessions",requirePermission("wms.execute"),async(req,res)=>{
  try{
    const p=req.body?.payload??req.body??{},qty=Number(p.approvedQty??0),hours=Number(p.validHours??0);
    if(!p.workOrderCode||qty<=0||hours<=0||!p.riskControls)throw new Error("Work order, positive quantity, validity, and risk controls are required");
    const no=`IQCC-${Date.now()}-${randomUUID().slice(0,5).toUpperCase()}`;
    const row=(await pgPool.query(`INSERT INTO iqc_concession_requests
      (request_no,control_lot_id,work_order_code,approved_qty,valid_until,risk_controls,evidence,requested_by)
      VALUES($1,$2,$3,$4,NOW()+make_interval(hours=>$5::int),$6,$7,$8) RETURNING *`,
      [no,req.params.id,p.workOrderCode,qty,hours,JSON.stringify(p.riskControls),JSON.stringify(p.evidence??[]),String(p.actor??"IQC")])).rows[0];
    await pgPool.query("UPDATE iqc_control_lots SET status='CONCESSION_PENDING',updated_at=NOW() WHERE id=$1",[req.params.id]);
    res.status(201).json(mutateEnvelope(row));
  }catch(error){res.status(409).json(errorEnvelope("IQC_CONCESSION_REQUEST_FAILED",error.message));}
});

app.post("/quality/iqc-loop/concessions/:id/decision",requirePermission("wms.execute"),async(req,res)=>{
  const client=await pgPool.connect();try{
    const p=req.body?.payload??req.body??{},decision=String(p.decision??"").toUpperCase();
    const required=["QUALITY_MANAGER","ENGINEERING","PMC","PRODUCTION_MANAGER"];
    const approvals=Array.isArray(p.approvals)?p.approvals:[];
    const roles=new Set(approvals.filter(x=>String(x.decision??"").toUpperCase()==="APPROVED").map(x=>String(x.role??"").toUpperCase()));
    if(!["APPROVED","REJECTED"].includes(decision))throw new Error("Concession decision must be APPROVED or REJECTED");
    if(decision==="APPROVED"&&!required.every(role=>roles.has(role)))throw new Error(`Missing approvals: ${required.filter(role=>!roles.has(role)).join(", ")}`);
    await client.query("BEGIN");
    const row=(await client.query(`UPDATE iqc_concession_requests SET status=$2,approvals=$3
      WHERE id=$1 AND status='PENDING_APPROVAL' AND valid_until>NOW() RETURNING *`,
      [req.params.id,decision,JSON.stringify(approvals)])).rows[0];
    if(!row)throw new Error("Active pending concession request not found");
    await client.query("UPDATE iqc_control_lots SET status=$2,updated_at=NOW() WHERE id=$1",
      [row.control_lot_id,decision==="APPROVED"?"DISPOSITION":"REJECT"]);
    await client.query("INSERT INTO iqc_governance_audit(control_lot_id,event_type,actor,detail)VALUES($1,'CONCESSION_DECIDED',$2,$3)",
      [row.control_lot_id,String(p.actor??"QUALITY_MANAGER"),JSON.stringify({requestNo:row.request_no,decision,approvals})]);
    await client.query("COMMIT");res.json(mutateEnvelope(row));
  }catch(error){await client.query("ROLLBACK").catch(()=>{});res.status(409).json(errorEnvelope("IQC_CONCESSION_DECISION_FAILED",error.message));}finally{client.release();}
});

app.post("/quality/iqc-loop/lots/:id/capa",requirePermission("wms.execute"),async(req,res)=>{
  try{
    const p=req.body?.payload??req.body??{},severity=String(p.severity??"MAJOR").toUpperCase();
    const lot=(await pgPool.query("SELECT * FROM iqc_control_lots WHERE id=$1",[req.params.id])).rows[0];
    if(!lot)throw new Error("IQC lot not found");
    const no=`CAPA-${Date.now()}-${randomUUID().slice(0,5).toUpperCase()}`;
    const row=(await pgPool.query(`INSERT INTO supplier_quality_capa
      (capa_no,control_lot_id,severity,supplier_code,containment_due_at,full_response_due_at)
      VALUES($1,$2,$3,$4,NOW()+INTERVAL '48 hours',NOW()+INTERVAL '10 days') RETURNING *`,
      [no,lot.id,severity,lot.supplier_code])).rows[0];
    await pgPool.query("INSERT INTO iqc_governance_audit(control_lot_id,event_type,actor,detail)VALUES($1,'SUPPLIER_CAPA_OPENED',$2,$3)",
      [lot.id,String(p.actor??"SQE"),JSON.stringify({capaNo:no,severity})]);
    res.status(201).json(mutateEnvelope(row));
  }catch(error){res.status(409).json(errorEnvelope("IQC_CAPA_CREATE_FAILED",error.message));}
});

app.patch("/quality/iqc-loop/capa/:id",requirePermission("wms.execute"),async(req,res)=>{
  try{
    const p=req.body?.payload??req.body??{},action=String(p.action??"").toUpperCase();
    const allowed=["ACKNOWLEDGE","CONTAINMENT","FULL_RESPONSE","CLOSE"];
    if(!allowed.includes(action))throw new Error(`CAPA action must be ${allowed.join(", ")}`);
    if(action==="CLOSE"&&!p.effectivenessResult)throw new Error("Effectiveness result is required to close CAPA");
    const row=(await pgPool.query(`UPDATE supplier_quality_capa SET
      status=CASE $2 WHEN 'ACKNOWLEDGE' THEN 'ACKNOWLEDGED' WHEN 'CONTAINMENT' THEN 'CONTAINED'
        WHEN 'FULL_RESPONSE' THEN 'RESPONSE_RECEIVED' WHEN 'CLOSE' THEN 'CLOSED' END,
      supplier_ack_at=CASE WHEN $2='ACKNOWLEDGE' THEN NOW() ELSE supplier_ack_at END,
      containment=COALESCE($3,containment),root_cause=COALESCE($4,root_cause),
      corrective_action=COALESCE($5,corrective_action),effectiveness_result=COALESCE($6,effectiveness_result),
      closed_by=CASE WHEN $2='CLOSE' THEN $7 ELSE closed_by END,
      closed_at=CASE WHEN $2='CLOSE' THEN NOW() ELSE closed_at END
      WHERE id=$1 AND status<>'CLOSED' RETURNING *`,
      [req.params.id,action,p.containment??null,p.rootCause??null,p.correctiveAction??null,p.effectivenessResult??null,String(p.actor??"SQE")])).rows[0];
    if(!row)return res.status(404).json(errorEnvelope("NOT_FOUND","Open CAPA not found"));
    res.json(mutateEnvelope(row));
  }catch(error){res.status(409).json(errorEnvelope("IQC_CAPA_UPDATE_FAILED",error.message));}
});

app.post("/quality/iqc-loop/lots/:id/exception-close",requirePermission("wms.execute"),async(req,res)=>{
  const client=await pgPool.connect();try{
    const p=req.body?.payload??req.body??{},required=["QUALITY_MANAGER","WMS_MANAGER","PROCUREMENT_MANAGER","FINANCE_MANAGER"];
    const approvals=Array.isArray(p.approvals)?p.approvals:[];
    const roles=new Set(approvals.filter(x=>String(x.decision??"").toUpperCase()==="APPROVED").map(x=>String(x.role??"").toUpperCase()));
    if(!p.reason||!required.every(role=>roles.has(role)))throw new Error(`Reason and approvals required: ${required.join(", ")}`);
    await client.query("BEGIN");
    const row=(await client.query(`UPDATE iqc_control_lots SET status='EXCEPTION_CLOSED',updated_at=NOW()
      WHERE id=$1 AND status='WAITING_CLOSURE' RETURNING *`,[req.params.id])).rows[0];
    if(!row)throw new Error("Only a lot waiting for closure can be exceptionally closed");
    await client.query("INSERT INTO iqc_governance_audit(control_lot_id,event_type,actor,detail)VALUES($1,'EXCEPTION_CLOSED',$2,$3)",
      [row.id,String(p.actor??"QUALITY_MANAGER"),JSON.stringify({reason:p.reason,approvals})]);
    await client.query("COMMIT");res.json(mutateEnvelope(row));
  }catch(error){await client.query("ROLLBACK").catch(()=>{});res.status(409).json(errorEnvelope("IQC_EXCEPTION_CLOSE_FAILED",error.message));}finally{client.release();}
});

app.post("/quality/iqc-loop/lots/:id/closure-check",requirePermission("wms.execute"),async(req,res)=>{
  const client=await pgPool.connect();try{
    const p=req.body?.payload??req.body??{};await client.query("BEGIN");
    const lot=(await client.query("SELECT * FROM iqc_control_lots WHERE id=$1 FOR UPDATE",[req.params.id])).rows[0];
    if(!lot)throw new Error("IQC lot not found");
    const measured=(await client.query("SELECT COUNT(*)::int total,BOOL_AND(equipment_calibration_valid) calibration,BOOL_AND(inspector_qualified) qualified FROM iqc_measurement_results WHERE control_lot_id=$1",[lot.id])).rows[0];
    const disposition=(await client.query("SELECT COALESCE(SUM(qty),0) qty,BOOL_AND(status IN('RECEIVED','COMPLETED')) received FROM iqc_quantity_dispositions WHERE control_lot_id=$1",[lot.id])).rows[0];
    const checks=[
      ["QUANTITY_BALANCE",Math.abs(Number(disposition.qty)-Number(lot.received_qty))<0.0001],
      ["SAMPLE_COMPLETE",lot.inspection_mode==="EXEMPT"||measured.total>=lot.sample_size],
      ["MEASUREMENT_COMPLETE",lot.inspection_mode==="EXEMPT"||measured.total>0],
      ["CALIBRATION_VALID",lot.inspection_mode==="EXEMPT"||measured.calibration===true],
      ["INSPECTOR_QUALIFIED",lot.inspection_mode==="EXEMPT"||measured.qualified===true],
      ["DISPOSITION_RECEIVED",disposition.received===true],
      ["RETEST_CLOSED",p.retestClosed!==false],
      ["CONCESSION_CONTROLLED",p.concessionControlled!==false],
      ["SUPPLIER_CAPA_STARTED",p.capaRequired?p.capaStarted===true:true],
      ["WMS_SYNCHRONIZED",p.wmsSynchronized===true],
      ["FINANCE_POSTED",p.financePosted===true],
      ["OPEN_EXCEPTIONS_CLOSED",p.openExceptionsClosed===true]
    ];
    for(const [type,pass] of checks)await client.query(`INSERT INTO iqc_closure_checks(control_lot_id,check_type,result,detail)
      VALUES($1,$2,$3,'{}') ON CONFLICT(control_lot_id,check_type) DO UPDATE SET result=EXCLUDED.result,checked_at=NOW()`,[lot.id,type,pass?"PASS":"FAIL"]);
    const closed=checks.every(x=>x[1]===true);
    if(closed)await client.query("UPDATE iqc_control_lots SET status='CLOSED',updated_at=NOW() WHERE id=$1",[lot.id]);
    else await client.query("UPDATE iqc_control_lots SET status='WAITING_CLOSURE',updated_at=NOW() WHERE id=$1",[lot.id]);
    await client.query("COMMIT");res.json(mutateEnvelope({controlLotId:lot.id,closed,checks:checks.map(([type,pass])=>({type,result:pass?"PASS":"FAIL"}))}));
  }catch(error){await client.query("ROLLBACK").catch(()=>{});res.status(409).json(errorEnvelope("IQC_CLOSURE_CHECK_FAILED",error.message));}finally{client.release();}
});
}
