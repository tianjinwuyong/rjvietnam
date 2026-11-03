// 三系统集成中枢端到端验证（3999 临时实例）
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const BASE = 'http://127.0.0.1:3999'
const SERVER = 'D:/Program Files/OA/app/server'
const require = createRequire(path.join(SERVER, 'package.json'))
const { Client } = require('pg')

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
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return true } catch {}
    await sleep(500)
  }
  return false
}
async function j(path, opts = {}, token) {
  const headers = { 'Content-Type': 'application/json', 'X-OA-Lang': 'zh', ...(opts.headers || {}) }
  if (token) headers['Authorization'] = 'Bearer ' + token
  const res = await fetch(BASE + path, { method: opts.method || 'GET', headers, body: opts.body })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, body }
}

const BIZ = 'test_mrb_' + Date.now().toString().slice(-6)
let token, apiKey, instanceId, keyId

console.log('等待临时实例启动...')
ok('临时实例健康', await waitUp())

const login = await j('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin123' }) })
ok('管理员登录', login.body.code === 0, login.body.msg || '')
token = login.body?.data?.token

// 1) 系统连接
const systems = await j('/api/integration/systems', {}, token)
const codes = (systems.body.data || []).map((x) => x.systemCode)
ok('系统连接已初始化（WMS/MES）', codes.includes('WMS') && codes.includes('MES'), codes.join(','))

// 2) 业务配置
const biz = await j('/api/integration/biz', {
  method: 'PUT',
  body: JSON.stringify({
    bizType: BIZ, name: '测试 MRB', systemCode: 'WMS', definitionId: 2,
    fieldMap: { problem: 'problem', lot_qty: 'qty' },
    statusMap: { completed: 'approved', terminated: 'rejected' },
    enabled: true,
  }),
}, token)
ok('业务配置保存', biz.body.code === 0, biz.body.msg || '')
ok('字段映射已存储', biz.body.data?.field_map?.problem === 'problem' && String(biz.body.data?.field_map?.lot_qty) === 'qty', JSON.stringify(biz.body.data?.field_map))
ok('状态映射已存储', biz.body.data?.status_map?.completed === 'approved')

// 3) 生成 API Key
const key = await j('/api/integration/keys', {
  method: 'POST',
  body: JSON.stringify({ name: '测试密钥', permissions: ['flow:submit'], description: '自动化测试' }),
}, token)
apiKey = key.body?.data?.key
keyId = key.body?.data?.id
ok('生成 API Key', !!apiKey && apiKey.startsWith('oa_'))

// 4) 外部系统走统一 API 提交（草稿，避免产生待办）
const submit = await j('/api/open/v1/flow/submit', {
  method: 'POST',
  headers: { 'x-api-key': apiKey },
  body: JSON.stringify({
    bizType: BIZ, bizKey: 'TEST-' + Date.now(), title: '测试 MRB 单据',
    formData: { problem: '测试问题', qty: 10 },
    applicantUserId: 2, submitNow: false,
  }),
})
ok('对外 API 提交成功', submit.body.code === 0, submit.body.msg || '')
instanceId = submit.body?.data?.instanceId

// 5) 状态查询
const st = await j(`/api/open/v1/flow/${instanceId}/status`, { headers: { 'x-api-key': apiKey } })
ok('状态查询成功', st.body.code === 0 && st.body.data?.instanceId === instanceId, `status=${st.body?.data?.rawStatus}`)
ok('状态映射可按配置返回', st.body.data?.status === 'draft', `mapped=${st.body?.data?.status}`)

// 6) 增量变更
const ch = await j('/api/open/v1/flow/changes?system=WMS&limit=10', { headers: { 'x-api-key': apiKey } })
ok('增量变更可读取', ch.body.code === 0 && Array.isArray(ch.body.data?.list))

// 7) 无密钥被拒
const noKey = await j('/api/open/v1/flow/changes?system=WMS')
ok('无 API Key 被拒绝', noKey.status === 401)

// 8) 事件日志接口
const ev = await j('/api/integration/events?limit=5', {}, token)
ok('事件日志接口可用', ev.body.code === 0 && Array.isArray(ev.body.data))

/* ---------------- 清理测试数据 ---------------- */
const c = new Client({ host: env.DB_HOST || 'localhost', port: Number(env.DB_PORT || 5432), database: env.DB_NAME || 'oa_system', user: env.DB_USER || 'postgres', password: env.DB_PASSWORD || '' })
await c.connect()
try {
  if (instanceId) {
    await c.query(`DELETE FROM flow_log WHERE instance_id=$1`, [instanceId])
    await c.query(`DELETE FROM flow_instance WHERE id=$1`, [instanceId])
  }
  await c.query(`DELETE FROM sys_integration_biz WHERE biz_type=$1`, [BIZ])
  if (keyId) await c.query(`DELETE FROM sys_api_key WHERE id=$1`, [keyId])
  console.log('已清理测试数据（单据/业务配置/密钥）')
} finally {
  await c.end().catch(() => {})
}

console.log(`\n结果: ${pass}/${total} 通过`)
