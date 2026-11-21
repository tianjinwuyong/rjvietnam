// ============================================================
// 巡线记录（IPQC）/ 首件记录（FAI）服务 —— 「Excel 导入模板 + 富文本填写」模型
// ------------------------------------------------------------
// 设计见 deliverables/巡线首件改造-记录.md §1。
// 核心范式（与原「结构化逐项判定」不同）：
//   · 模板 = 管理员导入的 Excel → 富文本底稿 HTML（content）+ 原 Excel 归档（source_file_id）
//   · 记录 = 创建时**复制模板 content 作为起点（快照）**，提交后固定；后续改模板不影响已存记录
//   · 不再逐项判定 ok/ng：异常由**人工标注 + 一键上报**品质异常单（ipqc_issue 流程）
//   · 任务制保留：generateIpqcTasks 仍每日按「启用且有产线」的模板生成 pending 任务
// ============================================================
import { many, one, query, transaction } from '../db/index.js';
import { notify } from './notify.js';
import { dateParam } from '../utils/params.js';
import { normJudgeConfig } from '../utils/judge-config.js';

/** DB 侧 today（Asia/Shanghai 语义由 DB 决定） */
async function dbToday() {
  const r = await one(`SELECT current_date::text AS d`);
  return r?.d || new Date().toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' 归一；非法返回 null */
export function parseDate(v) {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/**
 * 版面方向归一：只认 portrait（纵向）/ landscape（横向），其余一律回落纵向。
 * 三张模板表（巡线/首件/点检）共用同一取值域，DB 侧还有 CHECK 兜底。
 */
export function normOrientation(v) {
  return v === 'landscape' ? 'landscape' : 'portrait';
}

function todayStr() { return new Date().toISOString().slice(0, 10); }

/** 纯文本化（用于异常单描述：剥离 HTML 标签） */
function stripTags(html) {
  return String(html == null ? '' : html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * N-2 纵深防御：写库前剥离正文 img src 上的会话 token。
 * 与前端 `web/src/utils/imgTokens.js` 为等价实现（服务端不能 import 前端模块）；
 * 前端已剥离是主防线，此处为"未来前端遗漏"的兜底，保证 DB 永不落 token。
 */
function stripTokens(html) {
  return String(html == null ? '' : html).replace(/(\/api\/files\/[^"'\s?]+)\?token=[^"'\s&]+/g, '$1');
}
/** null 透传 + 剥离（保持"未提供则不改"的 COALESCE 语义） */
function cleanContent(v) {
  return v === undefined || v === null ? null : stripTokens(v);
}

/**
 * 创建品质异常单（ipqc_issue 流程）。
 * 事务外调用：记录已落库是事实，流程单失败不回滚，由调用方通过 error 感知。
 */
export async function triggerIssueFlow({ defCode, userId, title, formData }) {
  if (!userId) {
    const error = '缺少发起人（userId 为空），无法创建异常流程单';
    console.warn(`[ipqc] ${error}`);
    return { instanceId: null, error };
  }
  try {
    const def = await one(`SELECT id FROM flow_definition WHERE code = $1 AND active = TRUE`, [defCode]);
    if (!def) return { instanceId: null, error: `未找到启用的 ${defCode} 流程定义` };
    const { createInstance } = await import('./flow-engine.js');
    const inst = await createInstance({ definitionId: def.id, userId, title, formData });
    return { instanceId: inst.id, error: null };
  } catch (err) {
    console.warn(`[ipqc] 异常触发流程单失败：`, err.message);
    return { instanceId: null, error: err.message };
  }
}

/** 通用筛选条件拼装（数组参数风格） */
function buildWhere(conds, params) {
  const parts = [];
  for (const [col, val] of conds) {
    if (val === undefined || val === null || val === '') continue;
    if (col.endsWith('__like')) {
      params.push(`%${val}%`);
      parts.push(`${col.slice(0, -6)} ILIKE $${params.length}`);
    } else if (col.endsWith('__date')) {
      params.push(val);
      parts.push(`${col.slice(0, -6)}::date = $${params.length}::date`);
    } else if (col.endsWith('__from')) {
      params.push(val);
      parts.push(`${col.slice(0, -6)}::date >= $${params.length}::date`);
    } else if (col.endsWith('__to')) {
      params.push(val);
      parts.push(`${col.slice(0, -4)}::date <= $${params.length}::date`);
    } else {
      params.push(val);
      parts.push(`${col} = $${params.length}`);
    }
  }
  return parts.length ? parts.join(' AND ') : 'TRUE';
}

/* ============================================================
 * 一、IPQC 巡线模板
 * ============================================================ */
export async function listIpqcTemplates({ keyword, line, active, scope } = {}) {
  const params = [];
  const where = buildWhere([
    ['t.name__like', keyword],
    ['t.line', line],
    ['t.active', active === undefined || active === '' || active === null ? null : (active === true || active === 'true' || active === '1')],
    ['t.scope', scope || null],
  ], params);
  return many(
    `SELECT t.*, a.file_path AS source_file_path, a.file_name AS source_file_name, u.real_name AS creator_name
       FROM ipqc_template t
       LEFT JOIN attachment a ON a.id = t.source_file_id
       LEFT JOIN org_user u ON u.id = t.created_by
      WHERE ${where} ORDER BY t.active DESC, t.id DESC`, params
  );
}

export async function getIpqcTemplate(id) {
  return one(
    `SELECT t.*, a.file_path AS source_file_path, a.file_name AS source_file_name
       FROM ipqc_template t
       LEFT JOIN attachment a ON a.id = t.source_file_id
      WHERE t.id = $1`, [id]
  );
}

export async function createIpqcTemplate(data = {}) {
  if (!data.code || !data.name) throw new Error('请填写模板编号与名称');
  const dup = await one(`SELECT id FROM ipqc_template WHERE code = $1`, [data.code]);
  if (dup) throw Object.assign(new Error(`模板编号「${data.code}」已存在`), { statusCode: 409 });
  return one(
    `INSERT INTO ipqc_template (code, name, name_vi, line, shift, description, description_vi,
                                content, source_file_id, active, created_by, page_orientation, judge_config, scope)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [data.code, data.name, data.nameVi || null, data.line || null, data.shift || null,
     data.description || null, data.descriptionVi || null,
     cleanContent(data.content), data.sourceFileId || null,
     data.active === undefined ? true : !!data.active, data.createdBy || null,
     normOrientation(data.pageOrientation ?? data.page_orientation),
     normJudgeConfig(data.judgeConfig !== undefined ? data.judgeConfig : data.judge_config),
     // 模板归属白名单：巡检 / 来料 / 出货（未知值一律落巡检，避免脏数据）
     ['ipqc', 'iqc', 'oqc'].includes(data.scope) ? data.scope : 'ipqc']
  );
}

export async function updateIpqcTemplate(id, data = {}) {
  const cur = await one(`SELECT * FROM ipqc_template WHERE id = $1`, [id]);
  if (!cur) throw new Error('巡线模板不存在');
  if (data.code && data.code !== cur.code) {
    const dup = await one(`SELECT id FROM ipqc_template WHERE code = $1 AND id <> $2`, [data.code, id]);
    if (dup) throw Object.assign(new Error(`模板编号「${data.code}」已存在`), { statusCode: 409 });
  }
  return one(
    `UPDATE ipqc_template SET
       code = COALESCE($2, code), name = COALESCE($3, name), name_vi = COALESCE($4, name_vi),
       line = COALESCE($5, line), shift = COALESCE($6, shift),
       description = COALESCE($7, description), description_vi = COALESCE($8, description_vi),
       content = COALESCE($9, content), source_file_id = COALESCE($10, source_file_id),
       active = COALESCE($11, active), page_orientation = COALESCE($12, page_orientation),
       judge_config = CASE WHEN $13::boolean THEN $14::jsonb ELSE judge_config END,
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, data.code || null, data.name || null, data.nameVi || null, data.line ?? null, data.shift ?? null,
     data.description ?? null, data.descriptionVi ?? null, cleanContent(data.content),
     data.sourceFileId || null, (data.active === undefined ? null : !!data.active),
     (data.pageOrientation ?? data.page_orientation) === undefined
       ? null : normOrientation(data.pageOrientation ?? data.page_orientation),
     (data.judgeConfig !== undefined || data.judge_config !== undefined),
     JSON.stringify(normJudgeConfig(data.judgeConfig !== undefined ? data.judgeConfig : data.judge_config) ?? null)]
  );
}

export async function deleteIpqcTemplate(id) {
  const used = await one(`SELECT COUNT(*)::int AS c FROM ipqc_record WHERE template_id = $1`, [id]);
  if (used?.c > 0) throw new Error(`该模板已被 ${used.c} 条记录引用，禁止删除（可停用）`);
  // 任务表对模板有外键：存在任务历史时同样禁止删除，避免抛原始外键错误
  const tasked = await one(`SELECT COUNT(*)::int AS c FROM ipqc_task WHERE template_id = $1`, [id]);
  if (tasked?.c > 0) throw new Error(`该模板已有 ${tasked.c} 条巡线任务记录，禁止删除（可停用）`);
  await query(`DELETE FROM ipqc_template WHERE id = $1`, [id]);
  return { id: Number(id) };
}

/* ============================================================
 * 二、IPQC 巡线记录
 * ============================================================ */
export async function listIpqcRecords({ line, shift, status, abnormal, result, from, to, keyword, templateId } = {}) {
  const params = [];
  const where = buildWhere([
    ['r.line', line], ['r.shift', shift], ['r.status', status],
    ['r.abnormal', abnormal === undefined || abnormal === '' || abnormal === null ? null : (abnormal === true || abnormal === 'true' || abnormal === '1')],
    ['r.result', result],
    ['r.template_id', templateId],
    ['r.check_date__from', dateParam(from, '起始')], ['r.check_date__to', dateParam(to, '结束')],
    ['r.line__like', keyword],
  ], params);
  return many(
    `SELECT r.id, r.template_id, r.template_name, r.task_id, r.line, r.shift, r.check_date,
            r.checker_id, r.inspected_at, r.result, r.status, r.abnormal, r.abnormal_note,
            r.remark, r.ipqc_instance_id, r.created_at,
            u.real_name AS checker_name
       FROM ipqc_record r LEFT JOIN org_user u ON u.id = r.checker_id
      WHERE ${where}
      ORDER BY r.check_date DESC, r.id DESC LIMIT 500`, params
  );
}

export async function getIpqcRecord(id) {
  const r = await one(
    `SELECT r.*, u.real_name AS checker_name,
            COALESCE(t.page_orientation, 'portrait') AS page_orientation,
            t.judge_config AS judge_config
       FROM ipqc_record r
       LEFT JOIN org_user u ON u.id = r.checker_id
       LEFT JOIN ipqc_template t ON t.id = r.template_id
      WHERE r.id = $1`, [id]
  );
  if (!r) throw new Error('巡线记录不存在');
  return r;
}

/** 创建记录：content 默认复制模板底稿（快照原则） */
export async function createIpqcRecord(data = {}) {
  if (!data.templateId) throw new Error('请选择巡线模板');
  const tpl = await one(`SELECT id, code, name, line, shift, content FROM ipqc_template WHERE id = $1`, [data.templateId]);
  if (!tpl) throw new Error('巡线模板不存在');

  const line = data.line || tpl.line || null;
  const shift = data.shift || tpl.shift || null;
  const checkDate = parseDate(data.checkDate || data.check_date) || await dbToday();
  const submit = data.status === 'submitted';

  const rec = await transaction(async (client) => {
    const row = (await client.query(
      `INSERT INTO ipqc_record
         (template_id, template_name, task_id, line, shift, check_date, checker_id, inspected_at,
          result, remark, content, status, abnormal, abnormal_note)
       VALUES ($1,$2,$3,$4,$5,$6::date,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [tpl.id, tpl.name, data.taskId || null, line, shift, checkDate, data.checkerId || null,
       submit ? new Date() : null, data.abnormal ? 'ng' : 'ok', data.remark || null,
       cleanContent(data.content) ?? (cleanContent(tpl.content) ?? null), submit ? 'submitted' : 'draft',
       !!data.abnormal, data.abnormalNote || null]
    )).rows[0];
    if (data.taskId) {
      await client.query(`UPDATE ipqc_task SET status='done', done_at=now() WHERE id=$1 AND status <> 'done'`, [data.taskId]);
    }
    return row;
  });
  return rec;
}

/** 更新记录：仅草稿可改；提交为一次性动作 */
export async function updateIpqcRecord(id, userId, data = {}, isAdmin = false) {
  const cur = await one(`SELECT * FROM ipqc_record WHERE id = $1`, [id]);
  if (!cur) throw new Error('巡线记录不存在');
  if (cur.status === 'submitted') throw new Error('记录已提交，不可修改');
  if (!isAdmin && userId && cur.checker_id && Number(cur.checker_id) !== Number(userId)) {
    throw new Error('仅本人或管理员可修改该记录');
  }
  const submit = data.status === 'submitted';
  const rec = await transaction(async (client) => {
    const row = (await client.query(
      `UPDATE ipqc_record SET
         content = COALESCE($2, content),
         remark = COALESCE($3, remark),
         abnormal = COALESCE($4, abnormal),
         abnormal_note = COALESCE($5, abnormal_note),
         status = CASE WHEN $6 THEN 'submitted' ELSE status END,
         inspected_at = CASE WHEN $6 THEN now() ELSE inspected_at END,
         result = CASE WHEN $4 IS TRUE THEN 'ng' WHEN $6 THEN COALESCE(result,'ok') ELSE result END,
         task_id = COALESCE($7, task_id)
       WHERE id = $1 RETURNING *`,
      [id, cleanContent(data.content), data.remark ?? null,
       (data.abnormal === undefined ? null : !!data.abnormal), data.abnormalNote ?? null,
       submit, data.taskId || null]
    )).rows[0];
    if (submit && data.taskId) {
      await client.query(`UPDATE ipqc_task SET status='done', done_at=now() WHERE id=$1 AND status <> 'done'`, [data.taskId]);
    }
    return row;
  });
  return rec;
}

/** 一键上报品质异常单（人工口径） */
/**
 * 人工上报品质异常单。
 *
 * F-07（TOCTOU 修复，P1 改为 claim 行，避免持锁占用连接池）：
 *   · 原实现「先查空 → 建流程单 → 回写」，并发 6 次会建 6 张单；
 *   · 先用 ipqc_issue_claim 原子认领（INSERT ... ON CONFLICT DO NOTHING + TTL），
 *     认领成功者建单并原子回写；未认领者轮询等待结果（期间不持有连接）；
 *   · 进程崩溃时 claim 行靠 TTL（3 分钟）自动失效，不会永久卡死；
 *   · 库侧再以部分唯一索引兜底（sql/46_ipqc_issue_unique.sql）。
 * 不采用 advisory lock：它需要独占一个池连接直至建单结束，DB_POOL_MAX=10 下并发上报会放大池占用。
 */
const REPORT_CLAIM_TTL = '3 minutes';
const REPORT_LOCK_WAIT_MS = 15000;

/** 原子认领某条记录的上报权；返回 true=本次抢到（含 TTL 过期后接棒） */
async function claimReport(recordId) {
  const r = await query(
    `INSERT INTO ipqc_issue_claim (record_id, expires_at)
     VALUES ($1, now() + interval '${REPORT_CLAIM_TTL}')
     ON CONFLICT (record_id) DO UPDATE
       SET expires_at = now() + interval '${REPORT_CLAIM_TTL}', claimed_at = now()
       WHERE ipqc_issue_claim.expires_at < now()
     RETURNING record_id`,
    [recordId]
  );
  return r.rowCount > 0;
}

async function releaseReportClaim(recordId) {
  await query(`DELETE FROM ipqc_issue_claim WHERE record_id = $1`, [recordId]).catch(() => {});
}

export async function reportIpqcIssue(id, userId) {
  const rec = await one(`SELECT * FROM ipqc_record WHERE id = $1`, [id]);
  if (!rec) throw new Error('巡线记录不存在');
  if (rec.ipqc_instance_id) return { instanceId: rec.ipqc_instance_id, error: null, already: true };

  const already = cur => ({ instanceId: cur?.ipqc_instance_id || null, error: null, already: true });
  let claimed = await claimReport(rec.id);
  if (!claimed) {
    // 他人正在建单：轮询等待回写；对方失败会释放 claim，本请求可接棒
    const deadline = Date.now() + REPORT_LOCK_WAIT_MS;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 150));
      const cur = await one(`SELECT ipqc_instance_id FROM ipqc_record WHERE id = $1`, [id]);
      if (cur?.ipqc_instance_id) return already(cur);
      claimed = await claimReport(rec.id);
      if (claimed) break;
    }
    if (!claimed) return { instanceId: null, error: '该记录正在上报异常单，请稍后刷新查看', already: false };
  }

  try {
    // 认领后复查：等待期间可能已被前一请求处理完
    const fresh = await one(`SELECT * FROM ipqc_record WHERE id = $1`, [id]);
    if (fresh?.ipqc_instance_id) return already(fresh);

    const { instanceId, error } = await triggerIssueFlow({
      defCode: 'ipqc_issue',
      userId,
      title: `巡线异常-${fresh.line || '未知产线'}(${fresh.check_date instanceof Date ? fresh.check_date.toISOString().slice(0, 10) : String(fresh.check_date).slice(0, 10)})`,
      formData: {
        issue_date: fresh.check_date instanceof Date ? fresh.check_date.toISOString().slice(0, 10) : String(fresh.check_date).slice(0, 10),
        wo_no: `IPQC-${fresh.id}`,
        product_model: fresh.template_name || '巡线模板',
        process: fresh.line || 'IPQC 巡线',
        ng_qty: 1,
        phenomenon: fresh.abnormal_note || stripTags(fresh.content).slice(0, 500) || '巡线发现异常',
        urgent_action: '巡线发现异常，请品质主管评审处置',
      },
    });
    if (instanceId) {
      const upd = await query(
        `UPDATE ipqc_record SET ipqc_instance_id=$2, result='ng', abnormal=TRUE
          WHERE id=$1 AND ipqc_instance_id IS NULL`,
        [fresh.id, instanceId]
      );
      if (!upd.rowCount) {
        // 兜底（跨实例竞态）：本次多建的实例回滚掉，返回既有单号
        await query(`DELETE FROM flow_instance WHERE id = $1`, [instanceId]).catch(() => {});
        const cur = await one(`SELECT ipqc_instance_id FROM ipqc_record WHERE id = $1`, [id]);
        return already(cur);
      }
    } else if (userId) {
      await notify(userId, {
        title: `【异常单创建失败】${fresh.line || '未知产线'}巡线异常`,
        content: `巡线记录#${fresh.id} 上报异常失败：${error}。请联系品质主管手工开单。`,
        link: '/ipqc/records', category: 'system',
      }).catch(() => {});
    }
    return { instanceId, error };
  } finally {
    await releaseReportClaim(rec.id);
  }
}

/* ============================================================
 * 三、IPQC 巡线任务生成（保留任务制；不再读结构化项）
 * ============================================================ */
/**
 * 每日为「启用且配置了产线」的模板各生成 1 条 pending 任务（幂等）。
 * 幂等键沿用 uk_ipqctask_pending(template_id, line, shift, plan_date) WHERE status='pending'。
 * 任务只是「何时去巡线」的提醒，与「用什么表填」正交；首页日历聚合读本表，结构未变。
 * @param {string} [today] 便于测试注入
 * @returns {Promise<number>} 新建任务数
 */
export async function generateIpqcTasks(today) {
  const planDate = parseDate(today) || await dbToday();
  const tpls = await many(
    `SELECT id, code, name, line, shift FROM ipqc_template
      WHERE active = TRUE AND line IS NOT NULL AND line <> ''`
  );
  let created = 0;
  for (const tpl of tpls) {
    // 巡线员：优先 quality 角色，退化任意在职
    const staff = await one(
      `SELECT u.id FROM org_user u
         JOIN sys_user_role ur ON ur.user_id = u.id
         JOIN sys_role r ON r.id = ur.role_id
        WHERE r.code = 'quality' AND u.active = TRUE ORDER BY u.id LIMIT 1`
    ) || await one(`SELECT id FROM org_user WHERE active = TRUE ORDER BY id LIMIT 1`);

    // F2：幂等不能只靠部分唯一索引 —— PG 中唯一索引内 NULL 互不相等，
    //      shift 为 NULL 时 (template,line,NULL,plan_date) 两次插入不冲突（实测会重复建）。
    //      故先用 COALESCE(shift,'') 做应用层判重，再以索引兜底（双保险）。
    const dupTask = await one(
      `SELECT 1 FROM ipqc_task
        WHERE template_id = $1 AND line = $2
          AND COALESCE(shift, '') = COALESCE($3::varchar, '')
          AND plan_date = $4::date AND status = 'pending'
        LIMIT 1`,
      [tpl.id, tpl.line, tpl.shift || null, planDate]
    );
    if (dupTask) continue;

    const res = await query(
      `INSERT INTO ipqc_task (template_id, line, shift, plan_date, assignee_id, status)
       VALUES ($1,$2,$3,$4::date,$5,'pending')
       ON CONFLICT (template_id, line, shift, plan_date) WHERE status = 'pending' DO NOTHING
       RETURNING id`,
      [tpl.id, tpl.line, tpl.shift || null, planDate, staff?.id || null]
    );
    if (res.rowCount > 0) {
      created++;
      if (staff?.id) {
        await notify(staff.id, {
          title: `【巡线任务】${tpl.name}`,
          content: `产线「${tpl.line}」${tpl.shift || ''}班次巡线任务已生成（计划 ${planDate}），请前往填写。`,
          link: `/ipqc/fill?taskId=${res.rows[0].id}`,
          category: 'todo',
        });
      }
    }
  }
  return created;
}

/* ============================================================
 * 四、首件 FAI 模板（与 IPQC 同构，头部字段不同）
 * ============================================================ */
export async function listFaiTemplates({ keyword, productCode, active } = {}) {
  const params = [];
  const where = buildWhere([
    ['t.name__like', keyword],
    ['t.product_code', productCode],
    ['t.active', active === undefined || active === '' || active === null ? null : (active === true || active === 'true' || active === '1')],
  ], params);
  return many(
    `SELECT t.*, a.file_path AS source_file_path, a.file_name AS source_file_name, u.real_name AS creator_name
       FROM fai_template t
       LEFT JOIN attachment a ON a.id = t.source_file_id
       LEFT JOIN org_user u ON u.id = t.created_by
      WHERE ${where} ORDER BY t.active DESC, t.id DESC`, params
  );
}

export async function getFaiTemplate(id) {
  return one(
    `SELECT t.*, a.file_path AS source_file_path, a.file_name AS source_file_name
       FROM fai_template t LEFT JOIN attachment a ON a.id = t.source_file_id WHERE t.id = $1`, [id]
  );
}

export async function createFaiTemplate(data = {}) {
  if (!data.code || !data.name) throw new Error('请填写模板编号与名称');
  const dup = await one(`SELECT id FROM fai_template WHERE code = $1`, [data.code]);
  if (dup) throw Object.assign(new Error(`模板编号「${data.code}」已存在`), { statusCode: 409 });
  return one(
    `INSERT INTO fai_template (code, name, name_vi, product_code, process, description, description_vi,
                               content, source_file_id, active, created_by, page_orientation, judge_config)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [data.code, data.name, data.nameVi || null, data.productCode || data.product_code || null,
     data.process || null, data.description || null, data.descriptionVi || null,
     cleanContent(data.content), data.sourceFileId || null,
     data.active === undefined ? true : !!data.active, data.createdBy || null,
     normOrientation(data.pageOrientation ?? data.page_orientation),
     normJudgeConfig(data.judgeConfig !== undefined ? data.judgeConfig : data.judge_config)]
  );
}

export async function updateFaiTemplate(id, data = {}) {
  const cur = await one(`SELECT * FROM fai_template WHERE id = $1`, [id]);
  if (!cur) throw new Error('首件模板不存在');
  if (data.code && data.code !== cur.code) {
    const dup = await one(`SELECT id FROM fai_template WHERE code = $1 AND id <> $2`, [data.code, id]);
    if (dup) throw Object.assign(new Error(`模板编号「${data.code}」已存在`), { statusCode: 409 });
  }
  return one(
    `UPDATE fai_template SET
       code = COALESCE($2, code), name = COALESCE($3, name), name_vi = COALESCE($4, name_vi),
       product_code = COALESCE($5, product_code), process = COALESCE($6, process),
       description = COALESCE($7, description), description_vi = COALESCE($8, description_vi),
       content = COALESCE($9, content), source_file_id = COALESCE($10, source_file_id),
       active = COALESCE($11, active), page_orientation = COALESCE($12, page_orientation),
       judge_config = CASE WHEN $13::boolean THEN $14::jsonb ELSE judge_config END,
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, data.code || null, data.name || null, data.nameVi || null,
     (data.productCode ?? data.product_code ?? null), data.process ?? null,
     data.description ?? null, data.descriptionVi ?? null, cleanContent(data.content),
     data.sourceFileId || null, (data.active === undefined ? null : !!data.active),
     (data.pageOrientation ?? data.page_orientation) === undefined
       ? null : normOrientation(data.pageOrientation ?? data.page_orientation),
     (data.judgeConfig !== undefined || data.judge_config !== undefined),
     JSON.stringify(normJudgeConfig(data.judgeConfig !== undefined ? data.judgeConfig : data.judge_config) ?? null)]
  );
}

export async function deleteFaiTemplate(id) {
  const used = await one(`SELECT COUNT(*)::int AS c FROM fai_record WHERE template_id = $1`, [id]);
  if (used?.c > 0) throw new Error(`该模板已被 ${used.c} 条记录引用，禁止删除（可停用）`);
  await query(`DELETE FROM fai_template WHERE id = $1`, [id]);
  return { id: Number(id) };
}

/* ============================================================
 * 五、首件 FAI 记录
 * ============================================================ */
export async function listFaiRecords({ productCode, status, abnormal, result, from, to, keyword, templateId } = {}) {
  const params = [];
  const where = buildWhere([
    ['r.product_code', productCode], ['r.status', status], ['r.result', result],
    ['r.abnormal', abnormal === undefined || abnormal === '' || abnormal === null ? null : (abnormal === true || abnormal === 'true' || abnormal === '1')],
    ['r.template_id', templateId],
    ['r.inspected_at__from', dateParam(from, '起始')], ['r.inspected_at__to', dateParam(to, '结束')],
    ['r.product_code__like', keyword],
  ], params);
  return many(
    `SELECT r.id, r.template_id, r.template_name, r.product_code, r.batch_no, r.machine_code,
            r.trigger_scene, r.inspector_id, r.inspected_at, r.result, r.status, r.abnormal,
            r.abnormal_note, r.remark, r.ipqc_instance_id, r.created_at,
            u.real_name AS inspector_name
       FROM fai_record r LEFT JOIN org_user u ON u.id = r.inspector_id
      WHERE ${where}
      ORDER BY r.inspected_at DESC NULLS LAST, r.id DESC LIMIT 500`, params
  );
}

export async function getFaiRecord(id) {
  const r = await one(
    `SELECT r.*, u.real_name AS inspector_name,
            COALESCE(t.page_orientation, 'portrait') AS page_orientation,
            t.judge_config AS judge_config
       FROM fai_record r
       LEFT JOIN org_user u ON u.id = r.inspector_id
       LEFT JOIN fai_template t ON t.id = r.template_id
      WHERE r.id = $1`, [id]
  );
  if (!r) throw new Error('首件记录不存在');
  return r;
}

export async function createFaiRecord(data = {}) {
  if (!data.templateId) throw new Error('请选择首件模板');
  const tpl = await one(`SELECT id, code, name, product_code, process, content FROM fai_template WHERE id = $1`, [data.templateId]);
  if (!tpl) throw new Error('首件模板不存在');
  const submit = data.status === 'submitted';
  return one(
    `INSERT INTO fai_record
       (template_id, template_name, product_code, batch_no, machine_code, trigger_scene,
        inspector_id, inspected_at, result, remark, content, status, abnormal, abnormal_note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [tpl.id, tpl.name, data.productCode || data.product_code || tpl.product_code || null,
     data.batchNo || data.batch_no || null, data.machineCode || data.machine_code || null,
     data.triggerScene || data.trigger_scene || null, data.inspectorId || null,
     submit ? new Date() : null, data.abnormal ? 'ng' : 'ok', data.remark || null,
     cleanContent(data.content) ?? (cleanContent(tpl.content) ?? null), submit ? 'submitted' : 'draft',
     !!data.abnormal, data.abnormalNote || null]
  );
}

export async function updateFaiRecord(id, userId, data = {}, isAdmin = false) {
  const cur = await one(`SELECT * FROM fai_record WHERE id = $1`, [id]);
  if (!cur) throw new Error('首件记录不存在');
  if (cur.status === 'submitted') throw new Error('记录已提交，不可修改');
  if (!isAdmin && userId && cur.inspector_id && Number(cur.inspector_id) !== Number(userId)) {
    throw new Error('仅本人或管理员可修改该记录');
  }
  const submit = data.status === 'submitted';
  return one(
    `UPDATE fai_record SET
       content = COALESCE($2, content),
       remark = COALESCE($3, remark),
       batch_no = COALESCE($4, batch_no),
       machine_code = COALESCE($5, machine_code),
       abnormal = COALESCE($6, abnormal),
       abnormal_note = COALESCE($7, abnormal_note),
       status = CASE WHEN $8 THEN 'submitted' ELSE status END,
       inspected_at = CASE WHEN $8 THEN now() ELSE inspected_at END,
       result = CASE WHEN $6 IS TRUE THEN 'ng' WHEN $8 THEN COALESCE(result,'ok') ELSE result END
     WHERE id = $1 RETURNING *`,
    [id, cleanContent(data.content), data.remark ?? null,
     (data.batchNo ?? data.batch_no ?? null), (data.machineCode ?? data.machine_code ?? null),
     (data.abnormal === undefined ? null : !!data.abnormal), data.abnormalNote ?? null, submit]
  );
}

export async function reportFaiIssue(id, userId) {
  const rec = await one(`SELECT * FROM fai_record WHERE id = $1`, [id]);
  if (!rec) throw new Error('首件记录不存在');
  if (rec.ipqc_instance_id) return { instanceId: rec.ipqc_instance_id, error: null, already: true };
  const inspDate = rec.inspected_at instanceof Date
    ? rec.inspected_at.toISOString().slice(0, 10) : String(rec.inspected_at || todayStr()).slice(0, 10);
  const { instanceId, error } = await triggerIssueFlow({
    defCode: 'ipqc_issue',
    userId,
    title: `首件异常-${rec.product_code || rec.template_name || ''}`,
    formData: {
      issue_date: inspDate,
      wo_no: rec.batch_no || `FAI-${rec.id}`,
      product_model: rec.product_code || rec.template_name || '首件模板',
      process: rec.machine_code || '首件检验',
      ng_qty: 1,
      phenomenon: rec.abnormal_note || stripTags(rec.content).slice(0, 500) || '首件检验发现异常',
      urgent_action: '首件不合格，请品质主管评审处置',
    },
  });
  if (instanceId) {
    await query(`UPDATE fai_record SET ipqc_instance_id=$2, result='ng', abnormal=TRUE WHERE id=$1`, [rec.id, instanceId]);
  } else if (userId) {
    await notify(userId, {
      title: `【异常单创建失败】${rec.product_code || '首件'}异常`,
      content: `首件记录#${rec.id} 上报异常失败：${error}。请联系品质主管手工开单。`,
      link: '/fai/records', category: 'system',
    }).catch(() => {});
  }
  return { instanceId, error };
}

/* ============================================================
 * 六、统计（口径改造：不再依赖逐项判定）
 * ------------------------------------------------------------
 * · 任务执行率：仍来自 ipqc_task（结构未变）
 * · 巡线/首件「合格率」：改为按**人工标注/上报**口径 —— 有上报异常单记为异常
 * · 异常关闭率：分母 = 已上报的异常单（*_record.ipqc_instance_id JOIN flow_instance），
 *   分子 = 处于关闭态（completed/archived）者；不再读逐项判定数据
 * · 异常 TOP 产线：按**上报**记录聚合
 * ============================================================ */
export async function getIpqcStats({ from, to, module = 'ipqc' } = {}) {
  const isFai = module === 'fai';
  const hasRange = !!from || !!to;
  let params, cond;
  if (hasRange) {
    params = [dateParam(from, '起始'), dateParam(to, '结束')];
    cond = (col) => {
      const parts = [];
      if (from) parts.push(`${col} >= $1::date`);
      if (to) parts.push(`${col} <= $2::date`);
      return parts.length ? parts.join(' AND ') : 'TRUE';
    };
  } else {
    params = [];
    cond = (col) => `${col} BETWEEN current_date - 29 AND current_date`;
  }

  const taskRow = await one(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status='done')::int AS done,
            COUNT(*) FILTER (WHERE status='pending')::int AS pending,
            COUNT(*) FILTER (WHERE status='pending' AND plan_date < current_date)::int AS overdue
       FROM ipqc_task WHERE ${cond('plan_date')}`, params
  );
  // N-4：FAI 无任务表（事件驱动），任务执行率**仅巡线适用**。
  //      首件模块返回 applicable=false 且数值归零，避免把「巡线任务执行率」当首件指标展示。
  const taskStats = isFai
    ? { applicable: false, total: 0, done: 0, pending: 0, overdue: 0, completionRate: 0 }
    : {
        applicable: true,
        total: taskRow?.total || 0, done: taskRow?.done || 0,
        pending: taskRow?.pending || 0, overdue: taskRow?.overdue || 0,
        completionRate: taskRow?.total ? Math.round((taskRow.done / taskRow.total) * 100) : 0,
      };

  // F3：口径统一 —— 只有 status='submitted' 的记录计入分母（草稿不计入合格率/异常率）
  const ipqc = await one(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE ipqc_instance_id IS NULL)::int AS ok,
            COUNT(*) FILTER (WHERE ipqc_instance_id IS NOT NULL)::int AS ng,
            COUNT(*) FILTER (WHERE abnormal)::int AS marked
       FROM ipqc_record WHERE status = 'submitted' AND ${cond('check_date')}`, params
  );
  const ipqcStats = {
    total: ipqc?.total || 0, ok: ipqc?.ok || 0, ng: ipqc?.ng || 0,
    marked: ipqc?.marked || 0,
    okRate: ipqc?.total ? Math.round((ipqc.ok / ipqc.total) * 100) : 0,
    ngRate: ipqc?.total ? Math.round((ipqc.ng / ipqc.total) * 100) : 0,
    metric: 'reported',  // 口径标识：人工上报 + 仅已提交
  };
  const ipqcDraft = await one(
    `SELECT COUNT(*)::int AS c FROM ipqc_record WHERE status = 'draft' AND ${cond('check_date')}`, params
  );
  ipqcStats.draft = ipqcDraft?.c || 0;

  const fai = await one(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE ipqc_instance_id IS NULL)::int AS ok,
            COUNT(*) FILTER (WHERE ipqc_instance_id IS NOT NULL)::int AS ng
       FROM fai_record WHERE status = 'submitted' AND ${cond('inspected_at::date')}`, params
  );
  const faiStats = {
    total: fai?.total || 0, ok: fai?.ok || 0, ng: fai?.ng || 0,
    okRate: fai?.total ? Math.round((fai.ok / fai.total) * 100) : 0,
    ngRate: fai?.total ? Math.round((fai.ng / fai.total) * 100) : 0,
    metric: 'reported',
  };
  const faiDraft = await one(
    `SELECT COUNT(*)::int AS c FROM fai_record WHERE status = 'draft' AND ${cond('inspected_at::date')}`, params
  );
  faiStats.draft = faiDraft?.c || 0;

  // 上报异常 TOP 分组：巡线=产线 / 首件=产品编码（F4：按模块取各自口径）
  const topCol = isFai ? 'product_code' : 'line';
  const topTable = isFai ? 'fai_record' : 'ipqc_record';
  const topDate = isFai ? 'inspected_at::date' : 'check_date';
  const topNgLine = await many(
    `SELECT ${topCol} AS line, COUNT(*)::int AS ng_count FROM ${topTable}
      WHERE status = 'submitted' AND ipqc_instance_id IS NOT NULL AND ${cond(topDate)}
      GROUP BY ${topCol} ORDER BY ng_count DESC LIMIT 10`, params
  );

  // 异常关闭率（上报口径 + 仅已提交）：分母 = 该模块已上报的异常单；分子 = 关闭态
  const closTable = isFai ? 'fai_record' : 'ipqc_record';
  const closDate = isFai ? 'r.inspected_at::date' : 'r.check_date';
  const closure = await one(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE fi.status IN ('completed','archived'))::int AS closed
       FROM ${closTable} r JOIN flow_instance fi ON fi.id = r.ipqc_instance_id
      WHERE r.status = 'submitted' AND ${cond(closDate)}`, params
  );
  const closureRate = {
    total: closure?.total || 0, closed: closure?.closed || 0,
    open: (closure?.total || 0) - (closure?.closed || 0),
    rate: closure?.total ? Math.round((closure.closed / closure.total) * 100) : 0,
    scope: 'reported_only',
    module,
  };

  return {
    from: from || null, to: to || null, module, rangeMode: hasRange ? 'explicit' : 'last30d',
    taskStats, ipqcStats, faiStats, topNgLine, closureRate,
  };
}

/** 供 cron 与手工触发复用 */
export { todayStr };
