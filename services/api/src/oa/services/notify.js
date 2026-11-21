// ============================================================
// 通知服务：统一抽象层
// 现在只写站内信；上线时把渠道开关打开，同步推飞书与邮件。
// 业务代码只调用 notify()，不感知渠道差异。
// ============================================================
import { many, query } from '../db/index.js';
import { config } from '../config/index.js';
import { sendMail } from './mailer.js';
import { tNotify } from '../i18n/lang.js';

// 飞书月度调用量控制：接近免费版上限（1 万次/月）时自动降级为仅站内信
let feishuApiUsed = 0;
let feishuApiMonth = '';

export function feishuQuotaStats() {
  return {
    used: feishuApiUsed,
    month: feishuApiMonth,
    quota: config.feishu.monthlyApiQuota,
    degraded: feishuApiUsed >= config.feishu.monthlyApiQuota,
  };
}

async function sendFeishuCard(userId, { title, content, link }) {
  if (!config.feishu.enabled || !config.feishu.appId) return false;

  const month = new Date().toISOString().slice(0, 7);
  if (month !== feishuApiMonth) { feishuApiMonth = month; feishuApiUsed = 0; }
  if (feishuApiUsed >= config.feishu.monthlyApiQuota) {
    console.warn('[notify] 飞书接口额度接近上限，本次仅站内信');
    return false;
  }

  const openId = (await many(
    `SELECT feishu_open_id FROM org_user WHERE id = $1 AND feishu_open_id IS NOT NULL`,
    [userId]
  ))[0]?.feishu_open_id;
  if (!openId) return false;

  try {
    const tokenRes = await fetch(
      'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: config.feishu.appId, app_secret: config.feishu.appSecret }),
      }
    );
    const tokenJson = await tokenRes.json();
    if (tokenJson.code !== 0) throw new Error(tokenJson.msg || '获取 token 失败');
    feishuApiUsed++;

    const card = {
      msg_type: 'interactive',
      card: {
        config: { wide_screen_mode: true },
        header: { title: { tag: 'plain_text', content: title }, template: 'blue' },
        elements: [
          { tag: 'div', text: { tag: 'plain_text', content: content || '' } },
          {
            tag: 'action',
            actions: [{
              tag: 'button',
              text: { tag: 'plain_text', content: '前往处理' },
              type: 'primary',
              url: `${config.server.publicUrl}${link || ''}`,
            }],
          },
        ],
      },
    };
    const res = await fetch(
      'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenJson.tenant_access_token}` },
        body: JSON.stringify({ receive_id: openId, ...card }),
      }
    );
    const json = await res.json();
    feishuApiUsed++;
    if (json.code !== 0) throw new Error(json.msg || '发送失败');
    return true;
  } catch (err) {
    console.error('[notify] 飞书推送失败:', err.message);
    return false;
  }
}

/**
 * 发送通知。
 * @param userId 接收人
 * @param payload title / content / link / category
 * 站内信始终落库；邮件与飞书按开关异步推送，失败不影响主流程。
 *
 * 三语化（T4）：`notification.title/content` 是**落库前已渲染的文本**，落库后无法按读者语言变化，
 * 因此在 INSERT 前按**收件人**的 `org_user.language` 用 tNotify 渲染；历史通知保持原语言不变。
 */
export async function notify(userId, payload) {
  const { title, content, link, category = 'system' } = payload || {};
  if (!userId) return null;

  const user = (await many(
    `SELECT id, email, real_name, language FROM org_user WHERE id = $1`, [userId]
  ))[0];
  if (!user) return null;

  // 按收件人语言渲染标题与正文（未识别文案原样返回中文，绝不返回裸键）
  const lang = user.language || 'zh';
  const localTitle = tNotify(lang, title);
  const localContent = tNotify(lang, content);

  const inserted = (await query(
    `INSERT INTO notification (user_id, title, content, link, category, channel, delivered)
     VALUES ($1,$2,$3,$4,$5,'internal',TRUE) RETURNING id`,
    [userId, localTitle, localContent, link || null, category]
  )).rows[0];

  // 邮件：仅在开启且有地址时发送，失败不抛
  if (config.notify.email && user.email) {
    sendMail({
      to: user.email,
      subject: localTitle,
      text: `${localContent || ''}\n\n前往处理：${config.server.publicUrl}${link || ''}`,
    }).catch(err => {
      query(
        `UPDATE notification SET delivered=FALSE, fail_reason=$2 WHERE id=$1`,
        [inserted.id, String(err.message).slice(0, 500)]
      ).catch(() => {});
    });
  }

  // 飞书：同上
  if (config.notify.feishu) {
    sendFeishuCard(userId, { ...payload, title: localTitle, content: localContent }).catch(() => {});
  }

  return inserted;
}

/** 批量通知，调用方自己控制循环，消息为同一个标题时可用 */
export async function notifyMany(userIds, payload) {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  for (const id of ids) await notify(id, payload);
  return ids.length;
}

/** 未读统计，用于顶部铃铛 */
export async function unreadCount(userId) {
  const r = (await many(
    `SELECT COUNT(*)::int AS n FROM notification WHERE user_id=$1 AND read_at IS NULL`, [userId]
  ))[0];
  return r?.n || 0;
}

export async function listNotifications(userId, { limit = 20, offset = 0 } = {}) {
  return many(
    `SELECT id, title, content, link, category, read_at, created_at
       FROM notification WHERE user_id=$1
      ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
}

export async function markRead(userId, ids) {
  if (!Array.isArray(ids) || !ids.length) return 0;
  const res = await query(
    `UPDATE notification SET read_at=now() WHERE user_id=$1 AND id = ANY($2::bigint[]) AND read_at IS NULL`,
    [userId, ids]
  );
  return res.rowCount;
}