import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({
  host: process.env.PGHOST || "127.0.0.1",
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "postgres",
  database: process.env.PGDATABASE || "smt_factory",
});

const client = await pool.connect();
try {
  await client.query("BEGIN");
  const process = (await client.query("SELECT * FROM oa_process_definitions WHERE process_code='WMS-MATERIAL-REQUISITION' AND active=true")).rows[0];
  if (!process) throw new Error("WMS-MATERIAL-REQUISITION is not configured");
  const steps = (await client.query("SELECT * FROM oa_process_signature_steps WHERE process_id=$1 AND active=true ORDER BY step_no", [process.id])).rows;
  if (!steps.length) throw new Error("WMS-MATERIAL-REQUISITION has no signature steps");

  const stamp = new Date().toISOString().replace(/\D/g, "").slice(2, 14);
  const samples = [
    { priority: "NORMAL", line: "L001", requestor: "Nguyen Van An", items: [["RJ-MAT-0001", "贴片电阻 20K", 12000, "PCS"], ["RJ-MAT-0002", "陶瓷电容 10uF", 8000, "PCS"]] },
    { priority: "URGENT", line: "L003", requestor: "Tran Thi Hoa", items: [["RJ-MAT-0108", "MOS 管", 2400, "PCS"], ["RJ-MAT-0112", "散热硅胶", 36, "KG"]] },
    { priority: "CRITICAL", line: "L004", requestor: "Le Minh Duc", items: [["RJ-MAT-0206", "主控 IC", 1500, "PCS"], ["RJ-MAT-0210", "PCB 主板", 1500, "PCS"]] },
  ];

  const created = [];
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const docNo = `REQ-TEST-${stamp}-${index + 1}`;
    const requisition = (await client.query(`INSERT INTO requisitions(doc_no,status,work_order_code,line_code,requestor_name,submitted_at,notes,created_by,created_at,updated_at) VALUES($1,'SUBMITTED',$2,$3,$4,now(),$5,1,now(),now()) RETURNING id`, [docNo, `WO-TEST-${stamp}-${index + 1}`, sample.line, sample.requestor, `${sample.priority} test material fetching`])).rows[0];
    for (const item of sample.items) await client.query(`INSERT INTO requisition_lines(requisition_id,material_code,material_name_zh,unit,requested_qty,line_status,remarks) VALUES($1,$2,$3,$4,$5,'DRAFT',$6)`, [requisition.id, item[0], item[1], item[3], item[2], "OA test package"]);
    const packageData = {
      content: sample.items.map(item => ({ materialCode: item[0], materialName: item[1], quantity: item[2], unit: item[3], remarks: "测试领料" })),
      issuedBy: sample.requestor,
      department: `SMT-${sample.line}`,
      issuedAt: new Date().toISOString(),
      priority: sample.priority,
      itemLink: `/wms/requisitions/${requisition.id}`,
      itemLinkDescription: docNo,
      summary: `${sample.line} 测试领料，共 ${sample.items.length} 项`,
      attachments: [
        { name: `${docNo}-领料清单.pdf`, kind: "document", mimeType: "application/pdf", uploadedBy: sample.requestor, uploadedAt: new Date().toISOString(), requiredSignerRoles: steps.map(step => step.signer_role).filter(Boolean) },
        { name: `${docNo}-现场照片.jpg`, kind: "photo", mimeType: "image/jpeg", uploadedBy: sample.requestor, uploadedAt: new Date().toISOString(), requiredSignerRoles: [] },
      ],
      responses: [],
    };
    const requestNo = `OA-MR-${stamp}-${index + 1}`;
    const request = (await client.query(`INSERT INTO oa_process_requests(request_no,process_id,entity_type,entity_id,entity_no,title,requester_username,requester_name,status,current_step,total_steps,submitted_at,package_data) VALUES($1,$2,'WMS_REQUISITION',$3,$4,$5,$6,$7,'PENDING',1,$8,now(),$9::jsonb) RETURNING id`, [requestNo, process.id, requisition.id, docNo, `测试领料审批 · ${sample.line}`, `TEST_${sample.line}`, sample.requestor, steps.length, JSON.stringify(packageData)])).rows[0];
    for (const step of steps) await client.query(`INSERT INTO oa_process_request_steps(request_id,step_no,signer_user_id,signer_username,signer_name,signer_role,sla_hours,status,started_at,due_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $2=1 THEN now() END,CASE WHEN $2=1 THEN now()+make_interval(hours=>$7) END)`, [request.id, step.step_no, step.signer_user_id, step.signer_username, step.signer_name, step.signer_role, step.sla_hours, step.step_no === 1 ? "PENDING" : "WAITING"]);
    await client.query(`INSERT INTO oa_process_audit_events(request_id,action,actor,to_status,detail) VALUES($1,'SUBMITTED',$2,'PENDING',$3::jsonb)`, [request.id, sample.requestor, JSON.stringify({ testData: true, priority: sample.priority, docNo })]);
    created.push({ requestNo, docNo, priority: sample.priority, signer: steps[0].signer_username });
  }
  await client.query("COMMIT");
  console.log(JSON.stringify({ created }, null, 2));
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
