// 对接配置中心闭环测试（用本机残留 wms 库验证流程，测试后清理还原）
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const SERVER = 'D:/Program Files/OA/app/server'
const ic = await import(pathToFileURL(`${SERVER}/src/services/integration-config.js`).href)
const db = await import(pathToFileURL(`${SERVER}/src/db/index.js`).href)

const txt = fs.readFileSync(path.join(SERVER, '.env'), 'utf8')
const env = {}
for (const line of txt.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
  if (!m) continue
  let v = m[2]
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
  env[m[1]] = v
}
const dbPwd = env.DB_PASSWORD || ''
let pass = 0, total = 0
const ok = (n, c, extra = '') => { total++; if (c) pass++; console.log(`${c ? '✓' : '✗'} ${n}${extra ? ' — ' + extra : ''}`) }

try {
  // 1) 保存（用本机残留 wms 库做连通验证）
  await ic.saveIntegrationConfig({
    wmsDbHost: '127.0.0.1', wmsDbPort: 5432, wmsDbName: 'wms', wmsDbUser: 'postgres', wmsDbPassword: dbPwd,
  }, 1)
  const admin = await ic.getIntegrationConfigForAdmin()
  ok('保存后来源为数据库', admin.source === 'db')
  ok('密码不回显、仅标记已配置', admin.wmsDbPassword === '' && admin.hasDbPassword === true)
  ok('密码可正确解密', ic.getWmsDbConfig().password === dbPwd)

  // 2) 连通性测试
  const r = await ic.testIntegration()
  ok('WMS 数据库连通', r.db.ok === true, `latency=${r.db.latencyMs}ms`)
  ok('依赖表齐全', r.db.tables.every((t) => t.ok), r.db.tables.map((t) => `${t.table}:${t.ok ? '✓' : '✗'}`).join(' '))
  ok('测试结果已记录', !!(await ic.getIntegrationStatus()).lastTestAt)

  // 3) 清理（恢复未配置状态，避免把本机残留库当成真实 WMS）
  await db.query(
    `UPDATE sys_integration SET wms_db_host=NULL, wms_db_port=NULL, wms_db_name=NULL, wms_db_user=NULL,
       wms_db_password_enc=NULL, wms_webhook_url=NULL, wms_webhook_secret_enc=NULL, wms_base_url=NULL,
       wms_api_key_enc=NULL, oa_service_user_id=NULL, last_test_at=NULL, last_test_ok=NULL, last_test_error=NULL
     WHERE id=1`
  )
  await ic.ensureIntegrationLoaded(true)
  const after = await ic.getIntegrationConfigForAdmin()
  ok('清理后回到 .env 兜底（未配置）', after.source === 'env' && after.hasDbPassword === false)
} catch (e) {
  console.error('测试异常:', e)
  process.exitCode = 1
} finally {
  console.log(`\n结果: ${pass}/${total} 通过`)
  if (db.pool) await db.pool.end()
}
