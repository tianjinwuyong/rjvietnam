/**
 * wms-vision-inspect.js — WMS Visual Inspection Agent
 *
 * Uses Ollama vision model (minicpm-v4.5:8b) to inspect:
 *   - Reel label OCR (lot no, date code, qty, MSL level)
 *   - MSD seal integrity (vacuum seal, humidity indicator, desiccant)
 *   - Receiving package condition (packaging damage, labeling)
 *   - IQC defect detection (component damage, packaging issues)
 *   - Label mismatch vs expected PO/delivery note
 *
 * Usage:
 *   node wms-vision-inspect.js reel       --image /path/to/reel.jpg
 *   node wms-vision-inspect.js msd-seal   --image /path/to/bag-seal.jpg
 *   node wms-vision-inspect.js label      --image /path/to/label.jpg
 *   node wms-vision-inspect.js receiving  --image /path/to/package.jpg
 *   node wms-vision-inspect.js iqc        --image /path/to/iqc-photo.jpg
 *
 *   Use --camera to capture from webcam
 *   Use --url <url> to fetch from IP camera
 */

import { existsSync } from "fs";
import { spawn } from "child_process";

const VISION_MODEL = "minicpm-v4.5:8b";
const OLLAMA_HOST  = "http://localhost:11434";

// ── Task prompts ──────────────────────────────────────────────────────────

const TASK_PROMPTS = {
  reel: `You are reading an SMD reel label from a warehouse receiving context.
Inspect the label in the image and extract the following information.
Respond ONLY with this JSON block:
{
  "lot_no": "extracted lot number",
  "material_code": "extracted material/part number",
  "qty": "extracted quantity",
  "date_code": "extracted date code or MFD date",
  "msd_level": "extracted MSL level (e.g. 3, 4, 5, 6) or null if not visible",
  "supplier_code": "supplier code if visible",
  "confidence": 0.0-1.0,
  "defect_found": true/false,
  "defect_type": "NONE|UNREADABLE|MISSING_FIELD|MISMATCH",
  "recommendation": "PASS|FAIL|MANUAL_CHECK"
}`,

  "msd-seal": `You are inspecting the seal of an MSD (Moisture Sensitive Device) package bag.
Check for: vacuum seal integrity, humidity indicator card color (pink=wet, blue=dry), and desiccant packet condition.
Respond ONLY with this JSON block:
{
  "seal_intact": true/false,
  "humidity_indicator": "PINK|WET|BLUE|DRY|NONE",
  "desiccant_ok": true/false,
  "defect_found": true/false,
  "defect_type": "NONE|BROKEN_SEAL|HUMIDITY_INDICATOR_PINK|DESICCANT_MISSING|BAG_TORN|MOISTURE_DETECTED",
  "severity": "minor|major|critical",
  "recommendation": "PASS|BAKE|REJECT|HOLD",
  "confidence": 0.0-1.0,
  "_inspected_at": "<ISO timestamp>"
}`,

  label: `You are reading a material reel label from an SMT warehouse.
Extract lot_no, material code, quantity, date code, and MSL level.
Respond ONLY with this JSON block:
{
  "lot_no": "extracted lot number",
  "material_code": "extracted material code",
  "qty": "extracted quantity as number",
  "date_code": "extracted date code",
  "msd_level": "MSL level or null",
  "supplier": "supplier name if visible",
  "confidence": 0.0-1.0,
  "defect_found": true/false,
  "defect_type": "NONE|UNREADABLE|MISSING_PARTIAL|MISMATCH_WITH_EXPECTED",
  "recommendation": "PASS|RELABEL|MANUAL_CHECK"
}`,

  receiving: `You are inspecting an incoming delivery package or pallet at a warehouse receiving dock.
Check for: packaging damage, correct labeling, correct quantity markers, and any obvious issues.
Respond ONLY with this JSON block:
{
  "packaging_ok": true/false,
  "labels_ok": true/false,
  "quantity_ok": true/false,
  "defect_found": true/false,
  "defect_type": "NONE|PACKAGE_DAMAGED|INCORRECT_LABEL|MISSING_LABEL|QUANTITY_MISMATCH|DIRTY|OVERSIZED|UNDERSPECIFIED",
  "severity": "minor|major|critical",
  "recommendation": "ACCEPT|REJECT|HOLD|PARTIAL",
  "confidence": 0.0-1.0,
  "notes": "free text observations"
}`,

  iqc: `You are inspecting a material sample at IQC (Incoming Quality Control) in an SMT factory warehouse.
Detect any visible defects: bent component legs, missing parts, damaged reels, incorrect packaging, or label mismatches.
Respond ONLY with this JSON block:
{
  "defect_found": true/false,
  "defect_type": "NONE|BENT_LEADS|MISSING_COMPONENT|REEL_DAMAGED|LABEL_MISMATCH|PACKAGING_BROKEN|DESICCANT_PINK|EXPIRED_DATE|MIXED_LOT",
  "severity": "minor|major|critical",
  "recommendation": "PASS|HOLD|REJECT",
  "confidence": 0.0-1.0,
  "notes": "brief description of what was observed"
}`,
};

