// ============================================================
// 对外统一 API（供 WMS / MES 等外部系统调用，x-api-key 鉴权）
//
// 全公司只需要这一套稳定接口；业务差异由 sys_integration_biz 配置决定。
//   POST /api/open/v1/flow/submit        提交单据
//   GET  /api/open/v1/flow/:id/status    查询审批状态
//   GET  /api/open/v1/flow/changes       增量变更（对账用）
//   GET  /api/open/v1/master/users       人员主数据（可选）
// ============================================================
import { authenticate, ok, wrap } from '../middleware/index.js';
import { getBiz, listBiz, applyFieldMap, mapStatus } from '../services/integration-biz.js';
import { createInstance, submitInstance } from '../services/flow-engine.js';
import { one, many } from '../db/index.js';

function ensureApi(req, reply) {
  if (!req.user.isApi) {
    reply.code(403).send({ code: 1, msg: '仅限外部系统（x-api-key）调用' });
    return false;
  }
  return true;
}

export default async function openRoutes(app) {
  app.addHook('preHandler', authenticate);

  // 提交单据
  app.post('/api/open/v1/flow/submit', wrap(async (req, reply) => {
    if (!ensureApi(req, reply)) return;
    if (!(req.user.permissions || []).includes('flow:submit')) {
      return reply.code(403).send({ code: 1, msg: 'API Key 缺少 flow:submit 权限' });
    }

    const { bizType, bizKey, title, formData, applicantUserId, submitNow } = req.body || {};
    if (!bizType) return reply.code(400).send({ code: 1, msg: '缺少 bizType' });

    const biz = await getBiz(bizType);
    if (!biz) return reply.code(400).send({ code: 1, msg: `未配置的业务类型：${bizType}` });
    if (biz.enabled === false) return reply.code(400).send({ code: 1, msg: `业务类型已停用：${bizType}` });
    if (!biz.definition_id) return reply.code(400).send({ code: 1, msg: `业务类型未绑定流程：${bizType}` });

    const applicantId = Number(applicantUserId || 0);
    if (!applicantId) return reply.code(400).send({ code: 1, msg: '缺少 applicantUserId（OA 申请人）' });

    const mapped = applyFieldMap(formData || {}, biz.field_map);
    const inst = await createInstance({
      definitionId: Number(biz.definition_id),
      userId: applicantId,
      title: title || `${biz.name} ${bizKey || ''}`.trim(),
      formData: mapped,
      bizSystem: biz.system_code,
      bizType: biz.biz_type,
      bizKey: bizKey || null,
    });

    let advance = null;
    if (submitNow !== false) {
      advance = await submitInstance({ instanceId: inst.id, userId: applicantId });
    }

    return ok(reply, {
      instanceId: inst.id,
      instanceNo: inst.instance_no,
      status: inst.status,
      advance,
    }, submitNow === false ? '草稿已创建' : '已提交');
  }));

  // 查询状态
  app.get('/api/open/v1/flow/:id/status', wrap(async (req, reply) => {
    if (!ensureApi(req, reply)) return;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ code: 1, msg: '单据 ID 不正确' });
    const inst = await one(
      `SELECT id, instance_no, status, current_index, biz_system, biz_type, biz_key,
              form_data, updated_at, finished_at
         FROM flow_instance WHERE id = $1`,
      [id]
    );
    if (!inst) return reply.code(404).send({ code: 1, msg: '单据不存在' });
    const biz = await getBiz(inst.biz_type);
    return ok(reply, {
      instanceId: inst.id,
      instanceNo: inst.instance_no,
      rawStatus: inst.status,
      status: mapStatus(inst.status, biz?.status_map),
      currentNode: inst.current_index,
      bizSystem: inst.biz_system,
      bizType: inst.biz_type,
      bizKey: inst.biz_key,
      updatedAt: inst.updated_at,
      finishedAt: inst.finished_at,
    });
  }));

  // 增量变更（供外部系统对账/补拉）
  app.get('/api/open/v1/flow/changes', wrap(async (req, reply) => {
    if (!ensureApi(req, reply)) return;
    const { since, system, limit } = req.query || {};
    const sys = String(system || '').trim().toUpperCase();
    if (!sys) return reply.code(400).send({ code: 1, msg: '缺少 system（如 WMS/MES）' });

    const sinceTs = since ? new Date(since) : new Date(Date.now() - 3600_000);
    if (Number.isNaN(sinceTs.getTime())) return reply.code(400).send({ code: 1, msg: 'since 格式不正确（ISO 时间）' });
    const n = Math.min(Math.max(Number(limit) || 200, 1), 1000);

    const rows = await many(
      `SELECT id, instance_no, status, biz_type, biz_key, updated_at
         FROM flow_instance
        WHERE biz_system = $1 AND updated_at > $2
        ORDER BY updated_at
        LIMIT $3`,
      [sys, sinceTs, n]
    );

    const bizMap = new Map((await listBiz()).map((b) => [b.biz_type, b]));
    const list = rows.map((r) => ({
      instanceId: r.id,
      instanceNo: r.instance_no,
      bizType: r.biz_type,
      bizKey: r.biz_key,
      rawStatus: r.status,
      status: mapStatus(r.status, bizMap.get(r.biz_type)?.status_map),
      updatedAt: r.updated_at,
    }));

    return ok(reply, {
      since: sinceTs.toISOString(),
      nextSince: list.length ? list[list.length - 1].updatedAt : sinceTs.toISOString(),
      list,
    });
  }));

  // 人员主数据（可选；供 WMS/MES 同步组织人员）
  // 只推员工：系统/服务账号（admin、wms_bot 等）不是员工，推给下游会被当成可排班、
  // 可计薪的人，WMS/MES 那边就会出现幽灵人员。
  app.get('/api/open/v1/master/users', wrap(async (req, reply) => {
    if (!ensureApi(req, reply)) return;
    const { since, limit } = req.query || {};
    const n = Math.min(Math.max(Number(limit) || 500, 1), 2000);
    const sinceTs = since ? new Date(since) : null;
    const rows = sinceTs && !Number.isNaN(sinceTs.getTime())
      ? await many(
        `SELECT id, username, employee_no, real_name, position, department_id, organization, active, updated_at
           FROM org_user WHERE updated_at > $1 AND COALESCE(is_system, FALSE) = FALSE
          ORDER BY updated_at LIMIT $2`,
        [sinceTs, n]
      )
      : await many(
        `SELECT id, username, employee_no, real_name, position, department_id, organization, active, updated_at
           FROM org_user WHERE COALESCE(is_system, FALSE) = FALSE
          ORDER BY id LIMIT $1`,
        [n]
      );
    return ok(reply, { list: rows });
  }));
}
