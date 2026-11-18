// ============================================================
// 体系文件正文导入（docx → 保真 HTML）
// ------------------------------------------------------------
// 为什么单独开一个接口而不是继续在前端用 mammoth：
//   mammoth 只保留语义（p/h1/table），字号/字体/颜色/对齐/缩进/行距/单元格边框全部丢弃，
//   121 页的质量环境手册导入后变成「一样大小的黑字」，用户 2026-10-30 判定不可用。
//   保真转换需要读 OOXML 的 w:pPr / w:rPr / w:tblPr / w:tcPr，逻辑量在 600 行以上，
//   放服务端还有个好处：Node 有 jszip，不必给浏览器再塞一个解压实现。
//
// 入参：请求体就是 .docx 原始字节（application/octet-stream），前端直接 POST arrayBuffer。
//       —— 不走 multipart，因为前端手上只有 ArrayBuffer，且文件可能来自本地选择而非已上传。
// 出参：{ code:0, data:{ html, stats, warnings } }
//
// 2026-11-06 增：`/api/doc-import/xlsx` —— Excel 表单（体系文件四级表单 30 份都是 xlsx）
//   同样需要「能在正文里直接看」，而不是只给一句"以附件原件为准"。产出与 docx 一样是
//   内联样式的 HTML 片段，合并单元格还原成 rowspan/colspan。
//
// 鉴权：登录即可。转换是纯计算、不落库、不读业务数据，故不额外加权限码。
// ============================================================
import { authenticate, ok, fail, wrap } from '../middleware/index.js';
import { docxToHtml } from '../services/docx-import.js';
import { xlsxToHtml } from '../services/xlsx-import.js';

const MAX_BYTES = 40 * 1024 * 1024;   // 40MB，正常体系文件远小于此

export default async function docImportRoutes(app) {
  // 原始二进制 body：包一层 Buffer 解析器（只在本插件作用域内生效）
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (req, body, done) => {
    done(null, body);
  });

  app.post('/api/doc-import/docx', wrap(async (req, reply) => {
    await authenticate(req, reply);
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length < 4) {
      return fail(reply, 400, '未收到文件内容');
    }
    if (buf.length > MAX_BYTES) {
      return fail(reply, 413, `文件超过 ${MAX_BYTES / 1024 / 1024}MB`);
    }
    // 只认 ZIP（docx 是 zip 容器），避免把别的文件喂进解压
    if (buf[0] !== 0x50 || buf[1] !== 0x4b) {
      return fail(reply, 400, '不是有效的 .docx 文件');
    }
    const r = await docxToHtml(buf);
    return ok(reply, {
      html: r.html,
      pages: r.pages,
      pageSetup: r.pageSetup,
      stats: r.stats,
      warnings: r.warnings,
    }, '已转换');
  }));

  // Excel 表单 → 内联样式 HTML 表格（xlsx / xlsm）
  app.post('/api/doc-import/xlsx', wrap(async (req, reply) => {
    await authenticate(req, reply);
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length < 4) {
      return fail(reply, 400, '未收到文件内容');
    }
    if (buf.length > MAX_BYTES) {
      return fail(reply, 413, `文件超过 ${MAX_BYTES / 1024 / 1024}MB`);
    }
    // xlsx 也是 zip 容器
    if (buf[0] !== 0x50 || buf[1] !== 0x4b) {
      return fail(reply, 400, '不是有效的 .xlsx 文件（请另存为 Excel 2007+ 格式）');
    }
    let r;
    try {
      r = xlsxToHtml(buf);
    } catch (e) {
      return fail(reply, 400, 'Excel 解析失败：' + e.message);
    }
    if (r.empty) {
      return fail(reply, 400, '该工作簿没有可显示的内容（全为空表）');
    }
    return ok(reply, {
      html: r.html,
      sheets: r.sheets,
      rows: r.rows,
      cells: r.cells,
    }, '已转换');
  }));
}
