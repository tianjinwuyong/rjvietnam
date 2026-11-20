// HR grievance workflow (/hr/grievance-cases, /api/manager/grievance-cases), moved out
// of services/api/server.js.
//
// 8 registrations: filing a case, the employee's own list, the manager-side explanation
// request and reply, resolution, and the employee acknowledgement that closes the loop.
//
// Pure registrations, no module-level statements in the block.
export function registerHrGrievanceRoutes(app, deps) {
  const { query, requirePermission, errorEnvelope, writeAuditLog } = deps;

app.post("/hr/grievance-cases", requirePermission("hr.grievance.submit"), async (req, res) => {
  try {
    const p = req.body?.payload ?? req.body ?? {};
    if (!p.subjectEmployeeCode || !p.complaintText || !p.allegationCategory) return res.status(400).json(errorEnvelope("VALIDATION", "subjectEmployeeCode, complaintText and allegationCategory required"));
    const result = await query(`INSERT INTO hr_employee_grievance_cases(reporter_employee_id,subject_employee_id,line_id,complaint_text,allegation_category,evidence_reference,response_due_at)
      SELECT $1,e.id,l.id,$2,$3,NULLIF($4,''),COALESCE($5::timestamptz,NOW()+INTERVAL '3 days')
      FROM employees e LEFT JOIN production_lines l ON UPPER(l.internal_code)=UPPER(NULLIF($6,''))
      WHERE UPPER(COALESCE(NULLIF(e.code,''),e.employee_no))=UPPER($7) AND e.status='active'
      RETURNING id,case_no AS "caseNo",status,response_due_at AS "responseDueAt"`,
      [req.user?.employeeId ?? req.user?.userId ?? null,p.complaintText,p.allegationCategory,p.evidenceReference || "",p.responseDueAt || null,p.lineCode || "",p.subjectEmployeeCode]);
    if (!result.rows.length) return res.status(404).json(errorEnvelope("EMPLOYEE_NOT_FOUND", "Subject employee is not registered"));
    await writeAuditLog({actorId:req.user?.userId,action:'HR_GRIEVANCE_SUBMITTED',entityType:'hr_employee_grievance_case',entityId:String(result.rows[0].id),payload:{...p,complaintText:'[CONFIDENTIAL]'},ipAddress:req.ip,userAgent:req.headers['user-agent']});
    res.status(201).json({success:true,data:result.rows[0]});
  } catch (err) { res.status(409).json(errorEnvelope("GRIEVANCE_SUBMIT_FAILED", err.message)); }
});

app.get("/hr/grievance-cases", requirePermission("hr.grievance.investigate"), async (req, res) => {
  try {
    const rows = await query(`SELECT c.id,c.case_no AS "caseNo",c.complaint_text AS "complaintText",c.allegation_category AS "allegationCategory",c.evidence_reference AS "evidenceReference",c.status,c.response_due_at AS "responseDueAt",c.manager_explanation AS "managerExplanation",c.hr_finding AS "hrFinding",c.hr_action AS "hrAction",c.created_at AS "createdAt",
      COALESCE(NULLIF(re.code,''),re.employee_no) AS "reporterCode",COALESCE(NULLIF(re.display_name,''),re.name_zh,re.employee_no) AS "reporterName",
      COALESCE(NULLIF(se.code,''),se.employee_no) AS "subjectCode",COALESCE(NULLIF(se.display_name,''),se.name_zh,se.employee_no) AS "subjectName",l.internal_code AS "lineCode"
      FROM hr_employee_grievance_cases c LEFT JOIN employees re ON re.id=c.reporter_employee_id JOIN employees se ON se.id=c.subject_employee_id LEFT JOIN production_lines l ON l.id=c.line_id ORDER BY c.created_at DESC`);
    res.json({success:true,data:rows.rows});
  } catch (err) { res.status(500).json(errorEnvelope("GRIEVANCE_READ_FAILED", err.message)); }
});

app.post("/hr/grievance-cases/:id/request-explanation", requirePermission("hr.grievance.investigate"), async (req, res) => {
  try {
    const result = await query(`UPDATE hr_employee_grievance_cases SET status='AWAITING_MANAGER_EXPLANATION',investigated_by=$2,updated_at=NOW() WHERE id=$1 AND status IN ('SUBMITTED','INVESTIGATING','HR_REVIEW') RETURNING id,case_no AS "caseNo",status,response_due_at AS "responseDueAt"`, [req.params.id,req.user?.userId ?? null]);
    if (!result.rows.length) return res.status(404).json(errorEnvelope("GRIEVANCE_NOT_FOUND", "Case is not available for investigation"));
    await writeAuditLog({actorId:req.user?.userId,action:'HR_REQUESTED_LINE_MANAGER_EXPLANATION',entityType:'hr_employee_grievance_case',entityId:String(req.params.id),payload:{},ipAddress:req.ip,userAgent:req.headers['user-agent']});
    res.json({success:true,data:result.rows[0]});
  } catch (err) { res.status(409).json(errorEnvelope("GRIEVANCE_REQUEST_FAILED", err.message)); }
});

app.get("/api/manager/grievance-cases", requirePermission("hr.grievance.respond"), async (req, res) => {
  try {
    const employeeId = req.user?.employeeId ?? req.user?.userId;
    const rows = await query(`SELECT c.id,c.case_no AS "caseNo",c.allegation_category AS "allegationCategory",c.complaint_text AS "complaintText",c.status,c.response_due_at AS "responseDueAt",c.manager_explanation AS "managerExplanation",l.internal_code AS "lineCode"
      FROM hr_employee_grievance_cases c LEFT JOIN production_lines l ON l.id=c.line_id WHERE c.subject_employee_id=$1 AND c.status IN ('AWAITING_MANAGER_EXPLANATION','HR_REVIEW') ORDER BY c.response_due_at`, [employeeId]);
    res.json({success:true,data:rows.rows});
  } catch (err) { res.status(500).json(errorEnvelope("MANAGER_GRIEVANCE_READ_FAILED", err.message)); }
});

app.post("/api/manager/grievance-cases/:id/explanation", requirePermission("hr.grievance.respond"), async (req, res) => {
  try {
    const explanation = String(req.body?.payload?.explanation ?? req.body?.explanation ?? '').trim();
    if (!explanation) return res.status(400).json(errorEnvelope('VALIDATION','explanation required'));
    const employeeId = req.user?.employeeId ?? req.user?.userId;
    const result = await query(`UPDATE hr_employee_grievance_cases SET manager_explanation=$2,manager_responded_by=$3,manager_responded_at=NOW(),status='HR_REVIEW',updated_at=NOW() WHERE id=$1 AND subject_employee_id=$3 AND status='AWAITING_MANAGER_EXPLANATION' RETURNING id,case_no AS "caseNo",status,manager_responded_at AS "respondedAt"`, [req.params.id,explanation,employeeId]);
    if (!result.rows.length) return res.status(404).json(errorEnvelope('GRIEVANCE_NOT_FOUND','Case is not assigned to this line manager'));
    await writeAuditLog({actorId:req.user?.userId,action:'LINE_MANAGER_EXPLANATION_SUBMITTED',entityType:'hr_employee_grievance_case',entityId:String(req.params.id),payload:{},ipAddress:req.ip,userAgent:req.headers['user-agent']});
    res.json({success:true,data:result.rows[0]});
  } catch (err) { res.status(409).json(errorEnvelope('MANAGER_EXPLANATION_FAILED',err.message)); }
});

// HR must record a finding and corrective action before the employee can
// acknowledge the outcome. The case is not closed by the manager's reply.
app.post("/hr/grievance-cases/:id/resolve", requirePermission("hr.grievance.investigate"), async (req, res) => {
  try {
    const p = req.body?.payload ?? req.body ?? {};
    if (!String(p.hrFinding || '').trim() || !String(p.hrAction || '').trim()) return res.status(400).json(errorEnvelope('VALIDATION','hrFinding and hrAction required'));
    const result = await query(`UPDATE hr_employee_grievance_cases SET status='RESOLVED',hr_finding=$2,hr_action=$3,outcome_sent_at=NOW(),investigated_by=COALESCE(investigated_by,$4),updated_at=NOW() WHERE id=$1 AND status IN ('HR_REVIEW','INVESTIGATING','AWAITING_MANAGER_EXPLANATION') RETURNING id,case_no AS "caseNo",status,outcome_sent_at AS "outcomeSentAt"`, [req.params.id,p.hrFinding,p.hrAction,req.user?.userId ?? null]);
    if (!result.rows.length) return res.status(404).json(errorEnvelope('GRIEVANCE_NOT_READY','Case is not ready for HR resolution'));
    await writeAuditLog({actorId:req.user?.userId,action:'HR_GRIEVANCE_RESOLVED',entityType:'hr_employee_grievance_case',entityId:String(req.params.id),payload:{hrFinding:p.hrFinding,hrAction:p.hrAction},ipAddress:req.ip,userAgent:req.headers['user-agent']});
    res.json({success:true,data:result.rows[0]});
  } catch (err) { res.status(409).json(errorEnvelope('GRIEVANCE_RESOLVE_FAILED',err.message)); }
});

// Employee view is limited to the employee's own cases and HR outcome.
app.get("/hr/grievance-cases/mine", requirePermission("hr.grievance.submit"), async (req, res) => {
  try {
    const employeeId = req.user?.employeeId ?? req.user?.userId;
    const rows = await query(`SELECT id,case_no AS "caseNo",allegation_category AS "allegationCategory",status,response_due_at AS "responseDueAt",hr_finding AS "hrFinding",hr_action AS "hrAction",outcome_sent_at AS "outcomeSentAt",employee_ack_decision AS "employeeAckDecision",employee_ack_at AS "employeeAckAt",employee_appeal_text AS "employeeAppealText" FROM hr_employee_grievance_cases WHERE reporter_employee_id=$1 ORDER BY created_at DESC`, [employeeId]);
    res.json({success:true,data:rows.rows});
  } catch (err) { res.status(500).json(errorEnvelope('GRIEVANCE_MINE_READ_FAILED',err.message)); }
});

app.post("/hr/grievance-cases/:id/employee-ack", requirePermission("hr.grievance.submit"), async (req, res) => {
  try {
    const p = req.body?.payload ?? req.body ?? {};
    const decision = String(p.decision || '').toUpperCase();
    const employeeId = req.user?.employeeId ?? req.user?.userId;
    if (!['ACKNOWLEDGED','APPEALED'].includes(decision)) return res.status(400).json(errorEnvelope('VALIDATION','decision must be ACKNOWLEDGED or APPEALED'));
    if (decision === 'APPEALED' && !String(p.appealText || '').trim()) return res.status(400).json(errorEnvelope('VALIDATION','appealText required'));
    const result = await query(`UPDATE hr_employee_grievance_cases SET employee_ack_decision=$2,employee_ack_at=NOW(),employee_appeal_text=CASE WHEN $2='APPEALED' THEN $3 ELSE employee_appeal_text END,employee_appealed_at=CASE WHEN $2='APPEALED' THEN NOW() ELSE employee_appealed_at END,status=CASE WHEN $2='APPEALED' THEN 'HR_REVIEW' ELSE 'CLOSED' END,hr_closed_at=CASE WHEN $2='ACKNOWLEDGED' THEN NOW() ELSE NULL END,updated_at=NOW() WHERE id=$1 AND reporter_employee_id=$4 AND status='RESOLVED' RETURNING id,case_no AS "caseNo",status,employee_ack_at AS "ackAt"`, [req.params.id,decision,p.appealText || '',employeeId]);
    if (!result.rows.length) return res.status(404).json(errorEnvelope('GRIEVANCE_NOT_FOUND','Only the reporting employee can acknowledge a resolved case'));
    await writeAuditLog({actorId:req.user?.userId,action:decision === 'APPEALED' ? 'EMPLOYEE_GRIEVANCE_APPEALED' : 'EMPLOYEE_GRIEVANCE_ACKNOWLEDGED',entityType:'hr_employee_grievance_case',entityId:String(req.params.id),payload:{decision},ipAddress:req.ip,userAgent:req.headers['user-agent']});
    res.json({success:true,data:result.rows[0]});
  } catch (err) { res.status(409).json(errorEnvelope('GRIEVANCE_ACK_FAILED',err.message)); }
});
}
