// check-integration-contracts.mjs — 集成协议门禁（轻量静态检查）
// 协议: docs/integration/smt-subsystem-protocol.md
// 红线:
//   1. flow_webhook_outbox 被 services/ 引用但没有任何迁移创建它
//   2. 协议文档缺失或六条裁决被静默删除
//   3. contracts/*.md 契约文件缺必备小节
//   4. SMT 侧注册了 /api/health（该路径专属外部子系统，SMT 不得占用）
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const warnings = [];

function walk(dir, ext, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, ext, out);
    else if (e.name.endsWith(ext)) out.push(p);
  }
  return out;
}
function grepFiles(files, pattern) {
  const hits = [];
  for (const f of files) {
    try {
      if (pattern.test(readFileSync(f, 'utf8'))) hits.push(f);
    } catch { /* unreadable: skip */ }
  }
  return hits;
}

// ── 1. outbox 被引用必须有迁移 ────────────────────────────────────────────
const serviceFiles = walk(join(root, 'services'), '.js');
const outboxRefs = grepFiles(serviceFiles, /flow_webhook_outbox/);
const migrationFiles = walk(join(root, 'database', 'migrations'), '.sql');
const outboxDdl = grepFiles(migrationFiles, /CREATE TABLE (IF NOT EXISTS )?flow_webhook_outbox/);
if (outboxRefs.length > 0 && outboxDdl.length === 0) {
  failures.push(`flow_webhook_outbox 被 ${outboxRefs.length} 个文件引用但无迁移创建: ${outboxRefs.slice(0, 3).join(', ')}`);
}

// ── 2. 协议文档存在且六条裁决在位 ─────────────────────────────────────────
const protocolPath = join(root, 'docs', 'integration', 'smt-subsystem-protocol.md');
const protocolMarkers = [
  ['ruling-db-direct', /数据库直连豁免/],
  ['ruling-scope', /数据源归属区分/],
  ['ruling-health-dual', /SMT 自身健康端点：\*\*只有 `\/health`\*\*/],
  ['ruling-idempotency', /相同 payload：直接返回上次成功结果/],
  ['ruling-auth-me', /以 401 为健康/],
  ['ruling-cursor', /source_updated_at, source_id/],
  ['ruling-401', /\| 401 \|/],
  ['ruling-command-status', /commands\/\{command_id\}/],
];
if (!existsSync(protocolPath)) {
  failures.push('协议文档缺失: docs/integration/smt-subsystem-protocol.md');
} else {
  const text = readFileSync(protocolPath, 'utf8');
  for (const [name, re] of protocolMarkers) {
    if (!re.test(text)) failures.push(`协议文档缺少裁决标记 ${name}（被删改？）`);
  }
}

// ── 3. 契约文件必备小节 ──────────────────────────────────────────────────
const contractsDir = join(root, 'docs', 'integration', 'contracts');
const requiredSections = ['字段与写权威', 'external_id 映射', '幂等键', '频率与 SLA', '变更评审人'];
if (existsSync(contractsDir)) {
  for (const f of readdirSync(contractsDir).filter(n => n.endsWith('.md'))) {
    const text = readFileSync(join(contractsDir, f), 'utf8');
    for (const s of requiredSections) {
      if (!text.includes(s)) failures.push(`契约 ${f} 缺必备小节「${s}」`);
    }
  }
} else {
  warnings.push('docs/integration/contracts/ 尚不存在（首个 provider 接入前必须建立）');
}

// ── 4. /api/health 是外部子系统专属，SMT 不得注册 ─────────────────────────
const apiFiles = [join(root, 'services', 'api', 'server.js'), ...walk(join(root, 'services', 'api', 'src'), '.js'), ...walk(join(root, 'services', 'api', 'routes'), '.js')];
const reserved = grepFiles(apiFiles.filter(existsSync), /['"`]\/api\/health['"`]/);
if (reserved.length > 0) {
  failures.push(`SMT 侧注册了保留路径 /api/health（协议 §2.3：该路径专属外部子系统）: ${reserved.join(', ')}`);
}

// ── 结果 ─────────────────────────────────────────────────────────────────
for (const w of warnings) console.warn(`INTEGRATION_CONTRACTS_WARN ${w}`);
if (failures.length > 0) {
  for (const f of failures) console.error(`INTEGRATION_CONTRACTS_FAIL ${f}`);
  console.error(`INTEGRATION_CONTRACTS_FAILED failures=${failures.length} warnings=${warnings.length}`);
  process.exit(1);
}
console.log(`INTEGRATION_CONTRACTS_OK outboxRefs=${outboxRefs.length} outboxDdl=${outboxDdl.length} protocolMarkers=${protocolMarkers.length} contractsLinted=${existsSync(contractsDir) ? readdirSync(contractsDir).filter(n => n.endsWith('.md')).length : 0} warnings=${warnings.length}`);
