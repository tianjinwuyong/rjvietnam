import fs from 'node:fs'
import path from 'node:path'
const dir = 'D:/Program Files/OA/app/web/dist/assets'
const needle = process.argv[2]
const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'))
for (const f of files) {
  const s = fs.readFileSync(path.join(dir, f), 'utf8')
  const i = s.indexOf(needle)
  if (i >= 0) console.log(`HIT ${f} @${i}  (len ${s.length})`)
}
