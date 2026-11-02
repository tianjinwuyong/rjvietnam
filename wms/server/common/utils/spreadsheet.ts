import * as XLSX from 'xlsx';
import * as iconv from 'iconv-lite';

/**
 * 统一的表格文件解析入口。
 *
 * 解决的问题：
 * 1. 系统「批量导出」的是 CSV，但导入入口只认 xlsx —— 在这里统一支持 csv/txt。
 * 2. 中文版 Excel 把 CSV「另存为」默认使用 ANSI（GBK/GB18030）编码，
 *    直接用 xlsx 解析会得到乱码表头（"序号" → "ÐòºÅ"），导致列识别失败。
 *    这里先嗅探编码再解析。
 * 3. 有些用户把 xlsx 的后缀改成 .csv，按文件头识别比按扩展名更可靠。
 */

/** 是否为二进制工作簿：xlsx(zip) 或 xls(OLE2) */
function isBinaryWorkbook(buf: Buffer): boolean {
  if (buf.length < 4) return false;
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b; // PK
  const isOle = buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0;
  return isZip || isOle;
}

/** RFC 3629 校验：能否按 UTF-8 严格解码 */
function isValidUtf8(buf: Buffer): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

/**
 * 文本类文件（csv/txt）→ UTF-8 字符串。
 * 顺序：UTF-8 BOM → 严格 UTF-8 校验 → 回退 GB18030（GBK 超集，覆盖简体中文 ANSI）。
 */
export function decodeTextBuffer(buffer: Buffer): string {
  let buf = buffer;
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    buf = buf.subarray(3);
  }
  if (isValidUtf8(buf)) return buf.toString('utf8');
  return iconv.decode(buf, 'gb18030');
}

/**
 * 判断一行是否为「全空行」。
 *
 * Excel 文件尾部常存在有格式但无内容的幽灵行（sheet_to_json 会把它们
 * 一并返回），这类行不应报「xx不能为空」错误，而应直接跳过。
 * 判断标准：该行所有单元格去空格后均为空。
 */
export function isBlankRow(row: unknown): boolean {
  if (!Array.isArray(row)) return true;
  return row.every((cell) => String(cell ?? '').trim() === '');
}

/**
 * 解析上传的表格文件（xlsx / xls / csv / txt），返回工作簿。
 */
export function readWorkbook(buffer: Buffer): XLSX.WorkBook {
  if (isBinaryWorkbook(buffer)) {
    return XLSX.read(buffer, { type: 'buffer' });
  }
  return XLSX.read(decodeTextBuffer(buffer), { type: 'string', raw: false });
}
