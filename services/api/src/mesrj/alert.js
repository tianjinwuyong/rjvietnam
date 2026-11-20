/**
 * 预警巡检（源 analyze.py alert center + run.py 的 alert 扫描线程）
 *
 * 规则在 cfg_alert_rule：数据源 + 条件（>/>=/</<=/==）+ 阈值 + 级别。
 * 当前指标口径：最近 N 天 prd_machine_data 按工位算不良率（与看板一致）。
 * 同一 rule_key + 工位已有「待处理」预警时不再重复写（源行为：去重，不刷屏）。
 *
 * 两个入口共用这一份逻辑：GET /alert/check（页面点一下）和
 * mesrj-scheduler 的 jobAlert（alert.scan_minutes 定时跑）。
 */
import { query } from "../db.js";

const WINDOW_DAYS = 1;

function hit(cond, rate, val) {
  const c = String(cond || "").trim();
  if (c === ">") return rate > val;
  if (c === ">=") return rate >= val;
  if (c === "<") return rate < val;
  if (c === "<=") return rate <= val;
  if (c === "=" || c === "==") return rate === val;
  return false;
}

/** 评估所有启用的规则，超阈值的写 prd_alert；返回本次新产生的预警。 */
export async function checkAlerts() {
  const rules = (await query("SELECT * FROM cfg_alert_rule WHERE enabled=1 ORDER BY id")).rows;
  const stats = (await query(
    `SELECT station_code,
            COUNT(*) AS total,
            COUNT(CASE WHEN UPPER(COALESCE(pass_ng,'')) IN ('NG','FAIL') THEN 1 END) AS ng_qty,
            ROUND(100.0 * COUNT(CASE WHEN UPPER(COALESCE(pass_ng,'')) IN ('NG','FAIL') THEN 1 END)
                  / NULLIF(COUNT(*),0), 2) AS ng_rate
       FROM prd_machine_data
       WHERE created_at >= now() - ($1::int || ' days')::interval
       GROUP BY station_code`, [WINDOW_DAYS])).rows;

  const created = [];
  for (const r of rules) {
    const val = Number(r.value || 0);
    for (const s of stats) {
      const rate = Number(s.ng_rate || 0);
      if (!hit(r.cond, rate, val)) continue;
      const code = s.station_code;
      const dup = (await query(
        "SELECT id FROM prd_alert WHERE rule_key=$1 AND station_code=$2 AND status='待处理' LIMIT 1",
        [r.rule_key, code])).rows[0];
      if (dup) continue;
      await query(
        `INSERT INTO prd_alert (rule_key,rule_name,level,title,detail,ref_sn,station_code,status,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'待处理',now())`,
        [r.rule_key, r.rule_name, r.level || "普通",
         `预警触发：${r.rule_name || r.rule_key}`,
         `工位 ${code} 不良率 ${rate}% 超过阈值 ${val}${r.unit || ""}`,
         "", code]);
      created.push({ rule_key: r.rule_key, station_code: code, ng_rate: rate });
    }
  }
  return created;
}
