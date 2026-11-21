// MES-ruijing 外箱/栈板标签版式（源 tools/print_agent.py 逐语义移植）
//
// 标签尺寸：100 × 150 mm @300dpi
//   op 三类：
//     ["text", x, y, size, text, bold]
//     ["bc",   x, y, height, module, code]     条码（Code39）
//     ["line", x1, y1, x2, y2, thick]
// 同一份 ops 既出 ZPL（实打，走现场打印桥接程序），也出预览图 —— 保证「预览 = 实打」。
//
// ⚠ 预览渲染的差异（相对源）：源用 PIL + Windows arial.ttf 出 PNG，
//   Node 侧没有字体渲染库，故改为 **SVG**（<text> 用浏览器/系统字体）。
//   版式（坐标/字号/条码/分隔线）完全一致，只是栅格化后端不同。
import { readFileSync } from "node:fs";
import { inflateSync, constants } from "node:zlib";

export const LABEL_W = 1181;
export const LABEL_H = 1772;
export const MARGIN = 40;
export const SN_PER_PAGE = 48;
export const SN_COLS = 4;
export const SN_ROWS = 12;
export const SN_COLS_X = [40, 330, 620, 910];

/** 外箱标签版式（源 _pages_box）：按 BT 模板 EPS18R1G-36 TEST.btw 的实际结构 */
export function pagesBox(p, withLabel1 = false) {
  const pages = [];
  const boxNo = p.box_no || p.ref_no || "";
  const model = p.machine_model || "";
  const qty = p.qty;
  const wl = p.wireline_sku || "";
  const cs = p.consumer_sku || "";
  const dom = p.date_of_mfg || "";
  const reprint = p.reprint ? "   (REPRINT)" : "";
  const snPages = (p.sn_pages && p.sn_pages.length) ? p.sn_pages : [p.sns || []];
  const total = Math.max(1, snPages.length);

  // ---- Carton Label 1（可选：只有箱码与机型信息，旧规格里的 "1 page/carton"）----
  if (withLabel1) {
    pages.push([
      ["text", MARGIN, 30, 30, `${model}   Carton Label 1${reprint}`, true],
      ["line", MARGIN, 76, LABEL_W - MARGIN, 76, 3],
      ["bc", 60, 120, 220, 3, boxNo],
      ["text", 60, 400, 30, "CARTON SERIES:", false],
      ["text", 60, 440, 44, boxNo, true],
      ["line", 60, 520, LABEL_W - 60, 520, 2],
      ["text", 60, 545, 24, "Manufacture: NetBit", false],
      ["text", 60, 585, 24, `Model: ${model}`, false],
      ["text", 60, 625, 24, `Description: Power Supply, ${model}`, false],
      ["text", 60, 665, 24, `Wireline SKU: ${wl}    Consumer SKU: ${cs}`, false],
      ["text", 60, 705, 24, `Quantity: ${qty}    Date of Mfg: ${dom}`, false],
      ["text", 60, 745, 24, "Carton Weight(LBS): __________ LBS", false],
      ["line", 60, 800, LABEL_W - 60, 800, 2],
      ["text", 60, 1600, 26, "MADE IN VIETNAM", true],
      ["text", 60, 1690, 18, `Printed ${p.printed_at || ""} by MES`, false],
    ]);
  }

  // ---- 主标签：上半信息 + 48 个 SN 条码 ----
  snPages.forEach((sns, i) => {
    const ops = [
      ["text", MARGIN, 24, 24, `${model}   Carton Label 2-P${i + 1}   ${boxNo}${reprint}`, true],
      ["line", MARGIN, 62, LABEL_W - MARGIN, 62, 2],

      // 固定文字块（与 BT 模板一致）
      ["text", 60, 78, 20, "Manufacture: NetBit", false],
      ["text", 60, 108, 20, `Model: ${model}`, false],
      ["text", 60, 138, 20, `Description: Power Supply, AT&T part ${model}, NetBit part ${model}`, false],
      ["text", 60, 168, 20, "Carton Weight(LBS):                 LBS", false],

      // 第一行字段：Wireline SKU / Carton Series(箱码)
      ["text", 60, 210, 15, "Wireline SKU", false],
      ["bc", 60, 228, 40, 1, wl],
      ["text", 60, 272, 15, wl, false],

      ["text", 700, 210, 15, "Carton Series", false],
      ["bc", 700, 228, 40, 1, boxNo],
      ["text", 700, 272, 15, boxNo, false],

      // 第二行字段：Consumer SKU / Quantity / Date of Mfg
      ["text", 60, 300, 15, "Consumer SKU", false],
      ["bc", 60, 318, 40, 1, cs],
      ["text", 60, 362, 15, cs, false],

      ["text", 470, 300, 15, "Quantity", false],
      ["bc", 470, 318, 40, 1, String(qty)],
      ["text", 470, 362, 15, String(qty), false],

      ["text", 860, 300, 15, "Date of Mfg", false],
      ["bc", 860, 318, 40, 1, dom],
      ["text", 860, 362, 15, dom, false],

      ["line", 40, 388, LABEL_W - 40, 388, 2],
    ];

    // 48 个 SN 条码：4 列 × 12 行
    (sns || []).slice(0, SN_PER_PAGE).forEach((sn, k) => {
      const r = Math.floor(k / SN_COLS), c = k % SN_COLS;
      if (r >= SN_ROWS) return;
      const x = SN_COLS_X[c];
      const y = 396 + r * 106;
      ops.push(["bc", x, y, 70, 1, sn]);
      ops.push(["text", x, y + 74, 15, `SN/: ${sn}`, false]);
    });

    ops.push(["line", 40, 1690, LABEL_W - 40, 1690, 2]);
    ops.push(["text", 60, 1700, 18, `Page ${i + 1} of ${total}    ${(sns || []).length} SN`, false]);
    ops.push(["text", 820, 1700, 18, (p.printed_at || "").slice(0, 19), false]);
    pages.push(ops);
  });
  return pages;
}

