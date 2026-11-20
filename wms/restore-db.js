/**
 * WMS 数据库恢复工具（在目标电脑上运行）
 *
 * 作用：把 db-backup/wms_full_*.sql 导入目标机 PostgreSQL 的 wms 库。
 * 前提：目标机已安装 PostgreSQL（psql 能在 PATH 找到，或装在默认目录）。
 *
 * 幂等性：导入脚本自带 DROP TABLE IF EXISTS，重复执行会得到一份干净的同版本数据。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const readline = require('readline');

const ROOT = __dirname;
const BACKUP_DIR = path.join(ROOT, 'db-backup');

function pickDump() {
  if (!fs.existsSync(BACKUP_DIR)) return null;
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.toLowerCase().endsWith('.sql'))
    .sort()
    .reverse();
  return files.length ? path.join(BACKUP_DIR, files[0]) : null;
}

function parseEnv() {
  const p = path.join(ROOT, '.env');
  const out = {};
  if (!fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function findPsql() {
  try {
    const out = execFileSync('where', ['psql'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const first = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    if (first) return first;
  } catch {
    /* PATH 里没有，继续找默认安装目录 */
  }
  const bases = ['C:\\Program Files\\PostgreSQL', 'C:\\Program Files (x86)\\PostgreSQL', 'D:\\PostgreSQL'];
  for (const base of bases) {
    if (!fs.existsSync(base)) continue;
    const dirs = fs
      .readdirSync(base)
      .filter((d) => /^\d+/.test(d))
      .sort((a, b) => parseInt(b, 10) - parseInt(a, 10));
    for (const d of dirs) {
      const p = path.join(base, d, 'bin', 'psql.exe');
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

function psql(psqlPath, args, env, input) {
  // 注意：Windows 下 psql 无法正确解析含中文的 -f 路径（会变成 ????），
  // 所以备份内容一律走 stdin 传入，不用 -f。
  return execFileSync(psqlPath, args, {
    encoding: 'utf8',
    env: { ...process.env, PGCLIENTENCODING: 'UTF8', ...env },
    input,
    maxBuffer: 64 * 1024 * 1024,
  });
}

function ask(rl, question, def) {
  return new Promise((resolve) => {
    rl.question(def ? `${question} [${def}]: ` : `${question}: `, (a) => {
      const v = (a || '').trim();
      resolve(v || def || '');
    });
  });
}

(async () => {
  console.log('');
  console.log('==============================================');
  console.log('  WMS 数据库恢复工具');
  console.log('==============================================');
  console.log('');

  const dump = pickDump();
  if (!dump) {
    console.error('  [错误] 找不到备份文件：db-backup\\*.sql');
    process.exit(1);
  }
  console.log(`  备份文件：${path.basename(dump)}（${(fs.statSync(dump).size / 1024 / 1024).toFixed(1)} MB）`);

  const psqlPath = findPsql();
  if (!psqlPath) {
    console.error('');
    console.error('  [错误] 没有找到 psql。请先安装 PostgreSQL 18，');
    console.error('         或在「服务端安装时」勾选 Command Line Tools。');
    console.error('         安装后重新运行本工具。');
    process.exit(1);
  }
  console.log(`  psql：${psqlPath}`);

  const env = parseEnv();
  const host = env.DB_HOST || 'localhost';
  const port = env.DB_PORT || '5432';
  const user = env.DB_USER || 'postgres';
  const dbName = process.env.WMS_RESTORE_DB || env.DB_NAME || 'wms';

  console.log('');
  console.log(`  目标库：${user}@${host}:${port}/${dbName}`);
  console.log('  请输入这台电脑上 PostgreSQL 的 postgres 用户密码。');
  console.log('  （如果和源机器一样是 123，直接回车即可）');
  console.log('');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let pwd = await ask(rl, '  数据库密码', env.DB_PASSWORD || '');
  rl.close();

  const pgEnv = { PGPASSWORD: pwd };

  // 1. 测试连通性
  process.stdout.write('  [1/4] 测试数据库连接 ... ');
  try {
    psql(psqlPath, ['-h', host, '-p', port, '-U', user, '-d', 'postgres', '-tAc', 'select 1'], pgEnv);
    console.log('OK');
  } catch (e) {
    console.log('失败');
    const msg = (e.stderr || e.message || '').toString();
    console.error('');
    console.error('  [错误] 连不上数据库：' + msg.split('\n')[0]);
    console.error('  请检查：');
    console.error('    1) PostgreSQL 服务是否已启动（服务名 postgresql-x64-18）');
    console.error('    2) 密码是否正确');
    console.error('    3) 端口是否为 ' + port);
    process.exit(1);
  }

  // 2. 建库（不存在才建）
  process.stdout.write(`  [2/4] 检查数据库 ${dbName} ... `);
  let exists = '';
  try {
    exists = psql(
      psqlPath,
      ['-h', host, '-p', port, '-U', user, '-d', 'postgres', '-tAc', `select 1 from pg_database where datname='${dbName}'`],
      pgEnv,
    ).trim();
  } catch {
    exists = '';
  }
  if (exists === '1') {
    console.log('已存在（将被备份内容覆盖）');
  } else {
    psql(psqlPath, ['-h', host, '-p', port, '-U', user, '-d', 'postgres', '-c', `CREATE DATABASE "${dbName}"`], pgEnv);
    console.log('已创建');
  }

  // 3. 导入
  console.log('  [3/4] 正在导入数据，请稍候（约 10~60 秒）...');
  try {
    psql(psqlPath, ['-h', host, '-p', port, '-U', user, '-d', dbName, '-v', 'ON_ERROR_STOP=1', '-q'], pgEnv, fs.readFileSync(dump));
  } catch (e) {
    const msg = (e.stderr || e.message || '').toString();
    console.error('');
    console.error('  [错误] 导入失败：');
    console.error(msg.split('\n').slice(0, 8).join('\n'));
    process.exit(1);
  }
  console.log('        导入完成');

  // 4. 校验
  process.stdout.write('  [4/4] 校验业务数据 ... ');
  const check = (sql) =>
    psql(psqlPath, ['-h', host, '-p', port, '-U', user, '-d', dbName, '-tAc', sql], pgEnv).trim();
  try {
    const material = check('select count(*) from material');
    const receipt = check('select count(*) from receipt_order');
    const inv = check('select count(*) from inventory');
    const mrb = check('select count(*) from mrb_review');
    const acct = check('select count(*) from sys_account');
    console.log('OK');
    console.log('');
    console.log('           物料 ' + material + ' 条 | 收货单 ' + receipt + ' 条 | 库存 ' + inv + ' 条');
    console.log('           MRB ' + mrb + ' 条 | 系统账号 ' + acct + ' 个');
  } catch (e) {
    console.log('失败');
    console.error('  数据校验查询失败：' + (e.stderr || e.message || '').toString().split('\n')[0]);
    process.exit(1);
  }

  // 把密码写回 .env，保证启动脚本用的是同一套凭据
  try {
    const envPath = path.join(ROOT, '.env');
    if (fs.existsSync(envPath)) {
      let text = fs.readFileSync(envPath, 'utf8');
      if (/^DB_PASSWORD=.*$/m.test(text)) {
        text = text.replace(/^DB_PASSWORD=.*$/m, `DB_PASSWORD=${pwd}`);
      } else {
        text += `\r\nDB_PASSWORD=${pwd}\r\n`;
      }
      fs.writeFileSync(envPath, text);
    }
  } catch {
    /* 写不进去也不影响：用户可手工改 .env */
  }

  console.log('');
  console.log('==============================================');
  console.log('  恢复成功，数据库密码已同步写入 .env');
  console.log('  下一步：双击「启动.bat」启动系统');
  console.log('  登录账号：admin / admin');
  console.log('==============================================');
  console.log('');
})();
