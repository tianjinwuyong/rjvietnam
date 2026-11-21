const MEMORY_TYPES = new Set([
  "AUTHORITATIVE_GUIDANCE",
  "REAL_INSPECTION_FACT",
  "TASK_EPISODE",
  "LEARNING_CANDIDATE",
  "APPROVED_KNOWLEDGE",
]);

export async function rememberIqcMemory(query, input = {}) {
  const type = String(input.memoryType || "TASK_EPISODE").toUpperCase();
  if (!MEMORY_TYPES.has(type)) throw new Error(`unsupported IQC memory type: ${type}`);
  const content = input.content ?? {};
  const r = await query(`INSERT INTO qms_iqc_virtual_memory
    (memory_type,supplier_code,material_code,lot_no,content,source_type,source_id,confidence,approval_status,created_by)
    VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10) RETURNING *`, [
    type, String(input.supplierCode || "") || null, String(input.materialCode || "") || null,
    String(input.lotNo || "") || null, JSON.stringify(content), String(input.sourceType || "") || null,
    input.sourceId == null ? null : String(input.sourceId), Number.isFinite(Number(input.confidence)) ? Number(input.confidence) : 1,
    type === "LEARNING_CANDIDATE" ? "CANDIDATE" : "RECORDED", String(input.createdBy || "iqc-virtual-01"),
  ]);
  return r.rows[0];
}

export async function searchIqcMemory(query, input = {}) {
  const q = String(input.query || "").trim();
  const material = String(input.materialCode || "").trim();
  const supplier = String(input.supplierCode || "").trim();
  const r = await query(`SELECT id,memory_type,supplier_code,material_code,lot_no,content,source_type,source_id,confidence,approval_status,created_by,created_at
    FROM qms_iqc_virtual_memory
    WHERE approval_status NOT IN ('REJECTED','RETIRED')
      AND ($1='' OR material_code=$1) AND ($2='' OR supplier_code=$2)
      AND ($3='' OR content::text ILIKE '%' || $3 || '%' OR COALESCE(lot_no,'') ILIKE '%' || $3 || '%')
    ORDER BY CASE WHEN memory_type='AUTHORITATIVE_GUIDANCE' THEN 0 WHEN memory_type='REAL_INSPECTION_FACT' THEN 1 ELSE 2 END, created_at DESC LIMIT 50`, [material, supplier, q]);
  return r.rows;
}

export async function getIqcMemoryContext(query, input = {}) {
  const rows = await searchIqcMemory(query, input);
  const material = String(input.materialCode || "").trim();
  const supplier = String(input.supplierCode || "").trim();
  const events = await query(`SELECT supplier_code,material_code,lot_no,result,level_before,level_after,transition,inspection_date,source_file,abnormal_type,operator,created_at
    FROM qms_iqc_inspection_level_events WHERE ($1='' OR material_code=$1) AND ($2='' OR supplier_code=$2)
    ORDER BY created_at DESC LIMIT 20`, [material, supplier]);
  const remembered = rows.slice(0, 20).map(row => ({ type: row.memory_type, materialCode: row.material_code, supplierCode: row.supplier_code, lotNo: row.lot_no, content: row.content, source: row.source_type ? `${row.source_type}:${row.source_id || ""}` : null, confidence: row.confidence })).
    filter(row => row.type === "AUTHORITATIVE_GUIDANCE" || row.type === "REAL_INSPECTION_FACT" || row.type === "APPROVED_KNOWLEDGE");
  const realFacts = events.rows.map(row => ({ type: "REAL_INSPECTION_FACT", materialCode: row.material_code, supplierCode: row.supplier_code, lotNo: row.lot_no, content: row, source: `qms_iqc_inspection_level_events:${row.created_at}`, confidence: 1 }));
  return [...remembered, ...realFacts].slice(0, 30);
}

export { MEMORY_TYPES };
