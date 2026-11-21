// 邮件发送：Nodemailer，配置全在 .env，上线时打开 NOTIFY_EMAIL 即可
import nodemailer from 'nodemailer';
import { config } from '../config/index.js';

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  const { host, port, secure, user, pass } = config.notify.smtp;
  if (!host || !user) return null;
  transporter = nodemailer.createTransport({
    host, port, secure,
    auth: { user, pass },
    pool: true,          // 连接复用，避免频繁握手被判定异常
    maxConnections: 3,
  });
  return transporter;
}

export async function sendMail({ to, subject, text, html }) {
  const tp = getTransporter();
  if (!tp) throw new Error('SMTP 未配置');
  const { from } = config.notify.smtp;
  return tp.sendMail({
    from: from || `OA 系统 <${userOf(from)}>`,
    to, subject, text, html,
  });
}

function userOf(addr = '') {
  const m = addr.match(/<([^>]+)>/);
  return m ? m[1] : addr;
}

/** 自检：启动时验证 SMTP 可用性，失败只告警不阻断 */
export async function verifySmtp() {
  const tp = getTransporter();
  if (!tp) return { configured: false };
  try {
    await tp.verify();
    return { configured: true, ok: true };
  } catch (err) {
    return { configured: true, ok: false, error: err.message };
  }
}