import fs from 'node:fs'
import path from 'node:path'

const needle = process.argv[2]
const dir = process.argv[3] || 'D:/Program Files/OA/app/web/dist/assets'
if (!needle) {
  console.error('用法: node tools/find-string.mjs "要查的字符串" [目录]')
  process.exit(1)
}
let found = 0
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith('.js')) continue
  let s
  try {
    s = fs.readFileSync(path.join(dir, f), 'utf8')
  } catch {
    continue
  }
  const i = s.indexOf(needle)
  if (i >= 0) {
    found++
    console.log(`FILE: ${f}`)
    console.log(s.slice(Math.max(0, i - 350), i + 350).replace(/\n/g, ' '))
    console.log('-----')
  }
}
if (!found) console.log('未找到:', needle)
