import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module'
const SERVER='D:/Program Files/OA/app/server'
const require=createRequire(path.join(SERVER,'package.json'))
const {Client}=require('pg')
const envTxt=fs.readFileSync(path.join(SERVER,'.env'),'utf8'); const env={}
for(const line of envTxt.split(/\r?\n/)){const m=line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);if(!m)continue;let v=m[2];if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);env[m[1]]=v}
const c=new Client({host:env.DB_HOST,port:+env.DB_PORT||5432,database:env.DB_NAME,user:env.DB_USER,password:env.DB_PASSWORD})
await c.connect()
const sql=process.argv[2]
const r=await c.query(sql)
if(r.rows.length) console.table(r.rows); else console.log('(空)')
await c.end()
