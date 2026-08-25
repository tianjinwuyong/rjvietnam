/**
 * vision-inspect.js — Visual Inspection Agent
 *
 * Uses minicpm-v4.5:8b (vision LLM) to inspect material photos:
 *   reel count, defect detection, MSD seal integrity, label OCR
 *
 * Usage:
 *   node vision-inspect.js reel    --image <path>    (count components on reel)
 *   node vision-inspect.js defect  --image <path>    (detect defects at IQC)
 *   node vision-inspect.js msd     --image <path>    (check MSD bag seal)
 *   node vision-inspect.js label   --image <path>    (OCR label data)
 *   node vision-inspect.js defect  --camera           (capture from webcam)
 */

import { readFileSync, existsSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OLLAMA_HOST = "http://localhost:11434";
const VISION_MODEL = "minicpm-v4.5:8b";

// ── Argument parsing ────────────────────────────────────────────────────────
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i].startsWith("--")) {
    args[process.argv[i].slice(2)] = process.argv[i + 1] ?? null;
    i++;
  } else if (!process.argv[i].startsWith("-")) {
    args._ = args._ || [];
    args._.push(process.argv[i]);
  }
}

const task = args._[0] ?? "defect";
const imagePath = args.image ?? args.url ?? null;

// ── Image loading ──────────────────────────────────────────────────────────
async function loadImage() {
  if (args.camera) {
    // Attempt to capture from webcam using PowerShell
    const { execSync } = await import("child_process");
    const tmp = join(__dirname, `vision-cam-${Date.now()}.jpg`);
    try {
      execSync(`powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [Windows.Forms.Application]::EnableVisualStyles(); $bmp = New-Object System.Drawing.Bitmap 640,480; [Windows.Forms.Graphics]::FromImage($bmp).Clear([System.Drawing.Color]::Black); $bmp.Save('${tmp.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Jpeg); $bmp.Dispose()"`);
      const buf = readFileSync(tmp);
      return { base64: buf.toString("base64"), format: "jpeg" };
    } catch (e) {
      console.error("Camera capture not available:", e.message);
      process.exit(1);
    }
  }

  if (args.url) {
    // Fetch from IP camera URL
    const res = await fetch(args.url);
    if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
    const buf = await res.arrayBuffer();
    const b64 = Buffer.from(buf).toString("base64");
    const contentType = res.headers.get("content-type") || "image/jpeg";
    const fmt = contentType.includes("png") ? "png" : "jpeg";
    return { base64: b64, format: fmt };
  }

  if (!imagePath) {
    console.error("Usage: vision-inspect.js <task> --image <path> [--url <url>] [--camera]");
    console.error("Tasks: reel, defect, msd, label");
    process.exit(1);
  }

  if (!existsSync(imagePath)) {
    console.error(`Image not found: ${imagePath}`);
    process.exit(1);
  }

  const buf = readFileSync(imagePath);
  const fmt = imagePath.toLowerCase().endsWith(".png") ? "png" : "jpeg";
  return { base64: buf.toString("base64"), format: fmt };
}

