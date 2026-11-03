// 对比三个 OA 库的流程定义，寻找 WMS 引用的 30/31/34-40
import fs from 'node:fs'
import path from 'node:path'
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

const IDS = [30, 31, 34, 35, 36, 37, 38, 39, 40]
const DBS = ['oa_system', 'oa_system_fix', 'oa_system_qa3']

for (const db of DBS) {
  console.log(`\n================ ${db} ================`)
  const c = new Client({
    host: env.DB_HOST || 'localhost', port: Number(env.DB_PORT || 5432),
    database: db, user: env.DB_USER || 'postgres', password: env.DB_PASSWORD || '',
  })
  try {
    await c.connect()
    const cnt = await c.query(`SELECT count(*)::int n FROM flow_definition`)
    console.log('流程定义总数:', cnt.rows[0].n)
    const all = await c.query(`SELECT id, code, name, active FROM flow_definition ORDER BY id`)
    console.log('全部定义:')
    for (const r of all.rows) console.log(`  #${r.id} ${r.code || '-'} | ${r.name} | active=${r.active}`)
    const hit = await c.query(`SELECT id, code, name FROM flow_definition WHERE id = ANY($1) ORDER BY id`, [IDS])
    const have = new Map(hit.rows.map((r) => [r.id, r]))
    console.log('WMS 引用 ID 命中情况:', IDS.map((id) => `${id}${have.has(id) ? '✓' : '✗'}`).join(' '))
  } catch (e) {
    console.log('连接/查询失败:', e.message)
  } finally {
    await c.end().catch(() => {})
  }
}
