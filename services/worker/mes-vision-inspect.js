/**
 * mes-vision-inspect.js — MES Visual Inspection Agent
 *
 * Uses Ollama vision model (minicpm-v4.5:8b) to inspect:
 *   - PCB defects (missing component, tombstone, bridge, misalignment)
 *   - Solder quality (insufficient paste, bridging potential)
 *   - Feeder alignment (material loaded in wrong slot, tape peeling)
 *   - Label verification (material code match vs BOM expectation)
 *
 * Usage:
 *   node mes-vision-inspect.js pcb    --image /path/to/pcb.jpg
 *   node mes-vision-inspect.js solder --image /path/to/spi.jpg
 *   node mes-vision-inspect.js feeder --image /path/to/feeder-bank.jpg
 *   node mes-vision-inspect.js label  --image /path/to/reel-label.jpg
 *
 *   Use --camera to capture from webcam (requires fswebcam/ffmpeg)
 *   Use --url <url> to fetch from IP camera
 */

import { existsSync } from "fs";
import { spawn } from "child_process";

const VISION_MODEL = "minicpm-v4.5:8b";
const OLLAMA_HOST  = "http://localhost:11434";

// ── Task prompts ──────────────────────────────────────────────────────────

const TASK_PROMPTS = {
  pcb: `You are inspecting a PCB (Printed Circuit Board) photo from an SMT production line.
Detect any visible defects and respond with JSON only:
{
  "defect_found": true/false,
  "defect_type": "MISSING_COMPONENT|TOMBSTONE|BRIDGE|MISALIGNMENT|SOLDER_BALL|LIFTED_LEAD|OTHER|NONE",
  "severity": "minor|major|critical",
  "recommendation": "PASS|REWORK|SCRAP",
  "confidence": 0.0-1.0
}`,

  solder: `You are inspecting a solder paste inspection (SPI) image.
Detect solder paste defects and respond with JSON only:
{
  "defect_found": true/false,
  "defect_type": "INSUFFICIENT_PASTE|EXCESS_PASTE|BRIDGING_POTENTIAL|MISSING_PASTE|SHIFTED_PAD|NONE",
  "severity": "minor|major|critical",
  "recommendation": "PASS|REWORK|SCRAP",
  "confidence": 0.0-1.0
}`,

  feeder: `You are inspecting a feeder bank photo from an SMT line.
Check if materials are loaded correctly and respond with JSON only:
{
  "defect_found": true/false,
  "defect_type": "WRONG_SLOT|TAPE_PEELING|EMPTY_FEEDER|MISALIGNED_TAPE|COMPONENT_BRIDGE|NONE",
  "severity": "minor|major|critical",
  "recommendation": "PASS|RELOAD|ADJUST",
  "confidence": 0.0-1.0
}`,

  label: `You are reading a reel label from an SMT material reel.
Extract the information and respond with JSON only:
{
  "defect_found": true/false,
  "defect_type": "LEGIBLE|DAMAGED|MISSING|MISMATCH|NONE",
  "severity": "minor|major|critical",
  "recommendation": "PASS|RELABEL|MANUAL_CHECK",
  "extracted_text": "text read from label",
  "confidence": 0.0-1.0
}`,
};

// ── Capture from camera ─────────────────────────────────────────────────
function captureCamera(outputPath) {
  return new Promise((resolve, reject) => {
    // Try ffmpeg first (Windows DirectShow), fallback to PowerShell
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
  // Read image as base64
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
      prompt: prompt,
      images: [base64Image],
      stream: false,
      options: { temperature: 0.1, num_predict: 256 },
    }),
  });

  if (!res.ok) throw new Error(`Ollama vision error: ${res.status}`);
  const data = await res.json();
  return data.response || "";
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const taskType = process.argv[2];
  if (!taskType || !TASK_PROMPTS[taskType]) {
    console.error(`Usage: node mes-vision-inspect.js [${Object.keys(TASK_PROMPTS).join("|")}] --image <path> | --camera | --url <url>`);
    process.exit(1);
  }

  // Parse options
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

    // Capture or fetch if needed
    if (opts.camera) {
      const tmpPath = `C:/Users/${process.env.USERNAME}/AppData/Local/Temp/mes-vision-capture-${Date.now()}.jpg`;
      imagePath = await captureCamera(tmpPath);
    } else if (opts.url) {
      const tmpPath = `C:/Users/${process.env.USERNAME}/AppData/Local/Temp/mes-vision-url-${Date.now()}.jpg`;
      imagePath = await fetchFromUrl(opts.url, tmpPath);
    }

    if (!imagePath || !existsSync(imagePath)) {
      console.log(JSON.stringify({
        task: taskType,
        error: "File not found",
        _source: imagePath || "none",
        _inspected_at: inspectedAt,
      }));
      process.exit(1);
    }

    const response = await askVision(taskType, imagePath);

    // Parse JSON from response
    let result;
    try {
      // Find JSON in response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      } else {
        result = { defect_found: false, defect_type: "UNKNOWN", recommendation: "MANUAL_CHECK", confidence: 0 };
      }
    } catch {
      result = { defect_found: false, recommendation: "MANUAL_CHECK", raw: response.slice(0, 200) };
    }

    // Add metadata
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