// ── Camera capture ────────────────────────────────────────────────────────
function captureCamera(outputPath) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-f", "dshow",
      "-i", "video=USB Camera",
      "-vframes", "1",
      "-y", outputPath,
    ], { stdio: ["ignore", "pipe", "pipe"], timeout: 10000 });

    let err = "";
    child.stderr.on("data", d => (err += d));
    child.on("close", code => {
      if (code === 0 && existsSync(outputPath)) resolve(outputPath);
      else reject(new Error(`Camera capture failed: ${err.slice(-200)}`));
    });
    child.on("error", reject);
  });
}

// ── Fetch from IP camera ────────────────────────────────────────────────
async function fetchFromUrl(url, outputPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const { writeFileSync } = await import("fs");
  writeFileSync(outputPath, buffer);
  return outputPath;
}

// ── Call Ollama vision ──────────────────────────────────────────────────
async function askVision(taskType, imagePath) {
  const { readFileSync } = await import("fs");
  const imageBuffer = readFileSync(imagePath);
  const base64Image = imageBuffer.toString("base64");

  const prompt = TASK_PROMPTS[taskType];
  if (!prompt) throw new Error(`Unknown task type: ${taskType}`);

  const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: VISION_MODEL,
      prompt,
      images: [base64Image],
      stream: false,
      options: { temperature: 0.1, num_predict: 256 },
    }),
  });

  if (!res.ok) throw new Error(`Ollama vision error: ${res.status}`);
  const data = await res.json();
  return data.response || "";
}

// ── Parse JSON from LLM response ────────────────────────────────────────
function parseResponse(response) {
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]); } catch (_) {}
  }
  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const taskType = process.argv[2];
  if (!taskType || !TASK_PROMPTS[taskType]) {
    console.error(`Usage: node wms-vision-inspect.js [${Object.keys(TASK_PROMPTS).join("|")}] --image <path> | --camera | --url <url>`);
    process.exit(1);
  }

  const opts = {};
  for (let i = 3; i < process.argv.length; i++) {
    if (process.argv[i].startsWith("--")) {
      const key = process.argv[i].slice(2);
      opts[key] = process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
        ? process.argv[i + 1] : true;
      if (opts[key] !== true) i++;
    }
  }

  const inspectedAt = new Date().toISOString();

  try {
    let imagePath = opts.image;

    if (opts.camera) {
      const tmpPath = `C:/Users/${process.env.USERNAME}/AppData/Local/Temp/wms-vision-${Date.now()}.jpg`;
      imagePath = await captureCamera(tmpPath);
    } else if (opts.url) {
      const tmpPath = `C:/Users/${process.env.USERNAME}/AppData/Local/Temp/wms-vision-url-${Date.now()}.jpg`;
      imagePath = await fetchFromUrl(opts.url, tmpPath);
    }

    if (!imagePath || !existsSync(imagePath)) {
      console.log(JSON.stringify({
        task: taskType,
        error: "image file not found",
        _source: imagePath || "none",
        _inspected_at: inspectedAt,
      }));
      process.exit(1);
    }

    const response = await askVision(taskType, imagePath);
    const parsed = parseResponse(response);

    const result = parsed || {
      defect_found: false,
      defect_type: "PARSE_ERROR",
      recommendation: "MANUAL_CHECK",
      confidence: 0,
      _raw_response: response.slice(0, 200),
    };

    result.task = taskType;
    result._source = `file:${imagePath}`;
    result._inspected_at = inspectedAt;

    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.log(JSON.stringify({
      task: taskType,
      error: err.message,
      _inspected_at: inspectedAt,
    }));
    process.exit(1);
  }
}

main();
