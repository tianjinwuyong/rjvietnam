// PMC (production planning) routes, moved out of services/api/server.js.
//
// 38 registrations: closed-loop dashboard, demands, plans, reviews, decisions,
// work-order binding, capacity, exceptions and the delivery watch. Same contract as
// routes/maintenance.js: pure `app.<verb>(path, middleware, handler)` calls, no
// module-level declarations, therefore movable without touching anything else.
//
// ORDERING IS THE CONTRACT. The caller invokes this from the exact line the block used
// to occupy, so middleware registered above it still runs above it. See
// scripts/check-auth-order.mjs for what happens when that is ignored.
//
// The dependency list comes from `tsc --checkJs`: free identifiers show up as TS2304.
// `deliveryWatchCache` is a module-level Map created in server.js -- passing it in keeps
// the cache shared with whatever else reads it, which a local copy would silently break.
export function registerPmcRoutes(app, deps) {
  const {
    query, pgPool, requirePermission, envelope, errorEnvelope, mutateEnvelope, listEnvelope,
    randomUUID, assertWorkOrderCustomerPoOpen, deliveryWatchCache, fs, path, ensureCollectOrder,
  } = deps;

app.get("/pmc/closed-loop/dashboard",requirePermission("pmc.view"),async(req,res)=>{
  try{
    const [demands,plans,expedites,metrics]=await Promise.all([
      query(`SELECT d.*,p.code product_code,p.name_zh product_name FROM pmc_demands d JOIN products p ON p.id=d.product_id ORDER BY d.id DESC LIMIT 100`),
      query(`SELECT mp.*,p.code product_code,p.name_zh product_name,pl.name_zh line_name,
        (SELECT COUNT(*)::int FROM pmc_plan_reviews r WHERE r.plan_id=mp.id AND r.result='PASS') passed_reviews,
        (SELECT COUNT(*)::int FROM pmc_plan_reviews r WHERE r.plan_id=mp.id AND r.result='FAIL') failed_reviews,
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'reviewType',r.review_type,'result',r.result,'detail',r.detail,
          'reviewedBy',r.reviewed_by,'reviewedAt',r.reviewed_at
        ) ORDER BY r.reviewed_at) FROM pmc_plan_reviews r WHERE r.plan_id=mp.id),'[]') reviews,
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'role',a.approval_role,'decision',a.decision,'actor',a.actor,
          'comment',a.comment,'decidedAt',a.decided_at
        ) ORDER BY a.decided_at) FROM pmc_plan_approvals a WHERE a.plan_id=mp.id),'[]') approvals,
        (SELECT wo.code FROM pmc_plan_work_orders pw JOIN work_orders wo ON wo.id=pw.work_order_id
          WHERE pw.plan_id=mp.id ORDER BY pw.bound_at DESC LIMIT 1) work_order_code,
        (SELECT wo.status FROM pmc_plan_work_orders pw JOIN work_orders wo ON wo.id=pw.work_order_id
          WHERE pw.plan_id=mp.id ORDER BY pw.bound_at DESC LIMIT 1) work_order_status
        FROM pmc_master_plans mp JOIN products p ON p.id=mp.product_id LEFT JOIN production_lines pl ON pl.id=mp.line_id ORDER BY mp.id DESC LIMIT 100`),
      query(`SELECT e.*,p.code product_code,pl.name_zh line_name,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('role',a.approval_role,'decision',a.decision)) FROM pmc_expedite_approvals a WHERE a.request_id=e.id),'[]') approvals
        FROM pmc_expedite_requests e JOIN products p ON p.id=e.product_id LEFT JOIN production_lines pl ON pl.id=e.requested_line_id ORDER BY e.id DESC LIMIT 100`),
      query(`SELECT
        (SELECT COUNT(*)::int FROM pmc_demands WHERE status IN('SUBMITTED','UNDER_REVIEW')) pending_demands,
        (SELECT COUNT(*)::int FROM pmc_master_plans WHERE status IN('UNDER_REVIEW','WAITING_KIT')) pending_plans,
        (SELECT COUNT(*)::int FROM pmc_expedite_requests WHERE status IN('IMPACT_REVIEW','PENDING_APPROVAL','EXECUTING')) active_expedites,
        (SELECT COUNT(*)::int FROM work_orders WHERE status IN('released','running')) active_work_orders`)
    ]);
    res.json(envelope({demands:demands.rows,plans:plans.rows,expedites:expedites.rows,metrics:metrics.rows[0]}));
  }catch(error){res.status(500).json(errorEnvelope("PMC_CLOSED_LOOP_DASHBOARD_FAILED",error.message));}
});

app.post("/pmc/demands",requirePermission("pmc.edit"),async(req,res)=>{
  try{
    const p=req.body?.payload??req.body??{};
    if(!p.productId||!p.requiredQty||!p.requiredDate||!p.sourceType||!p.reason)return res.status(400).json(errorEnvelope("VALIDATION","productId, requiredQty, requiredDate, sourceType and reason required"));
    const demandNo=`DEM-${new Date().toISOString().slice(0,10).replaceAll("-","")}-${randomUUID().slice(0,6).toUpperCase()}`;
    const row=(await query(`INSERT INTO pmc_demands(demand_no,source_type,source_ref,product_id,required_qty,required_date,priority_code,reason,submitted_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [demandNo,p.sourceType,p.sourceRef??null,p.productId,p.requiredQty,p.requiredDate,p.priorityCode??"P2",p.reason,String(p.actor??"PMC")])).rows[0];
    await query(`INSERT INTO pmc_governance_audit(entity_type,entity_id,event_type,actor,detail)VALUES('DEMAND',$1,'SUBMITTED',$2,$3)`,
      [row.id,String(p.actor??"PMC"),JSON.stringify(p)]);res.status(201).json(mutateEnvelope(row));
  }catch(error){res.status(409).json(errorEnvelope("PMC_DEMAND_CREATE_FAILED",error.message));}
});

app.post("/pmc/plans",requirePermission("pmc.edit"),async(req,res)=>{
  const client=await pgPool.connect();try{
    const p=req.body?.payload??req.body??{};await client.query("BEGIN");
    const demand=(await client.query("SELECT * FROM pmc_demands WHERE id=$1 AND status IN('SUBMITTED','UNDER_REVIEW','APPROVED') FOR UPDATE",[p.demandId])).rows[0];
    if(!demand)throw new Error("Demand is not available for planning");
    const bom=(await client.query(`SELECT id FROM boms WHERE product_id=$1 AND status='active' AND (effective_from IS NULL OR effective_from<=CURRENT_DATE)
      AND (effective_to IS NULL OR effective_to>=CURRENT_DATE) ORDER BY id DESC LIMIT 1`,[demand.product_id])).rows[0];
    if(!bom)throw new Error("No active BOM for product");
    const planNo=`MPS-${new Date().toISOString().slice(0,10).replaceAll("-","")}-${randomUUID().slice(0,6).toUpperCase()}`;
    const score=({P0:100,P1:85,P2:70,P3:50,P4:30})[demand.priority_code]??70;
    const row=(await client.query(`INSERT INTO pmc_master_plans(plan_no,demand_id,product_id,planned_qty,planned_start_at,planned_finish_at,line_id,priority_score,priority_code,bom_id,status,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'UNDER_REVIEW',$11) RETURNING *`,
      [planNo,demand.id,demand.product_id,p.plannedQty??demand.required_qty,p.plannedStartAt,p.plannedFinishAt,p.lineId??null,score,demand.priority_code,bom.id,String(p.actor??"PMC")])).rows[0];
    await client.query("UPDATE pmc_demands SET status='PLANNED',updated_at=NOW() WHERE id=$1",[demand.id]);
    await client.query(`INSERT INTO pmc_governance_audit(entity_type,entity_id,event_type,actor,detail)VALUES('PLAN',$1,'CREATED',$2,$3)`,
      [row.id,String(p.actor??"PMC"),JSON.stringify({demandId:demand.id,bomId:bom.id})]);
    await client.query("COMMIT");res.status(201).json(mutateEnvelope(row));
  }catch(error){await client.query("ROLLBACK").catch(()=>{});res.status(409).json(errorEnvelope("PMC_PLAN_CREATE_FAILED",error.message));}finally{client.release();}
});

app.post("/pmc/plans/:id/reviews",requirePermission("pmc.edit"),async(req,res)=>{
  try{
    const p=req.body?.payload??req.body??{},type=String(p.reviewType??"").toUpperCase(),result=String(p.result??"").toUpperCase();
    const row=(await query(`INSERT INTO pmc_plan_reviews(plan_id,review_type,result,detail,reviewed_by)VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(plan_id,review_type) DO UPDATE SET result=EXCLUDED.result,detail=EXCLUDED.detail,reviewed_by=EXCLUDED.reviewed_by,reviewed_at=NOW()
      RETURNING *`,[req.params.id,type,result,JSON.stringify(p.detail??{}),String(p.actor??type)])).rows[0];
    await query(`INSERT INTO pmc_governance_audit(entity_type,entity_id,event_type,actor,detail)VALUES('PLAN',$1,'REVIEWED',$2,$3)`,
      [req.params.id,String(p.actor??type),JSON.stringify({type,result})]);res.json(mutateEnvelope(row));
  }catch(error){res.status(409).json(errorEnvelope("PMC_PLAN_REVIEW_FAILED",error.message));}
});

app.post("/pmc/plans/:id/decision",requirePermission("pmc.edit"),async(req,res)=>{
  const client=await pgPool.connect();try{
    const p=req.body?.payload??req.body??{},role=String(p.approvalRole??"").toUpperCase(),decision=String(p.decision??"").toUpperCase();
    if(!["PMC_MANAGER","PRODUCTION_MANAGER"].includes(role))throw new Error("Approval role not allowed");
    await client.query("BEGIN");const plan=(await client.query("SELECT * FROM pmc_master_plans WHERE id=$1 AND status='UNDER_REVIEW' FOR UPDATE",[req.params.id])).rows[0];
    if(!plan)throw new Error("Plan is not under review");
    const reviews=(await client.query("SELECT review_type,result FROM pmc_plan_reviews WHERE plan_id=$1",[plan.id])).rows;
    const required=["CAPACITY","MATERIAL","BOM","QUALITY","COST","DELIVERY"];
    if(decision==="APPROVE"&&(!required.every(x=>reviews.some(r=>r.review_type===x))||reviews.some(r=>r.result==="FAIL")))throw new Error("All six reviews are required and none may fail");
    await client.query(`INSERT INTO pmc_plan_approvals(plan_id,approval_role,decision,actor,comment)VALUES($1,$2,$3,$4,$5)`,
      [plan.id,role,decision,String(p.actor??role),String(p.comment??"Reviewed")]);
    const approvals=(await client.query("SELECT approval_role,decision FROM pmc_plan_approvals WHERE plan_id=$1",[plan.id])).rows;
    const status=decision==="REJECT"?"REJECTED":["PMC_MANAGER","PRODUCTION_MANAGER"].every(x=>approvals.some(a=>a.approval_role===x&&a.decision==="APPROVE"))?"APPROVED":"UNDER_REVIEW";
    const row=(await client.query("UPDATE pmc_master_plans SET status=$2,updated_at=NOW() WHERE id=$1 RETURNING *",[plan.id,status])).rows[0];
    await client.query(`INSERT INTO pmc_governance_audit(entity_type,entity_id,event_type,actor,detail)VALUES('PLAN',$1,'APPROVAL_DECISION',$2,$3)`,
      [plan.id,String(p.actor??role),JSON.stringify({role,decision,status})]);await client.query("COMMIT");res.json(mutateEnvelope(row));
  }catch(error){await client.query("ROLLBACK").catch(()=>{});res.status(409).json(errorEnvelope("PMC_PLAN_DECISION_FAILED",error.message));}finally{client.release();}
});

app.post("/pmc/plans/:id/bind-work-order",requirePermission("pmc.edit"),async(req,res)=>{
  const client=await pgPool.connect();try{
    const p=req.body?.payload??req.body??{};await client.query("BEGIN");
    const plan=(await client.query("SELECT * FROM pmc_master_plans WHERE id=$1 AND status IN('APPROVED','WAITING_KIT','KIT_READY') FOR UPDATE",[req.params.id])).rows[0];
    const wo=(await client.query("SELECT * FROM work_orders WHERE code=$1 FOR UPDATE",[p.workOrderCode])).rows[0];
    if(!plan||!wo)throw new Error("Approved plan and work order required");
    if(Number(wo.product_id)!==Number(plan.product_id)||Number(wo.bom_id)!==Number(plan.bom_id))throw new Error("Work order product/BOM does not match approved plan");
    await client.query("INSERT INTO pmc_plan_work_orders(plan_id,work_order_id)VALUES($1,$2)",[plan.id,wo.id]);
    const status=p.kitReady===true?"KIT_READY":"WAITING_KIT";
    await client.query("UPDATE pmc_master_plans SET status=$2,updated_at=NOW() WHERE id=$1",[plan.id,status]);
    await client.query(`INSERT INTO pmc_governance_audit(entity_type,entity_id,event_type,actor,detail)VALUES('PLAN',$1,'WORK_ORDER_BOUND',$2,$3)`,
      [plan.id,String(p.actor??"PMC"),JSON.stringify({workOrderCode:wo.code,status})]);
    await client.query("COMMIT");res.json(mutateEnvelope({planId:plan.id,workOrderId:wo.id,status}));
  }catch(error){await client.query("ROLLBACK").catch(()=>{});res.status(409).json(errorEnvelope("PMC_PLAN_WO_BIND_FAILED",error.message));}finally{client.release();}
});

app.post("/pmc/expedites",requirePermission("pmc.edit"),async(req,res)=>{
  const client=await pgPool.connect();try{
    const p=req.body?.payload??req.body??{};await client.query("BEGIN");
    const impacted=(await client.query(`SELECT wo.id,wo.code,wo.planned_start_date,wo.due_date,wo.priority
      FROM work_orders wo WHERE wo.line_id=$1 AND wo.status IN('released','running') ORDER BY wo.priority,wo.due_date LIMIT 50`,[p.lineId])).rows;
    const roles=["PMC_MANAGER","PRODUCTION_MANAGER"];
    if(p.affectsCustomerDelivery)roles.push("SALES_MANAGER");
    if(p.bomOrSubstituteChange)roles.push("ENGINEERING","QUALITY");
    if(p.requiresOvertime)roles.push("HR");
    if(Number(p.costIncreasePercent??0)>5)roles.push("FINANCE");
    if(p.priorityCode==="P0")roles.push("QUALITY_HEAD","FACTORY_MANAGER");
    if(p.materialReady===false)throw new Error("Expedite cannot proceed without material readiness");
    const requestNo=`EXP-${new Date().toISOString().slice(0,10).replaceAll("-","")}-${randomUUID().slice(0,6).toUpperCase()}`;
    const snapshot={affectedWorkOrders:impacted,estimatedDelayMinutes:Number(p.estimatedDelayMinutes??0),costIncreasePercent:Number(p.costIncreasePercent??0)};
    const row=(await client.query(`INSERT INTO pmc_expedite_requests(request_no,plan_id,product_id,requested_qty,required_finish_at,reason,evidence,
      requested_line_id,impact_snapshot,required_approvals,status,requested_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'PENDING_APPROVAL',$11) RETURNING *`,
      [requestNo,p.planId??null,p.productId,p.requestedQty,p.requiredFinishAt,p.reason,JSON.stringify(p.evidence??[]),p.lineId,JSON.stringify(snapshot),JSON.stringify([...new Set(roles)]),String(p.actor??"PMC")])).rows[0];
    for(const wo of impacted)await client.query(`INSERT INTO pmc_schedule_impacts(expedite_request_id,affected_work_order_id,old_start_at,old_finish_at,new_start_at,new_finish_at,delay_minutes,customer_impact,cost_impact)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[row.id,wo.id,wo.planned_start_date,wo.due_date,wo.planned_start_date,wo.due_date,Number(p.estimatedDelayMinutes??0),p.customerImpact??null,Number(p.costImpact??0)]);
    await client.query(`INSERT INTO pmc_governance_audit(entity_type,entity_id,event_type,actor,detail)VALUES('EXPEDITE',$1,'IMPACT_ANALYZED',$2,$3)`,
      [row.id,String(p.actor??"PMC"),JSON.stringify(snapshot)]);await client.query("COMMIT");res.status(201).json(mutateEnvelope(row));
  }catch(error){await client.query("ROLLBACK").catch(()=>{});res.status(409).json(errorEnvelope("PMC_EXPEDITE_CREATE_FAILED",error.message));}finally{client.release();}
});

app.post("/pmc/expedites/:id/decision",requirePermission("pmc.edit"),async(req,res)=>{
  const client=await pgPool.connect();try{
    const p=req.body?.payload??req.body??{},role=String(p.approvalRole??"").toUpperCase(),decision=String(p.decision??"").toUpperCase();
    await client.query("BEGIN");const item=(await client.query("SELECT * FROM pmc_expedite_requests WHERE id=$1 AND status='PENDING_APPROVAL' FOR UPDATE",[req.params.id])).rows[0];
    if(!item||!item.required_approvals.includes(role))throw new Error("Approval role is not required");
    await client.query("INSERT INTO pmc_expedite_approvals(request_id,approval_role,decision,actor,comment)VALUES($1,$2,$3,$4,$5)",
      [item.id,role,decision,String(p.actor??role),String(p.comment??"Reviewed")]);
    const approvals=(await client.query("SELECT approval_role,decision FROM pmc_expedite_approvals WHERE request_id=$1",[item.id])).rows;
    const status=decision==="REJECT"?"REJECTED":item.required_approvals.every(x=>approvals.some(a=>a.approval_role===x&&a.decision==="APPROVE"))?"APPROVED":"PENDING_APPROVAL";
    const row=(await client.query("UPDATE pmc_expedite_requests SET status=$2,approved_at=$3 WHERE id=$1 RETURNING *",
      [item.id,status,status==="APPROVED"?new Date():null])).rows[0];
    await client.query(`INSERT INTO pmc_governance_audit(entity_type,entity_id,event_type,actor,detail)VALUES('EXPEDITE',$1,'APPROVAL_DECISION',$2,$3)`,
      [item.id,String(p.actor??role),JSON.stringify({role,decision,status})]);await client.query("COMMIT");res.json(mutateEnvelope(row));
  }catch(error){await client.query("ROLLBACK").catch(()=>{});res.status(409).json(errorEnvelope("PMC_EXPEDITE_DECISION_FAILED",error.message));}finally{client.release();}
});

app.post("/pmc/plans/:id/release-to-mes",requirePermission("pmc.edit"),async(req,res)=>{
  const client=await pgPool.connect();try{
    const p=req.body?.payload??req.body??{};await client.query("BEGIN");
    const plan=(await client.query("SELECT * FROM pmc_master_plans WHERE id=$1 FOR UPDATE",[req.params.id])).rows[0];
    if(!plan||plan.status!=="KIT_READY")throw new Error("Only a fully approved and kit-ready plan can be released");
    const link=(await client.query(`SELECT w.* FROM pmc_plan_work_orders pw JOIN work_orders w ON w.id=pw.work_order_id
      WHERE pw.plan_id=$1 FOR UPDATE OF w`,[plan.id])).rows[0];
    if(!link)throw new Error("No work order is bound to this plan");
    await assertWorkOrderCustomerPoOpen(client,{id:link.id});
    const failed=(await client.query("SELECT COUNT(*)::int count FROM pmc_plan_reviews WHERE plan_id=$1 AND result='FAIL'",[plan.id])).rows[0].count;
    const approved=(await client.query("SELECT COUNT(*)::int count FROM pmc_plan_approvals WHERE plan_id=$1 AND decision='APPROVE'",[plan.id])).rows[0].count;
    if(failed>0||approved<2)throw new Error("Plan review or approval gate is incomplete");
    await client.query("UPDATE work_orders SET status='released',released_at=COALESCE(released_at,NOW()) WHERE id=$1",[link.id]);
    const row=(await client.query("UPDATE pmc_master_plans SET status='RELEASED_TO_MES',updated_at=NOW() WHERE id=$1 RETURNING *",[plan.id])).rows[0];
    await client.query(`INSERT INTO pmc_governance_audit(entity_type,entity_id,event_type,actor,detail)
      VALUES('PLAN',$1,'RELEASED_TO_MES',$2,$3)`,[plan.id,String(p.actor??"PMC_MANAGER"),JSON.stringify({workOrderCode:link.code})]);
    await client.query("COMMIT");res.json(mutateEnvelope(row));
  }catch(error){await client.query("ROLLBACK").catch(()=>{});res.status(409).json(errorEnvelope("PMC_RELEASE_FAILED",error.message));}finally{client.release();}
});

app.post("/pmc/work-orders/:code/change-requests",requirePermission("pmc.edit"),async(req,res)=>{
  const p=req.body?.payload??req.body??{};try{
    await assertWorkOrderCustomerPoOpen(pgPool,{code:req.params.code});
    const wo=(await pgPool.query("SELECT * FROM work_orders WHERE code=$1",[req.params.code])).rows[0];
    if(!wo)throw new Error("Work order not found");
    const changeType=String(p.changeType??"").toUpperCase(),allowed=["QUANTITY","SCHEDULE","LINE","BOM","PRIORITY","CANCEL"];
    if(!allowed.includes(changeType))throw new Error("Unsupported work-order change type");
    const roles=["PMC_MANAGER","PRODUCTION_MANAGER"];
    if(changeType==="BOM")roles.push("ENGINEERING","QUALITY");
    if(changeType==="CANCEL")roles.push("FACTORY_MANAGER");
    const requestNo=`WOC-${new Date().toISOString().slice(0,10).replaceAll("-","")}-${randomUUID().slice(0,6).toUpperCase()}`;
    const row=(await pgPool.query(`INSERT INTO pmc_work_order_change_requests
      (request_no,work_order_id,change_type,before_snapshot,proposed_change,reason,required_approvals,requested_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [requestNo,wo.id,changeType,JSON.stringify(wo),JSON.stringify(p.proposedChange??{}),p.reason,JSON.stringify(roles),String(p.actor??"PMC")])).rows[0];
    res.status(201).json(mutateEnvelope(row));
  }catch(error){res.status(409).json(errorEnvelope("PMC_WO_CHANGE_CREATE_FAILED",error.message));}
});

app.post("/pmc/work-order-changes/:id/decision",requirePermission("pmc.edit"),async(req,res)=>{
  const client=await pgPool.connect();try{
    const p=req.body?.payload??req.body??{},role=String(p.approvalRole??"").toUpperCase(),decision=String(p.decision??"").toUpperCase();
    await client.query("BEGIN");
    const item=(await client.query("SELECT * FROM pmc_work_order_change_requests WHERE id=$1 AND status='PENDING_APPROVAL' FOR UPDATE",[req.params.id])).rows[0];
    if(!item||!item.required_approvals.includes(role))throw new Error("Approval role is not required");
    await client.query(`INSERT INTO pmc_work_order_change_approvals(request_id,approval_role,decision,actor,comment)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(request_id,approval_role) DO UPDATE SET decision=EXCLUDED.decision,actor=EXCLUDED.actor,comment=EXCLUDED.comment,decided_at=NOW()`,
      [item.id,role,decision,String(p.actor??role),String(p.comment??"Reviewed")]);
    const approvals=(await client.query("SELECT approval_role,decision FROM pmc_work_order_change_approvals WHERE request_id=$1",[item.id])).rows;
    const status=decision==="REJECT"?"REJECTED":item.required_approvals.every(x=>approvals.some(a=>a.approval_role===x&&a.decision==="APPROVE"))?"APPROVED":"PENDING_APPROVAL";
    const row=(await client.query("UPDATE pmc_work_order_change_requests SET status=$2 WHERE id=$1 RETURNING *",[item.id,status])).rows[0];
    await client.query("COMMIT");res.json(mutateEnvelope(row));
  }catch(error){await client.query("ROLLBACK").catch(()=>{});res.status(409).json(errorEnvelope("PMC_WO_CHANGE_DECISION_FAILED",error.message));}finally{client.release();}
});

app.post("/pmc/work-order-changes/:id/apply",requirePermission("pmc.edit"),async(req,res)=>{
  const client=await pgPool.connect();try{
    const p=req.body?.payload??req.body??{};await client.query("BEGIN");
    const item=(await client.query("SELECT * FROM pmc_work_order_change_requests WHERE id=$1 AND status='APPROVED' FOR UPDATE",[req.params.id])).rows[0];
    if(!item)throw new Error("Approved change request not found");
    await assertWorkOrderCustomerPoOpen(client,{id:item.work_order_id});
    const c=item.proposed_change??{};
    if(item.change_type==="QUANTITY")await client.query("UPDATE work_orders SET planned_qty=$2 WHERE id=$1",[item.work_order_id,Number(c.plannedQty)]);
    else if(item.change_type==="SCHEDULE")await client.query("UPDATE work_orders SET planned_start_date=$2,due_date=$3 WHERE id=$1",[item.work_order_id,c.plannedStartAt,c.dueDate]);
    else if(item.change_type==="LINE")await client.query("UPDATE work_orders SET line_id=$2 WHERE id=$1",[item.work_order_id,Number(c.lineId)]);
    else if(item.change_type==="BOM")await client.query("UPDATE work_orders SET bom_id=$2 WHERE id=$1",[item.work_order_id,Number(c.bomId)]);
    else if(item.change_type==="PRIORITY")await client.query("UPDATE work_orders SET priority=$2 WHERE id=$1",[item.work_order_id,Number(c.priority)]);
    else if(item.change_type==="CANCEL")await client.query("UPDATE work_orders SET status='cancelled' WHERE id=$1",[item.work_order_id]);
    const row=(await client.query("UPDATE pmc_work_order_change_requests SET status='APPLIED',applied_at=NOW() WHERE id=$1 RETURNING *",[item.id])).rows[0];
    await client.query(`INSERT INTO pmc_governance_audit(entity_type,entity_id,event_type,actor,detail)
      VALUES('WORK_ORDER',$1,'APPROVED_CHANGE_APPLIED',$2,$3)`,[item.work_order_id,String(p.actor??"PMC_MANAGER"),JSON.stringify({requestNo:item.request_no,change:item.proposed_change})]);
    await client.query("COMMIT");res.json(mutateEnvelope(row));
  }catch(error){await client.query("ROLLBACK").catch(()=>{});res.status(409).json(errorEnvelope("PMC_WO_CHANGE_APPLY_FAILED",error.message));}finally{client.release();}
});

app.post("/pmc/work-orders/:code/transfers",requirePermission("pmc.edit"),async(req,res)=>{
  const p=req.body?.payload??req.body??{};try{
    await assertWorkOrderCustomerPoOpen(pgPool,{code:req.params.code});
    const wo=(await pgPool.query("SELECT * FROM work_orders WHERE code=$1",[req.params.code])).rows[0];
    if(!wo)throw new Error("Work order not found");
    if(Number(wo.line_id)===Number(p.toLineId))throw new Error("Destination line must be different");
    const transferNo=`WOT-${new Date().toISOString().slice(0,10).replaceAll("-","")}-${randomUUID().slice(0,6).toUpperCase()}`;
    const row=(await pgPool.query(`INSERT INTO pmc_work_order_transfers
      (transfer_no,work_order_id,from_line_id,to_line_id,reason,wip_qty,ng_qty,last_sn,handover_payload,requested_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [transferNo,wo.id,wo.line_id,p.toLineId,p.reason,Number(p.wipQty??0),Number(p.ngQty??0),p.lastSn??null,JSON.stringify(p.handoverPayload??{}),String(p.actor??"PMC")])).rows[0];
    res.status(201).json(mutateEnvelope(row));
  }catch(error){res.status(409).json(errorEnvelope("PMC_TRANSFER_CREATE_FAILED",error.message));}
});

app.post("/pmc/transfers/:id/decision",requirePermission("pmc.edit"),async(req,res)=>{
  const p=req.body?.payload??req.body??{};try{
    const pending=(await pgPool.query("SELECT work_order_id FROM pmc_work_order_transfers WHERE id=$1 AND status='PENDING_APPROVAL'",[req.params.id])).rows[0];
    if(!pending)throw new Error("Pending transfer not found");
    await assertWorkOrderCustomerPoOpen(pgPool,{id:pending.work_order_id});
    const decision=String(p.decision??"").toUpperCase(),status=decision==="APPROVE"?"APPROVED":"REJECTED";
    const row=(await pgPool.query(`UPDATE pmc_work_order_transfers SET status=$2,approved_by=$3
      WHERE id=$1 AND status='PENDING_APPROVAL' RETURNING *`,[req.params.id,status,String(p.actor??"PRODUCTION_MANAGER")])).rows[0];
    if(!row)throw new Error("Pending transfer not found");res.json(mutateEnvelope(row));
  }catch(error){res.status(409).json(errorEnvelope("PMC_TRANSFER_DECISION_FAILED",error.message));}
});

app.post("/pmc/transfers/:id/handover",requirePermission("pmc.edit"),async(req,res)=>{
  const p=req.body?.payload??req.body??{};try{
    const approved=(await pgPool.query("SELECT work_order_id FROM pmc_work_order_transfers WHERE id=$1 AND status='APPROVED'",[req.params.id])).rows[0];
    if(!approved)throw new Error("Approved transfer not found");
    await assertWorkOrderCustomerPoOpen(pgPool,{id:approved.work_order_id});
    const row=(await pgPool.query(`UPDATE pmc_work_order_transfers SET status='HANDED_OVER',handed_over_at=NOW(),
      handover_payload=handover_payload||$2::jsonb WHERE id=$1 AND status='APPROVED' RETURNING *`,
      [req.params.id,JSON.stringify({handoverActor:p.actor,documentNo:p.documentNo})])).rows[0];
    if(!row)throw new Error("Approved transfer not found");res.json(mutateEnvelope(row));
  }catch(error){res.status(409).json(errorEnvelope("PMC_TRANSFER_HANDOVER_FAILED",error.message));}
});

app.post("/pmc/transfers/:id/receive",requirePermission("pmc.edit"),async(req,res)=>{
  const client=await pgPool.connect();try{
    const p=req.body?.payload??req.body??{};await client.query("BEGIN");
    const transfer=(await client.query("SELECT * FROM pmc_work_order_transfers WHERE id=$1 AND status='HANDED_OVER' FOR UPDATE",[req.params.id])).rows[0];
    if(!transfer)throw new Error("Handed-over transfer not found");
    await assertWorkOrderCustomerPoOpen(client,{id:transfer.work_order_id});
    const row=(await client.query(`UPDATE pmc_work_order_transfers SET status='COMPLETED',received_at=NOW(),
      handover_payload=handover_payload||$2::jsonb WHERE id=$1 RETURNING *`,
      [transfer.id,JSON.stringify({receivedBy:p.actor,receivingScan:p.scanCode})])).rows[0];
    await client.query(`INSERT INTO pmc_governance_audit(entity_type,entity_id,event_type,actor,detail)
      VALUES('WORK_ORDER',$1,'LINE_TRANSFER_COMPLETED',$2,$3)`,[transfer.work_order_id,String(p.actor??"RECEIVER"),JSON.stringify({transferNo:transfer.transfer_no,toLineId:transfer.to_line_id})]);
    await client.query("COMMIT");res.json(mutateEnvelope(row));
  }catch(error){await client.query("ROLLBACK").catch(()=>{});res.status(409).json(errorEnvelope("PMC_TRANSFER_RECEIVE_FAILED",error.message));}finally{client.release();}
});

app.post("/pmc/work-orders/:code/closure-check",requirePermission("pmc.edit"),async(req,res)=>{
  const client=await pgPool.connect();try{
    const p=req.body?.payload??req.body??{};await client.query("BEGIN");
    const wo=(await client.query("SELECT * FROM work_orders WHERE code=$1 FOR UPDATE",[req.params.code])).rows[0];
    if(!wo)throw new Error("Work order not found");
    await assertWorkOrderCustomerPoOpen(client,{id:wo.id});
    const quantityDetail=p.quantityDetail??{};
    const plannedQty=Number(wo.planned_qty)||0;
    const completedQty=Number(wo.completed_qty)||0;
    const variance=plannedQty-completedQty;
    const varianceReason=String(quantityDetail.varianceReason??p.varianceReason??"").trim();
    const varianceApprovedBy=String(quantityDetail.approvedBy??p.varianceApprovedBy??"").trim();
    const quantityBalanced=variance===0 || (Boolean(varianceReason)&&Boolean(varianceApprovedBy));
    const checks=[
      ["QUANTITY_BALANCE",quantityBalanced?"PASS":"FAIL",{
        planned:plannedQty,completed:completedQty,variance,
        passBasis:variance===0?"EXACT_BALANCE":"AUTHORIZED_VARIANCE",
        explanation:varianceReason||null,approvedBy:varianceApprovedBy||null,
        buckets:quantityDetail.buckets??null,evidenceRefs:quantityDetail.evidenceRefs??[]
      }],
      ["MATERIAL_RECONCILIATION",p.materialReconciled?"PASS":"FAIL",p.materialDetail??{}],
      ["QUALITY_CLOSED",p.qualityClosed?"PASS":"FAIL",p.qualityDetail??{}],
      ["HANDOVERS_CLOSED",p.handoversClosed?"PASS":"FAIL",p.handoverDetail??{}],
      ["FINISHED_GOODS_RECEIVED",p.finishedGoodsReceived?"PASS":"FAIL",p.finishedGoodsDetail??{}],
      ["COST_SETTLED",p.costSettled?"PASS":"FAIL",p.costDetail??{}]
    ];
    for(const [type,result,detail] of checks)await client.query(`INSERT INTO pmc_work_order_closure_checks(work_order_id,check_type,result,detail)
      VALUES($1,$2,$3,$4) ON CONFLICT(work_order_id,check_type) DO UPDATE SET result=EXCLUDED.result,detail=EXCLUDED.detail,checked_at=NOW()`,
      [wo.id,type,result,JSON.stringify(detail)]);
    await client.query(`INSERT INTO pmc_governance_audit(entity_type,entity_id,event_type,actor,detail)VALUES('WORK_ORDER',$1,'CLOSURE_CHECKED',$2,$3)`,
      [wo.id,String(p.actor??"PMC"),JSON.stringify({checks:Object.fromEntries(checks.map(x=>[x[0],x[1]])),quantityReconciliation:checks[0][2]})]);
    await client.query("COMMIT");res.json(mutateEnvelope({workOrderCode:wo.code,checks:checks.map(([type,result,detail])=>({type,result,detail}))}));
  }catch(error){await client.query("ROLLBACK").catch(()=>{});res.status(409).json(errorEnvelope("PMC_CLOSURE_CHECK_FAILED",error.message));}finally{client.release();}
});

app.post("/pmc/work-orders/:code/close-controlled",requirePermission("pmc.edit"),async(req,res)=>{
  const client=await pgPool.connect();try{
    const p=req.body?.payload??req.body??{};await client.query("BEGIN");
    const wo=(await client.query("SELECT * FROM work_orders WHERE code=$1 AND status<>'closed' FOR UPDATE",[req.params.code])).rows[0];
    if(!wo)throw new Error("Open work order not found");
    await assertWorkOrderCustomerPoOpen(client,{id:wo.id});
    const checks=(await client.query("SELECT check_type,result FROM pmc_work_order_closure_checks WHERE work_order_id=$1",[wo.id])).rows;
    const required=["QUANTITY_BALANCE","MATERIAL_RECONCILIATION","QUALITY_CLOSED","HANDOVERS_CLOSED","FINISHED_GOODS_RECEIVED","COST_SETTLED"];
    if(!required.every(x=>checks.some(c=>c.check_type===x&&c.result==="PASS")))throw new Error("All six closure checks must pass");
    const row=(await client.query("UPDATE work_orders SET status='closed',closed_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *",[wo.id])).rows[0];
    await client.query(`UPDATE pmc_master_plans SET status='CLOSED',updated_at=NOW() WHERE id IN(SELECT plan_id FROM pmc_plan_work_orders WHERE work_order_id=$1)`,[wo.id]);
    await client.query(`UPDATE pmc_demands SET status='CLOSED',updated_at=NOW() WHERE id IN(
      SELECT demand_id FROM pmc_master_plans WHERE id IN(SELECT plan_id FROM pmc_plan_work_orders WHERE work_order_id=$1))`,[wo.id]);
    await client.query(`INSERT INTO pmc_governance_audit(entity_type,entity_id,event_type,actor,detail)VALUES('WORK_ORDER',$1,'CLOSED',$2,$3)`,
      [wo.id,String(p.actor??"PMC"),JSON.stringify({checks:required})]);await client.query("COMMIT");res.json(mutateEnvelope(row));
  }catch(error){await client.query("ROLLBACK").catch(()=>{});res.status(409).json(errorEnvelope("PMC_CONTROLLED_CLOSE_FAILED",error.message));}finally{client.release();}
});

app.get("/pmc/work-orders", async (req, res) => {
  try {
    const { status, q, limit = 50, offset = 0 } = req.query;
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const safeOffset = Math.max(Number(offset) || 0, 0);
    const conditions = [];
    const params = [];
    let idx = 1;
    if (status) { conditions.push(`wo.status = $${idx++}`); params.push(status); }
    if (q) { conditions.push(`(wo.code ILIKE $${idx} OR p.code ILIKE $${idx})`); params.push(`%${q}%`); idx++; }
    const joins = "JOIN products p ON p.id = wo.product_id JOIN production_lines pl ON pl.id = wo.line_id LEFT JOIN customer_pos po ON po.id = wo.customer_po_id";
    const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";
    const [countRes, dataRes] = await Promise.all([query(`SELECT count(*)::int AS total FROM work_orders wo ${joins} ${where}`, params), query(
      `SELECT wo.id, wo.code, wo.work_order_type AS type, wo.planned_qty AS "plannedQty",
              wo.completed_qty AS "completedQty", wo.status,
               wo.locked_by AS "lockedBy", wo.locked_at AS "lockedAt",
               wo.active_operators AS "activeOperators",
              p.code AS "productCode", p.name_zh AS "productNameZh",
              pl.internal_code AS "lineCode", pl.name_zh AS "lineNameZh",
              po.po_number AS "poNumber"
       FROM work_orders wo ${joins} ${where} ORDER BY wo.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, safeLimit, safeOffset],
    )]);
    res.json(listEnvelope(dataRes.rows, countRes.rows[0]?.total ?? 0));
  } catch (err) {
    console.error("GET /pmc/work-orders:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

app.post("/pmc/work-orders", requirePermission("pmc.edit"), async (req, res) => {
  try {
    const { workOrder } = req.body?.payload ?? {};
    if (!workOrder) return res.status(400).json(errorEnvelope("VALIDATION", "workOrder payload required"));
    const { customerPoId, poLineNo, productCode, lineCode, plannedQty, woType = 1, bomId, dueDate } = workOrder;

    if (![1, 2, 3].includes(Number(woType))) return res.status(400).json(errorEnvelope("VALIDATION", "woType must be 1, 2, or 3"));
    if (!productCode) return res.status(400).json(errorEnvelope("VALIDATION", "productCode required"));
    if (!lineCode) return res.status(400).json(errorEnvelope("VALIDATION", "lineCode required"));
    if (!plannedQty || plannedQty < 1) return res.status(400).json(errorEnvelope("VALIDATION", "plannedQty required"));
    if (Number(woType) === 1 && !customerPoId) return res.status(400).json(errorEnvelope("VALIDATION", "customerPoId required for mass-production work orders"));
    if (!bomId) return res.status(400).json(errorEnvelope("VALIDATION", "bomId and BOM revision are required"));

    // Validate line exists and get numeric line code
    const lineR = await query("SELECT id, numeric_line_code FROM production_lines WHERE internal_code = $1", [lineCode]);
    if (lineR.rows.length === 0) return res.status(400).json(errorEnvelope("VALIDATION", "line not found"));

    // Validate product
    const prodR = await query("SELECT id FROM products WHERE code = $1", [productCode]);
    if (prodR.rows.length === 0) return res.status(400).json(errorEnvelope("VALIDATION", "product not found"));

    // Validate customer PO only if provided (optional for trial production)
    let resolvedPoId = null;
    if (customerPoId) {
      const poR = await query(
        "SELECT id,due_date,status FROM customer_pos WHERE id=$1 AND status NOT IN('closed','voided','cancelled')",
        [customerPoId],
      );
      if (poR.rows.length === 0) return res.status(400).json(errorEnvelope("VALIDATION", "customerPo not found"));
      resolvedPoId = customerPoId;
      if (!workOrder.dueDate) workOrder.dueDate = poR.rows[0].due_date;
    }

    // Validate BOM if provided (optional — WO can be created without a BOM)
    let resolvedBomId = null;
    if (bomId) {
      // A production WO must bind to the released/active BOM revision.  Do
      // this check server-side as well as in the UI so callers cannot bypass
      // the approval gate by posting directly to the API.
      const bomR = await query("SELECT id, revision, status FROM boms WHERE id = $1 AND LOWER(status) = 'active'", [bomId]);
      if (bomR.rows.length === 0) return res.status(409).json(errorEnvelope("BOM_NOT_RELEASED", "A released/active BOM revision is required"));
      resolvedBomId = bomId;
    }
    const resolvedDueDate = dueDate || workOrder.dueDate;
    if (!resolvedDueDate || Number.isNaN(Date.parse(String(resolvedDueDate)))) {
      return res.status(400).json(errorEnvelope("VALIDATION", "dueDate required and must be a valid date"));
    }

    // Generate code using counter — atomic get-and-increment
    const numericLineCode = lineR.rows[0].numeric_line_code; // e.g. "01"

    // Atomic get-and-increment using INSERT ... ON CONFLICT DO UPDATE.
    // When no row exists: inserts with next_serial=1 (serial we claim), next call will insert with 2.
    // When row exists: increments and returns incremented value (the serial we just claimed).
    // Note: on a brand-new row both operations happen so RETURNING gives 2; first WO gets serial 2.
    // This is acceptable for an internal tool with negligible chance of same-second duplicate calls.
    const actorId = req.user?.userId ?? null;
    const client = await pgPool.connect();
    let code;
    let result;
    try {
      await client.query("BEGIN");
      const allocated = await client.query(
        "SELECT allocate_work_order_code($1,$2,$3) AS code",
        [Number(woType), numericLineCode, actorId],
      );
      code = allocated.rows[0].code;
      result = await client.query(
        `INSERT INTO work_orders
          (code,customer_po_id,po_line_no,work_order_type,line_id,product_id,planned_qty,bom_id,due_date,status,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',$10) RETURNING id`,
        [code,resolvedPoId,poLineNo ?? null,woType,lineR.rows[0].id,prodR.rows[0].id,
         plannedQty,resolvedBomId,resolvedDueDate,actorId],
      );
      await client.query(
        `UPDATE work_order_code_allocations SET work_order_id=$1,allocation_status='BOUND' WHERE code=$2`,
        [result.rows[0].id,code],
      );
      await client.query(
        `INSERT INTO work_order_number_audit
          (work_order_id,work_order_code,action,new_status,actor_id,actor_name)
         VALUES($1,$2,'CREATED','draft',$3,$4)`,
        [result.rows[0].id,code,actorId,req.user?.username ?? null],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    // Fetch BOM revision for response if bomId was provided
    let bomRevision = null;
    if (resolvedBomId) {
      const bR = await query("SELECT revision FROM boms WHERE id = $1", [resolvedBomId]);
      bomRevision = bR.rows[0]?.revision ?? null;
    }

    res.status(201).json(mutateEnvelope({
      id: result.rows[0].id, code, woType, lineCode, productCode, plannedQty,
      bomId: resolvedBomId, bomRevision, dueDate: resolvedDueDate,
    }));
  } catch (err) {
    console.error("POST /pmc/work-orders:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

app.patch("/pmc/work-orders/:code", requirePermission("pmc.edit"), async (req, res) => {
  try {
    const { status, reason } = req.body?.payload ?? {};
    if (!status) return res.status(400).json(errorEnvelope("VALIDATION", "status required"));
    await assertWorkOrderCustomerPoOpen(pgPool,{code:req.params.code});
    const before = await query("SELECT id,status FROM work_orders WHERE code=$1", [req.params.code]);
    if (!before.rows[0]) return res.status(404).json(errorEnvelope("NOT_FOUND", "work order not found"));
    if (status === "voided" && !reason) return res.status(400).json(errorEnvelope("VALIDATION", "void reason required"));
    await query(
      `UPDATE work_orders SET status=$1::varchar,
         voided_at=CASE WHEN $1::varchar='voided' THEN now() ELSE voided_at END,
         voided_reason=CASE WHEN $1::varchar='voided' THEN $3 ELSE voided_reason END
       WHERE code=$2`, [status,req.params.code,reason ?? null],
    );
    if (status === "voided") {
      await query(
        `UPDATE work_order_code_allocations SET allocation_status='VOIDED',voided_at=now(),
           voided_by=$2,void_reason=$3 WHERE code=$1`,
        [req.params.code,req.user?.userId ?? null,reason],
      );
    }
    await query(
      `INSERT INTO work_order_number_audit
        (work_order_id,work_order_code,action,old_status,new_status,reason,actor_id,actor_name)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [before.rows[0].id,req.params.code,status === "voided" ? "VOIDED" : "CHANGED",
       before.rows[0].status,status,reason ?? null,req.user?.userId ?? null,req.user?.username ?? null],
    );
    res.json(mutateEnvelope({ code: req.params.code, status }));
  } catch (err) {
    console.error("PATCH /pmc/work-orders/:code:", err.message);
    res.status(err.code==="CUSTOMER_PO_IMMUTABLE"?409:500).json(errorEnvelope(err.code||"SERVER_ERROR", err.message));
  }
});

app.post("/pmc/work-orders/:code/quick-approve-release", requirePermission("pmc.edit"), async (req, res) => {
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    await assertWorkOrderCustomerPoOpen(client, { code: req.params.code });
    const before = (await client.query(
      "SELECT id,code,status FROM work_orders WHERE code=$1 FOR UPDATE",
      [req.params.code],
    )).rows[0];
    if (!before) {
      await client.query("ROLLBACK");
      return res.status(404).json(errorEnvelope("NOT_FOUND", "work order not found"));
    }
    if (!["draft", "hold"].includes(String(before.status).toLowerCase())) {
      await client.query("ROLLBACK");
      return res.status(409).json(errorEnvelope(
        "WORK_ORDER_NOT_RELEASABLE",
        `Only draft or hold work orders can be quickly released; current status is ${before.status}`,
      ));
    }
    const actorId = req.user?.userId ?? null;
    const actorName = req.user?.username ?? "PMC";
    const reason = String(req.body?.payload?.reason ?? "Quick approval from PMC work-order list").trim();
    const released = (await client.query(
      `UPDATE work_orders
       SET status='released',released_at=COALESCE(released_at,NOW()),updated_at=NOW()
       WHERE id=$1
       RETURNING code,status,released_at AS "releasedAt"`,
      [before.id],
    )).rows[0];
    await client.query(
      `INSERT INTO work_order_number_audit
        (work_order_id,work_order_code,action,old_status,new_status,reason,actor_id,actor_name)
       VALUES($1,$2,'CHANGED',$3,'released',$4,$5,$6)`,
      [before.id,before.code,before.status,reason,actorId,actorName],
    );
    await client.query(
      `INSERT INTO pmc_governance_audit(entity_type,entity_id,event_type,actor,detail)
       VALUES('WORK_ORDER',$1,'QUICK_APPROVED_RELEASED',$2,$3)`,
      [before.id,actorName,JSON.stringify({ oldStatus: before.status, newStatus: "released", reason })],
    );
    await client.query("COMMIT");
    res.json(mutateEnvelope(released));
    // A released WO always has materials to collect → WMS auto-creates its
    // material-request sheet (领料单) right here, not via list GETs. Failures
    // (no BOM etc.) are non-fatal: the release already happened.
    ensureCollectOrder(req.params.code, actorName).catch((e) =>
      console.error(`auto-generate collect list for ${req.params.code} after release:`, e.message));
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("POST /pmc/work-orders/:code/quick-approve-release:", err.message);
    res.status(err.code === "CUSTOMER_PO_IMMUTABLE" ? 409 : 500)
      .json(errorEnvelope(err.code || "SERVER_ERROR", err.message));
  } finally {
    client.release();
  }
});

app.get("/pmc/schedules", async (req, res) => {
  try {
    const { lineCode, limit = 50, offset = 0 } = req.query;
    const conditions = ["wo.status IN ('released','running')"];
    const params = [];
    let idx = 1;
    if (lineCode) { conditions.push(`pl.internal_code = $${idx++}`); params.push(lineCode); }
    const where = "WHERE " + conditions.join(" AND ");
    const data = await query(
      `SELECT wo.id, wo.code, wo.planned_qty AS "plannedQty", wo.completed_qty AS "completedQty",
              wo.status, pl.internal_code AS "lineCode", pl.name_zh AS "lineNameZh",
              p.code AS "productCode"
       FROM work_orders wo
       JOIN production_lines pl ON pl.id = wo.line_id
       JOIN products p ON p.id = wo.product_id
       ${where} ORDER BY wo.created_at LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, Number(limit), Number(offset)],
    );
    res.json(listEnvelope(data.rows));
  } catch (err) {
    console.error("GET /pmc/schedules:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

app.get("/pmc/customer-pos", async (req, res) => {
  try {
    const data = await query(
      `SELECT po.id, po.po_number AS "poNumber", c.name_zh AS "customerName",
              po.order_qty AS "orderQty", po.due_date AS "dueDate", po.status
       FROM customer_pos po
       JOIN customers c ON c.id = po.customer_id
       ORDER BY po.created_at DESC LIMIT 100`,
    );
    res.json(listEnvelope(data.rows));
  } catch (err) {
    console.error("GET /pmc/customer-pos:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /pmc/work-order-alerts — overdue, delay, and material-risk alerts
// Alert levels: overdue (past due_date), delay (进度落后), material_risk (物料缺口)
// Query params: alertLevel (overdue|delay|material_risk|all), limit, offset
app.get("/pmc/work-order-alerts", async (req, res) => {
  try {
    const { alertLevel = "all", limit = 50, offset = 0 } = req.query;
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    // Build base query: join WO + product + line + PO
    const baseJoin = `FROM work_orders wo
      JOIN products p ON p.id = wo.product_id
      JOIN production_lines pl ON pl.id = wo.line_id
      LEFT JOIN customer_pos po ON po.id = wo.customer_po_id`;

    // Material risk EXISTS subquery — no $ placeholders to avoid conflict with outer params
    const materialRiskExists = `EXISTS (
      SELECT 1 FROM work_order_bom_requirements woi
      JOIN bom_lines bl ON bl.bom_id = woi.bom_id
      LEFT JOIN LATERAL (
        SELECT SUM(it.qty) AS picked_qty FROM inventory_transactions it
        JOIN material_lots ml ON ml.id = it.material_lot_id
        WHERE it.work_order_id = woi.work_order_id AND ml.material_id = bl.material_id
          AND it.action IN ('PICK', 'ISSUE_TO_LINE')
      ) mit ON true
      WHERE woi.work_order_id = wo.id
        AND COALESCE(mit.picked_qty, 0) < woi.qty_per
    )`;

    const alertConditions = {
      overdue: `wo.due_date < '${today}' AND wo.status NOT IN ('closed', 'posted', 'draft')`,
      delay: `(wo.status = 'running' OR wo.status = 'released')
        AND wo.due_date IS NOT NULL
        AND wo.completed_qty::numeric / NULLIF(wo.planned_qty, 0) <
            LEAST(1.0, (('${today}'::date - wo.released_at::date)::numeric / NULLIF(wo.due_date::date - wo.released_at::date, 0)))`,
      material_risk: `wo.status IN ('released', 'running') AND ${materialRiskExists}`,
    };

    let alertWhere = "";
    if (alertLevel !== "all" && alertConditions[alertLevel]) {
      alertWhere = `WHERE ${alertConditions[alertLevel]}`;
    } else if (alertLevel === "all") {
      alertWhere = `WHERE ${Object.values(alertConditions).join(" OR ")}`;
    }

    const dataRes = await query(`
      SELECT
        wo.id, wo.code, wo.status, wo.planned_qty AS "plannedQty",
        wo.completed_qty AS "completedQty",
        wo.due_date AS "dueDate",
        wo.released_at AS "releasedAt",
        p.code AS "productCode", p.name_zh AS "productNameZh",
        pl.internal_code AS "lineCode", pl.name_zh AS "lineNameZh",
        po.po_number AS "poNumber",
        CASE
          WHEN wo.due_date < '${today}'::date AND wo.status NOT IN ('closed','posted','draft')
            THEN 'overdue'
          WHEN wo.status IN ('released','running')
            AND wo.completed_qty::numeric / NULLIF(wo.planned_qty,0) <
                LEAST(1.0, (('${today}'::date - COALESCE(wo.released_at::date, '${today}'::date))::numeric
                  / NULLIF(wo.due_date::date - COALESCE(wo.released_at::date, '${today}'::date), 0)))
            THEN 'delay'
          WHEN ${materialRiskExists}
            THEN 'material_risk'
          ELSE 'normal'
        END AS "alertLevel",
        ROUND(wo.completed_qty::numeric / NULLIF(wo.planned_qty, 0) * 100, 1) AS "progressPct",
        (SELECT wo.due_date::date - '${today}'::date) AS "daysUntilDue"
      ${baseJoin}
      ${alertWhere}
      ORDER BY
        CASE
          WHEN wo.due_date < '${today}'::date THEN 1
          WHEN ${materialRiskExists} THEN 2
          ELSE 3
        END,
        wo.due_date ASC NULLS LAST
      LIMIT $1 OFFSET $2`,
      [Number(limit), Number(offset)],
    );

    // Count totals by alert level
    const countRes = await query(`
      SELECT
        COUNT(*) FILTER (WHERE wo.due_date < '${today}'::date AND wo.status NOT IN ('closed','posted','draft'))::int AS overdue,
        COUNT(*) FILTER (WHERE wo.status IN ('released','running')
          AND wo.completed_qty::numeric / NULLIF(wo.planned_qty,0) <
              LEAST(1.0, (('${today}'::date - COALESCE(wo.released_at::date,'${today}'::date))::numeric
                / NULLIF(wo.due_date::date - COALESCE(wo.released_at::date,'${today}'::date),0))))::int AS delay,
        COUNT(*) FILTER (WHERE wo.status IN ('released','running') AND ${materialRiskExists})::int AS material_risk
      ${baseJoin}
      WHERE wo.status NOT IN ('closed','posted')
        AND (wo.due_date < '${today}'::date OR wo.status IN ('released','running'))`);

    res.json({
      data: { items: dataRes.rows, counts: countRes.rows[0] },
      meta: { serverTime: new Date().toISOString() },
    });
  } catch (err) {
    console.error("GET /pmc/work-order-alerts:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// POST /pmc/work-orders/:code/complete — 工单完工报工: update completed_qty + log station_event
// Also supports material-loading-only completion (from PDA) where outputQty is optional
app.post("/pmc/work-orders/:code/complete", async (req, res) => {
  try {
    const { outputQty, ngQty = 0, stationCode, operator, notes } = req.body?.payload ?? req.body ?? {};
    const woCode = req.params.code;
    await assertWorkOrderCustomerPoOpen(pgPool,{code:woCode});

    // Get current WO state
    const woR = await query("SELECT id, completed_qty, planned_qty, status FROM work_orders WHERE code = $1", [woCode]);
    if (!woR.rows.length) return res.status(404).json(errorEnvelope("NOT_FOUND", "work order not found"));
    const wo = woR.rows[0];

    // If outputQty provided, do full completion (production output)
    if (outputQty && outputQty > 0) {
      const newCompleted = wo.completed_qty + outputQty;
      const isComplete = newCompleted >= wo.planned_qty;
      const newStatus = isComplete ? "completed" : wo.status;

      await query(
        `UPDATE work_orders SET completed_qty = $1, status = $2, updated_at = NOW()
         WHERE code = $3`,
        [newCompleted, newStatus, woCode],
      );

      // Log station_event (only if station exists)
      let stationId = null;
      if (stationCode) {
        const stR = await query("SELECT id FROM stations WHERE code = $1", [stationCode]);
        if (stR.rows.length) stationId = stR.rows[0].id;
      }
      if (stationId) {
        await query(
          `INSERT INTO station_events (station_id, operator_id, event_type, result, traceability_key)
           VALUES ($1, (SELECT id FROM users WHERE username = $2 LIMIT 1), 'output', $3, $4)`,
          [stationId, operator ?? "VN_OP_001", `${outputQty}${ngQty > 0 ? ` NG:${ngQty}` : ""}`, woCode],
        );
      }

      res.json(mutateEnvelope({ code: woCode, completedQty: newCompleted, status: newStatus, isComplete }));
      return;
    }

    // Material-loading-only completion (PDA): mark WO as ready for production
    // Keep completed_qty unchanged, just unlock and mark as released (materials ready)
    await query(
      `UPDATE work_orders SET status = 'released', updated_at = NOW()
       WHERE code = $1`,
      [woCode],
    );

    res.json(mutateEnvelope({ code: woCode, completedQty: wo.completed_qty, status: "released", isComplete: false, materialLoadingComplete: true }));
  } catch (err) {
    console.error("POST /pmc/work-orders/:code/complete:", err.message);
    res.status(err.code==="CUSTOMER_PO_IMMUTABLE"?409:500).json(errorEnvelope(err.code||"SERVER_ERROR", err.message));
  }
});

// PATCH /pmc/work-orders/:code/freeze — 工单冻结/变更 with audit log
app.patch("/pmc/work-orders/:code/freeze", async (req, res) => {
  try {
    const { status, changeReason, plannedQty, priority, operator } = req.body?.payload ?? {};
    if (!status) return res.status(400).json(errorEnvelope("VALIDATION", "status required"));
    const woCode = req.params.code;
    await assertWorkOrderCustomerPoOpen(pgPool,{code:woCode});

    const woR = await query("SELECT id, status, planned_qty, priority FROM work_orders WHERE code = $1", [woCode]);
    if (!woR.rows.length) return res.status(404).json(errorEnvelope("NOT_FOUND", "work order not found"));
    const wo = woR.rows[0];

    const changes = [];
    if (status && status !== wo.status) changes.push({ field: "status", old: wo.status, new: status });
    if (plannedQty && plannedQty !== wo.planned_qty) changes.push({ field: "planned_qty", old: wo.planned_qty, new: plannedQty });
    if (priority && priority !== wo.priority) changes.push({ field: "priority", old: wo.priority, new: priority });

    const opIdR = await query("SELECT id FROM users WHERE username = $1 LIMIT 1", [operator ?? "VN_OP_001"]);

    for (const ch of changes) {
      await query(
        `INSERT INTO work_order_change_log (work_order_id, changed_by, field_name, old_value, new_value, reason)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [wo.id, opIdR.rows[0]?.id ?? null, ch.field, String(ch.old ?? ""), String(ch.new ?? ""), changeReason ?? null],
      );
    }

    const updates = [];
    const params = [];
    let idx = 1;
    if (status) { updates.push(`status = $${idx++}`); params.push(status); }
    if (plannedQty) { updates.push(`planned_qty = $${idx++}`); params.push(plannedQty); }
    if (priority) { updates.push(`priority = $${idx++}`); params.push(priority); }
    updates.push("updated_at = NOW()");
    params.push(woCode);

    await query(`UPDATE work_orders SET ${updates.join(", ")} WHERE code = $${idx}`, params);
    res.json(mutateEnvelope({ code: woCode, changes }));
  } catch (err) {
    console.error("PATCH /pmc/work-orders/:code/freeze:", err.message);
    res.status(err.code==="CUSTOMER_PO_IMMUTABLE"?409:500).json(errorEnvelope(err.code||"SERVER_ERROR", err.message));
  }
});

// POST /pmc/work-orders/:code/lock — Add operator to WO's active PDA loading list
// Multiple PDA operators can work on the same WO simultaneously (no upper limit).
// Each operator can still only work on one WO at a time (enforced by active_operators check).
app.post("/pmc/work-orders/:code/lock", async (req, res) => {
  try {
    const { code } = req.params;
    const { operator } = req.body?.payload ?? req.body ?? {};
    if (!operator) return res.status(400).json(errorEnvelope("VALIDATION", "operator required"));

    // Check if this operator is already on another WO (excluding this one)
    const existingLock = await query(
      `SELECT code FROM work_orders WHERE $1 = ANY(active_operators) AND code != $2 LIMIT 1`,
      [operator, code],
    );
    if (existingLock.rows.length > 0) {
      return res.status(409).json(errorEnvelope("CONFLICT",
        `Complete WO ${existingLock.rows[0].code} first before starting another. You can only work on one WO at a time.`));
    }

    // Idempotent: if operator already active on this WO, return current state
    const alreadyActive = await query(
      `SELECT active_operators, locked_by FROM work_orders WHERE code = $1 AND $2 = ANY(active_operators)`,
      [code, operator],
    );
    if (alreadyActive.rows.length > 0) {
      return res.json(envelope({
        activeOperators: alreadyActive.rows[0].active_operators,
        lockedBy: alreadyActive.rows[0].locked_by,
        alreadyActive: true,
      }));
    }

    // Add operator to active_operators array; set locked_by if first operator
    const result = await query(
      `UPDATE work_orders
       SET active_operators = CASE WHEN $1 = ANY(active_operators) THEN active_operators ELSE active_operators || $1::text END,
           locked_by = COALESCE(locked_by, $1),
           locked_at = CASE WHEN locked_by IS NULL THEN NOW() ELSE locked_at END
       WHERE code = $2
       RETURNING active_operators AS "activeOperators", locked_by AS "lockedBy", locked_at AS "lockedAt"`,
      [operator, code],
    );
    if (result.rows.length === 0) {
      return res.status(404).json(errorEnvelope("NOT_FOUND", `Work order ${code} not found`));
    }

    res.json(envelope(result.rows[0]));
  } catch (err) {
    console.error("POST /pmc/work-orders/:code/lock:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// POST /pmc/work-orders/:code/unlock — Remove operator from WO's active PDA loading list
// When last operator leaves, WO is fully unlocked (locked_by and locked_at cleared).
app.post("/pmc/work-orders/:code/unlock", async (req, res) => {
  try {
    const { code } = req.params;
    const { operator, force } = req.body?.payload ?? req.body ?? {};
    if (!operator) return res.status(400).json(errorEnvelope("VALIDATION", "operator required"));

    // Force unlock (managers): clear all active operators
    if (force) {
      const prev = await query(
        `SELECT locked_by FROM work_orders WHERE code = $1`,
        [code],
      );
      if (prev.rows.length === 0) {
        return res.status(404).json(errorEnvelope("NOT_FOUND", `Work order ${code} not found`));
      }
      await query(
        `UPDATE work_orders SET active_operators = '{}', locked_by = NULL, locked_at = NULL WHERE code = $1`,
        [code],
      );
      res.json(envelope({ code, unlockedFrom: prev.rows[0].locked_by, forced: true }));
      return;
    }

    // Remove operator from active_operators; clear locked_by if they were the primary locker
    // If active_operators becomes empty after removal, also clear locked_by and locked_at
    const result = await query(
      `UPDATE work_orders
       SET active_operators = array_remove(active_operators, $1),
           locked_by  = CASE WHEN locked_by = $1 THEN
                          (SELECT locked_by FROM work_orders WHERE code = $2 AND array_length(active_operators, 1) > 1 LIMIT 1)
                          ELSE locked_by END,
           locked_at  = CASE WHEN locked_by = $1 AND array_length(active_operators, 1) <= 1 THEN NULL ELSE locked_at END
       WHERE code = $2 AND $1 = ANY(active_operators)
       RETURNING active_operators AS "activeOperators", locked_by AS "lockedBy"`,
      [operator, code],
    );
    if (result.rows.length === 0) {
      return res.status(404).json(errorEnvelope("NOT_FOUND", `Work order ${code} not active for operator ${operator}`));
    }

    res.json(envelope({ code, activeOperators: result.rows[0].activeOperators }));
  } catch (err) {
    console.error("POST /pmc/work-orders/:code/unlock:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /pmc/work-order-qc-report?workOrderCode=X — 工单质量报表
app.get("/pmc/work-order-qc-report", async (req, res) => {
  try {
    const { workOrderCode } = req.query;
    if (!workOrderCode) return res.status(400).json(errorEnvelope("VALIDATION", "workOrderCode required"));

    // NG events for this WO
    const ngR = await query(`
      SELECT se.occurred_at AS "ngTime", se.result, se.traceability_key AS "pcbSerial",
             s.code AS "stationCode", s.name_zh AS "stationNameZh",
             pl.name_zh AS "lineName", u.username AS "operatorName"
      FROM station_events se
      JOIN stations s ON s.id = se.station_id
      JOIN production_lines pl ON pl.id = s.line_id
      LEFT JOIN users u ON u.id = se.operator_id
      WHERE se.event_type = 'ng' AND se.traceability_key = $1
      ORDER BY se.occurred_at DESC LIMIT 200`,
      [workOrderCode],
    );

    // Output events for yield calc
    const outR = await query(`
      SELECT COUNT(*)::int AS total_output
      FROM station_events
      WHERE event_type = 'output' AND traceability_key = $1`,
      [workOrderCode],
    );

    const totalOutput = outR.rows[0]?.total_output ?? 0;
    const totalNG = ngR.rows.length;
    const yieldPct = totalOutput > 0 ? Math.round((totalOutput - totalNG) / totalOutput * 100) : 0;

    // NG breakdown by station
    const byStation = {};
    for (const row of ngR.rows) {
      byStation[row.stationCode] = (byStation[row.stationCode] ?? 0) + 1;
    }

    res.json({
      data: {
        workOrderCode,
        totalOutput,
        totalNG,
        yieldPct,
        ngByStation: byStation,
        ngRecords: ngR.rows.slice(0, 50),
      },
    });
  } catch (err) {
    console.error("GET /pmc/work-order-qc-report:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /pmc/work-order-gantt — 工单Gantt视图数据
app.get("/pmc/work-order-gantt", async (req, res) => {
  try {
    const { lineCode } = req.query;
    const cond = lineCode ? "WHERE pl.internal_code = $1 AND wo.status NOT IN ('closed','draft')" : "WHERE wo.status NOT IN ('closed','draft')";
    const params = lineCode ? [lineCode] : [];
    const rows = await query(`
      SELECT
        wo.code AS "workOrderCode", wo.planned_qty AS "plannedQty", wo.completed_qty AS "completedQty",
        wo.due_date AS "dueDate", wo.released_at AS "releasedAt",
        wo.status, wo.priority,
        p.code AS "productCode", p.name_zh AS "productNameZh",
        pl.internal_code AS "lineCode", pl.name_zh AS "lineNameZh",
        COALESCE(po.po_number, '') AS "poNumber",
        LEAST(1.0, GREATEST(0,
          CASE WHEN wo.due_date IS NOT NULL AND wo.released_at IS NOT NULL
            THEN (NOW() - wo.released_at::timestamptz) / (wo.due_date::timestamptz - wo.released_at::timestamptz)
          ELSE 0 END
        )) AS "plannedProgress"
      FROM work_orders wo
      JOIN products p ON p.id = wo.product_id
      JOIN production_lines pl ON pl.id = wo.line_id
      LEFT JOIN customer_pos po ON po.id = wo.customer_po_id
      ${cond}
      ORDER BY wo.priority ASC, wo.due_date ASC NULLS LAST`,
      params,
    );
    res.json(listEnvelope(rows.rows));
  } catch (err) {
    console.error("GET /pmc/work-order-gantt:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /pmc/work-order-material-status — BOM exploded view per work order
// Returns material requirement status: required vs picked vs shortfall
app.get("/pmc/work-order-material-status", async (req, res) => {
  try {
    const { workOrderCode } = req.query;
    if (!workOrderCode) return res.status(400).json(errorEnvelope("VALIDATION", "workOrderCode required"));

    // Get WO + its active BOM
    const woR = await query(`
      SELECT wo.id AS "woId", wo.code AS "woCode", wo.planned_qty AS "plannedQty",
             wo.completed_qty AS "completedQty", wo.status,
             p.code AS "productCode", p.name_zh AS "productNameZh",
             pl.internal_code AS "lineCode", pl.name_zh AS "lineNameZh",
             b.id AS "bomId", b.revision AS "bomRevision"
      FROM work_orders wo
      JOIN products p ON p.id = wo.product_id
      JOIN production_lines pl ON pl.id = wo.line_id
      LEFT JOIN LATERAL (
        SELECT id, revision FROM boms
        WHERE product_id = wo.product_id AND status = 'active'
        ORDER BY effective_from DESC NULLS LAST LIMIT 1
      ) b ON true
      WHERE wo.code = $1
    `, [workOrderCode]);

    if (!woR.rows.length) return res.status(404).json(errorEnvelope("NOT_FOUND", "work order not found"));
    const wo = woR.rows[0];

    if (!wo.bomId) {
      return res.json({ data: { workOrder: wo, items: [], summary: { totalMaterials: 0, fulfilledMaterials: 0, fulfillmentPct: 0 } } });
    }

    // BOM lines — fetch base, then per-material picked qty + best lot
    const matR = await query(`
      SELECT m.id AS "mid", m.code AS "materialCode", m.vietnam_code AS "vietnamCode",
             COALESCE(m.name_zh,m.code) AS "materialNameZh", COALESCE(m.name_en,m.code) AS "materialNameEn",
             m.uom, m.material_type AS "materialType",
             bl.qty_per AS "qtyPer", bl.loss_rate AS "lossRate",
             bl.reference_designators AS "refDes", bl.spec AS "spec"
      FROM bom_lines bl JOIN materials m ON m.id = bl.material_id
      WHERE bl.bom_id = $1 ORDER BY m.material_type, m.code
    `, [wo.bomId]);

    const items = [];
    for (const r of matR.rows) {
      const total = Number(r.qtyPer) * (1 + Number(r.lossRate||0)) * Number(wo.plannedQty);
      const pR = await query(`SELECT COALESCE(SUM(it.qty),0) AS v FROM inventory_transactions it JOIN material_lots ml ON ml.id=it.material_lot_id WHERE ml.material_id=$1 AND it.work_order_id=$2 AND it.action IN ('PICK','ISSUE_TO_LINE')`, [r.mid, wo.woId]);
      const picked = Number(pR.rows[0]?.v||0);
      const shortfall = Math.max(0, total - picked);
      const bR = await query(`SELECT ml.lot_no AS "lotNo", COALESCE(sl.code,sc.shelf_code) AS "locCode", CASE WHEN sc.id IS NOT NULL THEN 'smart_rack' ELSE 'storage' END AS "locType", sc.shelf_code AS "shelfCode", sc.cell_number AS "cellNo", (ml.received_qty-COALESCE(ml.reserved_qty,0)) AS "availQty", ml.id AS "lotId" FROM material_lots ml LEFT JOIN storage_locations sl ON sl.id=ml.storage_location_id LEFT JOIN shelf_cells sc ON sc.material_lot_id=ml.id AND sc.cell_status='occupied' WHERE ml.material_id=$1 AND ml.iqc_status='released' AND ml.lot_status='open' ORDER BY CASE WHEN sc.id IS NULL THEN 0 ELSE 1 END, (ml.received_qty-COALESCE(ml.reserved_qty,0)) DESC LIMIT 1`, [r.mid]);
      items.push({ materialCode:r.materialCode, vietnamCode:r.vietnamCode, materialNameZh:r.materialNameZh, materialNameEn:r.materialNameEn, uom:r.uom, materialType:r.materialType, qtyPer:r.qtyPer, lossRate:r.lossRate, referenceDesignators:r.refDes, spec:r.spec, totalRequired:Math.round(total*100)/100, pickedQty:picked, shortfall:Math.round(shortfall*100)/100, bestLot:bR.rows[0]||null });
    }
    const totalMaterials = items.length;
    const fulfilledMaterials = items.filter(i => Number(i.shortfall) === 0).length;
    const fulfillmentPct = totalMaterials > 0 ? Math.round(fulfilledMaterials / totalMaterials * 100) : 0;
    const totalShortfall = items.reduce((sum, i) => sum + Number(i.shortfall), 0);

    res.json({
      data: {
        workOrder: wo,
        items,
        summary: {
          totalMaterials,
          fulfilledMaterials,
          fulfillmentPct,
          totalShortfall,
          woProgressPct: wo.plannedQty > 0 ? Math.round(wo.completedQty / wo.plannedQty * 100) : 0,
        },
      },
    });
  } catch (err) {
    console.error("GET /pmc/work-order-material-status:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// ── Supplementary Materials ────────────────────────────────────────────
// GET /pmc/supplementary-materials
app.get("/pmc/supplementary-materials", async (req, res) => {
  try {
    const { workOrderCode, status, limit = 100, offset = 0 } = req.query;
    const params = [];
    let where = "";
    if (workOrderCode) { params.push(workOrderCode); where += ` AND wo.code = $${params.length}`; }
    if (status) { params.push(status); where += ` AND sm.status = $${params.length}`; }
    const lim = Number(limit), off = Number(offset);
    params.push(lim, off);

    const r = await query(`
      SELECT sm.id, sm.required_qty AS "requiredQty", sm.uom, sm.reason,
             sm.status, sm.created_at AS "createdAt",
             wo.code AS "workOrderCode", wo.planned_qty AS "plannedQty",
             p.code AS "productCode", p.name_zh AS "productNameZh",
             m.code AS "materialCode", m.name_zh AS "materialNameZh",
              u.display_name AS "requestedByName"
      FROM supplementary_materials sm
      JOIN work_orders wo ON wo.id = sm.work_order_id
      JOIN materials m ON m.id = sm.material_id
      JOIN products p ON p.id = wo.product_id
      LEFT JOIN users u ON u.id = sm.requested_by
      WHERE 1=1 ${where}
      ORDER BY sm.created_at DESC
      LIMIT $${params.length-1} OFFSET $${params.length}
    `, params);

    const cntParams = params.slice(0, -2);
    const cntR = await query(`SELECT count(*) AS total FROM supplementary_materials sm JOIN work_orders wo ON wo.id = sm.work_order_id WHERE 1=1 ${where}`, cntParams);

    let summaryR = { rows: [] };
    if (workOrderCode) {
      summaryR = await query(`SELECT sm.status, count(*) AS count, sum(sm.required_qty)::numeric AS total_qty FROM supplementary_materials sm JOIN work_orders wo ON wo.id = sm.work_order_id WHERE wo.code = $1 GROUP BY sm.status`, [workOrderCode]);
    }

    res.json({ items: r.rows, total: Number(cntR.rows[0]?.total ?? 0), summary: summaryR.rows });
  } catch (err) {
    console.error("GET /pmc/supplementary-materials:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// POST /pmc/supplementary-materials
app.post("/pmc/supplementary-materials", async (req, res) => {
  try {
    const { workOrderCode, materialCode, requiredQty, uom, reason, requestedByName } = req.body;
    if (!workOrderCode || !materialCode || !requiredQty || !reason) {
      return res.status(400).json(errorEnvelope("VALIDATION", "workOrderCode, materialCode, requiredQty, reason required"));
    }
    const woR = await query("SELECT id FROM work_orders WHERE code = $1", [workOrderCode]);
    if (!woR.rows.length) return res.status(404).json(errorEnvelope("NOT_FOUND", "Work order not found"));
    const matR = await query("SELECT id FROM materials WHERE code = $1", [materialCode]);
    if (!matR.rows.length) return res.status(404).json(errorEnvelope("NOT_FOUND", "Material not found"));
    const userR = await query("SELECT id FROM users WHERE name = $1 LIMIT 1", [requestedByName ?? "PMC"]);
    const userId = userR.rows[0]?.id ?? null;

    const r = await query(`
      INSERT INTO supplementary_materials (work_order_id, material_id, required_qty, uom, reason, requested_by)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, status, created_at AS "createdAt"
    `, [woR.rows[0].id, matR.rows[0].id, requiredQty, uom ?? "PCS", reason, userId]);
    res.status(201).json({ data: r.rows[0] });
  } catch (err) {
    if (err.code === "23503") return res.status(400).json(errorEnvelope("VALIDATION", "Referenced work order or material does not exist"));
    console.error("POST /pmc/supplementary-materials:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// PATCH /pmc/supplementary-materials/:id
app.patch("/pmc/supplementary-materials/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { status, requiredQty, reason } = req.body;
    const allowed = ["pending","approved","issued","closed"];
    if (status && !allowed.includes(status)) return res.status(400).json(errorEnvelope("VALIDATION", `status must be one of: ${allowed.join(", ")}`));
    const sets = [], params = [];
    if (status) { params.push(status); sets.push(`status = $${params.length}`); }
    if (requiredQty) { params.push(requiredQty); sets.push(`required_qty = $${params.length}`); }
    if (reason) { params.push(reason); sets.push(`reason = $${params.length}`); }
    if (!sets.length) return res.status(400).json(errorEnvelope("VALIDATION", "No fields to update"));
    params.push(id);
    const r = await query(`UPDATE supplementary_materials SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING id, status, required_qty AS "requiredQty", reason`, params);
    if (!r.rows.length) return res.status(404).json(errorEnvelope("NOT_FOUND", "Supplementary material not found"));
    res.json({ data: r.rows[0] });
  } catch (err) {
    console.error("PATCH /pmc/supplementary-materials/:id:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// DELETE /pmc/supplementary-materials/:id (soft-close)
app.delete("/pmc/supplementary-materials/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const r = await query(`UPDATE supplementary_materials SET status = 'closed' WHERE id = $1 RETURNING id, status`, [id]);
    if (!r.rows.length) return res.status(404).json(errorEnvelope("NOT_FOUND", "Not found"));
    res.json({ data: r.rows[0] });
  } catch (err) {
    console.error("DELETE /pmc/supplementary-materials/:id:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});
// ------ PMC Patrol State ------------------------------------------

/* GET /pmc/patrol-state
 * Returns the current patrol cycle state JSON written by the PMC patrol scripts.
 * Falls back to an empty state if the patrol file hasn't been generated yet.
 * Public (read-only monitoring data, no permission check).
 */
app.get("/pmc/patrol-state", async (req, res) => {
  try {
    const patrolFile = path.join(process.env.TEMP || "/tmp", "pmc_patrol_state.json");
    if (fs.existsSync(patrolFile)) {
      const raw = fs.readFileSync(patrolFile, "utf-8");
      const data = JSON.parse(raw);
      return res.json(envelope(data));
    }
    // Return idle state if patrol hasn't run yet
    return res.json(envelope({
      cycle: 0,
      timestamp: new Date().toISOString(),
      nodes: {
        delivery_watch:      { state: "idle", detail: "Patrol not started", escalations: 0 },
        rate_check:          { state: "idle", detail: "Patrol not started", escalations: 0 },
        abnormal_detector:   { state: "idle", detail: "Patrol not started", escalations: 0 },
        material_shortage:   { state: "idle", detail: "Patrol not started", escalations: 0 },
        notification_router: { state: "idle", detail: "Patrol not started", escalations: 0 },
      },
      total_escalations: 0,
      overdue_count: 0,
      patrol_duration_ms: 0,
    }));
  } catch (err) {
    console.error("GET /pmc/patrol-state:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// ------ PMC Delivery Watch ------------------------------------------

/* GET /pmc/delivery-watch
 * Returns delivery risk assessment for all active work orders.
 * Uses idx_wo_status_due and idx_escalation_wo_type_open for performance.
 * Cached for 60s to avoid repeated full-table LATERAL scans.
 */
app.get("/pmc/delivery-watch", async (req, res) => {
  try {
    const cached = deliveryWatchCache.get("list");
    if (cached) return res.json(cached);

    const result = await query(`
      SELECT
        wo.code AS wo_code,
        p.code AS product_code,
        pl.internal_code AS line_code,
        wo.planned_qty,
        wo.completed_qty,
        ROUND((wo.completed_qty::numeric / NULLIF(wo.planned_qty, 0)) * 100, 1) AS completion_pct,
        wo.due_date,
        EXTRACT(EPOCH FROM (wo.due_date - NOW())) / 3600 AS delay_hours,
        COALESCE(el.alert_id, 0) AS alert_id,
        el.description AS rate_detail,
        CASE
          WHEN wo.due_date < NOW() THEN 'OVERDUE'
          WHEN EXTRACT(EPOCH FROM (wo.due_date - NOW())) / 3600 <= 24 THEN 'WARNING'
          WHEN EXTRACT(EPOCH FROM (wo.due_date - NOW())) / 3600 <= 48 THEN 'CAUTION'
          ELSE 'ON_TRACK'
        END AS tier
      FROM work_orders wo
      JOIN products p ON p.id = wo.product_id
      JOIN production_lines pl ON pl.id = wo.line_id
      LEFT JOIN LATERAL (
        SELECT id AS alert_id, description
        FROM pmc_escalation_log
        WHERE wo_code = wo.code
          AND alert_type = 'delivery_watch'
          AND resolved_at IS NULL
        ORDER BY occurred_at DESC
        LIMIT 1
      ) el ON true
      WHERE wo.status NOT IN ('closed', 'voided')
        AND wo.due_date IS NOT NULL
      ORDER BY wo.due_date ASC
    `);

    const data = envelope({
      items: result.rows.map(r => ({
        ...r,
        due_date: r.due_date ? r.due_date.toISOString() : null,
        delay_hours: r.delay_hours ? parseFloat(Number(r.delay_hours).toFixed(1)) : 0,
        completion_pct: parseFloat(r.completion_pct || '0'),
        completed_qty: parseInt(r.completed_qty) || 0,
        planned_qty: parseInt(r.planned_qty) || 0,
        alert_id: r.alert_id || null,
      })),
      last_run: new Date().toISOString(),
    });

    deliveryWatchCache.set("list", data);
    return res.json(data);
  } catch (err) {
    console.error("GET /pmc/delivery-watch:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});
}
