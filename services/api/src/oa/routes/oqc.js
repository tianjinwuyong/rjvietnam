// ============================================================
// oqc —— 出货检验（OQC）
//   · /api/oqc/sampling/options  可选值（水平 / AQL / 严格度）
//   · /api/oqc/sampling          按批量算抽样方案（n / Ac / Re）
// 规则计算在 WMS，这里只做代理与校验（见 services/oqc-service.js 注释）
// ============================================================
import { authenticate, ok, wrap } from '../middleware/index.js';
import { computeSampling, SAMPLING_OPTIONS } from '../services/oqc-service.js';

export default async function oqcRoutes(app) {
  app.addHook('preHandler', authenticate);

  app.get('/api/oqc/sampling/options', wrap(async (req, reply) => {
    return ok(reply, SAMPLING_OPTIONS);
  }));

  app.get('/api/oqc/sampling', wrap(async (req, reply) => {
    const r = await computeSampling(req.query || {});
    return ok(reply, r);
  }));
}
