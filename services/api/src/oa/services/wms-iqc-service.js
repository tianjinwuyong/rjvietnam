// ============================================================
// wms-iqc-service —— WMS「IQC 检验看板」数据接入（只读）
//
// 目标：把 WMS 看板（client/src/pages/Dashboard/IqcDashboard.tsx +
// server/modules/dashboard/dashboard.service.ts getIqcStats）的**口径**搬到 OA 品质总览，
// 让两个系统看到的是同一组数字，而不是"OA 自己另算一套"。
//
// 严格照抄 WMS 已定口径（见 WMS dashboard.service.ts 的注释）：
//   · 时间：按 iqc_lot.receipt_date，**闭区间** [startDate, endDate]
//   · 范围：已出检验结论 `inspection_result IN ('pass','fail')`
//   · 合格：`inspection_result='pass' AND status <> 'rejected'`（被驳回不算合格）
//   · 不合格：`inspection_result='fail' OR (inspection_result='pass' AND status='rejected')`
//   · 缺陷类型取 iqc_lot.defect_type（一个批次只归一类，扇区之和 = 不合格批数）
//   · 超期/预警：status='pending' 且 _created_at 超过 sys_param 里的
//     iqc_pending_urgent_hours / iqc_pending_warning_hours
//
// 【数据源选择】两条路，按「系统对接」里是否配了 WMS 账号自动切换：
//   ① 配了账号 → services/wms-iqc-live.js：登录 WMS 用 HTTP 实时拉 /api/dashboard/iqc-*，
//      数据与 WMS 自己的看板同源同口径，**实时**。失败就报错，不退化成快照。
//   ② 没配账号 → 本文件下方的 SQL，直连 WMS 只读库。
//      ⚠️ 现网 WMS 只放行 3000，数据库端口不通，这条路基本走不到；
//      若指向本地快照库，看到的是历史截面而非实时数据 —— 所以生产请用 ①。
//
// 注意：不要在这里"优化"口径。OA 与 WMS 数字一旦不一致，现场会先怀疑系统坏了。
// ============================================================
import { wmsQuery, wmsPing } from '../db/wms.js';
import { getWmsLoginConfig, getIqcDashboardLive, getIqcDefectLotsLive } from './wms-iqc-live.js';

/** WMS 前端地址（联动跳转用）：可在 .env 用 WMS_WEB_BASE 覆盖 */
const wmsWebBase = () => (process.env.WMS_WEB_BASE || 'http://127.0.0.1:3000').replace(/\/$/, '');
/** WMS 前端端口：只取端口交给前端拼主机名，避免写死 127.0.0.1 */
function wmsWebPort() {
  try { return Number(new URL(wmsWebBase()).port) || 3000; } catch { return 3000; }
}

/** 时间粒度白名单（防注入，只允许这三种） */
const GRAN = { day: 'YYYY-MM-DD', week: 'YYYY-"W"IW', month: 'YYYY-MM' };

function normRange(startDate, endDate) {
  const end = (endDate || '').trim() || new Date().toISOString().slice(0, 10);
  const start = (startDate || '').trim()
    || new Date(Date.parse(end) - 29 * 86400000).toISOString().slice(0, 10);
  return { start, end };
}

