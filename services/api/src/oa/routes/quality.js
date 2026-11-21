// ============================================================
// quality —— 品质总览相关接口（当前：WMS IQC 检验看板接入）
//
// 数据源两条：
//   · 首选实时：配了 WMS 账号就走 HTTP 拉 WMS 的 /api/dashboard/iqc-*（见 wms-iqc-live.js）；
//   · 兜底：未配账号时直连 WMS 只读库（现网不可达，仅特殊部署可用）。
// WMS 不可用时返回 wmsAvailable=false，前端降级显示提示，不影响品质总览其它模块。
// 只读接口，登录即可访问（看板不含敏感数据）。
// ============================================================
import { authenticate, ok, wrap } from '../middleware/index.js';
import { getIqcDashboard, getIqcDefectLots } from '../services/wms-iqc-service.js';
import { getWmsLiveStatus } from '../services/wms-iqc-live.js';

export default async function qualityRoutes(app) {
  app.addHook('preHandler', authenticate);

  // 实时通道自检：是否配了账号、能否登录 WMS。排查"为什么没数据"先看这里
  app.get('/api/quality/wms-iqc/status', wrap(async (req, reply) => {
    return ok(reply, await getWmsLiveStatus());
  }));

  // IQC 看板聚合：汇总卡 + 趋势 + 不良类型/物料类型分布 + 待检超期
  app.get('/api/quality/wms-iqc/dashboard', wrap(async (req, reply) => {
    return ok(reply, await getIqcDashboard(req.query || {}));
  }));

  // 不良明细下钻：点饼图扇区 → 批次清单（与扇区数值同口径）
  app.get('/api/quality/wms-iqc/defects', wrap(async (req, reply) => {
    return ok(reply, await getIqcDefectLots(req.query || {}));
  }));
}
