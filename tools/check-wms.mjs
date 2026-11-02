// 探测本机 PostgreSQL 是否存在 wms 库，以及 WMS_DB_* 配置情况
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const SERVER = 'D:/Program Files/OA/app/server'
const require = createRequire(path.join(SERVER, 'package.json'))
const { Client } = require('pg')

const envTxt = fs.readFileSync(path.join(SERVER, '.env'), 'utf8')
const env = {}
for (const line of envTxt.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
  if (!m) continue
  let v = m[2]
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
  env[m[1]] = v
}

console.log('=== 当前 WMS_DB_* 配置 ===')
const keys = ['WMS_DB_HOST', 'WMS_DB_PORT', 'WMS_DB_NAME', 'WMS_DB_USER', 'WMS_DB_PASSWORD']
for (const k of keys) console.log(`  ${k} = ${env[k] ? (k.includes('PASSWORD') ? '******' : env[k]) : '(未设置)'}`)

const host = env.DB_HOST || 'localhost'
const port = Number(env.DB_PORT || 5432)
const user = env.DB_USER || 'postgres'
const password = env.DB_PASSWORD || ''

console.log(`\n=== 用 OA 的库账号 ${user}@${host}:${port} 列数据库 ===`)
const client = new Client({ host, port, user, password, database: env.DB_NAME || 'oa_system' })
try {
  await client.connect()
  const r = await client.query(`SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname`)
  console.log('数据库列表:', r.rows.map((x) => x.datname).join(', '))
  const hasWms = r.rows.some((x) => x.datname === 'wms')
  console.log('是否存在 wms 库:', hasWms ? '✅ 存在' : '❌ 不存在')
  if (hasWms) {
    const c2 = new Client({ host, port, user, password, database: 'wms' })
    await c2.connect()
    const t = await c2.query(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public'`)
    console.log('wms 库 public 表数量:', t.rows[0].n)
    await c2.end()
  }
} catch (e) {
  console.log('连接失败:', e.message)
} finally {
  await client.end().catch(() => {})
}
