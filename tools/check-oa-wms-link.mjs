// 核验 WMS 侧配置与 OA 库是否对得上：API Key、流程定义 ID
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'

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

const WMS_API_KEY = 'wms_a59d88420734ab27166de208b10fa91e'
const DEF_IDS = [30, 31, 34, 35, 36, 37, 38, 39, 40]

const c = new Client({
  host: env.DB_HOST || 'localhost', port: Number(env.DB_PORT || 5432),
  database: env.DB_NAME || 'oa_system', user: env.DB_USER || 'postgres', password: env.DB_PASSWORD || '',
})
await c.connect()
try {
  // 1) sys_api_key 结构
  const cols = await c.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='sys_api_key' ORDER BY ordinal_position`
  )
  console.log('=== sys_api_key 字段 ===')
  console.log(cols.rows.map((r) => r.column_name).join(', ') || '(表不存在)')

  // 2) 现有密钥（脱敏）
  const keys = await c.query(`SELECT * FROM sys_api_key ORDER BY id`)
  console.log('\n=== 现有 API Key ===')
  if (!keys.rows.length) console.log('(没有任何 API Key)')
  for (const k of keys.rows) {
    const masked = k.key_hash ? k.key_hash.slice(0, 8) + '…' : '(无 hash)'
    console.log(`  #${k.id} name=${k.name || k.label || '-'} active=${k.active} hash=${masked} perms=${JSON.stringify(k.permissions || [])} user=${k.user_id || k.service_user_id || '-'}`)
  }

  // 3) 目标 Key 是否命中
  const hash = crypto.createHash('sha256').update(WMS_API_KEY).digest('hex')
  const hit = keys.rows.find((k) => k.key_hash === hash)
  console.log('\n=== WMS 提供的 Key 校验 ===')
  console.log(hit ? `✓ 命中已登记 Key #${hit.id}（active=${hit.active}）` : '✗ 未命中：OA 里没有这条 Key（WMS 调用 OA 会 401）')

  // 4) 流程定义
  const defs = await c.query(
    `SELECT id, code, name, active FROM flow_definition WHERE id = ANY($1) ORDER BY id`,
    [DEF_IDS]
  )
  console.log('\n=== WMS 引用的流程定义 ===')
  const have = new Map(defs.rows.map((r) => [r.id, r]))
  for (const id of DEF_IDS) {
    const d = have.get(id)
    console.log(`  ${d ? '✓' : '✗'} #${id} ${d ? `${d.code} | ${d.name} | active=${d.active}` : '不存在'}`)
  }
} catch (e) {
  console.log('查询失败:', e.message)
} finally {
  await c.end().catch(() => {})
}
