// One-way file-byte pull: running OA (100.107.212.49:8090) → local oa-uploads.
// oa.attachment.file_path is relative to the source uploads root
// (D:\OA\app\server\uploads). The SMT OA module serves /api/files/<rel> from
// services/api/oa-uploads (config UPLOAD_DIR), so copying bytes under the same
// relative path makes every existing doc/drive download link work unchanged.
// Resumable: skips files already present with matching size. Auth: OA session
// token via /api/auth/login (credentials read from sys_param liveoa.*).
// Usage: node scripts/pull-oa-attachments.mjs [--dry]
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const DRY = process.argv.includes("--dry");
const ROOT = path.resolve(import.meta.dirname, "..", "services", "api", "oa-uploads");
const env = Object.fromEntries(
  fs.readFileSync(path.join(import.meta.dirname, "..", "services", "api", ".env"), "utf8")
    .split(/\r?\n/).filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const c = new pg.Client({ host: env.PGHOST, port: +env.PGPORT, user: env.PGUSER, password: env.PGPASSWORD, database: env.PGDATABASE });
await c.connect();

const p = await c.query(`SELECT param_key, param_val FROM sys_param WHERE param_key IN ('liveoa.base_url','liveoa.account','liveoa.password')`);
const cfg = Object.fromEntries(p.rows.map((r) => [r.param_key, r.param_val]));
const base = (cfg["liveoa.base_url"] || "http://100.107.212.49:8090").replace(/\/+$/, "");
if (!cfg["liveoa.account"] || !cfg["liveoa.password"]) { console.error("liveoa.* credentials missing in sys_param"); process.exit(1); }

const login = await fetch(`${base}/api/auth/login`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: cfg["liveoa.account"], password: cfg["liveoa.password"] }),
});
const lj = await login.json().catch(() => null);
const token = lj?.data?.token;
if (!token) { console.error("OA login failed:", JSON.stringify(lj).slice(0, 160)); process.exit(2); }
const H = { authorization: `Bearer ${token}` };

const rows = (await c.query(`SELECT file_path, file_size FROM oa.attachment WHERE file_path IS NOT NULL AND file_path <> '' ORDER BY id`)).rows;
console.log(`attachments to mirror: ${rows.length}; root ${ROOT}`);

let ok = 0, skip = 0, fail = 0;
for (const r of rows) {
  const rel = String(r.file_path).split("\\").join("/");
  if (rel.includes("..") || path.isAbsolute(rel)) { console.warn("unsafe path skipped:", rel); fail++; continue; }
  const dst = path.join(ROOT, rel);
  if (!DRY && fs.existsSync(dst) && fs.statSync(dst).size === Number(r.file_size || 0)) { skip++; continue; }
  if (DRY) { ok++; continue; }
  try {
    const res = await fetch(`${base}/api/files/${rel.split("/").map(encodeURIComponent).join("/")}`, { headers: H, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) { console.warn(`  ${res.status} ${rel}`); fail++; continue; }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(dst, buf);
    if (Number(r.file_size || 0) && buf.length !== Number(r.file_size)) console.warn(`  size mismatch ${rel}: ${buf.length} vs ${r.file_size}`);
    ok++;
  } catch (e) { console.warn(`  ERR ${rel}: ${String(e.message).slice(0, 80)}`); fail++; }
}
console.log(`done: copied ${ok}, already-present ${skip}, failed ${fail}`);
await c.end();
process.exit(fail ? 3 : 0);