/** 栈板标签版式（源 _pages_pallet） */
export function pagesPallet(p) {
  const pages = [];
  const pal = p.pallet_no || p.ref_no || "";
  const model = p.machine_model || "";
  const cartons = p.cartons || [];
  const perPage = 24;
  const chunks = [];
  const src = cartons.length ? cartons : [[]];
  for (let i = 0; i < src.length; i += perPage) chunks.push(src.slice(i, i + perPage));
  if (!chunks.length) chunks.push([]);
  chunks.forEach((chunk, i) => {
    const ops = [
      ["text", MARGIN, 30, 32, `PALLET LABEL   ${model}`, true],
      ["line", MARGIN, 80, LABEL_W - MARGIN, 80, 3],
      ["bc", 60, 110, 170, 3, pal],
      ["text", 60, 340, 40, pal, true],
      ["line", 60, 410, LABEL_W - 60, 410, 2],
      ["text", 60, 430, 24, `Ship To: ${p.ship_to || ""}`, false],
      ["text", 60, 465, 24, `Sub: ${p.subordinate_name || ""}    PO: ${p.sub_po || p.po_no || ""}`, false],
      ["text", 60, 500, 24, `Cartons: ${p.carton_count}    Qty: ${p.total_qty}    Pallet No.: ${p.pallet_no_seq || ""}`, false],
      ["line", 60, 545, LABEL_W - 60, 545, 2],
      ["text", 60, 560, 22, "CARTON ID", true],
      ["text", 720, 560, 20, "QTY", true],
    ];
    chunk.forEach((ct, k) => {
      const y = 600 + k * 44;
      ops.push(["text", 60, y, 20, String(ct.box_no || ""), false]);
      ops.push(["text", 740, y, 20, String(ct.qty || ""), false]);
    });
    ops.push(["line", 60, 1690, LABEL_W - 60, 1690, 2]);
    ops.push(["text", 60, 1700, 20, `Page ${i + 1} of ${chunks.length}`, false]);
    pages.push(ops);
  });
  return pages;
}

/** 源 build_pages */
export function buildPages(payload, withLabel1 = false) {
  if (payload.ref_type === "pallet" || payload.pallet_no) return pagesPallet(payload);
  return pagesBox(payload, withLabel1);
}

function zplEscape(s) {
  return String(s || "").replace(/\^/g, "").replace(/~/g, "");
}

/** 源 to_zpl：给现场打印桥接程序（Zebra 打印机）用 */
export function toZpl(pages) {
  const out = [];
  for (const ops of pages) {
    out.push(`^XA^CI28^PW${LABEL_W}^LL${LABEL_H}^LH0,0`);
    for (const op of ops) {
      if (op[0] === "text") {
        const [, x, y, size, text, bold] = op;
        const w = size + (bold ? 2 : 0);
        out.push(`^FO${x},${y}^A0N,${size},${w}^FD${zplEscape(text)}^FS`);
      } else if (op[0] === "bc") {
        const [, x, y, h, mod, code] = op;
        out.push(`^FO${x},${y}^BY${mod},3,${h}^BCN,${h},N,N,N^FD${zplEscape(code)}^FS`);
      } else if (op[0] === "line") {
        const [, x1, y1, x2, y2, t] = op;
        out.push(`^FO${x1},${y1}^GB${Math.max(1, x2 - x1)},${Math.max(1, y2 - y1)},${t}^FS`);
      }
    }
    out.push("^XZ");
  }
  return out.join("\r\n");
}

/**
 * 读出 .btw 里声明的提示字段名（按出现顺序，去重）—— 源 print_agent.read_template_prompts。
 * .btw 是 zip 容器，但源没有用 zip 库：直接扫 zlib 流头（0x78 0x01/0x9C/0xDA），
 * 逐段尝试解压，取正文最长的一段，再按 UTF-16LE 解码后正则取「Screen Data」后的字段名。
 * Node 有内置 zlib，逻辑可原样移植。
 */
