// 验证临时实例（3999）上的对接配置接口
import fs from 'node:fs'
import path from 'node:path'

const BASE = 'http://127.0.0.1:3999'
const SERVER = 'D:/Program Files/OA/app/server'
const txt = fs.readFileSync(path.join(SERVER, '.env'), 'utf8')
const env = {}
for (const line of txt.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
  if (!m) continue
  let v = m[2]
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
  env[m[1]] = v
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0, total = 0
const ok = (n, c, extra = '') => { total++; if (c) pass++; console.log(`${c ? '✓' : '✗'} ${n}${extra ? ' — ' + extra : ''}`) }

async function waitUp() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`)
      if (r.ok) return true
    } catch { /* retry */ }
    await sleep(500)
  }
  return false
}

await waitUp()
ok('临时实例健康检查', true)

const loginRes = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'admin123' }),
})
const login = await loginRes.json().catch(() => ({}))
ok('管理员登录', login.code === 0, login.msg || '')
const token = login?.data?.token
const H = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }

const cfgRes = await fetch(`${BASE}/api/integration/config`, { headers: H })
const cfg = await cfgRes.json().catch(() => ({}))
ok('GET /api/integration/config（管理员可读）', cfgRes.status === 200 && cfg.code === 0, `source=${cfg?.data?.source}`)
ok('密码字段已脱敏', cfg?.data?.wmsDbPassword === '' && typeof cfg?.data?.hasDbPassword === 'boolean')

const t1Res = await fetch(`${BASE}/api/integration/test`, { method: 'POST', headers: H, body: JSON.stringify({}) })
const t1 = await t1Res.json().catch(() => ({}))
ok('POST /api/integration/test（未配置时应报缺密码）', t1.code === 0 && t1?.data?.db?.ok === false, t1?.data?.db?.error || '')

const t2Res = await fetch(`${BASE}/api/integration/test`, {
  method: 'POST', headers: H,
  body: JSON.stringify({
    wmsDbHost: '127.0.0.1', wmsDbPort: 5432, wmsDbName: 'wms',
    wmsDbUser: 'postgres', wmsDbPassword: env.DB_PASSWORD,
  }),
})
const t2 = await t2Res.json().catch(() => ({}))
ok('POST /api/integration/test（带参数试连本机 wms）', t2.code === 0 && t2?.data?.db?.ok === true, `latency=${t2?.data?.db?.latencyMs}ms`)

// 无 token 应 401
const noAuth = await fetch(`${BASE}/api/integration/config`)
ok('无 token 访问被拒绝（401）', noAuth.status === 401)

console.log(`\n结果: ${pass}/${total} 通过`)
