// 集成中枢管理接口（仅管理员）：连接配置 / 业务配置 / API Key / 事件
import crypto from 'node:crypto';
import { authenticate, ok, wrap } from '../middleware/index.js';
import {
  getIntegrationConfigForAdmin, saveIntegrationConfig, testIntegration, getIntegrationStatus,
  listSystemsForAdmin, saveSystemConfig, testSystem,
} from '../services/integration-config.js';
import { listBiz, saveBiz, deleteBiz } from '../services/integration-biz.js';
import { listAlerts, ackAlert, scanIntegrationAlerts } from '../services/integration-alert.js';
import { runIntegrationReconcile, listReconcileRuns, getReconcileRun } from '../services/integration-reconcile.js';
import { getMesStatus, pingMes } from '../services/mes-connector.js';
import { one, many, query } from '../db/index.js';
import { hashPassword } from '../services/auth.js';

function adminOnly(req, reply) {
  if (!req.user.isAdmin) {
    reply.code(403).send({ code: 1, msg: '无权限' });
    return false;
  }
  return true;
}

export default async function integrationRoutes(app) {
  app.addHook('preHandler', authenticate);

  /* ---------------- WMS 只读库 + 回调密钥 ---------------- */
  app.get('/api/integration/config', wrap(async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    return ok(reply, await getIntegrationConfigForAdmin());
  }));

  app.put('/api/integration/config', wrap(async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    await saveIntegrationConfig(req.body || {}, req.user.id);
    return ok(reply, await getIntegrationConfigForAdmin(), '对接配置已保存并生效');
  }));

  app.post('/api/integration/test', wrap(async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    const r = await testIntegration(req.body || {});
    return ok(reply, r, r.db.ok ? '连接成功' : '连接失败');
  }));

  app.get('/api/integration/status', wrap(async (req, reply) => {
    return ok(reply, await getIntegrationStatus());
  }));

  /* ---------------- 多系统连接（WMS / MES） ---------------- */
  app.get('/api/integration/systems', wrap(async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    return ok(reply, await listSystemsForAdmin());
  }));

  app.put('/api/integration/systems/:code', wrap(async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    await saveSystemConfig(req.params.code, req.body || {}, req.user.id);
    return ok(reply, await listSystemsForAdmin(), '系统连接已保存');
  }));

  app.post('/api/integration/systems/:code/test', wrap(async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    return ok(reply, await testSystem(req.params.code, req.body || {}));
  }));

  /* ---------------- 业务类型配置 ---------------- */
  app.get('/api/integration/biz', wrap(async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    return ok(reply, await listBiz());
  }));

  app.put('/api/integration/biz', wrap(async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    return ok(reply, await saveBiz(req.body || {}), '业务配置已保存');
  }));

  app.delete('/api/integration/biz/:bizType', wrap(async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    await deleteBiz(req.params.bizType);
    return ok(reply, null, '业务配置已删除');
  }));

  /* ---------------- API Key ---------------- */
  app.get('/api/integration/keys', wrap(async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    const rows = await many(
      `SELECT id, name, permissions, active, service_user_id, description, created_at
         FROM sys_api_key ORDER BY id`
    );
    return ok(reply, rows);
  }));

  app.post('/api/integration/keys', wrap(async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    const { name, permissions, serviceUserId, description } = req.body || {};
    const plain = 'oa_' + crypto.randomBytes(24).toString('hex');
    const hash = crypto.createHash('sha256').update(plain).digest('hex');
    const perms = Array.isArray(permissions) && permissions.length ? permissions : ['flow:submit'];
    const row = await one(
      `INSERT INTO sys_api_key (name, key_hash, permissions, active, service_user_id, description)
       VALUES ($1,$2,$3,TRUE,$4,$5)
       RETURNING id, name, permissions, active, service_user_id, description, created_at`,
      [String(name || '外部系统').slice(0, 100), hash, perms, serviceUserId || null, description || null]
    );
    // 明文只回显一次，请立即保存到对方系统
    return ok(reply, { ...row, key: plain }, 'API Key 已创建（仅显示一次）');
  }));

  /**
   * 登记「对方系统已持有」的密钥：把明文 Key 粘进来，OA 只存 SHA-256。
   * 用途：WMS/MES 那边已经配好一把 Key（如 wms_xxx），不想改对方配置时用它。
   * 幂等：同一把 Key 重复登记不会产生多条记录。
   */
  app.post('/api/integration/keys/import', wrap(async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    const { key, name, permissions, serviceUserId, description } = req.body || {};
    const plain = String(key || '').trim();
    if (plain.length < 8) return reply.code(400).send({ code: 1, msg: '请粘贴完整的 API Key（至少 8 位）' });
    const hash = crypto.createHash('sha256').update(plain).digest('hex');
    const perms = Array.isArray(permissions) && permissions.length ? permissions : ['flow:submit'];
    const exist = await one(`SELECT id FROM sys_api_key WHERE key_hash = $1`, [hash]);
    if (exist) {
      await query(
        `UPDATE sys_api_key SET name=$2, permissions=$3, active=TRUE, service_user_id=$4, description=$5 WHERE id=$1`,
        [exist.id,
         String(name || '外部系统').slice(0, 100),
         perms,
         serviceUserId || null,
         description || null]
      );
      const row = await one(
        `SELECT id, name, permissions, active, service_user_id, description, created_at FROM sys_api_key WHERE id=$1`,
        [exist.id]
      );
      return ok(reply, { ...row, imported: true }, '该密钥已存在登记记录，已更新');
    }
    const row = await one(
      `INSERT INTO sys_api_key (name, key_hash, permissions, active, service_user_id, description)
       VALUES ($1,$2,$3,TRUE,$4,$5)
       RETURNING id, name, permissions, active, service_user_id, description, created_at`,
      [String(name || '外部系统').slice(0, 100), hash, perms, serviceUserId || null, description || null]
    );
    return ok(reply, { ...row, imported: true }, '已登记（对方系统无需改动）');
  }));

  /* ---------------- 服务账号（API Key 的执行身份） ---------------- */
  /** 候选服务账号：所有启用中的非管理员账号 */
  app.get('/api/integration/service-accounts', wrap(async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    const rows = await many(
      `SELECT u.id, u.username, u.real_name, u.department_id, d.name AS dept_name
         FROM org_user u LEFT JOIN org_department d ON d.id = u.department_id
        WHERE u.active = TRUE AND u.is_admin = FALSE
        ORDER BY u.id`
    );
    return ok(reply, rows);
  }));

  /**
   * 建一个专用机器人账号（非管理员），用于外部系统调用时归属操作人。
   * 不借用真人账号，避免「幽灵操作人 / 自审冲突」。
   */
  app.post('/api/integration/service-accounts', wrap(async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    const username = String(req.body?.username || '').trim();
    const realName = String(req.body?.realName || '').trim() || username;
    if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
      return reply.code(400).send({ code: 1, msg: '账号只能包含字母/数字/下划线，长度 3–32' });
    }
    const exist = await one(`SELECT id FROM org_user WHERE username = $1`, [username]);
    if (exist) return reply.code(400).send({ code: 1, msg: '该账号已存在' });
    // 机器人账号不允许交互式登录使用：随机高强度密码 + 强制改密标记
    const plainPwd = req.body?.password ? String(req.body.password) : crypto.randomBytes(24).toString('hex');
    const hash = await hashPassword(plainPwd);
    // 机器人账号一律 is_system=TRUE：它不是员工，不参与工资核算/考勤/休假台账，
    // 也不会出现在各处「选人」清单里（115 迁移的触发器会顺带清空工号与考勤规则）。
    const row = await one(
      `INSERT INTO org_user (username, password_hash, real_name, is_admin, active, organization, must_change_pwd, employee_no, is_system)
       VALUES ($1,$2,$3,FALSE,TRUE,'外部系统集成',FALSE,NULL,TRUE)
       RETURNING id, username, real_name, is_admin, is_system, active`,
      [username, hash, realName]
    );
    return ok(reply, row, '服务账号已创建');
  }));

  app.put('/api/integration/keys/:id', wrap(async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    const id = Number(req.params.id);
    const { active, permissions, serviceUserId, description } = req.body || {};
    await query(
      `UPDATE sys_api_key SET
         active = COALESCE($2, active),
         permissions = COALESCE($3, permissions),
         service_user_id = COALESCE($4, service_user_id),
         description = COALESCE($5, description)
       WHERE id = $1`,
      [id,
       active === undefined ? null : !!active,
       Array.isArray(permissions) ? permissions : null,
       serviceUserId === undefined ? null : serviceUserId,
       description === undefined ? null : description]
    );
    return ok(reply, null, '已更新');
  }));

  /* ---------------- 事件（出站） ---------------- */
  app.get('/api/integration/events', wrap(async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    const { status, system, limit } = req.query || {};
    const n = Math.min(Math.max(Number(limit) || 50, 1), 500);
    const params = [];
    let where = 'WHERE 1=1';
    if (status) { params.push(status); where += ` AND status=$${params.length}`; }
    if (system) { params.push(String(system).toUpperCase()); where += ` AND system_code=$${params.length}`; }
    params.push(n);
    const rows = await many(
      `SELECT id, instance_id, event, system_code, status, attempts, last_error, created_at, next_retry_at
         FROM flow_webhook_outbox ${where} ORDER BY id DESC LIMIT $${params.length}`,
      params
    );
    return ok(reply, rows);
  }));

  app.post('/api/integration/events/:id/replay', wrap(async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    await query(
      `UPDATE flow_webhook_outbox
          SET status='pending', attempts=0, next_retry_at=now(), last_error=NULL
        WHERE id=$1`,
      [Number(req.params.id)]
    );
    return ok(reply, null, '已重新排队投递');
  }));

  /* ---------------- 告警 ---------------- */
  app.get('/api/integration/alerts', wrap(async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    const { status = 'open', limit } = req.query || {};
    return ok(reply, await listAlerts({ status, limit }));
  }));

  app.post('/api/integration/alerts/:id/ack', wrap(async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    return ok(reply, await ackAlert(req.params.id, req.user.id), '已标记处理');
  }));

  app.post('/api/integration/alerts/scan', wrap(async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    const r = await scanIntegrationAlerts();
    return ok(reply, r, r.raised ? `新产生 ${r.raised} 条告警` : '扫描完成，无新告警');
  }));

  /* ---------------- 对账 ---------------- */
  app.post('/api/integration/reconcile/run', wrap(async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    const { hours, iqc } = req.body || {};
    const r = await runIntegrationReconcile({
      hours: Number(hours) || 72,
      iqc: iqc !== false,
      actor: req.user.id,
      kind: 'manual',
    });
    const diffs = (r.outbox?.diffs || 0) + (r.iqc?.diffs || 0);
    return ok(reply, r, diffs ? `对账完成：发现 ${diffs} 条差异` : '对账完成：两边一致');
  }));

  app.get('/api/integration/reconcile/runs', wrap(async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    return ok(reply, await listReconcileRuns({ limit: req.query?.limit }));
  }));

  app.get('/api/integration/reconcile/runs/:id', wrap(async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    const row = await getReconcileRun(req.params.id);
    if (!row) throw Object.assign(new Error('对账记录不存在'), { statusCode: 404, isBiz: true });
    return ok(reply, row);
  }));

  /* ---------------- MES 连接器 ---------------- */
  app.get('/api/integration/mes/status', wrap(async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    return ok(reply, await getMesStatus());
  }));

  // 发一条签名 ping 到 MES 回调地址：验证地址通 + 密钥对得上（不写事件日志）
  app.post('/api/integration/mes/ping', wrap(async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    const r = await pingMes();
    return ok(reply, r, r.ok ? 'MES 已收到并验签通过' : `MES 未响应：${r.error}`);
  }));
}
