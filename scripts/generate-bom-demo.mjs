// Extract full BOM demo data from 002_bom_seed.sql → TypeScript file
import { readFileSync, writeFileSync } from 'fs';

const sql = readFileSync(
  new URL('../database/seeds/002_bom_seed.sql', import.meta.url),
  'utf8'
);
const lines = sql.split('\n');

// ── 1. Parse materials ─────────────────────────────────────────────
const materials = new Map();
let inMaterials = false;
for (const line of lines) {
  if (line.includes("insert into materials")) { inMaterials = true; continue; }
  if (!inMaterials) continue;
  if (line.trim() === '') continue;
  if (line.startsWith('--')) break;

  const m = line.match(/\('([^']+)',\s*'([^']*)',\s*'([^']*)',\s*'([^']*)'/);
  if (m) {
    materials.set(m[1], { zh: m[2], en: m[3], vi: m[4] });
  }
}

console.log(`Found ${materials.size} unique materials`);

// ── 2. Parse BOM lines per product ─────────────────────────────────
function extractProductBom(lines, startIdx) {
  const result = [];
  let currentRefDes = '';
  let currentQty = 1.0;
  let i = startIdx;
  let nextProdPattern = false;

  for (; i < lines.length; i++) {
    const line = lines[i];

    // Check for next product block
    if (line.includes("select id into v_pid from products where code =") && i > startIdx + 20) {
      nextProdPattern = true;
      break;
    }
    if ((line.includes("end;") && line.includes("$$;")) || line.startsWith('commit')) {
      break;
    }

    // Extract reference_designators and qty_per: ('refDes', qty)
    const refMatch = line.match(/'([^']*)',\s*([\d.]+)\s*\)/);
    if (refMatch) {
      currentRefDes = refMatch[1];
      currentQty = parseFloat(refMatch[2]);
    }

    // Extract material code from "where code = 'XXXX'"
    const codeMatch = line.match(/where code = '([^']+)'/);
    if (codeMatch) {
      result.push({ code: codeMatch[1], refDes: currentRefDes, qtyPer: currentQty });
    }
  }

  return { lines: result, endIdx: i, nextProdPattern };
}

const productConfigs = [
  { search: "code = 'B2672111-001'", prodCode: 'B2672111-001', rev: 'V0.5' },
  { search: "code = 'EPS18R1G'", prodCode: 'EPS18R1G', rev: 'V1.5' },
  { search: "code = 'EPS48R1-36'", prodCode: 'EPS48R1-36', rev: 'V1.8' },
];

const products = [];

for (const cfg of productConfigs) {
  const startIdx = lines.findIndex(l => l.includes(cfg.search));
  if (startIdx < 0) { console.error(`Product ${cfg.prodCode} not found!`); continue; }
  const { lines: bomLines } = extractProductBom(lines, startIdx + 40);
  products.push({
    code: cfg.prodCode,
    rev: cfg.rev,
    lines: bomLines,
    materialCount: bomLines.length,
  });
  console.log(`${cfg.prodCode}: ${bomLines.length} material lines`);
}

// ── 3. Generate TypeScript output ──────────────────────────────────
function escapeJs(s) {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '');
}

function jsonStringifyArr(arr) {
  return '[' + arr.map(s => `'${escapeJs(s)}'`).join(', ') + ']';
}

let ts = `// Auto-generated from database/seeds/002_bom_seed.sql — DO NOT EDIT BY HAND
import type { Bom, BomLine } from "../../../../packages/shared-types/src/factory";

export interface DemoBomLine {
  id: number | string;
  materialCode: string;
  materialNameZh: string;
  materialNameEn: string;
  materialNameVi: string;
  qtyPer: number;
  lossRate: number;
  referenceDesignators: string[];
}

export type DemoBom = Bom & { lines: DemoBomLine[] };

`;

let lineId = 1;
const productNames = {
  'B2672111-001': { zh: '海翼A2672 CD版 1C 100WGaN插墙式电源适配器黑色（US版）', en: 'Anker A2672 CD 1C 100W GaN Wall Charger Black (US)', vi: 'Anker A2672 CD 1C 100W GaN Sạc tường Đen (Mỹ)' },
  'EPS18R1G': { zh: 'NBT 12V1.5A美规插墙式电源适配器冷灰色 AI版', en: 'NBT 12V1.5A US Wall Adapter Cool Gray AI', vi: 'NBT 12V1.5A Sạc tường Mỹ Xám lạnh AI' },
  'EPS48R1-36': { zh: 'NBT 12V4A美规桌面式电源适配器冷灰色 AI版', en: 'NBT 12V4A US Desktop Adapter Cool Gray AI', vi: 'NBT 12V4A Bộ đổi nguồn để bàn Mỹ Xám lạnh AI' },
};

for (const prod of products) {
  const safeName = 'bom_' + prod.code.replace(/[^a-zA-Z0-9]/g, '_') + '_lines';
  ts += `export const ${safeName}: DemoBomLine[] = [\n`;
  for (const bl of prod.lines) {
    const mat = materials.get(bl.code);
    const nameZh = mat ? escapeJs(mat.zh) : escapeJs(bl.code);
    const nameEn = mat ? escapeJs(mat.en) : escapeJs(bl.code);
    const nameVi = mat ? escapeJs(mat.vi) : escapeJs(bl.code);
    const refDes = bl.refDes && bl.refDes !== 'null' && bl.refDes !== ''
      ? bl.refDes.split(',').map(s => s.trim())
      : [];
    const refArray = jsonStringifyArr(refDes);
    ts += `  { id: ${lineId}, materialCode: '${escapeJs(bl.code)}', materialNameZh: '${nameZh}', materialNameEn: '${nameEn}', materialNameVi: '${nameVi}', qtyPer: ${bl.qtyPer}, lossRate: 0, referenceDesignators: ${refArray} },\n`;
    lineId++;
  }
  ts += `];\n\n`;
}

// Generate the demo store
ts += `export type DemoBomProduct = {\n`;
ts += `  bom: DemoBom;\n`;
ts += `  productId: string;\n`;
ts += `};\n\n`;

ts += `export const demoBoms: DemoBomProduct[] = [\n`;
for (const prod of products) {
  const safeName = 'bom_' + prod.code.replace(/[^a-zA-Z0-9]/g, '_') + '_lines';
  const n = productNames[prod.code];
  const pid = prod.code === 'B2672111-001' ? '1' : prod.code === 'EPS18R1G' ? '2' : '3';
  ts += `  {
    bom: {
      id: "${prod.code}-ref",
      productId: "${pid}",
      productCode: "${prod.code}",
      productNameZh: "${escapeJs(n.zh)}",
      productNameEn: "${escapeJs(n.en)}",
      productNameVi: "${escapeJs(n.vi)}",
      revision: "${prod.rev}",
      status: "active",
      materialCount: ${prod.materialCount},
      lineCount: ${prod.lines.length},
      lines: ${safeName},
    },
    productId: "${pid}",
  },\n`;
}
ts += `];\n`;

const outPath = new URL('../apps/web/src/api/bom-demo-data.ts', import.meta.url);
writeFileSync(outPath, ts, 'utf8');
console.log(`\n✅ Generated ${outPath.pathname} (${(ts.length / 1024).toFixed(0)} KB)`);