/** 读 WMS 参数（sys_param），读不到用默认值 —— 与 WMS getParamNumber 行为一致 */
async function paramNumber(key, fallback) {
  try {
    const rows = await wmsQuery(`SELECT param_value FROM sys_param WHERE param_key = $1 LIMIT 1`, [key]);
    const v = Number(rows[0]?.param_value);
    return Number.isFinite(v) && v > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}

/**
 * IQC 看板聚合：汇总 + 趋势 + 两张分布 + 待检/超期。
 * WMS 未接入时返回 { wmsAvailable:false }，由前端降级展示，不抛 500。
 */
export async function getIqcDashboard({ startDate, endDate, granularity } = {}) {
  // ── 实时通道优先（推荐路径）──────────────────────────────
  // 管理员在「系统对接 → WMS」里填了账号后，一律走 HTTP 实时拉取，
  // **绝不回退到本地快照**：快照会被当成实时数据误读，那比空着更糟。
  // 实时失败就明确返回 wmsAvailable:false + 具体原因，由前端降级提示。
  const liveCfg = await getWmsLoginConfig().catch(() => null);
  if (liveCfg) {
    try {
      return await getIqcDashboardLive({ startDate, endDate, granularity });
    } catch (e) {
      return {
        wmsAvailable: false,
        source: 'wms-http',
        error: e.message || '实时取数失败',
        errorCode: e.code || '',
        range: null, summary: null,
        trend: [], defectByType: [], defectByMaterialType: [],
      };
    }
  }

  const available = await wmsPing();
  if (!available) {
    return { wmsAvailable: false, range: null, summary: null, trend: [], defectByType: [], defectByMaterialType: [] };
  }

  const { start, end } = normRange(startDate, endDate);
  const gran = GRAN[granularity] ? granularity : 'day';
  const fmt = GRAN[gran];
  const params = [start, end];

  // 1) 趋势（按粒度分桶）与汇总：同一条 SQL 出，保证卡片数字 = 曲线累加
  //    分桶直接用 to_char，不再 to_date 往返——周粒度往返会踩 ISO 周解析，且没必要。
  const trendRows = await wmsQuery(
    `SELECT to_char(l.receipt_date, '${fmt}') AS bucket,
            count(*)::int AS total,
            count(*) FILTER (WHERE l.inspection_result = 'pass' AND coalesce(l.status,'') <> 'rejected')::int AS passed
       FROM iqc_lot l
      WHERE l.receipt_date >= $1::date AND l.receipt_date <= $2::date
        AND l.inspection_result IN ('pass','fail')
      GROUP BY 1 ORDER BY 1 ASC`,
    params
  );

  const trend = trendRows.map(r => {
    const total = Number(r.total) || 0;
    const passed = Number(r.passed) || 0;
    return {
      bucket: String(r.bucket),
      total,
      passed,
      failed: total - passed,
      passRate: total ? Math.round((passed / total) * 1000) / 10 : 0,
    };
  });

  const totalLots = trend.reduce((s, p) => s + p.total, 0);
  const passedLots = trend.reduce((s, p) => s + p.passed, 0);
  const failedLots = totalLots - passedLots;

  // 2) 待检 + 超期/预警（WMS 口径：status='pending' 按创建时长分档）
  const [warningHours, urgentHours] = await Promise.all([
    paramNumber('iqc_pending_warning_hours', 24),
    paramNumber('iqc_pending_urgent_hours', 48),
  ]);
  // 目标合格率：与 WMS 同一参数（sys_param.iqc_target_pass_rate，默认 95），
  // 折线图上的红色目标虚线用它，避免"目标值两边不一样"
  const targetPassRate = await paramNumber('iqc_target_pass_rate', 95);
  const pend = (await wmsQuery(
    `SELECT count(*)::int AS pending,
            count(*) FILTER (WHERE l._created_at < now() - ($1::int || ' hours')::interval)::int AS overdue,
            count(*) FILTER (WHERE l._created_at < now() - ($1::int || ' hours')::interval
                               AND l._created_at >= now() - ($2::int || ' hours')::interval)::int AS warning
       FROM iqc_lot l WHERE l.status = 'pending'`,
    [warningHours, urgentHours]
  ))[0] || {};

  // 3) 不合格按「不良类型」分布（扇区之和 = failedLots）
  const defectByType = (await wmsQuery(
    `SELECT CASE WHEN nullif(trim(l.defect_type), '') IS NULL THEN '未分类'
                 ELSE trim(l.defect_type) END AS type,
            count(*)::int AS count
       FROM iqc_lot l
      WHERE l.receipt_date >= $1::date AND l.receipt_date <= $2::date
        AND l.inspection_result IN ('pass','fail')
        AND (l.inspection_result = 'fail' OR l.status = 'rejected')
      GROUP BY 1 ORDER BY count DESC, 1 ASC`,
    params
  )).map(r => ({ type: r.type, count: Number(r.count) || 0 }));

  // 4) 不合格按「物料类型」分布
  const defectByMaterialType = (await wmsQuery(
    `SELECT coalesce(nullif(trim(m.material_type), ''), '未分类') AS material_type,
            count(DISTINCT l.id)::int AS count
       FROM iqc_lot l LEFT JOIN material m ON l.material_id = m.id
      WHERE l.receipt_date >= $1::date AND l.receipt_date <= $2::date
        AND l.inspection_result IN ('pass','fail')
        AND (l.inspection_result = 'fail' OR l.status = 'rejected')
      GROUP BY 1 ORDER BY count DESC, 1 ASC`,
    params
  )).map(r => ({ materialType: r.material_type, count: Number(r.count) || 0 }));

  return {
    wmsAvailable: true,
    // 联动入口：只回「端口 + 路径」，由前端用**当前访问 OA 的主机名**拼完整地址。
    // 原因：后端写死 127.0.0.1 时，从局域网（192.168.6.160）打开 OA 的人点"打开 WMS"
    // 会跳到他自己那台机器的 127.0.0.1:3000，必然打不开。
    links: {
      port: wmsWebPort(),
      pendingPath: '/iqc/pending',
      recordsPath: '/iqc/record',
      statsPath: '/iqc/stats',
      // 兼容保留：服务端拼好的绝对地址（仅在同机访问时可用）
      base: wmsWebBase(),
    },
    range: {
      start, end, granularity: gran,
      // 与 WMS 同款：预警/超期阈值也回传给前端显示，避免"数字对不上"的争议
      warningHours, urgentHours,
    },
    summary: {
      totalLots, passedLots, failedLots,
      passRate: totalLots ? Math.round((passedLots / totalLots) * 1000) / 10 : 0,
      targetPassRate,
      pending: Number(pend.pending) || 0,
      warning: Number(pend.warning) || 0,
      overdue: Number(pend.overdue) || 0,
    },
    trend,
    defectByType,
    defectByMaterialType,
  };
}

/**
 * 不良明细下钻：点饼图某个扇区 → 列出对应批次（与扇区数值同源同口径）。
 * @param {{startDate?:string,endDate?:string,type?:string,materialType?:string,page?:number,size?:number}} p
 */
export async function getIqcDefectLots({ startDate, endDate, type, materialType, page = 1, size = 20 } = {}) {
  // 实时通道优先（同上，配置了账号就不再碰本地库）
  const liveCfg = await getWmsLoginConfig().catch(() => null);
  if (liveCfg) {
    try {
      return await getIqcDefectLotsLive({ startDate, endDate, type, materialType, page, size });
    } catch (e) {
      return {
        wmsAvailable: false,
        source: 'wms-http',
        error: e.message || '实时取数失败',
        errorCode: e.code || '',
        list: [], total: 0,
      };
    }
  }

  const available = await wmsPing();
  if (!available) return { wmsAvailable: false, list: [], total: 0 };

  const { start, end } = normRange(startDate, endDate);
  const p = Math.max(1, Number(page) || 1);
  const s = Math.min(100, Math.max(1, Number(size) || 20));

  const where = [
    `l.receipt_date >= $1::date`, `l.receipt_date <= $2::date`,
    `l.inspection_result IN ('pass','fail')`,
    `(l.inspection_result = 'fail' OR l.status = 'rejected')`,
  ];
  const params = [start, end];

  if (type) {
    params.push(type);
    where.push(`CASE WHEN nullif(trim(l.defect_type), '') IS NULL THEN '未分类' ELSE trim(l.defect_type) END = $${params.length}`);
  }
  if (materialType) {
    params.push(materialType);
    where.push(`coalesce(nullif(trim(m.material_type), ''), '未分类') = $${params.length}`);
  }
  const whereSql = where.join(' AND ');

  const total = Number((await wmsQuery(
    `SELECT count(DISTINCT l.id)::int AS c
       FROM iqc_lot l LEFT JOIN material m ON l.material_id = m.id
      WHERE ${whereSql}`,
    params
  ))[0]?.c || 0);

  const list = await wmsQuery(
    `SELECT l.lot_no, l.inspection_no, l.receipt_date,
            m.material_code, m.material_name, m.material_type, m.specification,
            s.supplier_name, s.supplier_code,
            l.defect_type, l.total_qty, l.unit, l.inspection_result, l.status,
            l.remark
       FROM iqc_lot l
       LEFT JOIN material m ON l.material_id = m.id
       LEFT JOIN supplier s ON l.supplier_id = s.id
      WHERE ${whereSql}
      ORDER BY l.receipt_date DESC, l.lot_no DESC
      LIMIT ${s} OFFSET ${(p - 1) * s}`,
    params
  );

  return {
    wmsAvailable: true,
    total,
    page: p,
    size: s,
    list: list.map(r => ({
      lotNo: r.lot_no,
      inspectionNo: r.inspection_no,
      receiptDate: r.receipt_date instanceof Date ? r.receipt_date.toISOString().slice(0, 10) : String(r.receipt_date || ''),
      materialCode: r.material_code || '',
      materialName: r.material_name || '',
      materialType: r.material_type || '',
      specification: r.specification || '',
      supplierName: r.supplier_name || '',
      supplierCode: r.supplier_code || '',
      defectType: r.defect_type || '',
      totalQty: Number(r.total_qty) || 0,
      unit: r.unit || '',
      inspectionResult: r.inspection_result,
      status: r.status,
      remark: r.remark || '',
    })),
  };
}
