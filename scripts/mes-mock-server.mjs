#!/usr/bin/env node
/**
 * MES 工单下发接口 · 本地模拟服务（联调用）
 * ---------------------------------------------------------------------------
 * 作用：在没有 MES 真实密钥、或者 MES 那边不方便配合的情况下，把 WMS 的
 *       「MES 接入」页面完整跑通（同步工单 → 看缺口 → 开领料单）。
 *
 * 严格按对接文档 v1.0 的路径、字段、错误码实现：
 *   GET /api/itf/wms/ping
 *   GET /api/itf/wms/mo?updated_since=&page=&page_size=&only_open=
 *   GET /api/itf/wms/mo/{moNo}
 *   GET /api/itf/wms/mo/{moNo}/materials
 *   GET /api/itf/wms/issue/pending?limit=
 *
 * 启动：
 *   node scripts/mes-mock-server.mjs            # 默认 8099 端口，密钥 test-key
 *   MES_MOCK_PORT=8099 MES_MOCK_KEY=test-key node scripts/mes-mock-server.mjs
 *
 * 然后在 WMS「MES 接入 → 接口配置」里填：
 *   接口地址 http://127.0.0.1:8099
 *   密钥     test-key
 */
import http from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.MES_MOCK_PORT || 8099);
const API_KEY = process.env.MES_MOCK_KEY || 'test-key';
const PREFIX = '/api/itf/wms';

/** 两个工段各一条，故意混入一个 WMS 没有的物料编码，用来验证「未匹配物料」提示 */
const MATERIALS = [
  ['smt', '0.00.00.01.0237B-HF', '贴片电阻', '0603 10KΩ ±1%', 'PCS', 4, 200, 0, 200, 5000, 'R11,R12', 'bom'],
  ['smt', '0.00.00.01.0435L-HF', '贴片电容', '0603 100nF 50V', 'PCS', 2, 100, 40, 60, 4000, 'C3,C4', 'issue'],
  ['dip', '0.00.00.02.0043B-HF', '电解电容', '10uF 25V 5*11', 'PCS', 1, 50, 50, 0, 1000, '', 'issue'],
  ['assembly', '1.02.00.01.0466', '装配件', 'NBT 12V4A 美规桌面式电源适配器 冷灰色', 'PCS', 1, 50, 0, 50, 1, '', 'bom'],
  ['packing', 'MES-ONLY-9999', '彩盒', 'MES 独有物料（WMS 未建档）', 'PCS', 1, 50, 0, 50, 100, '', 'bom'],
];

const MO = {
  moNo: '26101001204',
  woType: '包装',
  productCode: 'EPS48R1-36',
  productName: 'EPS48R1-36',
  productModel: 'EPS48R1-36',
  spec: '',
  unit: 'PCS',
  panelCount: 12,
  planQty: 50.0,
  outQty: 0.0,
  ngQty: 0.0,
  lineCode: 'PACK-L01',
  status: '已排产',
  poNo: '',
  poLine: '1',
  custCode: 'NB08',
  planStart: '2026-10-26',
  planEnd: '2026-11-01',
  actualStart: '',
  actualEnd: '',
  bomVersion: '',
  fgCode: '2.01.00.55.0022',
  srcMoNo: '',
  remark: '',
  createdAt: '2026-10-26 21:05:05',
  updatedAt: '2026-10-30 20:15:00',
  issueNo: '',
  issueStatus: '',
  issueCount: 0,
};

const MO2 = {
  ...MO,
  moNo: '26101001205',
  woType: '组装',
  productCode: 'EPS18R1G-36',
  productName: 'EPS18R1G-36',
  lineCode: 'ASSY-L02',
  status: '生产中',
  planQty: 120.0,
  planStart: '2026-10-27',
  updatedAt: '2026-10-30 21:40:00',
};

/** 第三个工单：产品在 WMS 没有 BOM，用来验证「没有 BOM 的 MES 工单也能进列表」 */
const MO3 = {
  ...MO,
  moNo: '26101001206',
  woType: 'SMT',
  productCode: 'MES-NOBOM-01',
  productName: '无 BOM 测试机种',
  productModel: 'NOBOM-01',
  lineCode: 'SMT-L01',
  status: '已排产',
  planQty: 10.0,
  planStart: '2026-11-02',
  updatedAt: '2026-10-30 22:05:00',
};

const MOS = [MO, MO2, MO3];

function materialRow([segment, code, name, spec, unit, qtyPer, need, issued, open, mpq, posRef, source], planQty) {
  const suggest = mpq > 1 && open > 0 ? Math.ceil(open / mpq) * mpq : open;
  return {
    materialCode: code,
    materialName: name,
    spec,
    unit,
    qtyPer,
    needQty: need,
    issueQty: issued,
    openQty: open,
    mpq,
    posRef,
    altList: '',
    isAlt: 0,
    segment,
    mainCode: code,
    source,
    suggestIssueQty: suggest,
    _planQty: planQty,
  };
}

