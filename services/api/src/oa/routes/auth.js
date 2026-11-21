import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { authenticate, ok, wrap } from '../middleware/index.js';
import { login, loginByFeishuCode, logout, getUserProfile, hashPassword, verifyPassword, checkPasswordStrength } from '../services/auth.js';
import { unreadCount, listNotifications, markRead } from '../services/notify.js';
import { many, one, query } from '../db/index.js';
import { config } from '../config/index.js';

export default async function authRoutes(app) {
  // 登录
  app.post('/api/auth/login', wrap(async (req, reply) => {
    const { username, password } = req.body || {};
    if (!username || !password) return reply.code(400).send({ code: 1, msg: '请输入用户名和密码' });
    const r = await login({
      username, password,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return ok(reply, r, '登录成功');
  }));

  // 飞书免登（上线时启用）
  app.post('/api/auth/feishu/login', wrap(async (req, reply) => {
    if (!config.feishu.enabled) return reply.code(400).send({ code: 1, msg: '飞书登录未启用' });
    const { code } = req.body || {};
    if (!code) return reply.code(400).send({ code: 1, msg: '缺少授权码' });
    const r = await loginByFeishuCode(code);
    return ok(reply, r, '登录成功');
  }));

  // 退出
  app.post('/api/auth/logout', { preHandler: authenticate }, wrap(async (req, reply) => {
    await logout(req.token);
    return ok(reply, null, '已退出');
  }));

  // 切换界面语言（账号级保存，PC 与移动端同步）
  app.put('/api/auth/language', { preHandler: authenticate }, wrap(async (req, reply) => {
    const { language } = req.body || {};
    if (!['zh', 'vi', 'en'].includes(language)) {
      return reply.code(400).send({ code: 1, msg: '不支持的语言' });
    }
    await query(`UPDATE org_user SET language = $2, updated_at = now() WHERE id = $1`, [req.user.id, language]);
    const switchMsg = language === 'vi' ? 'Đã chuyển sang tiếng Việt'
      : language === 'en' ? 'Switched to English'
      : '已切换到中文';
    return ok(reply, { language }, switchMsg);
  }));

  // 枚举字典（按类型批量取，前端按当前语言选显示名）
  app.get('/api/i18n/dict', { preHandler: authenticate }, wrap(async (req, reply) => {
    const { type } = req.query || {};
    const params = [];
    let where = 'active = TRUE';
    if (type) { params.push(type); where += ` AND dict_type = $${params.length}`; }
    const rows = await many(
      `SELECT dict_type, code, name_zh, name_vi, name_en, sort_order
         FROM sys_i18n_dict WHERE ${where} ORDER BY dict_type, sort_order, id`,
      params
    );
    // 按类型分组返回，便于前端一次取全部
    // 三语契约（T2）：每条恒含 4 个键 { code, zh, vi, en }。
    //   · en 无值时返回 null（**不回退中文**）—— 回落策略统一由前端 utils/label.js 决定，
    //     后端不做语言决策，避免与缓存里的旧结构打架。
    //   · 旧前端只读 zh/vi，多出的 en 键对它无感（纯增量，零回归）。
    //   · vi 保持历史口径 `name_vi || name_zh`（老前端有直接取 vi 的写法，不可改为 null）。
    const grouped = {};
    for (const r of rows) {
      grouped[r.dict_type] = grouped[r.dict_type] || [];
      grouped[r.dict_type].push({
        code: r.code,
        zh: r.name_zh,
        vi: r.name_vi || r.name_zh,
        en: r.name_en || null,
      });
    }
    return ok(reply, grouped);
  }));

  // 当前用户
  app.get('/api/auth/profile', { preHandler: authenticate }, wrap(async (req, reply) => {
    const counts = {
      todo: (await one(
        `SELECT COUNT(*)::int AS n FROM flow_task WHERE assignee_id=$1 AND status='assigned'`,
        [req.user.id]
      ))?.n || 0,
      drafts: (await one(
        `SELECT COUNT(*)::int AS n FROM flow_instance WHERE applicant_id=$1 AND status='draft'`,
        [req.user.id]
      ))?.n || 0,
      cc: (await one(
        `SELECT COUNT(*)::int AS n FROM flow_cc WHERE user_id=$1 AND read_at IS NULL`,
        [req.user.id]
      ))?.n || 0,
      notifications: await unreadCount(req.user.id),
    };
    // 安全：绝不把口令散列等敏感字段回传前端（历史实现直接展开 req.user）
    // eslint-disable-next-line no-unused-vars
    const { password_hash, ...safeUser } = req.user || {};
    return ok(reply, { ...safeUser, counts });
  }));

  // 修改密码
  app.post('/api/auth/password', { preHandler: authenticate }, wrap(async (req, reply) => {
    const { oldPassword, newPassword } = req.body || {};
    checkPasswordStrength(newPassword);
    const row = await one(`SELECT password_hash FROM org_user WHERE id=$1`, [req.user.id]);
    if (!await verifyPassword(oldPassword, row.password_hash)) {
      return reply.code(400).send({ code: 1, msg: '原密码不正确' });
    }
    await query(`UPDATE org_user SET password_hash=$1, must_change_pwd=FALSE, pwd_changed_at=now(), updated_at=now() WHERE id=$2`,
      [await hashPassword(newPassword), req.user.id]);
    // 改密后清掉其他会话，仅保留当前
    await query(`DELETE FROM sys_session WHERE user_id=$1 AND token <> $2`, [req.user.id, req.token]);
    return ok(reply, null, '密码已修改，请重新登录其他设备');
  }));

  // 通知列表
  app.get('/api/notifications', { preHandler: authenticate }, wrap(async (req, reply) => {
    const { limit = 20, offset = 0 } = req.query || {};
    const list = await listNotifications(req.user.id, { limit: Number(limit), offset: Number(offset) });
    return ok(reply, { list, unread: await unreadCount(req.user.id) });
  }));

  app.post('/api/notifications/read', { preHandler: authenticate }, wrap(async (req, reply) => {
    const { ids } = req.body || {};
    const n = await markRead(req.user.id, ids);
    return ok(reply, { updated: n }, '已标记为已读');
  }));
}