export function readTemplatePrompts(filePath) {
  const data = readFileSync(filePath);
  let body = null;
  for (let i = 0; i < Math.min(data.length, 300000) - 2; i++) {
    if (data[i] === 0x78 && [0x01, 0x9C, 0xDA].includes(data[i + 1])) {
      try {
        const out = inflateSync(data.subarray(i, i + 4000000), { finishFlush: constants.Z_SYNC_FLUSH });
        if (!body || out.length > body.length) body = out;
      } catch { /* 不是 zlib 块，跳过 */ }
    }
  }
  if (!body) throw new Error(`读不懂模板（没有可解压的正文）：${filePath}`);
  const t = body.toString("utf16le");
  const pat = /Screen Data[\s\S]{0,60}?[﻿￮][\u00FF-\uFFFF]([A-Za-z_][A-Za-z0-9_]{1,30})/g;
  const names = [];
  let m;
  while ((m = pat.exec(t)) !== null) {
    if (!names.includes(m[1])) names.push(m[1]);
  }
  return names;
}

// Code39 码表（源 print_agent.CODE39）
const CODE39 = {
  "0": "101001101101", "1": "110100101011", "2": "101100101011", "3": "110110010101",
  "4": "101001101011", "5": "110100110101", "6": "101100110101", "7": "101001011011",
  "8": "110100101101", "9": "101100101101", "A": "110101001011", "B": "101101001011",
  "C": "110110100101", "D": "101011001011", "E": "110101100101", "F": "101101100101",
  "G": "101010011011", "H": "110101001101", "I": "101101001101", "J": "101011001101",
  "K": "110101010011", "L": "101101010011", "M": "110110101001", "N": "101011010011",
  "O": "110101101001", "P": "101101101001", "Q": "101010110011", "R": "110101011001",
  "S": "101101011001", "T": "101011011001", "U": "110010101011", "V": "100110101011",
  "W": "110011010101", "X": "100101101011", "Y": "110010110101", "Z": "100110110101",
  "-": "100101011011", ".": "110010101101", " ": "100110101101", "$": "100100100101",
  "/": "100100101001", "+": "100101001001", "%": "101001001001", "*": "100101101101",
};

/** 源 code39_bits */
export function code39Bits(s) {
  let bits = CODE39["*"];
  for (const ch of String(s || "").toUpperCase()) {
    bits += (CODE39[ch] || CODE39["-"]) + "0";
  }
  bits += CODE39["*"];
  return bits;
}

function escXml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/**
 * 预览图渲染（源 render_png 的 SVG 版）。
 * 版式坐标/字号与源一致；条码按源的逐位绘制逻辑（预览用，非打印用）。
 * 返回 SVG 字符串（可直接 data:image/svg+xml;base64 交给 <img>）。
 */
export function renderSvg(pages, scale = 1) {
  const W = Math.round(LABEL_W * scale);
  const H = Math.round(LABEL_H * scale);
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${LABEL_W} ${LABEL_H}">`);
  parts.push(`<rect x="0" y="0" width="${LABEL_W}" height="${LABEL_H}" fill="#ffffff"/>`);
  for (const ops of pages) {
    for (const op of ops) {
      if (op[0] === "text") {
        const [, x, y, size, text, bold] = op;
        // 源 PIL 的 text 默认锚点是「左上」，SVG 的 y 是基线 → 下移约 0.85em
        const baseline = y + size * 0.85;
        parts.push(`<text x="${x}" y="${baseline.toFixed(1)}" font-family="Arial, Helvetica, sans-serif" ` +
          `font-size="${size}"${bold ? ' font-weight="bold"' : ""} fill="#000000">${escXml(text)}</text>`);
      } else if (op[0] === "bc") {
        const [, x, y, h, mod, code] = op;
        const bits = code39Bits(code);
        const bw = Math.max(1, Math.round(mod * scale));
        let cx = x * scale;
        for (let i = 0; i < bits.length; i++) {
          if (i % 2 === 0) {              // 条
            if (bits[i] === "1") {
              parts.push(`<rect x="${cx.toFixed(2)}" y="${(y * scale).toFixed(2)}" ` +
                `width="${(bw - 1).toFixed(2)}" height="${(h * scale).toFixed(2)}" fill="#000000"/>`);
            }
            cx += bw;
          } else if (bits[i] === "1") {   // 空
            cx += bw;
          }
        }
      } else if (op[0] === "line") {
        const [, x1, y1, x2, y2, t] = op;
        parts.push(`<rect x="${(x1 * scale).toFixed(2)}" y="${(y1 * scale).toFixed(2)}" ` +
          `width="${((x2 - x1) * scale).toFixed(2)}" ` +
          `height="${((y2 - y1) * scale + Math.max(1, t * scale)).toFixed(2)}" fill="#000000"/>`);
      }
    }
  }
  parts.push("</svg>");
  return parts.join("");
}
