// 为 OA 补上 WMS 只读连接配置（复用 OA 的 PostgreSQL 账号）
import fs from 'node:fs'
import path from 'node:path'

const SERVER = 'D:/Program Files/OA/app/server'
const ENV = path.join(SERVER, '.env')

const txt = fs.readFileSync(ENV, 'utf8')
if (/^\s*WMS_DB_PASSWORD\s*=\s*\S/m.test(txt)) {
  console.log('已存在 WMS_DB_PASSWORD，跳过（不覆盖现有配置）')
  process.exit(0)
}

const env = {}
for (const line of txt.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
  if (!m) continue
  let v = m[2]
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
  env[m[1]] = v
}

const host = env.DB_HOST || '127.0.0.1'
const port = env.DB_PORT || '5432'
const user = env.DB_USER || 'postgres'
const pwd = env.DB_PASSWORD || ''
if (!pwd) {
  console.error('DB_PASSWORD 为空，无法复用；请手动配置 WMS_DB_PASSWORD')
  process.exit(1)
}

const quote = /[#\s"'\\]/.test(pwd)
  ? '"' + pwd.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
  : pwd

const block = [
  '',
  '# ===== WMS 只读集成（同机同库实例，2026-10-25 自动补充）=====',
  `WMS_DB_HOST=${host}`,
  `WMS_DB_PORT=${port}`,
  'WMS_DB_NAME=wms',
  `WMS_DB_USER=${user}`,
  `WMS_DB_PASSWORD=${quote}`,
  '',
].join('\n')

fs.writeFileSync(ENV, txt.replace(/\s*$/, '') + '\n' + block, 'utf8')
console.log('已写入 WMS_DB_* 配置（密码复用 DB_PASSWORD，未回显）')
console.log(`  WMS_DB_HOST=${host}`)
console.log(`  WMS_DB_PORT=${port}`)
console.log('  WMS_DB_NAME=wms')
console.log(`  WMS_DB_USER=${user}`)
console.log('  WMS_DB_PASSWORD=******')
