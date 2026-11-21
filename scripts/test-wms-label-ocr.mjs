import fs from "node:fs/promises";
import "dotenv/config";
import os from "node:os";
import path from "node:path";
import { query } from "../services/api/src/db.js";
import { askReceivingLabelVision } from "../integrations/llm/index.js";

process.env.OLLAMA_URL = "http://127.0.0.1:1";
const requested = Math.max(1, Math.min(8, Number(process.argv[2] || 4)));
const scans = (await query(`SELECT DISTINCT ON (md5(image_data)) id,image_data,created_at
  FROM wms_receiving_label_ai_scans
  WHERE length(image_data)>10000
  ORDER BY md5(image_data),id DESC`)).rows.slice(0, requested);

const results = [];
for (const scan of scans) {
  const result = await askReceivingLabelVision(scan.image_data);
  const parsed = JSON.parse(result.raw);
  const codes = [parsed.materialCode, parsed.vietnamMaterialCode, parsed.ruijingMaterialCode].filter(Boolean).map(String);
  let masterMatched = false;
  if (codes.length) {
    masterMatched = Boolean((await query(`SELECT 1 FROM wms_material_label_master
      WHERE UPPER(vietnam_material_code)=ANY($1::text[]) OR UPPER(ruijing_material_code)=ANY($1::text[]) LIMIT 1`,
      [codes.map(code => code.toUpperCase())])).rows[0]);
  }
  results.push({
    scanId: scan.id,
    model: result.model,
    candidateMaterialCode: parsed.materialCode,
    specification: parsed.specification,
    lot: parsed.lot,
    quantity: parsed.quantity,
    manufactureDate: parsed.manufactureDate,
    ulCode: parsed.ulCode,
    confidence: Number(parsed.confidence || 0).toFixed(3),
    masterMatched,
    appliedMaterialCode: masterMatched ? parsed.materialCode : null,
  });
}
console.log(JSON.stringify(results, null, 2));
process.exit(0);