// ── Vision LLM call ────────────────────────────────────────────────────────
async function visionPrompt(taskType, imageB64, imageFormat) {
  const prompts = {
    reel: `这是一张SMD贴片料的料条照片。请仔细识别:
1. REEL标签上的lot_no、date code、qty数量
2. 料条上的元件包装数量估算
3. 料条外观是否有损坏、变形、缺失
4. 干燥剂颜色（蓝色=正常，粉色=受潮）

回复JSON（只回复JSON，不要其他文字）:
{"lot_no":"识别到的批次号或null","date_code":"识别到的日期代码或null","label_qty":数字或null,"estimated_remaining_pcs":数字估算,"defect":null|"REEL_DAMAGED"|"TAPE_TORN"|"MISSING_COVER"|"CORRODED"|"OK","desiccant":"blue"|"pink"|null,"confidence":0.0到1.0}`,

    defect: `这是一张SMT来料检验现场照片（IQc检查站）。请仔细检测:
1. 是否有明显的外观缺陷：引脚弯曲(BENT_LEAD)、缺件(MISSING_COMP)、墓碑现象(TOMBSTONE)、桥连(BRIDGE)、冷焊(COLD_SOLDER)、偏移(MISALIGN)
2. 包装是否完整无破损
3. 标签是否清晰可读
4. 元件表面是否有裂纹、氧化、异物

回复JSON（只回复JSON，不要其他文字）:
{"defect_found":true|false,"defect_type":null|"BENT_LEAD"|"MISSING_COMP"|"TOMBSTONE"|"BRIDGE"|"COLD_SOLDER"|"MISALIGN"|"CRACK"|"OXIDATION"|"CONTAMINATION","severity":"critical"|"major"|"minor"|"none","recommendation":"IQC_REJECT"|"IQC_HOLD"|"PASS","confidence":0.0到1.0,"notes":"简短描述所见情况(中文)"}`,

    msd: `这是一张湿度敏感元件（MSD）包装照片。请仔细检查:
1. 防潮袋真空密封是否完好（无破损、无起皱、无明显漏气）
2. 干燥剂颜色（蓝色=正常，粉色=受潮失效）
3. 湿度指示卡是否显示受潮（三个圆圈全部蓝色=正常，任何粉色=失败）
4. MSL标签等级是否与系统记录一致

回复JSON（只回复JSON，不要其他文字）:
{"seal_intact":true|false,"seal_defect":null|"TEAR"|"CREASE"|"HOLE"|"LOOSE_HEAT_SEAL","desiccant":"blue"|"pink"|"mixed"|null,"humidity_indicator":"pass"|"fail"|null,"msd_status":"OK"|"BAKE_REQUIRED"|"REJECT","confidence":0.0到1.0,"notes":"简短说明(中文)"}`,

    label: `这是一张物料标签照片。请OCR识别以下内容:
1. Lot No / 批次号
2. Date Code / 日期代码
3. Qty / 数量
4. Supplier / 供应商
5. MSL Level / 防潮等级
6. Part Number / 料号

回复JSON（只回复JSON，不要其他文字）:
{"lot_no":"识别到的批次号或null","date_code":"日期代码或null","qty":数字或null,"supplier":"供应商名称或null","msd_level":"MSD等级如MSD-3或null","part_number":"料号或null","all_readable":true|false,"confidence":0.0到1.0}`
  };

  const prompt = prompts[taskType] || prompts.defect;

  const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: VISION_MODEL,
      prompt,
      stream: false,
      images: [imageB64],
      options: {
        temperature: 0.01,
        num_predict: 512,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama vision error: ${res.status} — ${text}`);
  }

  const data = await res.json();
  return data.response || "";
}

// ── JSON parser ───────────────────────────────────────────────────────────
function parseVisionResponse(text) {
  // Try direct JSON parse
  try {
    return JSON.parse(text.trim());
  } catch {}

  // Try to extract JSON from markdown code block
  const blockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (blockMatch) {
    try {
      return JSON.parse(blockMatch[1].trim());
    } catch {}
  }

  // Try to find JSON-like object
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      return JSON.parse(objMatch[0]);
    } catch {}
  }

  return { error: "PARSE_FAILED", raw: text.slice(0, 200) };
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.error(`[VISION] Task: ${task} | Loading image...`);

  let imageData;
  try {
    imageData = await loadImage();
  } catch (err) {
    console.error(`[VISION] Image load failed: ${err.message}`);
    process.exit(1);
  }

  console.error(`[VISION] Calling ${VISION_MODEL}...`);
  let response;
  try {
    response = await visionPrompt(task, imageData.base64, imageData.format);
  } catch (err) {
    console.error(`[VISION] LLM call failed: ${err.message}`);
    process.exit(1);
  }

  const result = parseVisionResponse(response);
  result._task = task;
  result._model = VISION_MODEL;
  result._inspected_at = new Date().toISOString();
  if (args.camera) result._source = "camera";
  else if (args.url) result._source = `url:${args.url}`;
  else result._source = `file:${imagePath}`;

  console.log(JSON.stringify(result, null, 2));
}

main().catch(err => {
  console.error(`[VISION] Fatal: ${err.message}`);
  process.exit(1);
});
