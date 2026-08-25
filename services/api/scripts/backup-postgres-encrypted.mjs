import { spawn } from 'node:child_process';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const required = ['PGHOST','PGUSER','PGPASSWORD','PGDATABASE','MES_BACKUP_KEY_BASE64'];
for (const name of required) if (!process.env[name]) throw new Error(`${name} is required`);
const key = Buffer.from(process.env.MES_BACKUP_KEY_BASE64, 'base64');
if (key.length !== 32) throw new Error('MES_BACKUP_KEY_BASE64 must decode to exactly 32 bytes');
const root = path.resolve(process.env.MES_BACKUP_DIR || './secure-backups');
await mkdir(root, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g,'-');
const rawPath = path.join(root, `${process.env.PGDATABASE}-${stamp}.dump.tmp`);
const encryptedPath = rawPath.replace('.dump.tmp','.dump.aes256gcm');
const pgDump = process.env.PG_DUMP_PATH || 'pg_dump';
const args = ['--format=custom','--no-password','--host',process.env.PGHOST,'--port',process.env.PGPORT||'5432',
  '--username',process.env.PGUSER,'--file',rawPath,process.env.PGDATABASE];
await new Promise((resolve,reject)=>{ const p=spawn(pgDump,args,{env:process.env,windowsHide:true}); let err='';
  p.stderr.on('data',d=>err+=d); p.on('error',reject); p.on('exit',c=>c===0?resolve():reject(new Error(err||`pg_dump ${c}`))); });
try {
  const plaintext=await readFile(rawPath), iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',key,iv);
  const ciphertext=Buffer.concat([cipher.update(plaintext),cipher.final()]), tag=cipher.getAuthTag();
  const envelope=Buffer.concat([Buffer.from('RJPG01'),iv,tag,ciphertext]);
  await writeFile(encryptedPath,envelope,{flag:'wx'});
  const sha256=createHash('sha256').update(envelope).digest('hex');
  await writeFile(`${encryptedPath}.sha256`,`${sha256}  ${path.basename(encryptedPath)}\n`,{flag:'wx'});
  await appendFile(path.join(root,'backup-audit.jsonl'),JSON.stringify({time:new Date().toISOString(),database:process.env.PGDATABASE,
    file:path.basename(encryptedPath),sha256,bytes:envelope.length,result:'SUCCESS'})+'\n');
} finally { await rm(rawPath,{force:true}); }
const retention=Number(process.env.MES_BACKUP_RETENTION_DAYS||30), cutoff=Date.now()-retention*86400000;
for(const file of await readdir(root,{withFileTypes:true})) if(file.isFile()&&file.name.endsWith('.aes256gcm')) {
  const match=file.name.match(/-(\d{4}-\d{2}-\d{2})T/); if(match&&Date.parse(match[1])<cutoff) {
    await rm(path.join(root,file.name),{force:true}); await rm(path.join(root,`${file.name}.sha256`),{force:true});
  }
}
console.log(encryptedPath);
