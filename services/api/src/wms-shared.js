// WMS 共享小工具（阶段3轮2 从 server.js 迁出；server.js 与 wms-inventory-flow.js 共用）。
import { query } from "./db.js";

export function resolveOperatorId(operator) {
  if (!operator) return Promise.resolve(null);
  if (/^\d+$/.test(String(operator))) {
    return query("SELECT id FROM users WHERE id = $1", [operator]).then(r => r.rows[0]?.id ?? null);
  }
  return query("SELECT id FROM users WHERE username = $1", [operator]).then(r => r.rows[0]?.id ?? null);
}
