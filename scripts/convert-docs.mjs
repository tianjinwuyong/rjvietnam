/**
 * Convert source factory documents (dc/) to Markdown.
 * Handles: .doc, .docx, .pdf, .xlsx
 *
 * Usage: node scripts/convert-docs.mjs
 */

import fs from "fs";
import path from "path";
import { createRequire } from "module";
import mammoth from "mammoth";

const require = createRequire(import.meta.url);
const WordExtractor = require("word-extractor");
const { PDFParse } = require("pdf-parse");
const XLSX = require("xlsx");

const DC_DIR = path.resolve("..", "dc");
const OUT_DIR = path.resolve("..", "dc", "_md");

async function ensureDir(dir) {
  await fs.promises.mkdir(dir, { recursive: true });
}

function nameWithoutExt(file) {
  const base = path.basename(file);
  // Strip all extensions (e.g. .docx2025.docx → strip both)
  const noExt = base.replace(/\.[^.]+$/, "");
  // Clean up common debris
  return noExt.replace(/\(\d+\)$/, "").replace(/[.]+$/, "").trim();
}

// ── .doc (old OLE2 format) ──────────────────────────────────────────
async function convertDoc(filePath) {
  const extractor = new WordExtractor();
  const extracted = await extractor.extract(filePath);
  return extracted.getBody();
}

// ── .docx ───────────────────────────────────────────────────────────
async function convertDocx(filePath) {
  const buffer = await fs.promises.readFile(filePath);
  const result = await mammoth.convertToMarkdown({ buffer });
  return result.value;
}

// ── .pdf ────────────────────────────────────────────────────────────
async function convertPdf(filePath) {
  const buffer = await fs.promises.readFile(filePath);
  const parser = new PDFParse({ data: buffer, verbosity: 0 });
  await parser.load();
  const result = await parser.getText();
  parser.destroy();
  return result?.text ?? "";
}

// ── .xlsx ───────────────────────────────────────────────────────────
async function convertXlsx(filePath) {
  const workbook = XLSX.readFile(filePath);
  const parts = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet || !sheet["!ref"]) continue; // empty sheet
    const json = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    if (!json || json.length === 0) continue;

    parts.push(`## Sheet: ${sheetName}\n`);

    // Find max column width per row for padding
    for (let i = 0; i < json.length; i++) {
      const row = json[i];
      if (!row || row.length === 0) continue;

      // Filter out completely empty rows
      const hasContent = row.some((cell) => cell !== undefined && cell !== null && cell !== "");
      if (!hasContent) continue;

      const cells = row.map((cell) =>
        cell === undefined || cell === null ? "" : String(cell).trim(),
      );
      parts.push(`| ${cells.join(" | ")} |`);
    }
    parts.push("");
  }

  return parts.join("\n");
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  await ensureDir(OUT_DIR);

  const files = await fs.promises.readdir(DC_DIR);
  const docFiles = files.filter((f) => /\.(docx?|pdf|xlsx?)$/i.test(f));

  for (const file of docFiles) {
    // Skip our own output
    if (file.startsWith("_")) continue;

    const filePath = path.join(DC_DIR, file);
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) continue;

    const ext = path.extname(file).toLowerCase();
    const outName = nameWithoutExt(file).replace(/[\s_]+/g, "-") + ".md";
    const outPath = path.join(OUT_DIR, outName);

    // Skip if already converted and source is older
    if (fs.existsSync(outPath)) {
      const outStat = fs.statSync(outPath);
      if (outStat.mtime > stat.mtime) {
        console.log(`  SKIP  ${file} → ${outName} (up to date)`);
        continue;
      }
    }

    console.log(`  CONV  ${file} → ${outName}`);

    try {
      let mdContent;
      switch (ext) {
        case ".doc": {
          // Check if it's actually .docx in disguise
          const buf = await fs.promises.readFile(filePath);
          const isZip =
            buf[0] === 0x50 && buf[1] === 0x4b; // PK\x03\x04
          if (isZip) {
            mdContent = await convertDocx(filePath);
          } else {
            mdContent = await convertDoc(filePath);
          }
          break;
        }
        case ".docx":
          mdContent = await convertDocx(filePath);
          break;
        case ".pdf":
          mdContent = await convertPdf(filePath);
          break;
        case ".xlsx":
        case ".xls":
          mdContent = await convertXlsx(filePath);
          break;
        default:
          console.log(`  SKIP  ${file} (unsupported: ${ext})`);
          continue;
      }

      const frontmatter = `---
source: ${file}
---
\n\n`;
      await fs.promises.writeFile(outPath, frontmatter + mdContent.trim(), "utf-8");
    } catch (err) {
      console.error(`  FAIL  ${file}: ${err.message}`);
    }
  }

  console.log("\nDone. Markdown files in dc/_md/");
}

main().catch(console.error);
