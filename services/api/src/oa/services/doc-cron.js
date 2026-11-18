// ============================================================
// 体系文件定时任务（doc-cron）
// 职责（§4 / §3.2F）：
//   1) ECN 4 小时提醒：ECN 流程实例提交后超 4h 未推进 → 提醒当前审批人
//   2) 外来文件季度评审：external 文件按季度提醒/生成评审计划
//   3) 2 年定期评审：next_review_date 到期 → 提醒责任人 + 生成 doc_review_record
// 设计：与 cron.js 同风格（轻量自调度，不引第三方依赖），并导出 scanAll() 供 38 号接口手动触发。
// ============================================================
import { many, one, query } from '../db/index.js';
import { notify } from './notify.js';

const ECN_DEF_CODES = ['ecn', 'bom_change'];   // ECN 相关流程 code
const ECN_HOURS = 4;

/**
 * ECN 4 小时提醒：找出提交超 4h 仍在 running 且当前节点有 assigned 待办的实例，
 * 提醒其当前审批人（同一实例同一用户 24h 内只提醒一次，靠 notification 去重）。
 * @returns {Promise<number>} 处理条数
 */
export async function scanEcnReminders() {
  const stuck = await many(
    `SELECT i.id, i.instance_no, i.title, i.submitted_at, i.current_index, fd.code AS def_code
       FROM flow_instance i JOIN flow_definition fd ON fd.id = i.definition_id
      WHERE fd.code = ANY($1)
        AND i.status = 'running'
        AND i.submitted_at IS NOT NULL
        AND i.submitted_at <= now() - ($2 || ' hours')::interval`,
    [ECN_DEF_CODES, ECN_HOURS]
  );
  let n = 0;
  for (const inst of stuck) {
    const tasks = await many(
      `SELECT id, assignee_id FROM flow_task
        WHERE instance_id = $1 AND node_index = $2 AND status = 'assigned'`,
      [inst.id, inst.current_index]
    );
    for (const t of tasks) {
      // 去重：同人同实例 24h 内已有 ECN 提醒则跳过
      const existed = await one(
        `SELECT id FROM notification
          WHERE user_id = $1 AND category = 'reminder'
            AND content LIKE $2 AND created_at >= now() - interval '24 hours'`,
        [t.assignee_id, `%${inst.instance_no}%`]
      );
      if (existed) continue;
      await notify(t.assignee_id, {
        title: `【ECN 超时提醒】${inst.title}`,
        content: `流程 ${inst.instance_no} 已提交超过 ${ECN_HOURS} 小时仍未处理，请尽快审批。`,
        link: `/flow/detail/${inst.id}`,
        category: 'reminder',
      });
      n++;
    }
  }
  return n;
}

/** 当前季度串，如 2026Q4 */
function currentQuarter(d = new Date()) {
  return `${d.getFullYear()}Q${Math.floor(d.getMonth() / 3) + 1}`;
}

/**
 * 外来文件季度评审：对 category='external' 且本季度尚未评审的文件，
 * 生成 doc_review_record（plan_date=今天）并提醒体系工程师。
 * @returns {Promise<number>} 处理条数
 */
export async function scanExternalQuarterly() {
  const quarter = currentQuarter();
  const external = await many(
    `SELECT d.id, d.code, d.title, d.external_source, d.owner_dept_id,
            e.last_review_quarter
       FROM doc_system d LEFT JOIN doc_external_record e ON e.doc_id = d.id
      WHERE d.category = 'external'
        AND d.status <> 'obsolete'
        AND (e.last_review_quarter IS NULL OR e.last_review_quarter <> $1)`,
    [quarter]
  );
  const reviewer = await one(
    `SELECT u.id FROM org_user u
       JOIN sys_user_role ur ON ur.user_id = u.id
       JOIN sys_role r ON r.id = ur.role_id
      WHERE r.code = 'sys_eng' AND u.active = TRUE LIMIT 1`
  );
  let n = 0;
  for (const d of external) {
    // 本季度是否已有记录
    const existed = await one(
      `SELECT id FROM doc_review_record
        WHERE doc_id = $1 AND review_type = 'external_quarterly'
          AND to_char(plan_date, 'YYYY"Q"Q') = $2`,
      [d.id, quarter]
    );
    if (existed) continue;
    await query(
      `INSERT INTO doc_review_record (doc_id, review_type, plan_date, reviewer_id, remark)
       VALUES ($1, 'external_quarterly', CURRENT_DATE, $2, $3)`,
      [d.id, reviewer?.id || null, `外来文件 ${quarter} 季度评审计划`]
    );
    // 关联 external_record 的最近季度标记
    await query(
      `INSERT INTO doc_external_record (doc_id, last_review_quarter)
       VALUES ($1, $2)
       ON CONFLICT (doc_id) DO UPDATE SET updated_at = now()`,
      [d.id, quarter]
    );
    if (reviewer?.id) {
      await notify(reviewer.id, {
        title: `【外来文件季度评审】${d.code}`,
        content: `外来文件 ${d.title} 需进行 ${quarter} 季度评审。`,
        link: `/docs/${d.id}`,
        category: 'todo',
      });
    }
    n++;
  }
  return n;
}

/**
 * 2 年定期评审：next_review_date <= 今天 的文件，生成 periodic 评审记录并提醒责任人。
 * @returns {Promise<number>} 处理条数
 */
export async function scanPeriodicReview() {
  const due = await many(
    `SELECT d.id, d.code, d.title, d.next_review_date, d.owner_dept_id, d.created_by
       FROM doc_system d
      WHERE d.status = 'published'
        AND d.next_review_date IS NOT NULL
        AND d.next_review_date <= CURRENT_DATE
        AND NOT EXISTS (
          SELECT 1 FROM doc_review_record r
           WHERE r.doc_id = d.id AND r.review_type = 'periodic'
             AND r.done_date IS NULL
        )`
  );
  let n = 0;
  for (const d of due) {
    await query(
      `INSERT INTO doc_review_record (doc_id, review_type, plan_date, remark)
       VALUES ($1, 'periodic', CURRENT_DATE, $2)`,
      [d.id, `定期评审到期（原定 ${d.next_review_date}）`]
    );
    const target = d.created_by;
    if (target) {
      await notify(target, {
        title: `【定期评审到期】${d.code}`,
        content: `${d.title} 已到定期评审期（${d.next_review_date}），请安排评审。`,
        link: `/docs/${d.id}`,
        category: 'reminder',
      });
    }
    n++;
  }
  return n;
}

/**
 * 全量扫描（供 38 号接口 POST /api/docs/cron/scan 手动触发）。
 * @returns {Promise<{ecn:number, external:number, periodic:number}>}
 */
export async function scanAll() {
  const ecn = await scanEcnReminders();
  const external = await scanExternalQuarterly();
  const periodic = await scanPeriodicReview();
  return { ecn, external, periodic };
}

export default { scanEcnReminders, scanExternalQuarterly, scanPeriodicReview, scanAll };
