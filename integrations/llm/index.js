import { query } from "../../services/api/src/db.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL ?? "gemma4:latest";
const TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS ?? 60_000);
const execFileAsync = promisify(execFile);
const LOCAL_TESSDATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "tessdata");

function receivingFieldsFromOcrText(rawText, warnings = []) {
  const text = String(rawText || "").replace(/\u0000/g, " ");
  const pick = (patterns) => {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) return match[1].trim();
    }
    return null;
  };
  const quantityText = pick([/(?:QTY|QUANTITY|数量|本箱数量)\s*[:：#]?\s*([0-9,]+)/i, /\b([0-9,]+)\s*PCS\b/i]);
  const materialCode = pick([
    /(?:MATERIAL\s*(?:CODE|NO)?|PART\s*NO|P\/N|料号|物料(?:代码|编码))\s*[:：#]?\s*([A-Z0-9][A-Z0-9._/-]{2,})/i,
    /\b(\d{1,3}(?:\.\d{2}){2,}[A-Z]?)\b/i,
    /\b([A-Z0-9]{1,8}(?:[-.][A-Z0-9]{1,8}){3,})\b/i,
  ]);
  const specification = pick([
    /(?<!-)\b([A-Z0-9]{1,8}-[A-Z0-9]{2,8})\b(?!-)/i,
    /(?:SPECIFICATION|MODEL)\s*[:：]?\s*([A-Z0-9][A-Z0-9._/-]{2,})/i,
  ]);
  const lot = pick([/(?:LOT(?:\s*NO)?|BATCH|批次(?:号)?|批号)\s*[:：#]?\s*([A-Z0-9][A-Z0-9._/-]{2,})/i]);
  const supplier = pick([/(?:SUPPLIER|VENDOR|供应商(?:名称)?)\s*[:：#]?\s*([^\r\n|;]+)/i]);
  const manufactureDate = pick([/(?:MFG|MFD|DATE\s*CODE|生产日期)\s*[:：#]?\s*(20\d{2}[-/.]?\d{2}[-/.]?\d{2})/i]);
  const expiryDate = pick([/(?:EXP|EXPIRY|有效期(?:至)?)\s*[:：#]?\s*(20\d{2}[-/.]?\d{2}[-/.]?\d{2})/i]);
  const msdLevel = pick([/(?:MSD|MSL)\s*(?:LEVEL)?\s*[:：#-]?\s*([1-6][A-Z]?)/i]);
  return {
    materialCode, vietnamMaterialCode: materialCode, ruijingMaterialCode: null,
    materialName: null, specification, supplier, purchaseOrder: null, lot,
    manufactureDate, expiryDate,
    quantity: quantityText ? Number(quantityText.replace(/,/g, "")) : null,
    expectedQuantity: quantityText ? Number(quantityText.replace(/,/g, "")) : null,
    quantityPerBox: quantityText ? Number(quantityText.replace(/,/g, "")) : null,
    boxCount: null, boxNumber: null, boxSn: null, unit: /\bPCS\b/i.test(text) ? "PCS" : null,
    palletQr: null, locationCode: null, msdLevel, floorLifeHours: null, invoice: null,
    ulCode: pick([/\b(E\d{4,})\b/i]), qualityMark: null,
    confidence: text.trim() ? 0.65 : 0,
    warnings,
    ocrText: text,
  };
}

function receivingFieldsFromQr(raw) {
  const value = String(raw || "").trim();
  const parts = value.split("*").map(item => item.trim());
  if (parts.length >= 6 && Number.isFinite(Number(parts[4]))) {
    const quantity = Number(parts[4]);
    return {
      ...receivingFieldsFromOcrText("", ["Exact fields decoded from label QR"]),
      ruijingMaterialCode: parts[0], lot: parts[1], manufactureDate: parts[2],
      supplier: parts[3], quantity, expectedQuantity: quantity,
      quantityPerBox: quantity, boxNumber: parts[5], boxSn: parts[5],
      supplierBarcode: parts[5], confidence: 1, qrValue: value,
    };
  }
  return null;
}

async function quickQrFields(imageBase64) {
  const file = path.join(os.tmpdir(), `wms-qr-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`);
  try {
    await fs.writeFile(file, Buffer.from(imageBase64, "base64"));
    const rapidOcr = path.join(path.dirname(fileURLToPath(import.meta.url)), "rapidocr_receiving_label.py");
    const out = String((await execFileAsync("python", [rapidOcr, file], {
      windowsHide: true,
      timeout: 45_000,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    })).stdout || "");
    const lines = out.split(/\r?\n/);
    const exactQr = lines
      .filter((line) => line.startsWith("QR_VALUE:"))
      .map((line) => receivingFieldsFromQr(line.slice("QR_VALUE:".length)))
      .find(Boolean);
    const rapidText = lines.filter((line) => !line.startsWith("QR_VALUE:")).join("\n").trim();
    return { exactQr: exactQr ?? null, rapidText };
  } catch {
    return { exactQr: null, rapidText: "" };
  } finally {
    await fs.rm(file, { force: true }).catch(() => {});
  }
}

function parseLooseJson(raw) {
  try {
    const text = String(raw || "").replace(/```json|```/gi, "").trim();
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function visionResultEmpty(raw) {
  const value = parseLooseJson(raw);
  if (!value) return true;
  const keys = ["materialCode", "vietnamMaterialCode", "ruijingMaterialCode", "lot", "quantity", "quantityPerBox", "expectedQuantity", "boxSn"];
  return keys.every((key) => {
    const field = value[key];
    return field === null || field === undefined || String(field).trim() === "";
  });
}

function mergeVisionWithLocal(visionRaw, localRaw) {
  const vision = parseLooseJson(visionRaw) ?? {};
  const local = parseLooseJson(localRaw) ?? {};
  const merged = { ...local, ...vision };
  // Vision nulls must not erase local OCR reads; keep whichever side has a value.
  for (const key of Object.keys(merged)) {
    const visionValue = vision[key];
    const localValue = local[key];
    const isEmpty = (field) => field === null || field === undefined || String(field).trim() === "";
    if (isEmpty(visionValue) && !isEmpty(localValue)) merged[key] = localValue;
  }
  const warnings = [
    ...(Array.isArray(vision.warnings) ? vision.warnings : []),
    ...(Array.isArray(local.warnings) ? local.warnings : []),
    "vision read no fields; local QR/OCR result merged in",
  ];
  merged.warnings = [...new Set(warnings.map(String))];
  if (typeof merged.confidence !== "number") merged.confidence = 0.5;
  return JSON.stringify(merged);
}

async function localReceivingOcr(imageBase64, originalError) {
  const file = path.join(os.tmpdir(), `wms-label-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`);
  const enhancedFile = file.replace(/\.jpg$/, "-enhanced.png");
  try {
    await fs.writeFile(file, Buffer.from(imageBase64, "base64"));
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const bundledPython = path.resolve(moduleDir, "../../services/api/.venv-ocr/Scripts/python.exe");
    const paddlePython = process.env.WMS_OCR_PYTHON || bundledPython;
    const paddleScript = path.join(moduleDir, "paddleocr_receiving_label.py");
    try {
      // The PP-OCR pipeline exceeds the available factory PC memory and can
      // stall every PDA request. Keep it opt-in (WMS_OCR_USE_PADDLE=1); the
      // resized RapidOCR plus Chinese/English Tesseract path below is the
      // stable production path.
      if (process.env.WMS_OCR_USE_PADDLE !== "1") throw new Error("PaddleOCR opt-in only (set WMS_OCR_USE_PADDLE=1 to enable)");
      const paddleOutput = await execFileAsync(paddlePython, [paddleScript, file], {
        windowsHide: true,
        timeout: 120_000,
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, PADDLE_PDX_MODEL_SOURCE: "BOS", PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK: "True" },
      });
      const lastJsonLine = String(paddleOutput.stdout || "").trim().split(/\r?\n/).reverse().find(line => line.trim().startsWith("{"));
      const paddleResult = JSON.parse(lastJsonLine || "{}");
      const exactQr = (Array.isArray(paddleResult.qrValues) ? paddleResult.qrValues : [])
        .map(receivingFieldsFromQr).find(Boolean);
      if (exactQr) return { model: "opencv-qr+paddleocr-pp-ocrv5", raw: JSON.stringify(exactQr) };
      const lines = Array.isArray(paddleResult.lines) ? paddleResult.lines : [];
      const paddleText = lines.map(line => String(line.text || "")).filter(Boolean).join("\n");
      if (paddleText) {
        // For labels without a readable QR, combine Paddle detection with
        // Tesseract's Simplified-Chinese + English recognition. Tesseract is
        // authoritative for Chinese field names and thin printed characters.
        const preprocessor = path.join(moduleDir, "preprocess_receiving_label.py");
        await execFileAsync("python", [preprocessor, file, enhancedFile], { windowsHide: true, timeout: 30_000 });
        const executable = process.env.TESSERACT_PATH ?? "C:\\Program Files\\Tesseract-OCR\\tesseract.exe";
        const recognize = async (psm) => (await execFileAsync(executable, [
          enhancedFile, "stdout", "--tessdata-dir", LOCAL_TESSDATA_DIR,
          "-l", "chi_sim+eng", "--psm", String(psm),
        ], { windowsHide: true, timeout: 30_000 })).stdout;
        const [blockText, sparseText] = await Promise.all([recognize(6), recognize(11)]);
        const combinedText = `${paddleText}\n${String(blockText || "")}\n${String(sparseText || "")}`;
        const averageScore = lines.reduce((sum, line) => sum + Number(line.score || 0), 0) / lines.length;
        const parsed = receivingFieldsFromOcrText(combinedText, ["WMS Tesseract chi_sim+eng with PP-OCRv5 detection"]);
        parsed.confidence = Math.max(0, Math.min(1, averageScore));
        return { model: "tesseract-chi_sim+eng+paddleocr-pp-ocrv5", raw: JSON.stringify(parsed) };
      }
    } catch (paddleError) {
      console.warn("[WMS OCR] PaddleOCR unavailable, using fallback:", paddleError.message);
    }
    const rapidOcr = path.join(path.dirname(fileURLToPath(import.meta.url)), "rapidocr_receiving_label.py");
    let rapidText = "";
    try {
      rapidText = String((await execFileAsync("python", [rapidOcr, file], {
        windowsHide: true,
        timeout: 45_000,
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
      })).stdout || "");
      const rapidQr = rapidText.split(/\r?\n/)
        .filter(line => line.startsWith("QR_VALUE:"))
        .map(line => receivingFieldsFromQr(line.slice("QR_VALUE:".length)))
        .find(Boolean);
      if (rapidQr) return { model: "opencv-qr", raw: JSON.stringify(rapidQr) };
    } catch (rapidError) {
      console.warn("[WMS OCR] RapidOCR unavailable, using Tesseract:", rapidError.message);
    }
    const preprocessor = path.join(path.dirname(fileURLToPath(import.meta.url)), "preprocess_receiving_label.py");
    await execFileAsync("python", [preprocessor, file, enhancedFile], { windowsHide: true, timeout: 30_000 });
    const executable = process.env.TESSERACT_PATH ?? "C:\\Program Files\\Tesseract-OCR\\tesseract.exe";
    const recognize = async (psm) => (await execFileAsync(executable, [
      enhancedFile, "stdout", "--tessdata-dir", LOCAL_TESSDATA_DIR,
      "-l", "chi_sim+eng", "--psm", String(psm),
    ], { windowsHide: true, timeout: 30_000 })).stdout;
    const [blockText, sparseText] = await Promise.all([recognize(6), recognize(11)]);
    const text = `${rapidText}\n${String(blockText || "")}\n${String(sparseText || "")}`.trim();
    const model = rapidText.trim() ? "rapidocr-local+chi_sim+eng" : "tesseract-local-chi_sim+eng";
    return { model, raw: JSON.stringify(receivingFieldsFromOcrText(text, [`Primary OCR unavailable: ${originalError.message}`, "Local WMS OCR used; fields auto-applied"])) };
  } finally {
    await Promise.all([file, enhancedFile].map((item) => fs.rm(item, { force: true }).catch(() => {})));
  }
}

async function ollamaChat(model, messages, opts = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${OLLAMA_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: false, ...opts }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Ollama ${res.status}: ${err}`);
    }
    const json = await res.json();
    return json.choices?.[0]?.message ?? { role: "assistant", content: "" };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Parse a receiving label with a local Ollama vision model. Results are
 * returned for automatic WMS form application.
 */
export async function askReceivingLabelVision(imageDataUrl, opts = {}) {
  const model = opts.model ?? process.env.OLLAMA_VISION_MODEL ?? "minicpm-v4.5:8b";
  const image = String(imageDataUrl || "").replace(/^data:image\/[^;]+;base64,/, "");
  if (!image) throw new Error("label image is required");
  const localOcrText = String(opts.localOcrText || "").trim();
  const mlkitContext = localOcrText
    ? `\nOn-device MLKit OCR text (high trust for printed characters; verify against the image):\n${localOcrText.slice(0, 4000)}`
    : "";
  const scannerContext = opts.context ? `\nAdditional scanner/OCR context (may be wrong; compare it to the image):\n${String(opts.context).slice(0, 6000)}` : "";
  // QR-first short-circuit: a decoded label QR is deterministic and beats
  // any vision guess. RapidOCR text is reused as extra vision context.
  let rapidContext = "";
  try {
    const qr = await quickQrFields(image);
    if (qr.exactQr) {
      return { model: "opencv-qr", raw: JSON.stringify(qr.exactQr), imageBase64: image };
    }
    if (qr.rapidText) {
      rapidContext = `\nRapidOCR pre-scan text (may be partial; verify against the image):\n${qr.rapidText.slice(0, 4000)}`;
    }
  } catch { /* fall through to vision */ }
  const context = `${mlkitContext}${scannerContext}${rapidContext}`;
  const prompt = `You are a warehouse receiving label parser. Read the attached label carefully.
Return ONLY valid JSON, no markdown, using exactly these keys:
materialCode, vietnamMaterialCode, ruijingMaterialCode, materialName, specification, supplier, purchaseOrder, lot, manufactureDate, expiryDate, quantity, expectedQuantity, quantityPerBox, boxCount, boxNumber, boxSn, unit, palletQr, locationCode, msdLevel, floorLifeHours, invoice, ulCode, qualityMark, confidence, warnings.
Labels may be Chinese, Vietnamese, or English and may be supplier labels, customer labels, packing labels, barcode labels, or QR labels. Map equivalent labels such as 物料代码/料号/PART NO to materialCode, 越南代码 to vietnamMaterialCode, 瑞晶代码 to ruijingMaterialCode, 批次/LOT NO to lot, 本批数量/总数量 to quantity or expectedQuantity, 本箱数量 to quantityPerBox, 箱数 to boxCount, 箱号/箱SN to boxSn, 供应商/VENDOR to supplier, 生产日期/PACKING DATE to manufactureDate, 有效期 to expiryDate, and MS/MSD to msdLevel. Read text near barcodes and QR codes; do not confuse a barcode value with the material code.
Use null when a value is not readable. Dates must be YYYY-MM-DD when confidently recognized. quantity must be a number or null. confidence is 0..1. warnings is an array of short strings. Never invent values; mark uncertain readings in warnings.
The photo may be rotated 90 or 180 degrees or taken at an angle with glare or moire; mentally rotate the label upright before reading. If a QR code is visible, decode it first and use its payload for materialCode, lot and quantity.`;
  const finalPrompt = prompt + context;
  try {
    const response = await ollamaChat(model, [{
      role: "user",
      content: [
        { type: "text", text: finalPrompt },
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image}` } },
      ],
    }], { temperature: 0, max_tokens: 1200 });
    const raw = response.content || "";
    if (visionResultEmpty(raw)) {
      // Vision returned valid JSON but read nothing (rotated/blurry shot).
      // Fall through to the local QR + RapidOCR/Tesseract pipeline instead
      // of reporting an empty parse.
      const local = await localReceivingOcr(image, new Error("vision returned no fields"));
      const merged = mergeVisionWithLocal(raw, local.raw);
      return { model: `${model}+${local.model}`, raw: merged, imageBase64: image };
    }
    return { model, raw, imageBase64: image };
  } catch (error) {
    if (localOcrText) {
      const parsed = receivingFieldsFromOcrText(localOcrText, [`Vision unavailable (${error.message}); MLKit on-device text used`]);
      return { model: "google-mlkit-on-device", raw: JSON.stringify(parsed), imageBase64: image };
    }
    return { ...(await localReceivingOcr(image, error)), imageBase64: image };
  }
}

export async function askChat(prompt, opts = {}) {
  const locale = opts?.locale ?? "zh-CN";
  const model = opts?.model ?? DEFAULT_MODEL;

  // System prompt for factory assistant
  const systemPrompt = locale === "vi-VN"
    ? "Bạn là trợ lý AI cho nhà máy Ruijing Việt Nam. Trả lời bằng tiếng Việt."
    : locale === "en-US"
    ? "You are the AI assistant for Vietnam Ruijing factory. Reply in English."
    : "你是越南瑞晶工厂的AI助手。请用中文回复。";

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: prompt },
  ];

  try {
    return await ollamaChat(model, messages);
  } catch (err) {
    console.error("[llm/askChat]", err.message);
    return { role: "assistant", content: `[AI暂时不可用: ${err.message}]` };
  }
}

export async function askServiceAgent(prompt, opts = {}) {
  return askChat(prompt, opts);
}

const _invI18n = (zh, en) => zh ? zh : en;
const _invNum = (n) => Number(n ?? 0).toLocaleString("en-US");

/**
 * Real rule-based WMS inventory query engine (no LLM required).
 * Classifies the prompt into an intent, runs live SQL against the WMS tables,
 * and returns a readable answer + the executed SQL (transparency).
 */
export async function askInventoryQuery(prompt = "", lots = [], opts = {}) {
  const locale = opts?.locale ?? "zh-CN";
  const zh = locale === "zh-CN" || (locale !== "en-US" && locale !== "vi-VN");
  const q = String(prompt || "").toLowerCase();
  const nameOf = (r) => (zh ? r.nameZh ?? r.nameEn : r.nameEn ?? r.nameZh);

  const fallback = (errMsg) => {
    if (!lots?.length) {
      return { sql: "", explanation: zh ? `[查询失败: ${errMsg}]` : `[Query failed: ${errMsg}]` };
    }
    const total = lots.reduce((s, l) => s + Number(l.qty ?? 0), 0);
    const counts = {};
    for (const l of lots) {
      const k = l.iqcStatus ?? "unknown";
      counts[k] = (counts[k] ?? 0) + 1;
    }
    const statusLine = Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(", ");
    return {
      sql: "",
      explanation: zh
        ? `[实时快照 ${lots.length} 批 · 合计 ${_invNum(total)}]\n${statusLine}`
        : `[Live snapshot ${lots.length} lots · total ${_invNum(total)}]\n${statusLine}`,
    };
  };

  try {
    // ── 1) Low stock / shortage ──────────────────────────────────────────────
    if (/(库存不足|缺料|欠料|不足|shortage|low\s*stock)/i.test(q)) {
      const sql = `SELECT m.code AS "materialCode",
          COALESCE(m.name_zh, m.name_en) AS "nameZh",
          COALESCE(m.name_en, m.name_zh) AS "nameEn",
          COALESCE(SUM(ml.received_qty - COALESCE(ml.reserved_qty, 0)), 0) AS "availableQty",
          COUNT(*) AS "lotCount", COALESCE(m.uom, '') AS "uom",
          COALESCE(m.safety_stock_qty, 0) AS "safetyStock"
        FROM material_lots ml
        JOIN materials m ON m.id = ml.material_id
        WHERE ml.lot_status = 'open'
        GROUP BY m.code, m.name_zh, m.name_en, m.uom, m.safety_stock_qty
        ORDER BY "availableQty" ASC, m.code ASC
        LIMIT 10`;
      const { rows } = await query(sql);
      if (!rows.length) return { sql, explanation: zh ? "[暂无库存数据]" : "[No inventory data]" };
      const lines = rows.map((r, i) => {
        const flag = r.availableQty <= r.safetyStock ? " ⚠️低于安全库存" : "";
        return `${i + 1}. ${r.materialCode} ${nameOf(r)} — 可用 ${_invNum(r.availableQty)} ${r.uom}（${r.lotCount} 批）${flag}`;
      });
      const title = zh ? "📦 库存最少的物料（可用数量升序）" : "📦 Materials with lowest stock (ascending)";
      return { sql, explanation: `${title}\n${lines.join("\n")}` };
    }

    // ── 2) IQC pending / hold ────────────────────────────────────────────────
    if (/(iqc|待检|检验|来料|hold|pending|inspection)/i.test(q)) {
      const sql = `SELECT m.code AS "materialCode",
          COALESCE(m.name_zh, m.name_en) AS "nameZh",
          COALESCE(m.name_en, m.name_zh) AS "nameEn",
          ml.lot_no AS "lotNo",
          ml.received_qty - COALESCE(ml.reserved_qty, 0) AS "qty",
          ml.iqc_status AS "iqcStatus", sl.code AS "locationCode"
        FROM material_lots ml
        JOIN materials m ON m.id = ml.material_id
        LEFT JOIN storage_locations sl ON sl.id = ml.storage_location_id
        WHERE ml.lot_status = 'open' AND ml.iqc_status IN ('hold','pending')
        ORDER BY ml.iqc_status, m.code
        LIMIT 20`;
      const { rows } = await query(sql);
      if (!rows.length) return { sql, explanation: zh ? "✅ 当前没有待检/HOLD 的批次" : "✅ No lots pending IQC / HOLD" };
      const lines = rows.map((r, i) => `${i + 1}. ${r.materialCode} ${nameOf(r)} 批次 ${r.lotNo} — ${r.iqcStatus.toUpperCase()}（${_invNum(r.qty)}${r.locationCode ? " · " + r.locationCode : ""}）`);
      const title = zh ? `🔍 IQC 待检/HOLD 批次（${rows.length}）` : `🔍 IQC pending/HOLD lots (${rows.length})`;
      return { sql, explanation: `${title}\n${lines.join("\n")}` };
    }

    // ── 3) Rejected / defective ──────────────────────────────────────────────
    if (/(reject|不合格|退货|退料)/i.test(q)) {
      const sql = `SELECT m.code AS "materialCode",
          COALESCE(m.name_zh, m.name_en) AS "nameZh",
          COALESCE(m.name_en, m.name_zh) AS "nameEn",
          ml.lot_no AS "lotNo", ml.received_qty - COALESCE(ml.reserved_qty, 0) AS "qty"
        FROM material_lots ml
        JOIN materials m ON m.id = ml.material_id
        WHERE ml.lot_status = 'open' AND ml.iqc_status = 'rejected'
        ORDER BY m.code
        LIMIT 20`;
      const { rows } = await query(sql);
      if (!rows.length) return { sql, explanation: zh ? "✅ 当前没有不合格/退货批次" : "✅ No rejected lots" };
      const lines = rows.map((r, i) => `${i + 1}. ${r.materialCode} ${nameOf(r)} 批次 ${r.lotNo} — ${_invNum(r.qty)}`);
      const title = zh ? `⛔ 不合格/退货批次（${rows.length}）` : `⛔ Rejected lots (${rows.length})`;
      return { sql, explanation: `${title}\n${lines.join("\n")}` };
    }

    // ── 4) Expiry / shelf life ───────────────────────────────────────────────
    if (/(过期|效期|临期|expir|shelf\s*life)/i.test(q)) {
      const sql = `SELECT m.code AS "materialCode",
          COALESCE(m.name_zh, m.name_en) AS "nameZh",
          COALESCE(m.name_en, m.name_zh) AS "nameEn",
          ml.lot_no AS "lotNo", ml.expiry_date AS "expiryDate",
          ml.lifecycle_status AS "lifecycleStatus",
          ml.received_qty - COALESCE(ml.reserved_qty, 0) AS "qty"
        FROM material_lots ml
        JOIN materials m ON m.id = ml.material_id
        WHERE ml.lot_status = 'open'
          AND (ml.expiry_date IS NOT NULL AND ml.expiry_date <= CURRENT_DATE + INTERVAL '90 days'
               OR ml.lifecycle_status IS NOT NULL AND ml.lifecycle_status <> 'NORMAL')
        ORDER BY ml.expiry_date ASC NULLS LAST, ml.lifecycle_status
        LIMIT 10`;
      const { rows } = await query(sql);
      if (!rows.length) return { sql, explanation: zh ? "✅ 未来 90 天内无到期批次" : "✅ No lots expiring within 90 days" };
      const lines = rows.map((r, i) => {
        const d = r.expiryDate ? (r.expiryDate instanceof Date ? r.expiryDate.toISOString().slice(0, 10) : String(r.expiryDate).slice(0, 10)) : "?";
        const badge = r.lifecycleStatus && r.lifecycleStatus !== "NORMAL" ? ` [${r.lifecycleStatus}]` : "";
        return `${i + 1}. ${r.materialCode} ${nameOf(r)} 批次 ${r.lotNo} — ${d}（${_invNum(r.qty)}）${badge}`;
      });
      const title = zh ? `⏳ 临期/效期预警批次（${rows.length}）` : `⏳ Expiry warning lots (${rows.length})`;
      return { sql, explanation: `${title}\n${lines.join("\n")}` };
    }

    // ── 5) By supplier ───────────────────────────────────────────────────────
    if (/(供应商|厂商|supplier|vendor)/i.test(q)) {
      const sql = `SELECT s.code AS "supplierCode",
          COALESCE(s.name_zh, s.name_en) AS "supplierName",
          COUNT(*) AS "lotCount",
          COALESCE(SUM(ml.received_qty - COALESCE(ml.reserved_qty, 0)), 0) AS "totalQty"
        FROM material_lots ml
        JOIN suppliers s ON s.id = ml.supplier_id
        WHERE ml.lot_status = 'open'
        GROUP BY s.code, s.name_zh, s.name_en
        ORDER BY "totalQty" DESC
        LIMIT 10`;
      const { rows } = await query(sql);
      if (!rows.length) return { sql, explanation: zh ? "[暂无供应商库存数据]" : "[No supplier data]" };
      const lines = rows.map((r, i) => `${i + 1}. ${r.supplierCode} ${r.supplierName} — 合计 ${_invNum(r.totalQty)}（${r.lotCount} 批）`);
      const title = zh ? `🏭 按供应商汇总库存（${rows.length}）` : `🏭 Inventory by supplier (${rows.length})`;
      return { sql, explanation: `${title}\n${lines.join("\n")}` };
    }

    // ── 6) By location ───────────────────────────────────────────────────────
    if (/(库位|储位|location|shelf\s*cell)/i.test(q)) {
      const sql = `SELECT COALESCE(sl.code, '(未分配)') AS "locationCode",
          COUNT(*) AS "lotCount",
          COALESCE(SUM(ml.received_qty - COALESCE(ml.reserved_qty, 0)), 0) AS "totalQty"
        FROM material_lots ml
        LEFT JOIN storage_locations sl ON sl.id = ml.storage_location_id
        WHERE ml.lot_status = 'open'
        GROUP BY sl.code
        ORDER BY "totalQty" DESC
        LIMIT 10`;
      const { rows } = await query(sql);
      if (!rows.length) return { sql, explanation: zh ? "[暂无库位数据]" : "[No location data]" };
      const lines = rows.map((r, i) => `${i + 1}. ${r.locationCode} — ${_invNum(r.totalQty)}（${r.lotCount} 批）`);
      const title = zh ? `📍 按库位库存分布（${rows.length}）` : `📍 Inventory by location (${rows.length})`;
      return { sql, explanation: `${title}\n${lines.join("\n")}` };
    }

    // ── 7) Summary / default ─────────────────────────────────────────────────
    const sql = `SELECT COUNT(*) AS "lotCount",
          COUNT(DISTINCT ml.material_id) AS "materialCount",
          COALESCE(SUM(ml.received_qty - COALESCE(ml.reserved_qty, 0)), 0) AS "totalQty",
          COUNT(*) FILTER (WHERE ml.iqc_status IN ('hold','pending')) AS "pendingIqc",
          COUNT(*) FILTER (WHERE ml.iqc_status = 'rejected') AS "rejected"
        FROM material_lots ml
        WHERE ml.lot_status = 'open'`;
    const [sum, byStatus] = await Promise.all([
      query(sql),
      query(`SELECT iqc_status, COUNT(*) AS n FROM material_lots WHERE lot_status='open' GROUP BY iqc_status`),
    ]);
    const r = sum.rows[0];
    const statusLine = byStatus.rows.map((x) => `${x.iqc_status}: ${x.n}`).join(" · ");
    const explanation = zh
      ? `📦 库存总览（实时）\n活跃批次 ${_invNum(r.lotCount)} · 物料 ${_invNum(r.materialCount)} · 可用总量 ${_invNum(r.totalQty)}\nIQC: ${statusLine}\n待检/HOLD ${_invNum(r.pendingIqc)} · 不合格 ${_invNum(r.rejected)}`
      : `📦 Inventory summary (live)\nActive lots ${_invNum(r.lotCount)} · materials ${_invNum(r.materialCount)} · total qty ${_invNum(r.totalQty)}\nIQC: ${statusLine}\npending/HOLD ${_invNum(r.pendingIqc)} · rejected ${_invNum(r.rejected)}`;
    return { sql, explanation };
  } catch (err) {
    console.error("[llm/askInventoryQuery]", err.message);
    return fallback(err.message);
  }
}

export async function askTraceQuery(prompt) {
  return {
    sql: "",
    explanation: "[追溯查询需要更完整的实现]",
  };
}

export async function askReport(params) {
  return { html: "<p>[报表生成需要更完整的实现]</p>" };
}

export async function health() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return { status: "error", model: "none", error: `HTTP ${res.status}` };
    const data = await res.json();
    const models = data.models ?? [];
    const defaultModel = models.find((m) => m.name === DEFAULT_MODEL) ?? models[0];
    return {
      status: "ok",
      model: defaultModel?.name ?? "unknown",
      models: models.map((m) => ({ name: m.name, size: m.size, modified: m.modified_at })),
      reachable: true,
      modelAvailable: !!defaultModel,
    };
  } catch (err) {
    return { status: "error", model: "none", error: err.message, reachable: false, modelAvailable: false, models: [] };
  }
}
