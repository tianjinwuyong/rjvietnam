/**
 * MES 连接器
 * ------------------------------------------------------------
 * MES 目前（2026-10）还没有和 OA 约定接口，所以这个连接器先做「插上就能用」的部分：
 *
 *   入站（MES → OA）：复用已有对外接口 /api/open/v1/flow/*
 *                    MES 只要拿一把 OA 发的 API Key，就能提交单据、查状态。
 *                    —— 不需要为 MES 单独写代码，业务类型配一条即可。
 *
 *   出站（OA → MES）：复用 flow_webhook_outbox + 投递任务
 *                    事件里 bizSystem='MES' 时，投递任务按 sys_integration_system.MES
 *                    的 webhook_url 发，用该系统的密钥做 HMAC-SHA256 签名。
 *
 * 因此「连接器」真正缺的是：① 配置 ② 一把密钥 ③ 契约文档 ④ 一个能自证通路的测试。
 * 本文件提供 ②④ 所需的运行时能力，契约见 deliverables/MES对接契约-v1.md。
 */
import crypto from 'node:crypto';
import { getSystemConfig } from './integration-config.js';

export const MES_CODE = 'MES';

/** 读取 MES 连接配置（不返回密钥明文） */
export async function getMesStatus() {
  const c = (await getSystemConfig(MES_CODE)) || {};
  return {
    systemCode: MES_CODE,
    configured: !!c.baseUrl || !!c.webhookUrl,
    baseUrl: c.baseUrl || null,
    webhookUrl: c.webhookUrl || null,
    hasSecret: !!c.webhookSecret,
    enabled: c.enabled !== false,
    lastTest: c.lastTestAt ? { at: c.lastTestAt, ok: c.lastTestOk, error: c.lastTestError || '' } : null,
  };
}

function sign(body, secret) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * 发一条 ping 事件到 MES 的回调地址，验证「地址通 + 密钥对上 + 签名能被验」。
 * 只发一次，不写 outbox（免得测试流量污染事件日志）。
 * @returns {Promise<{ok:boolean,status:number|null,error:string,payload:object|null}>}
 */
export async function pingMes() {
  const c = (await getSystemConfig(MES_CODE)) || {};
  // 停用的系统不探测：人主动关掉的开关，程序不要绕过（安全审计 F-08）
  if (c.enabled === false) {
    return { ok: false, status: null, error: 'MES 连接已停用，未发起测试', payload: null };
  }
  const url = String(c.webhookUrl || '');
  if (!url) {
    return { ok: false, status: null, error: 'MES 未配置回调地址（系统连接 → MES → 回调地址）', payload: null };
  }
  // 只允许 http/https，不接受 file:// / ftp:// 等（安全审计 F-07）
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, status: null, error: '回调地址必须是 http:// 或 https:// 开头', payload: null };
  }
  // 没有密钥就别测：空密钥算出来的签名等于没签名，测出「成功」是假绿灯（安全审计 F-06）
  if (!c.webhookSecret) {
    return { ok: false, status: null, error: 'MES 未设置回调密钥，签名为空，测试不予通过', payload: null };
  }
  const payload = {
    event: 'ping',
    source: 'OA',
    systemCode: MES_CODE,
    occurredAt: new Date().toISOString(),
    version: 1,
  };
  const body = JSON.stringify(payload);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-OA-Signature': sign(body, c.webhookSecret),
        'X-OA-System': MES_CODE,
      },
      body,
      // 不跟随跳转：避免被 302 引到别的主机（SSRF 加固）
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
    // 只读状态码，不回显响应体（对端可能返回内网路径/调试信息，进了日志就是二次泄露）
    await res.arrayBuffer().catch(() => null);
    return {
      ok: res.ok,
      status: res.status,
      error: res.ok ? '' : `HTTP ${res.status}`,
      payload,
    };
  } catch (e) {
    return { ok: false, status: null, error: e.message, payload };
  }
}

/**
 * MES 侧验签参考实现（给 MES 开发者抄的，也是我们自测 mock 用的同一份逻辑）。
 * @param {string} rawBody 原始请求体（必须用原始字节，不能先 parse 再 stringify）
 */
export function verifyMesSignature(rawBody, signature, secret) {
  const expect = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(String(expect));
  const b = Buffer.from(String(signature || ''));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
