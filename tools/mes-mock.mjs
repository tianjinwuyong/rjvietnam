/**
 * 极简 MES 回调模拟器（自测用，不是生产组件）
 * ------------------------------------------------------------
 * 作用：在本机 4099 端口扮演 MES，接收 OA 发出的回调，
 *       按「MES 侧验签参考实现」校验 X-OA-Signature，验过才回 200。
 *
 * 用法：
 *   MES_TEST_SECRET=mes-test-secret node tools/mes-mock.mjs
 * 然后在「系统连接 → MES」把回调地址填 http://127.0.0.1:4099/mes/oa、密钥填同一个。
 */
import http from 'node:http';
import crypto from 'node:crypto';

const SECRET = process.env.MES_TEST_SECRET || 'mes-test-secret';
const PORT = Number(process.env.MES_MOCK_PORT || 4099);

http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const sig = String(req.headers['x-oa-signature'] || '');
    const expect = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
    const ok = sig.length === expect.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect));
    let parsed = null;
    try { parsed = JSON.parse(body); } catch { /* ignore */ }
    console.log(`[mock] ${new Date().toISOString()} ${req.method} ${req.url} 验签=${ok ? 'OK' : '失败'} ` +
      `event=${parsed?.event || '-'} instance=${parsed?.instanceNo || '-'}`);
    res.writeHead(ok ? 200 : 401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok, received: ok, ts: Date.now() }));
  });
}).listen(PORT, () => console.log(`[mock] MES 模拟器已监听 http://127.0.0.1:${PORT}  密钥长度=${SECRET.length}`));