function materialsOf(moNo) {
  const mo = MOS.find((m) => m.moNo === moNo) || MO;
  return MATERIALS.map((row) => {
    // MATERIALS 列序：segment, code, name, spec, unit, qtyPer, need, issued, open, mpq, posRef, source
    const [, , , , , qtyPer, need, issued, open, mpq, posRef, source] = row;
    const k = mo.planQty / 50;
    return materialRow([
      row[0], row[1], row[2], row[3], row[4],
      qtyPer, need * k, issued * k, open * k, mpq, posRef, source,
    ]);
  }).map(({ _planQty, ...rest }) => rest);
}

const nowText = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 19).replace('T', ' ');

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(json);
}

function ok(res, data) {
  send(res, 200, { code: 0, message: 'ok', requestId: randomUUID().replace(/-/g, ''), data });
}

function err(res, status, code, message) {
  send(res, status, { code, message, data: null, requestId: randomUUID().replace(/-/g, '') });
}

/** 回写幂等台账：同一个 idempotencyKey 只记一次 */
const received = new Map();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (!url.pathname.startsWith(PREFIX)) return err(res, 404, 40400, `未知路径 ${url.pathname}`);

  if (req.headers['x-api-key'] !== API_KEY) {
    return err(res, 401, 40101, '缺少 X-Api-Key 请求头');
  }

  const path = url.pathname.slice(PREFIX.length) || '/';

  if (path === '/ping') {
    return ok(res, {
      service: 'ruijing-mes(mock)', ok: true, serverTime: nowText(), utcOffset: '+07:00',
    });
  }

  if (path === '/mo') {
    const page = Math.max(1, Number(url.searchParams.get('page') || 1));
    const pageSize = Math.min(500, Math.max(1, Number(url.searchParams.get('page_size') || 50)));
    const since = url.searchParams.get('updated_since');
    const onlyOpen = url.searchParams.get('only_open') === 'true';
    let list = MOS;
    if (since) {
      const s = since.replace('T', ' ').replace('Z', '');
      list = list.filter((m) => m.updatedAt >= s);
    }
    if (onlyOpen) list = list.filter((m) => m.status !== '已完工' && m.status !== '已关闭');
    const start = (page - 1) * pageSize;
    const items = list.slice(start, start + pageSize).map((m) => ({ ...m, issueCount: 0 }));
    return ok(res, {
      total: list.length, page, pageSize, hasMore: start + pageSize < list.length, items,
    });
  }

  if (path === '/issue/pending') {
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 50)));
    const items = MOS.filter((m) => m.status !== '已完工' && m.status !== '已关闭')
      .slice(0, limit)
      .map((m) => {
        const ms = materialsOf(m.moNo).filter((x) => x.openQty > 0);
        // 真实 MES 的工单头带已开领料单号；mock 用 LL+工单号 造一个，方便验证回写链路
        return { ...m, issueNo: m.issueNo || `LL${m.moNo}`, issueCount: 1, materials: ms };
      });
    return ok(res, { total: items.length, items });
  }

  // 发料结果回写（MES 写接口）：按 idempotencyKey 去重，重复推送只记一次
  const mIssued = /^\/issue\/([^/]+)\/issued$/.exec(path);
  if (mIssued) {
    if (req.method !== 'POST') return err(res, 405, 40500, '请用 POST');
    const issueNo = decodeURIComponent(mIssued[1]);
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { body = {}; }
      const key = body.idempotencyKey;
      if (key && received.has(key)) {
        console.log(`[writeback] 幂等命中 ${issueNo} key=${key}`);
        return ok(res, { issueNo, wmsPickingNo: body.wmsPickingNo, accepted: true, duplicate: true });
      }
      if (key) received.set(key, body);
      const total = (body.items || []).reduce((s, i) => s + (Number(i.actualQty) || 0), 0);
      console.log(`[writeback] ${issueNo} / ${body.wmsPickingNo} 行=${(body.items || []).length} 合计=${total} key=${key}`);
      return ok(res, { issueNo, wmsPickingNo: body.wmsPickingNo, accepted: true, duplicate: false });
    });
    return undefined;
  }

  const mDetail = /^\/mo\/([^/]+)$/.exec(path);
  if (mDetail) {
    const mo = MOS.find((m) => m.moNo === decodeURIComponent(mDetail[1]));
    if (!mo) return err(res, 404, 40404, `工单不存在：${mDetail[1]}`);
    return ok(res, {
      ...mo, materials: materialsOf(mo.moNo), issues: [],
      materialSource: 'BOM V2.6 现算', bomVersionUsed: 'V2.6', materialCount: MATERIALS.length,
    });
  }

  const mMat = /^\/mo\/([^/]+)\/materials$/.exec(path);
  if (mMat) {
    const moNo = decodeURIComponent(mMat[1]);
    const mo = MOS.find((m) => m.moNo === moNo);
    if (!mo) return err(res, 404, 40404, `工单不存在：${moNo}`);
    const materials = materialsOf(moNo);
    return ok(res, {
      moNo,
      productCode: mo.productCode,
      planQty: mo.planQty,
      source: 'BOM V2.6 现算',
      bomVersionUsed: 'V2.6',
      materialCount: materials.length,
      materials,
      issues: [],
    });
  }

  return err(res, 404, 40400, `未知路径 ${path}`);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[MES mock] http://127.0.0.1:${PORT}${PREFIX}  key=${API_KEY}`);
});
