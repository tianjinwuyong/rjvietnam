// 校验 wms 库中 OA 依赖的表/字段是否齐全
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

const client = new Client({
  host: env.WMS_DB_HOST || env.DB_HOST || 'localhost',
  port: Number(env.WMS_DB_PORT || env.DB_PORT || 5432),
  database: env.WMS_DB_NAME || 'factory', options: "-c search_path=rjvn,public",
  user: env.WMS_DB_USER || env.DB_USER || 'postgres',
  password: env.WMS_DB_PASSWORD || env.DB_PASSWORD || '',
})

const need = ['sys_param', 'iqc_lot', 'material', 'supplier']
await client.connect()
try {
  const t = await client.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1)`,
    [need]
  )
  const have = new Set(t.rows.map((r) => r.table_name))
  console.log('=== 依赖表 ===')
  for (const n of need) console.log(`  ${have.has(n) ? '✓' : '✗'} ${n}`)

  if (have.has('iqc_lot')) {
    const c = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='iqc_lot' ORDER BY ordinal_position`
    )
    console.log('=== iqc_lot 字段 ===')
    console.log(c.rows.map((r) => r.column_name).join(', '))
    const cnt = await client.query(`SELECT count(*)::int n FROM iqc_lot`)
    console.log('iqc_lot 行数:', cnt.rows[0].n)
  }
  if (have.has('sys_param')) {
    const cnt = await client.query(`SELECT count(*)::int n FROM sys_param`)
    console.log('sys_param 行数:', cnt.rows[0].n)
  }
} catch (e) {
  console.log('校验失败:', e.message)
} finally {
  await client.end().catch(() => {})
}
