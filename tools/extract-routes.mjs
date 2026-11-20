// 扫描后端 routes，提取 method / path / 鉴权 / 权限码，生成 API 契约
import fs from 'node:fs'
import path from 'node:path'

const DIR = 'D:/Program Files/OA/app/server/src/routes'
const OUT_JSON = 'C:/Users/Bruce/WorkBuddy/2026-10-24-23-29-25/oa-web/src/api/catalog.json'
const OUT_MD = 'C:/Users/Bruce/WorkBuddy/2026-10-24-23-29-25/deliverables/gstack/api-contract-oa-2026-10-24.md'

const files = fs.readdirSync(DIR).filter(f => f.endsWith('.js')).sort()
const all = []

for (const f of files) {
  const txt = fs.readFileSync(path.join(DIR, f), 'utf8')
  const re = /app\.(get|post|put|delete|patch|head|options)\s*\(/gi
  const hits = []
  let m
  while ((m = re.exec(txt))) hits.push({ method: m[1].toUpperCase(), start: m.index })

  for (let i = 0; i < hits.length; i++) {
    const { method, start } = hits[i]
    const end = i + 1 < hits.length ? hits[i + 1].start : txt.length
    const seg = txt.slice(start, Math.min(end, start + 2500))

    const pm = seg.match(/['"`](\/api\/[^'"`]*)['"`]/)
    const p = pm ? pm[1] : '(未识别路径)'

    const needsAuth = /\bauthenticate\b/.test(seg)
    let perm = ''
    const any = seg.match(/requireAnyPermission\(([^)]*)\)/)
    const single = seg.match(/requirePermission\(\s*['"`]([^'"`]+)['"`]/)
    if (any) perm = 'any: ' + any[1].replace(/['"`\s]/g, '')
    else if (single) perm = single[1]

    all.push({ file: f, method, path: p, auth: needsAuth ? 'yes' : 'no', perm })
  }
}

// 去重（同文件同 method+path 只留一条）
const seen = new Set()
const rows = all.filter(r => {
  const k = r.file + '|' + r.method + '|' + r.path
  if (seen.has(k)) return false
  seen.add(k)
  return true
})

fs.writeFileSync(OUT_JSON, JSON.stringify(rows, null, 2), 'utf8')

const byFile = {}
for (const r of rows) (byFile[r.file] ||= []).push(r)

let md = `# OA 后端 API 契约（自动提取）\n\n`
md += `> 来源：\`app/server/src/routes/*.js\`｜提取时间：2026-10-24｜共 **${rows.length}** 个端点\n`
md += `> 统一响应信封：成功 \`{ code:0, msg, data }\`；失败 \`{ code:1, msg }\`（HTTP 4xx/5xx）\n`
md += `> 令牌：\`Authorization: Bearer <token>\` / \`x-token\` / \`?token=\`；语言：\`X-OA-Lang: zh|vi|en\`\n\n`
md += `| 文件 | 端点数 |\n|---|---|\n`
for (const f of Object.keys(byFile).sort()) md += `| ${f} | ${byFile[f].length} |\n`
md += `\n`

for (const f of Object.keys(byFile).sort()) {
  md += `## ${f}（${byFile[f].length}）\n\n`
  md += `| Method | Path | 认证 | 权限码 |\n|---|---|---|---|\n`
  for (const r of byFile[f]) {
    md += `| ${r.method} | \`${r.path}\` | ${r.auth === 'yes' ? '✅' : '—'} | ${r.perm ? '`' + r.perm + '`' : '—'} |\n`
  }
  md += `\n`
}

fs.writeFileSync(OUT_MD, md, 'utf8')
console.log('端点总数:', rows.length)
console.log('文件数:', Object.keys(byFile).length)
for (const f of Object.keys(byFile).sort()) console.log('  ', f, byFile[f].length)
