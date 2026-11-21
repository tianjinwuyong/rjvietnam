// ============================================================
// 排班计划服务（部门提报 → HR 确认 → 回写生效排班）
// ------------------------------------------------------------
// 为什么要有「计划」这一层：
//   原「批量刷班」是直接改 attendance_schedule，谁有 attend:schedule 谁就能改生效排班。
//   让各部门自助排班后，必须有一层草稿 + 审批闸门，否则部门一提交就影响工资。
//
// 两层模型：
//   草稿层 attendance_schedule_plan / _item  ← 本服务主要操作对象
//   生效层 attendance_schedule              ← 只由 applyPlan() 写，且必须审批通过
//
// 评审定下的硬约束（2026-10-29）：
//   1) 同部门同月最多一份在途/有效计划 → 部分唯一索引（库层兜底，服务层给友好报错）
//   2) 明细日期必须落在计划月份内 → 触发器兜底
//   3) 该月工资已确认（payroll_run.status='confirmed'）→ 禁止提交/回写
//   4) 已有手工调班（source='manual'）或休假补班锁（attendance_day_override）的格子
//      回写时跳过并报冲突，绝不硬覆盖
//   5) 回写失败可补偿：保留 status='approved' + applied_at IS NULL，支持手工重放 applyPlan
//
// 日期口径：全部按 'YYYY-MM-DD' 字符串进出，日期运算走 UTC，与 schedule-service 一致。
// ============================================================
import { many, one, query, transaction } from '../db/index.js';
import { makeShiftResolver } from './shift-resolver.js';

export const REST_CODE = 'rest';

const STATUS = {
  DRAFT: 'draft',
  PENDING: 'pending',
  APPROVED: 'approved',
  APPLIED: 'applied',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
};

/** 可编辑的状态（驳回后改完可再交） */
const EDITABLE = new Set([STATUS.DRAFT, STATUS.REJECTED]);

function bad(msg, code = 400) {
  return Object.assign(new Error(msg), { statusCode: code });
}

/** 数值化 */
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** 解析 'YYYY-MM-DD'，非法返回 null（做日历往返校验：2026-11-31 这种必须挡掉） */
export function parseDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), da = Number(m[3]);
  const d = new Date(Date.UTC(y, mo - 1, da));
  // 往返比对：JS 会把 2026-11-31 静默滚到 12-01，必须用回读值反证
  if (d.getUTCFullYear() !== y || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== da) return null;
  return `${m[1]}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
}

/** 校验并归一 'YYYY-MM' */
export function parseMonth(v) {
  const s = String(v || '').trim();
  const m = /^(\d{4})[-/](\d{1,2})$/.exec(s);
  if (!m) return null;
  const mm = Number(m[2]);
  if (mm < 1 || mm > 12) return null;
  return `${m[1]}-${String(mm).padStart(2, '0')}`;
}

/** 月份 → [起, 止] */
export function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}`, days: last };
}

/** 月份内所有日期 */
export function monthDates(ym) {
  const { days } = monthRange(ym);
  return Array.from({ length: days }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`);
}

/**
 * 是否周末（5 天工作制口径：周六 + 周日）。
 *
 * ⚠️ 不要用它当排班默认休息日的判据。本厂是 6 天工作制（周六上班），
 * 详见 monthRestSet()。这里保留导出只是因为历史上可能有外部引用。
 */
export function isWeekend(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return d === 0 || d === 6;
}

/* ============================================================
 * 权限与数据范围
 * ==========================================================*/

/**
 * HR / 管理员：可看全部门、可直改生效排班。
 *   · attend:schedule        —— 排班管理员（月历、直接刷班、回写重放）
 *   · attend:schedule_approve —— 排班审核人（总助），只看计划、审批、可让计划直接生效
 * 后者的存在是因为审批人（总助）本来没有 attend:schedule，若不单列，
 * 他会被当成普通员工：只能看到自己部门、点不了「直接生效」，回写链路就断了。
 */
export function isHr(user) {
  if (!user) return false;
  if (user.isAdmin || user.isSystem) return true;
  const perms = user.permissions || [];
  return perms.includes('attend:schedule') || perms.includes('attend:schedule_approve');
}

/** 可做排班计划（部门提报权） */
export function canPlan(user) {
  return isHr(user) || !!(user && (user.permissions || []).includes('attend:schedule_plan'));
}

/**
 * 用户可见的部门 id 集合。
 * HR → null（不限）；其余 → 本人部门 + 全部子部门。
 * @returns {Promise<number[]|null>}
 */
export async function deptScopeIds(user) {
  if (isHr(user)) return null;
  const own = await one(
    `SELECT department_id FROM org_user WHERE id = $1`,
    [num(user?.id)]
  );
  const deptId = num(own?.department_id);
  if (!deptId) return [];
  // UNION（而非 UNION ALL）：部门树一旦被录成环（parent_id 自指/互指），
  // UNION ALL 会无限递归把连接挂死；UNION 去重后集合不再增长，必然收敛。
  const rows = await many(
    `WITH RECURSIVE sub AS (
       SELECT id FROM org_department WHERE id = $1
       UNION
       SELECT d.id FROM org_department d JOIN sub s ON d.parent_id = s.id
     )
     SELECT id FROM sub`,
    [deptId]
  );
  return rows.map(r => num(r.id));
}

/** 断言某部门在用户范围内 */
async function assertDept(user, departmentId) {
  const scope = await deptScopeIds(user);
  if (scope === null) return;
  if (!scope.includes(num(departmentId))) {
    throw bad('只能为本部门及下属部门排班', 403);
  }
}

/** 断言计划可被用户读写 */
async function loadPlanForUser(planId, user) {
  const plan = await one(`SELECT * FROM attendance_schedule_plan WHERE id = $1`, [num(planId)]);
  if (!plan) throw bad('排班计划不存在', 404);
  await assertDept(user, plan.department_id);
  return plan;
}

/* ============================================================
 * 基础数据
 * ==========================================================*/

/** 班次定义（含 rest 占位）。只给启用的班次 —— 停用班次画进计划后，
 *  卡点识别（schedule-service.detectAnomalies 只载 active 班次）永远归不进任何班次。 */
export async function listShifts() {
  const rows = await many(
    `SELECT code, name, name_vi, start_time, end_time, cross_day, color, active
       FROM attendance_shift_def
      WHERE active = TRUE
      ORDER BY code`
  );
  return rows;
}

/** 某部门（含子部门）在职人员 */
export async function listRoster(departmentId) {
  return many(
    `SELECT u.id, u.username, u.real_name, u.employee_no, u.position,
            u.position_code, u.department_id, d.name AS department_name
       FROM org_user u
       LEFT JOIN org_department d ON d.id = u.department_id
      WHERE u.active = TRUE
        AND NOT COALESCE(u.is_system, FALSE)
        AND u.department_id = $1
      ORDER BY u.employee_no NULLS LAST, u.id`,
    [num(departmentId)]
  );
}

/** 可选部门（按权限范围） */
export async function listDepartments(user) {
  const scope = await deptScopeIds(user);
  const rows = await many(
    `SELECT d.id, d.code, d.name, d.name_en, d.name_vi, d.parent_id
       FROM org_department d
      ORDER BY d.name`
  );
  if (scope === null) return rows;
  return rows.filter(r => scope.includes(num(r.id)));
}

/** 该月工资是否已确认（确认后禁止改排班 —— 改排班等于改工资） */
export async function payrollConfirmed(yearMonth) {
  const row = await one(
    `SELECT period, status FROM payroll_run
      WHERE period = $1 AND status = 'confirmed' LIMIT 1`,
    [yearMonth]
  );
  return !!row;
}

/** 法定节假日集合（与 attendance-service / schedule-service 同源） */
async function holidaySet() {
  const row = await one(`SELECT value FROM sys_config WHERE key = 'attendance_holidays'`);
  const set = new Set();
  if (row?.value) {
    String(row.value).split(',').map(s => parseDate(s.trim())).filter(Boolean)
      .forEach(d => set.add(d));
  }
  return set;
}

/**
 * 某月的休息日集合（排班默认值口径）。
 *
 * 真值链（按优先级）：
 *   1) attendance_work_calendar —— 逐日权重，0 = 休息。这是唯一能表达
 *      「6 天工作制 + 调休补班」的表，工厂作息变了只改这里。
 *   2) 没有日历 → 6 天工作制默认：**仅周日休**。
 *      不能退回「周六 + 周日」的 5 天制 —— 本厂周六上班，那样每人每月
 *      会多排 4~5 天休息，主管得手工改回来，等于白排一遍。
 *      （考勤侧 attendance-service 判日型也是 w === 0，两处口径必须一致，
 *        否则排班表按 5 天制、考勤按 6 天制，月度工时会少算。）
 *   3) 法定假日 attendance_holiday（region=VN, is_statutory）一律休息。
 *      有日历的月份生成时已置 0，没日历的月份靠这一步。
 *   4) 兼容历史配置 sys_config.attendance_holidays。
 *
 * @returns {Promise<{rest: Set<string>, source: string}>} source: calendar | default_6day
 */
async function monthRestSet(yearMonth) {
  const ym = String(yearMonth);
  const rest = new Set();
  let source = 'calendar';

  const cal = await one(
    `SELECT days FROM attendance_work_calendar WHERE year_month = $1`, [ym]
  ).catch(() => null);

  if (cal?.days && typeof cal.days === 'object' && Object.keys(cal.days).length) {
    for (const [dd, w] of Object.entries(cal.days)) {
      if (Number(w) === 0) rest.add(`${ym}-${String(dd).padStart(2, '0')}`);
    }
  } else {
    source = 'default_6day';
    for (const d of monthDates(ym)) {
      if (new Date(`${d}T00:00:00Z`).getUTCDay() === 0) rest.add(d);
    }
  }

  const hol = await many(
    `SELECT to_char(holiday_date,'YYYY-MM-DD') AS d
       FROM attendance_holiday
      WHERE region_code = 'VN' AND is_statutory
        AND to_char(holiday_date,'YYYY-MM') = $1`,
    [ym]
  ).catch(() => []);
  for (const h of hol) rest.add(String(h.d));

  for (const d of await holidaySet()) {
    if (String(d).startsWith(ym)) rest.add(d);
  }

  return { rest, source };
}

/* ============================================================
 * 日志
 * ==========================================================*/
async function writeLog(planId, action, userId, cells, detail) {
  await query(
    `INSERT INTO attendance_schedule_plan_log (plan_id, action, user_id, cells, detail)
     VALUES ($1,$2,$3,$4,$5)`,
    [num(planId), action, userId || null, cells || null,
     detail ? JSON.stringify(detail) : null]
  ).catch(err => console.warn('[schedule-plan] 写日志失败（已忽略）：', err?.message || err));
}

/* ============================================================
 * 查询
 * ==========================================================*/

/**
 * 计划列表。
 * @param {{yearMonth?:string, departmentId?:number, status?:string}} q
 * @param {object} user
 */
export async function listPlans(q, user) {
  const params = [];
  const where = [];

  const ym = q?.yearMonth ? parseMonth(q.yearMonth) : null;
  if (q?.yearMonth && !ym) throw bad('月份格式应为 YYYY-MM');
  if (ym) { params.push(ym); where.push(`p.year_month = $${params.length}`); }

  if (q?.status) { params.push(String(q.status)); where.push(`p.status = $${params.length}`); }

  if (q?.departmentId) { params.push(num(q.departmentId)); where.push(`p.department_id = $${params.length}`); }

  const scope = await deptScopeIds(user);
  if (scope !== null) {
    if (!scope.length) return [];
    params.push(scope);
    where.push(`p.department_id = ANY($${params.length}::bigint[])`);
  }

  const rows = await many(
    `SELECT p.*, d.name AS department_name, d.name_vi AS department_name_vi,
            su.real_name AS submitter_name, au.real_name AS approver_name,
            (SELECT count(DISTINCT i.user_id) FROM attendance_schedule_plan_item i WHERE i.plan_id = p.id)::int AS user_count,
            (SELECT count(*) FROM attendance_schedule_plan_item i WHERE i.plan_id = p.id)::int AS cell_count,
            fi.instance_no, fi.status AS instance_status
       FROM attendance_schedule_plan p
       LEFT JOIN org_department d ON d.id = p.department_id
       LEFT JOIN org_user su ON su.id = p.submitter_id
       LEFT JOIN org_user au ON au.id = p.approver_id
       LEFT JOIN flow_instance fi ON fi.id = p.instance_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY p.year_month DESC, p.department_id, p.id DESC`,
    params
  );
  return rows;
}

/**
 * 计划详情：表头 + 明细 + 人员花名册 + 当月现状（生效排班）+ 班次 + 最近日志。
 * 前端网格需要「计划值」与「现值」对照：空格显示现值灰字，填了才覆盖。
 */
export async function getPlan(planId, user) {
  const plan = await loadPlanForUser(planId, user);
  const { from, to } = monthRange(plan.year_month);

  const [items, roster, current, shifts, logs, dept] = await Promise.all([
    many(
      `SELECT user_id, work_date, shift_code, remark
         FROM attendance_schedule_plan_item WHERE plan_id = $1`,
      [plan.id]
    ),
    listRoster(plan.department_id),
    many(
      `SELECT s.user_id, s.work_date, s.shift_code, s.source, s.plan_id
         FROM attendance_schedule s
         JOIN org_user u ON u.id = s.user_id
        WHERE u.department_id = $1 AND s.work_date BETWEEN $2::date AND $3::date`,
      [plan.department_id, from, to]
    ),
    listShifts(),
    many(
      `SELECT l.*, u.real_name FROM attendance_schedule_plan_log l
         LEFT JOIN org_user u ON u.id = l.user_id
        WHERE l.plan_id = $1 ORDER BY l.id DESC LIMIT 20`,
      [plan.id]
    ),
    one(`SELECT id, name, name_vi FROM org_department WHERE id = $1`, [plan.department_id]),
  ]);

  return {
    plan: Object.assign({}, plan, {
      department_name: dept?.name || null,
      department_name_vi: dept?.name_vi || null,
      editable: EDITABLE.has(plan.status),
      payroll_confirmed: await payrollConfirmed(plan.year_month),
    }),
    items: items.map(i => ({
      user_id: num(i.user_id),
      work_date: i.work_date,
      shift_code: i.shift_code,
      remark: i.remark,
    })),
    users: roster.map(u => ({
      id: num(u.id),
      real_name: u.real_name,
      employee_no: u.employee_no,
      position: u.position,
      department_name: u.department_name,
    })),
    current: current.map(c => ({
      user_id: num(c.user_id),
      work_date: c.work_date,
      shift_code: c.shift_code,
      source: c.source,
      plan_id: c.plan_id ? num(c.plan_id) : null,
    })),
    shifts,
    logs,
    dates: monthDates(plan.year_month),
  };
}

/* ============================================================
 * 建/改/删
 * ==========================================================*/

/** 生成计划编号：SP-YYYYMM-<部门码>-<序号>（跳号用「找第一个没被占用的」而不是 count，删过草稿也不会撞号） */
async function nextPlanNo(yearMonth, departmentId) {
  const dept = await one(`SELECT code, name FROM org_department WHERE id = $1`, [num(departmentId)]);
  const code = String(dept?.code || dept?.name || 'DEPT').replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase() || 'DEPT';
  const prefix = `SP-${yearMonth.replace('-', '')}-${code}-`;
  const rows = await many(
    `SELECT plan_no FROM attendance_schedule_plan
      WHERE year_month = $1 AND department_id = $2 AND plan_no LIKE $3`,
    [yearMonth, num(departmentId), prefix + '%']
  );
  const used = new Set(rows.map(r => r.plan_no));
  let seq = 1;
  while (used.has(prefix + String(seq).padStart(2, '0'))) seq++;
  return prefix + String(seq).padStart(2, '0');
}

/**
 * 新建草稿（同部门同月已有草稿则直接返回该草稿，避免「点两次建两份」）。
 */
export async function createPlan({ yearMonth, departmentId, note }, user) {
  const ym = parseMonth(yearMonth);
  if (!ym) throw bad('月份格式应为 YYYY-MM');
  const deptId = num(departmentId);
  if (!deptId) throw bad('请选择部门');
  await assertDept(user, deptId);

  const exists = await one(
    `SELECT * FROM attendance_schedule_plan
      WHERE year_month = $1 AND department_id = $2 AND status = 'draft'
      ORDER BY id DESC LIMIT 1`,
    [ym, deptId]
  );
  if (exists) return { plan: exists, reused: true };

  const inFlight = await one(
    `SELECT id, status FROM attendance_schedule_plan
      WHERE year_month = $1 AND department_id = $2 AND status IN ('pending','approved')`,
    [ym, deptId]
  );
  if (inFlight) {
    throw bad(inFlight.status === 'pending'
      ? '该部门本月已有计划在审批中，请先在列表里查看或撤回'
      : '该部门本月计划已通过但尚未回写，请先联系人事处理', 409);
  }

  const no = await nextPlanNo(ym, deptId);
  let row;
  try {
    row = await one(
      `INSERT INTO attendance_schedule_plan
         (plan_no, year_month, department_id, status, note, created_by)
       VALUES ($1,$2,$3,'draft',$4,$5) RETURNING *`,
      [no, ym, deptId, note ? String(note) : null, num(user?.id) || null]
    );
  } catch (e) {
    if (e?.code === '23505') throw bad('该部门本月已有在途计划，请刷新后查看', 409);
    throw e;
  }
  await writeLog(row.id, 'create', user?.id, 0, { year_month: ym, department_id: deptId });
  return { plan: row, reused: false };
}

/** 改备注 */
export async function updatePlan(planId, patch, user) {
  const plan = await loadPlanForUser(planId, user);
  if (!EDITABLE.has(plan.status)) throw bad('只有草稿或已驳回的计划可以修改', 409);
  const row = await one(
    `UPDATE attendance_schedule_plan SET note = COALESCE($2, note), updated_at = now()
      WHERE id = $1 RETURNING *`,
    [plan.id, patch?.note != null ? String(patch.note) : null]
  );
  return row;
}

/** 删除草稿 */
export async function deletePlan(planId, user) {
  const plan = await loadPlanForUser(planId, user);
  if (!EDITABLE.has(plan.status)) throw bad('只有草稿或已驳回的计划可以删除', 409);
  await query(`DELETE FROM attendance_schedule_plan WHERE id = $1`, [plan.id]);
  return { ok: true };
}

/* ============================================================
 * 明细写入（单格 / 批量 / 整月预填 / Excel）
 * ==========================================================*/

/** 校验班次；返回可用班次集合（只含启用班次 + rest） */
async function shiftValidator() {
  const rows = await many(`SELECT code FROM attendance_shift_def WHERE active = TRUE`);
  const set = new Set(rows.map(r => r.code));
  set.add(REST_CODE);
  return set;
}

/** 编辑前统一断言：状态可改、月份一致、人员属本部门 */
async function assertEditable(plan, user, { userIds = [], dates = [] } = {}) {
  const fresh = await loadPlanForUser(plan.id || plan, user);
  if (!EDITABLE.has(fresh.status)) throw bad('计划已提交审批，不能再改；需要修改请先撤回或等驳回', 409);
  if (await payrollConfirmed(fresh.year_month)) {
    throw bad(`${fresh.year_month} 的工资已确认，不能再改这个月的排班`, 409);
  }
  for (const d of dates) {
    if (!parseDate(d) || parseDate(d).slice(0, 7) !== fresh.year_month) {
      throw bad(`日期 ${d} 不在计划月份 ${fresh.year_month} 内`, 400);
    }
  }
  if (userIds.length) {
    const roster = await listRoster(fresh.department_id);
    const allow = new Set(roster.map(r => num(r.id)));
    const outside = userIds.map(num).filter(id => !allow.has(id));
    if (outside.length) {
      throw bad(`有 ${outside.length} 人不在本部门在职名单内（可能是已离职或已调部门），请刷新后重试`, 400);
    }
  }
  return fresh;
}

/**
 * 批量写格子（画笔 / 整行 / 整列 / 清空）。
 * @param {number} planId
 * @param {{userIds:number[],dates:string[],shiftCode:string|null,remark?:string}} payload
 * @param {object} user
 */
export async function setCells(planId, payload, user) {
  const userIds = [...new Set((payload?.userIds || []).map(num).filter(Boolean))];
  const dates = [...new Set((payload?.dates || []).map(d => parseDate(d)).filter(Boolean))];
  const raw = payload?.shiftCode;
  const clearing = raw === null || raw === undefined || raw === '';

  if (!userIds.length) throw bad('请至少选择一名员工');
  if (!dates.length) throw bad('请至少选择一个日期');

  const plan = await assertEditable({ id: planId }, user, { userIds, dates });

  let shiftCode = null;
  if (!clearing) {
    shiftCode = String(raw).trim();
    const valid = await shiftValidator();
    if (!valid.has(shiftCode)) throw bad(`班次「${shiftCode}」不存在`, 400);
  }

  if (userIds.length * dates.length > 5000) throw bad('单次操作超过 5000 格，请缩小范围');

  let changed = 0;
  await transaction(async client => {
    if (clearing) {
      const r = await client.query(
        `DELETE FROM attendance_schedule_plan_item
          WHERE plan_id = $1 AND user_id = ANY($2::bigint[]) AND work_date = ANY($3::date[])`,
        [plan.id, userIds, dates]
      );
      changed = r.rowCount;
    } else {
      for (const uid of userIds) {
        for (const d of dates) {
          await client.query(
            `INSERT INTO attendance_schedule_plan_item (plan_id, user_id, work_date, shift_code, remark)
             VALUES ($1,$2,$3::date,$4,$5)
             ON CONFLICT (plan_id, user_id, work_date) DO UPDATE SET
               shift_code = EXCLUDED.shift_code,
               remark = EXCLUDED.remark`,
            [plan.id, uid, d, shiftCode, payload?.remark != null ? String(payload.remark) : null]
          );
          changed++;
        }
      }
    }
    await client.query(
      `UPDATE attendance_schedule_plan SET updated_at = now() WHERE id = $1`,
      [plan.id]
    );
  });

  await writeLog(plan.id, clearing ? 'clear' : 'batch', user?.id, changed, {
    users: userIds.length, dates: dates.length, shift: shiftCode,
  });
  return { ok: true, changed, users: userIds.length, dates: dates.length, shiftCode };
}

/** 单格写入（网格单击） */
export async function setCell(planId, payload, user) {
  const userId = num(payload?.userId);
  const workDate = parseDate(payload?.workDate);
  if (!userId) throw bad('请指定员工');
  if (!workDate) throw bad('日期无效');
  const r = await setCells(planId, {
    userIds: [userId],
    dates: [workDate],
    shiftCode: payload?.shiftCode ?? null,
    remark: payload?.remark,
  }, user);
  return r;
}

/**
 * 按精确格子写入（拖拽刷格用：只写用户真正划过的格子，不按矩形整片填）。
 * @param {number} planId
 * @param {{cells:Array<{user_id:number,work_date:string,shift_code:string|null}>}} payload
 * @param {object} user
 */
export async function setCellList(planId, payload, user) {
  const raw = Array.isArray(payload?.cells) ? payload.cells : [];
  if (!raw.length) throw bad('没有要更新的格子');
  if (raw.length > 5000) throw bad('单次操作超过 5000 格，请缩小范围');

  const pickShift = (c) => {
    const v = c.shift_code !== undefined ? c.shift_code
      : (c.shiftCode !== undefined ? c.shiftCode : c.shift);
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s ? s : null;
  };

  const cells = raw.map(c => ({
    user_id: num(c.user_id ?? c.userId),
    work_date: parseDate(c.work_date ?? c.workDate),
    shift: pickShift(c),
  })).filter(c => c.user_id && c.work_date);

  if (!cells.length) throw bad('没有有效格子');

  const plan = await assertEditable({ id: planId }, user, {
    userIds: [...new Set(cells.map(c => c.user_id))],
    dates: [...new Set(cells.map(c => c.work_date))],
  });

  const valid = await shiftValidator();
  for (const c of cells) {
    if (c.shift && !valid.has(c.shift)) throw bad(`班次「${c.shift}」不存在`, 400);
  }

  let changed = 0;
  await transaction(async client => {
    for (const c of cells) {
      if (!c.shift) {
        const r = await client.query(
          `DELETE FROM attendance_schedule_plan_item
            WHERE plan_id = $1 AND user_id = $2 AND work_date = $3::date`,
          [plan.id, c.user_id, c.work_date]
        );
        changed += r.rowCount;
      } else {
        await client.query(
          `INSERT INTO attendance_schedule_plan_item (plan_id, user_id, work_date, shift_code)
           VALUES ($1,$2,$3::date,$4)
           ON CONFLICT (plan_id, user_id, work_date) DO UPDATE SET shift_code = EXCLUDED.shift_code`,
          [plan.id, c.user_id, c.work_date, c.shift]
        );
        changed++;
      }
    }
    await client.query(`UPDATE attendance_schedule_plan SET updated_at = now() WHERE id = $1`, [plan.id]);
  });

  await writeLog(plan.id, 'brush', user?.id, changed, { cells: cells.length });
  return { ok: true, changed };
}

/**
 * 整月预填：工作日 = workdayShift，周末/法定节假日 = restShift（默认 rest）。
 * 只填空格还是全覆盖？keepExisting=true 时保留已有格（默认 true，防误清手排结果）。
 */
export async function generateMonth(planId, payload, user) {
  const plan = await loadPlanForUser(planId, user);
  if (!EDITABLE.has(plan.status)) throw bad('计划已提交审批，不能再改', 409);
  if (await payrollConfirmed(plan.year_month)) {
    throw bad(`${plan.year_month} 的工资已确认，不能再改这个月的排班`, 409);
  }

  const workdayShift = String(payload?.workdayShift || 'day').trim();
  const restShift = String(payload?.restShift || REST_CODE).trim();
  const keepExisting = payload?.keepExisting !== false;

  // 按人指定工作日班次（继承上月时用）：{ "<userId>": "night" }
  // 不传 = 全员统一 workdayShift，与原有行为完全一致。
  const perUserShift = new Map();
  const rawPerUser = payload?.perUserShift;
  if (rawPerUser && typeof rawPerUser === 'object') {
    for (const [k, v] of Object.entries(rawPerUser)) {
      const uid = num(k);
      const code = String(v || '').trim();
      if (uid && code) perUserShift.set(uid, code);
    }
  }

  const valid = await shiftValidator();
  if (!valid.has(workdayShift)) throw bad(`班次「${workdayShift}」不存在`, 400);
  if (!valid.has(restShift)) throw bad(`班次「${restShift}」不存在`, 400);
  for (const code of perUserShift.values()) {
    if (!valid.has(code)) throw bad(`班次「${code}」不存在或已停用`, 400);
  }

  const roster = await listRoster(plan.department_id);
  if (!roster.length) throw bad('该部门没有在职人员', 400);

  const { from, to } = monthRange(plan.year_month);

  // 调休/补班产生的日期性质覆盖优先于「周末即休息」的默认口径，
  // 否则调休周六会被预填成 rest、调休休息日会被预填成上班，整月口径全错。
  const uidList = roster.map(u => num(u.id));
  const ovRows = await many(
    `SELECT user_id, department_id, work_date, day_type, scope
       FROM attendance_day_override
      WHERE work_date BETWEEN $1::date AND $2::date
        AND (user_id = ANY($3::bigint[]) OR (scope = 'dept' AND department_id = $4))`,
    [from, to, uidList, num(plan.department_id)]
  );
  const userOv = new Map();   // `${uid}|${date}` → day_type
  const deptOv = new Map();   // `${date}` → day_type
  for (const r of ovRows) {
    const d = String(r.work_date).slice(0, 10);
    if (r.user_id) userOv.set(`${num(r.user_id)}|${d}`, r.day_type);
    else if (r.scope === 'dept') deptOv.set(d, r.day_type);
  }

  const restPlan = await monthRestSet(plan.year_month);
  const dates = monthDates(plan.year_month).map(d => ({
    date: d,
    rest: restPlan.rest.has(d),
  }));

  let written = 0;
  await transaction(async client => {
    for (const u of roster) {
      for (const d of dates) {
        const ov = userOv.get(`${num(u.id)}|${d.date}`) || deptOv.get(d.date) || null;
        // workday 覆盖 → 上班；rest / holiday 覆盖 → 休息
        const rest = ov ? ov !== 'workday' : d.rest;
        const code = rest ? restShift : (perUserShift.get(num(u.id)) || workdayShift);
        const sql = keepExisting
          ? `INSERT INTO attendance_schedule_plan_item (plan_id, user_id, work_date, shift_code)
             VALUES ($1,$2,$3::date,$4)
             ON CONFLICT (plan_id, user_id, work_date) DO NOTHING`
          : `INSERT INTO attendance_schedule_plan_item (plan_id, user_id, work_date, shift_code)
             VALUES ($1,$2,$3::date,$4)
             ON CONFLICT (plan_id, user_id, work_date) DO UPDATE SET shift_code = EXCLUDED.shift_code`;
        const r = await client.query(sql, [plan.id, num(u.id), d.date, code]);
        written += r.rowCount;
      }
    }
    await client.query(`UPDATE attendance_schedule_plan SET updated_at = now() WHERE id = $1`, [plan.id]);
  });

  await writeLog(plan.id, 'generate', user?.id, written, {
    workday: workdayShift, rest: restShift, keep_existing: keepExisting,
    overrides: ovRows.length,
  });
  return {
    ok: true, written, users: roster.length, dates: dates.length,
    overrides: ovRows.length,
  };
}

/** 上一个月的 'YYYY-MM'（纯字符串运算，不走本地时区） */
export function prevMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * 从「上月已生效排班」推断每人本月的主班次。
 *
 * 为什么不按日期号对拷：本月 1 号与上月 1 号的星期几不同，
 * 直接按号拷会把工作日/周末整体错位（上月 1 号周日、本月 1 号周一全反）。
 * 所以只沿用「这个人上月主要上什么班」，再按本月日历（含节假日、调休覆盖）重铺，
 * 轮班例外留给主管在页面上微调。这一步消灭的是每月重复刷 N×30 格的无意义劳动。
 *
 * 数据源优先级：
 *   1) attendance_schedule（生效层，含手工调整）—— 上月计划已回写才有
 *   2) 上月计划明细（status='applied'）—— 回写异常时的兜底
 * 都没有 → 返回空对象，调用方退回「全员统一白班」的默认预填。
 *
 * @returns {Promise<{perUserShift: Record<string,string>, from: string, users: number, source: string}>}
 */
export async function inheritFromLastMonth(yearMonth, departmentId) {
  const prev = prevMonth(yearMonth);
  const deptId = num(departmentId);
  const validShifts = await shiftValidator();
  const { from, to } = monthRange(prev);

  let srcRows = await many(
    `SELECT s.user_id, s.shift_code, count(*)::int AS days
       FROM attendance_schedule s
       JOIN org_user u ON u.id = s.user_id
      WHERE s.work_date BETWEEN $1::date AND $2::date
        AND u.department_id = $3
        AND u.active AND NOT COALESCE(u.is_system, FALSE)
      GROUP BY 1, 2`,
    [from, to, deptId]
  );
  let source = 'attendance_schedule';

  if (!srcRows.length) {
    srcRows = await many(
      `SELECT i.user_id, i.shift_code, count(*)::int AS days
         FROM attendance_schedule_plan_item i
         JOIN attendance_schedule_plan p ON p.id = i.plan_id
         JOIN org_user u ON u.id = i.user_id
        WHERE p.year_month = $1 AND p.department_id = $2 AND p.status = 'applied'
          AND u.active AND NOT COALESCE(u.is_system, FALSE)
        GROUP BY 1, 2`,
      [prev, deptId]
    );
    source = srcRows.length ? 'plan_item' : 'none';
  }

  // 每人取「天数最多的非休息班次」= 主班次；已停用的班次不继承，避免写进无效 code
  const best = new Map();
  for (const r of srcRows) {
    const code = String(r.shift_code || '').trim();
    if (!code || code === REST_CODE) continue;
    if (!validShifts.has(code)) continue;
    const uid = num(r.user_id);
    const cur = best.get(uid);
    if (!cur || Number(r.days) > cur.days) best.set(uid, { code, days: Number(r.days) });
  }

  const perUserShift = {};
  for (const [uid, v] of best) perUserShift[uid] = v.code;
  return { perUserShift, from: prev, users: best.size, source };
}

/**
 * 一键生成：建草稿 + 自动铺满整月。
 *
 * 原来主管每月要「新建 → 整月预填 → 改例外」三步，且上月的夜班安排不会带过来，
 * 等于每月重排一遍。这里合并成一步：有上月数据就沿用主班次，没有就按默认白班/休息。
 *
 * 复用已有草稿时绝不覆盖明细：主管可能已经改过，重算会把他改的抹掉。
 */
export async function quickCreate({ yearMonth, departmentId, note }, user) {
  const { plan, reused } = await createPlan({ yearMonth, departmentId, note }, user);
  const pid = num(plan.id);

  const existing = await one(
    `SELECT count(*)::int AS n FROM attendance_schedule_plan_item WHERE plan_id = $1`,
    [pid]
  );
  if (reused && Number(existing?.n) > 0) {
    return { plan, reused: true, filled: 0, inherited: null };
  }

  const inherit = await inheritFromLastMonth(plan.year_month, plan.department_id);
  const useInherit = Object.keys(inherit.perUserShift).length > 0;

  const r = await generateMonth(pid, {
    workdayShift: 'day',
    restShift: REST_CODE,
    keepExisting: false,
    perUserShift: useInherit ? inherit.perUserShift : undefined,
  }, user);

  return {
    plan: await one(`SELECT * FROM attendance_schedule_plan WHERE id = $1`, [pid]),
    reused: false,
    filled: r.written,
    users: r.users,
    inherited: useInherit
      ? { from: inherit.from, users: inherit.users, source: inherit.source }
      : null,
  };
}

/**
 * Excel 行导入（行结构同 attendance 导入：employee_no / work_date / shift_code / remark）。
 * 只往草稿层写，随手可撤；不校验部门外人员以外的业务规则。
 */
export async function importRows(planId, rows, user) {
  const plan = await loadPlanForUser(planId, user);
  if (!EDITABLE.has(plan.status)) throw bad('计划已提交审批，不能再导入', 409);
  // 三处写入口径一致：工资已确认的月份，草稿也不许再动（否则提交时才拦，白填一场）
  if (await payrollConfirmed(plan.year_month)) {
    throw bad(`${plan.year_month} 的工资已确认，不能再改这个月的排班`, 409);
  }

  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) throw bad('没有可导入的数据行');
  if (list.length > 20000) throw bad('单次导入不能超过 20000 行');

  const roster = await listRoster(plan.department_id);
  const byNo = new Map();
  roster.forEach(u => {
    if (u.employee_no) byNo.set(String(u.employee_no).trim(), num(u.id));
  });
  // 导入是「人肉填表」入口，宽容一点：编码 / 白班 / 夜班 / Ca đêm 都认（编码优先，口径不变）
  const resolveShift = makeShiftResolver(
    await many(`SELECT code, name, name_vi FROM attendance_shift_def WHERE active = TRUE`)
  );
  const errors = [];
  const ok = [];

  list.forEach((raw, idx) => {
    const rowNo = idx + 2;
    const empNo = raw?.employee_no != null ? String(raw.employee_no).trim() : '';
    const workDate = parseDate(raw?.work_date);
    const rawShift = raw?.shift_code != null ? String(raw.shift_code).trim() : '';
    const shiftCode = resolveShift(rawShift);

    if (!empNo) { errors.push({ row: rowNo, field: 'employee_no', msg: '工号必填' }); return; }
    if (!workDate) { errors.push({ row: rowNo, field: 'work_date', msg: `日期无效：${raw?.work_date}` }); return; }
    if (workDate.slice(0, 7) !== plan.year_month) {
      errors.push({ row: rowNo, field: 'work_date', msg: `日期 ${workDate} 不在 ${plan.year_month} 内` }); return;
    }
    if (!rawShift) { errors.push({ row: rowNo, field: 'shift_code', msg: '班次编码必填' }); return; }
    if (!shiftCode) {
      errors.push({ row: rowNo, field: 'shift_code', msg: `班次不存在：${rawShift}（可填编码，也可填「白班」「夜班」这类名称）` }); return;
    }
    const uid = byNo.get(empNo);
    if (!uid) {
      errors.push({ row: rowNo, field: 'employee_no', msg: `工号 ${empNo} 不在该部门在职名单内` }); return;
    }
    ok.push({ user_id: uid, work_date: workDate, shift_code: shiftCode, remark: raw?.remark ?? null });
  });

  let written = 0;
  if (ok.length) {
    await transaction(async client => {
      for (const it of ok) {
        await client.query(
          `INSERT INTO attendance_schedule_plan_item (plan_id, user_id, work_date, shift_code, remark)
           VALUES ($1,$2,$3::date,$4,$5)
           ON CONFLICT (plan_id, user_id, work_date) DO UPDATE SET
             shift_code = EXCLUDED.shift_code, remark = EXCLUDED.remark`,
          [plan.id, it.user_id, it.work_date, it.shift_code,
           it.remark != null ? String(it.remark) : null]
        );
        written++;
      }
      await client.query(`UPDATE attendance_schedule_plan SET updated_at = now() WHERE id = $1`, [plan.id]);
    });
  }

  await writeLog(plan.id, 'import', user?.id, written, { total: list.length, failed: errors.length });
  return { ok: true, inserted: written, failed: errors.length, errors: errors.slice(0, 200) };
}

/** 导出计划为 xlsx 行（前端生成文件） */
export async function exportRows(planId, user) {
  const plan = await loadPlanForUser(planId, user);
  const rows = await many(
    `SELECT u.employee_no, i.work_date, i.shift_code, i.remark, u.real_name
       FROM attendance_schedule_plan_item i
       JOIN org_user u ON u.id = i.user_id
      WHERE i.plan_id = $1
      ORDER BY u.employee_no NULLS LAST, u.id, i.work_date`,
    [plan.id]
  );
  return {
    columns: [
      { key: 'employee_no', label: '工号', label_vi: 'Mã nhân viên' },
      { key: 'real_name', label: '姓名', label_vi: 'Họ tên' },
      { key: 'work_date', label: '日期', label_vi: 'Ngày' },
      { key: 'shift_code', label: '班次', label_vi: 'Ca' },
      { key: 'remark', label: '备注', label_vi: 'Ghi chú' },
    ],
    rows: rows.map(r => ({
      employee_no: r.employee_no || '',
      real_name: r.real_name || '',
      work_date: r.work_date,
      shift_code: r.shift_code,
      remark: r.remark || '',
    })),
    plan_no: plan.plan_no,
  };
}

/** Excel 导入模板（一行示例） */
export function importTemplate() {
  return {
    columns: [
      { key: 'employee_no', label: '工号', label_vi: 'Mã nhân viên', required: true, sample: 'RJ001' },
      { key: 'work_date', label: '日期', label_vi: 'Ngày', required: true, sample: '2026-11-02' },
      { key: 'shift_code', label: '班次', label_vi: 'Ca', required: true, sample: 'day' },
      { key: 'remark', label: '备注', label_vi: 'Ghi chú', required: false },
    ],
    note: '日期须在计划月份内；班次用编码（day/night/regular_day/regular_night/rest）。',
  };
}

/* ============================================================
 * 提交 / 撤回
 * ==========================================================*/

/**
 * 提交审批。
 * @param {number} planId
 * @param {object} user
 * @param {{direct?:boolean}} opts direct=true 时要求 attend:schedule（HR/管理员自己排班，直接生效）
 */
/* ============================================================
 * 审批摘要
 * ==========================================================*/

/** 连续夜班预警阈值（天）。越南劳动法连续夜班上限 7 天，取 6 留一天缓冲。口径可按需调整。 */
const NIGHT_RUN_ALERT = 6;

/**
 * 生成审批摘要：每人 × 班次天数 + 与上月变动 + 异常提示。
 *
 * 为什么必须做：审批人在流程详情里只能看到 formData。原来 formData 只有
 * 「部门 / 人数 / 格数」三个数字，所谓「HR 确认」等于盲签 —— 看不出谁整月没休、
 * 谁连着上一个星期夜班、这个月和上月的班次差在哪。这里输出结构化行，
 * form_schema 用 type=table 渲染成表格。
 *
 * @returns {Promise<{rows: object[], flags: string}>}
 */
export async function buildPlanSummary(plan) {
  const planId = num(plan.id);
  const shifts = await listShifts();
  const shiftMap = new Map(shifts.map(s => [s.code, s]));

  // 夜班按上班时间判定，不按 code 里有没有 night 猜：
  // 以后再加第三个夜班班次（如 shift3）也不会漏判。
  const isNight = (code) => {
    const st = shiftMap.get(code)?.start_time;
    if (st != null) {
      const h = Number(String(st).slice(0, 2));
      if (Number.isFinite(h)) return h >= 18 || h < 6;
    }
    return /night/i.test(String(code || ''));
  };

  const items = await many(
    `SELECT i.user_id, u.real_name, u.employee_no, i.shift_code,
            to_char(i.work_date,'YYYY-MM-DD') AS wd
       FROM attendance_schedule_plan_item i
       JOIN org_user u ON u.id = i.user_id
      WHERE i.plan_id = $1
      ORDER BY u.employee_no NULLS LAST, u.real_name, i.work_date`,
    [planId]
  );
  if (!items.length) return { rows: [], flags: '' };

  // 上月实际生效分布，用于算「较上月变动」（用生效层，含手工调整，才是真值）
  const prev = prevMonth(plan.year_month);
  const { from: pFrom, to: pTo } = monthRange(prev);
  const prevRows = await many(
    `SELECT s.user_id, s.shift_code, count(*)::int AS days
       FROM attendance_schedule s
      WHERE s.work_date BETWEEN $1::date AND $2::date
        AND s.user_id IN (SELECT user_id FROM attendance_schedule_plan_item WHERE plan_id = $3)
      GROUP BY 1, 2`,
    [pFrom, pTo, planId]
  );
  const prevMap = new Map();   // uid -> { code: days }
  for (const r of prevRows) {
    const uid = num(r.user_id);
    if (!prevMap.has(uid)) prevMap.set(uid, {});
    prevMap.get(uid)[r.shift_code] = Number(r.days) || 0;
  }

  const byUser = new Map();
  for (const it of items) {
    const uid = num(it.user_id);
    if (!byUser.has(uid)) {
      byUser.set(uid, {
        name: it.real_name || it.employee_no || String(uid),
        counts: {}, rest: 0, total: 0, dates: [],
      });
    }
    const u = byUser.get(uid);
    const code = String(it.shift_code || '');
    u.counts[code] = (u.counts[code] || 0) + 1;
    if (code === REST_CODE) u.rest += 1;
    u.total += 1;
    u.dates.push({ wd: String(it.wd), code });
  }

  const monthDays = monthRange(plan.year_month).days;
  const rows = [];
  const flagLines = [];
  let nightTotal = 0;
  let restTotal = 0;
  let noRestCount = 0;
  let changedCount = 0;   // 主班次与上月不同的人数

  for (const [uid, u] of byUser) {
    // 班次天数文本按班次定义顺序拼，休息单独一列不混进来
    const parts = [];
    for (const s of shifts) {
      const n = u.counts[s.code] || 0;
      if (n) parts.push(`${s.name} ${n}`);
    }

    // 最长连续夜班（日期必须真正相邻，中间断一天就重新计数）
    let maxRun = 0;
    let run = 0;
    let lastNight = null;
    for (const d of u.dates) {
      if (!isNight(d.code)) { run = 0; lastNight = null; continue; }
      const contiguous = lastNight
        && (Date.parse(`${d.wd}T00:00:00Z`) - Date.parse(`${lastNight}T00:00:00Z`)) === 86400000;
      run = contiguous ? run + 1 : 1;
      lastNight = d.wd;
      if (run > maxRun) maxRun = run;
    }

    const f = [];
    const missing = monthDays - u.total;
    // 只有排满整月且一天没休，才算「整月未休」；没排满的人走下面「N 天未排」
    if (missing <= 0 && u.rest === 0) f.push('整月未休');
    if (maxRun > NIGHT_RUN_ALERT) f.push(`连续夜班 ${maxRun} 天`);
    if (missing > 0) f.push(`${missing} 天未排`);

    // 与上月对比只看「主班次是否变化」。
    // 天数会因月份长短（30/31 天）和法定假自然不同，把天数差也算成「变动」，
    // 会让审批人看到每个人都「变了 3 格」，反而看不出真正换班的人。
    const pv = prevMap.get(uid);
    let change = '无上月数据';
    if (pv) {
      const mainOf = (counts) => {
        let best = null;
        for (const [c, n] of Object.entries(counts)) {
          if (c === REST_CODE) continue;
          if (!best || n > best.n) best = { c, n };
        }
        return best?.c || null;
      };
      const nameOf = (c) => (c ? (shiftMap.get(c)?.name || c) : '休息');
      const cur = mainOf(u.counts);
      const old = mainOf(pv);
      if (!old) change = '上月未排班';
      else if (cur === old) change = '一致';
      else { change = `${nameOf(old)}→${nameOf(cur)}`; changedCount += 1; }
    }

    nightTotal += Object.entries(u.counts)
      .filter(([c]) => isNight(c))
      .reduce((a, [, n]) => a + n, 0);
    restTotal += u.rest;
    if (u.rest === 0) noRestCount += 1;
    if (f.length) flagLines.push(`${u.name}：${f.join('、')}`);

    rows.push({
      name: u.name,
      by_shift: parts.join(' · ') || '未排班',
      rest_days: String(u.rest),
      vs_last: change,
      flags: f.join('；') || '—',
    });
  }

  const flags = [
    `${byUser.size} 人 / ${items.length} 格（当月 ${monthDays} 天）`,
    `休息合计 ${restTotal} 天 · 夜班合计 ${nightTotal} 天`,
    changedCount ? `${changedCount} 人换班` : '无人换班',
    noRestCount ? `${noRestCount} 人整月未休` : null,
    flagLines.length ? flagLines.slice(0, 8).join('；') : null,
  ].filter(Boolean).join('｜');

  return { rows, flags };
}

export async function submitPlan(planId, user, opts = {}) {
  const plan = await loadPlanForUser(planId, user);
  if (!EDITABLE.has(plan.status)) throw bad('该计划已提交，不能重复提交', 409);

  const stat = await one(
    `SELECT count(*)::int AS cells, count(DISTINCT user_id)::int AS users
       FROM attendance_schedule_plan_item WHERE plan_id = $1`,
    [plan.id]
  );
  if (!stat?.cells) throw bad('计划里还没有任何排班，请先填写再提交', 400);

  if (await payrollConfirmed(plan.year_month)) {
    throw bad(`${plan.year_month} 的工资已确认，不能再提交这个月的排班`, 409);
  }

  const direct = !!opts.direct;
  if (direct && !isHr(user)) throw bad('只有人事/管理员可以直接生效', 403);

  const inFlight = await one(
    `SELECT id FROM attendance_schedule_plan
      WHERE year_month = $1 AND department_id = $2
        AND status IN ('pending','approved') AND id <> $3`,
    [plan.year_month, plan.department_id, plan.id]
  );
  if (inFlight) throw bad('该部门本月已有在途计划', 409);

  const dept = await one(`SELECT name FROM org_department WHERE id = $1`, [plan.department_id]);

  if (direct) {
    await query(
      `UPDATE attendance_schedule_plan
          SET status = 'approved', approver_id = $2, approved_at = now(),
              applied_at = NULL, updated_at = now()
        WHERE id = $1`,
      [plan.id, num(user?.id) || null]
    );
    await writeLog(plan.id, 'approve', user?.id, stat.cells, { direct: true });
    const result = await applyPlan(plan.id, { approverId: num(user?.id) });
    return { ok: true, direct: true, status: STATUS.APPLIED, applied: result.applied, skipped: result.skipped };
  }

  // 建单 + 提交
  const def = await one(`SELECT id FROM flow_definition WHERE code = 'schedule_plan' AND active = TRUE`);
  if (!def) throw bad('排班计划审批流程未配置，请联系管理员', 500);

  const { createInstance, submitInstance } = await import('./flow-engine.js');
  const title = `${plan.year_month} ${dept?.name || ''} 排班计划（${stat.users} 人 / ${stat.cells} 格）`;

  // 审批摘要随 formData 一起固化进实例：审批人不必跳转排班页就能看到班次分布与异常。
  // 摘要只是辅助信息，算不出来不能拦住提交，但失败要留痕，不能静默。
  let summary = { rows: [], flags: '' };
  try {
    summary = await buildPlanSummary(plan);
  } catch (e) {
    await writeLog(plan.id, 'summary_failed', user?.id, 0, {
      error: String(e?.message || e).slice(0, 500),
    }).catch(() => {});
  }

  const inst = await createInstance({
    definitionId: num(def.id),
    userId: num(user.id),
    title,
    formData: {
      plan_id: plan.plan_no,
      plan_id_num: num(plan.id),
      year_month: plan.year_month,
      department_name: dept?.name || '',
      user_count: stat.users,
      cell_count: stat.cells,
      note: plan.note || '',
      schedule_summary: summary.rows,
      schedule_flags: summary.flags,
    },
    bizSystem: 'oa',
    bizType: 'schedule_plan',
    bizKey: plan.plan_no,
  });
  await submitInstance({ instanceId: num(inst.id), userId: num(user.id) })
    .catch(async (err) => {
      // 派不到人（例如总助岗位空缺、部门负责人也是脏数据）时 submitInstance 会抛。
      // 此时实例已插入且占着 uq_flow_instance_biz（只对 draft/running 生效），
      // 若不收尾，用户改完再提交会撞「该业务单据已在审批中」，彻底卡死。
      // 这里把空壳实例置为 withdrawn 释放唯一键，原错误照旧抛给用户。
      await query(
        `UPDATE flow_instance SET status='withdrawn', finished_at=now(), updated_at=now()
          WHERE id = $1 AND status = 'draft'`,
        [num(inst.id)]
      ).catch(() => {});
      await query(`DELETE FROM flow_task WHERE instance_id = $1 AND status = 'assigned'`, [num(inst.id)])
        .catch(() => {});
      throw err;
    });

  const fresh = await one(`SELECT * FROM attendance_schedule_plan WHERE id = $1`, [plan.id]);
  const latest = await one(`SELECT status FROM flow_instance WHERE id = $1`, [num(inst.id)]);
  let finalStatus = fresh.status;

  if (EDITABLE.has(fresh.status)) {
    if (latest?.status === 'completed') {
      // 提交人就是唯一审批人（如总助自己排班）→ 节点被引擎自动跳过，流程当场完成。
      // 正常情况下终态钩子已经把计划写成 applied；这里兜底补一次，避免「审批完了计划还是草稿」。
      const upgraded = await one(
        `UPDATE attendance_schedule_plan
            SET status = 'approved', instance_id = $2, submitter_id = $3,
                submitted_at = now(), updated_at = now()
          WHERE id = $1 AND status IN ('draft','rejected') RETURNING id`,
        [plan.id, num(inst.id), num(user.id)]
      );
      if (upgraded) await applyPlan(plan.id, { approverId: null, system: true });
      finalStatus = STATUS.APPLIED;
    } else if (latest?.status === 'rejected') {
      // 理论上不会同步发生；真发生了就以流程状态为准，不再把计划挂在草稿里
      await query(
        `UPDATE attendance_schedule_plan SET status='rejected', instance_id=$2, updated_at=now()
          WHERE id=$1 AND status IN ('draft','rejected')`,
        [plan.id, num(inst.id)]
      );
      finalStatus = STATUS.REJECTED;
    } else {
      await query(
        `UPDATE attendance_schedule_plan
            SET status='pending', submitter_id=$2, submitted_at=now(), instance_id=$3, updated_at=now()
          WHERE id=$1`,
        [plan.id, num(user.id), num(inst.id)]
      );
      finalStatus = STATUS.PENDING;
    }
  }
  await writeLog(plan.id, 'submit', user?.id, stat.cells, { instance_id: num(inst.id), status: finalStatus });
  return { ok: true, instanceId: num(inst.id), status: finalStatus };
}

/** 撤回：草稿直接作废；审批中先撤销流程 */
export async function withdrawPlan(planId, user) {
  const plan = await loadPlanForUser(planId, user);
  if (plan.status === STATUS.DRAFT) {
    await query(
      `UPDATE attendance_schedule_plan SET status='cancelled', updated_at=now() WHERE id=$1`,
      [plan.id]
    );
    await writeLog(plan.id, 'cancel', user?.id, 0, { from: STATUS.DRAFT });
    return { ok: true, status: STATUS.CANCELLED };
  }
  if (plan.status !== STATUS.PENDING) throw bad('只有草稿或审批中的计划可以撤回', 409);
  if (!plan.instance_id) throw bad('计划没有关联审批单，请联系管理员', 500);

  const { withdrawInstance } = await import('./flow-engine.js');
  await withdrawInstance({ instanceId: num(plan.instance_id), userId: num(user.id) });
  await query(
    `UPDATE attendance_schedule_plan SET status='cancelled', updated_at=now() WHERE id=$1`,
    [plan.id]
  );
  await writeLog(plan.id, 'withdraw', user?.id, 0, { instance_id: num(plan.instance_id) });
  return { ok: true, status: STATUS.CANCELLED };
}

/* ============================================================
 * 回写（核心）
 * ==========================================================*/

/**
 * 把计划明细写入生效排班。
 *
 * 幂等（关键）：整个「读状态 → 写排班 → 改计划状态」在一个事务里完成，
 *   进门先 `SELECT ... FOR UPDATE` 锁住计划行。这样：
 *   · 并发两次调用，第二次会阻塞在行锁上，拿到锁时已看到 status='applied'，直接返回 already；
 *   · 中途任何异常整体回滚，计划仍是 approved + applied_at IS NULL，可原样重放；
 *   · 不存在「先置 applied_at 占锁、事务又失败」导致计划永久卡在「已占锁未回写」的窗口
 *     （这是 2026-10-29 自查发现的漏洞，旧写法是分开两条语句）。
 *
 * 冲突处理（不覆盖别人的成果）：
 *   · 该格已有 source='manual' 的手工调班 → 跳过
 *   · 该格有 attendance_day_override（休假/补班锁）→ 跳过
 *   · 其它（空、导入、历史计划回写）→ 覆盖
 */
export async function applyPlan(planId, opts = {}) {
  const id = num(planId);

  const result = await transaction(async client => {
    const { rows } = await client.query(
      `SELECT * FROM attendance_schedule_plan WHERE id = $1 FOR UPDATE`,
      [id]
    );
    const plan = rows[0];
    if (!plan) throw bad('排班计划不存在', 404);
    if (plan.applied_at) return { applied: 0, skipped: [], already: true };
    if (plan.status !== STATUS.APPROVED) throw bad('只有已通过的排班计划可以回写', 409);

    if (await payrollConfirmed(plan.year_month)) {
      throw bad(`${plan.year_month} 的工资已确认，禁止回写排班`, 409);
    }

    const { rows: itemRows } = await client.query(
      `SELECT id, user_id, work_date, shift_code, remark
         FROM attendance_schedule_plan_item WHERE plan_id = $1`,
      [plan.id]
    );
    if (!itemRows.length) throw bad('计划没有明细，无法回写', 400);

    const { from, to } = monthRange(plan.year_month);
    const userIds = [...new Set(itemRows.map(i => num(i.user_id)))];

    // 现存的受保护格子（同一事务内读取，避免与并发手工调班打架）
    const { rows: manualRows } = await client.query(
      `SELECT user_id, work_date FROM attendance_schedule
        WHERE user_id = ANY($1::bigint[]) AND work_date BETWEEN $2::date AND $3::date
          AND source = 'manual'`,
      [userIds, from, to]
    );
    const manualSet = new Set(manualRows.map(r => `${num(r.user_id)}|${String(r.work_date).slice(0, 10)}`));

    // 休假/调休锁：既有「按人」的，也有「按部门」的（scope='dept' 时 user_id 为空）。
    // 只查 user_id 会漏掉部门级覆盖 —— 全厂调休那一天仍会被计划覆盖回去，
    // 与 generateMonth 的口径不一致（那里两类都读）。
    const { rows: overrideRows } = await client.query(
      `SELECT user_id, department_id, work_date, scope FROM attendance_day_override
        WHERE work_date BETWEEN $2::date AND $3::date
          AND (user_id = ANY($1::bigint[]) OR (scope = 'dept' AND department_id = $4))`,
      [userIds, from, to, num(plan.department_id)]
    );
    const overrideSet = new Set();     // `${uid}|${date}`
    const deptOverride = new Set();    // `${date}`（部门级，对整个计划生效）
    for (const r of overrideRows) {
      const d = String(r.work_date).slice(0, 10);
      if (r.user_id) overrideSet.add(`${num(r.user_id)}|${d}`);
      else if (r.scope === 'dept') deptOverride.add(d);
    }

    const skipped = [];
    let applied = 0;

    for (const it of itemRows) {
      const day = String(it.work_date).slice(0, 10);
      const key = `${num(it.user_id)}|${day}`;
      if (manualSet.has(key)) {
        skipped.push({ user_id: num(it.user_id), work_date: it.work_date, reason: 'manual' });
        continue;
      }
      if (overrideSet.has(key) || deptOverride.has(day)) {
        skipped.push({ user_id: num(it.user_id), work_date: it.work_date, reason: 'leave_override' });
        continue;
      }
      await client.query(
        `INSERT INTO attendance_schedule
           (user_id, work_date, shift_code, source, remark, created_by, plan_id, plan_item_id, updated_at)
         VALUES ($1,$2::date,$3,'plan',$4,$5,$6,$7,now())
         ON CONFLICT (user_id, work_date) DO UPDATE SET
           shift_code = EXCLUDED.shift_code,
           source = 'plan',
           remark = COALESCE(EXCLUDED.remark, attendance_schedule.remark),
           plan_id = EXCLUDED.plan_id,
           plan_item_id = EXCLUDED.plan_item_id,
           updated_at = now()`,
        [num(it.user_id), it.work_date, it.shift_code,
         it.remark != null ? String(it.remark) : null,
         opts.approverId || null, plan.id, num(it.id)]
      );
      applied++;
    }

    await client.query(
      `UPDATE attendance_schedule_plan
          SET status = 'applied', applied_rows = $2, apply_result = $3,
              applied_at = now(), updated_at = now()
        WHERE id = $1`,
      [plan.id, applied, JSON.stringify({ skipped: skipped.slice(0, 500), total: skipped.length })]
    );

    return { applied, skipped, already: false };
  });

  if (!result.already) {
    await writeLog(id, 'apply', opts.approverId || null, result.applied, {
      skipped: result.skipped.length, system: !!opts.system,
    });
  }
  return result;
}

/* ============================================================
 * 流程终态钩子（由 flow-engine 调用）
 * ==========================================================*/

function planIdFromInstance(inst) {
  const fd = inst?.form_data || {};
  return num(fd.plan_id_num || fd.plan_id || 0);
}

/** 通过后回写 */
export async function onSchedulePlanClosed(instanceId) {
  const inst = await one(
    `SELECT fi.*, fd.code AS def_code FROM flow_instance fi
       JOIN flow_definition fd ON fd.id = fi.definition_id WHERE fi.id = $1`,
    [num(instanceId)]
  );
  if (!inst) return { ok: false, reason: 'instance_not_found' };

  let plan = await one(`SELECT * FROM attendance_schedule_plan WHERE instance_id = $1`, [num(instanceId)]);
  if (!plan) {
    const pid = planIdFromInstance(inst);
    if (pid) plan = await one(`SELECT * FROM attendance_schedule_plan WHERE id = $1`, [pid]);
  }
  if (!plan) return { ok: false, reason: 'plan_not_found' };
  if (plan.status === STATUS.APPLIED) return { ok: true, already: true };

  // 审批人：终态钩子只知道「流程通过了」，不知道是谁点的通过。
  // 从 flow_log 最后一条 approve 记录取 actor_id，否则 approver_id 永远 NULL，审计链断裂。
  const lastApprove = await one(
    `SELECT actor_id FROM flow_log
      WHERE instance_id = $1 AND action = 'approve'
      ORDER BY id DESC LIMIT 1`,
    [num(instanceId)]
  );
  const approverId = num(lastApprove?.actor_id) || null;

  await query(
    `UPDATE attendance_schedule_plan
        SET status='approved', approver_id = COALESCE($2::bigint, approver_id),
            approved_at = now(), instance_id = COALESCE(instance_id, $3::bigint), updated_at = now()
      WHERE id = $1 AND status = 'pending'`,
    [plan.id, approverId, num(instanceId)]
  );
  const r = await applyPlan(plan.id, { approverId });
  return { ok: true, applied: r.applied, skipped: r.skipped?.length || 0 };
}

/** 驳回：回到可编辑状态，保留草稿内容供修改后重提 */
export async function onSchedulePlanRejected(instanceId) {
  const plan = await one(`SELECT * FROM attendance_schedule_plan WHERE instance_id = $1`, [num(instanceId)]);
  if (!plan) return { ok: false, reason: 'plan_not_found' };
  const log = await one(
    `SELECT detail FROM flow_log WHERE instance_id = $1 AND action = 'reject'
      ORDER BY id DESC LIMIT 1`,
    [num(instanceId)]
  );
  await query(
    `UPDATE attendance_schedule_plan
        SET status='rejected', reject_reason = $2, updated_at = now()
      WHERE id = $1 AND status IN ('pending','approved')`,
    [plan.id, log?.detail || null]
  );
  await writeLog(plan.id, 'reject', null, 0, { reason: log?.detail || null });
  return { ok: true };
}

/** 撤回/终止：释放草稿 */
export async function onSchedulePlanRevoked(instanceId) {
  const plan = await one(`SELECT * FROM attendance_schedule_plan WHERE instance_id = $1`, [num(instanceId)]);
  if (!plan) return { ok: false, reason: 'plan_not_found' };
  await query(
    `UPDATE attendance_schedule_plan SET status='cancelled', updated_at=now()
      WHERE id = $1 AND status IN ('pending','approved')`,
    [plan.id]
  );
  await writeLog(plan.id, 'cancel', null, 0, { via: 'flow_revoked' });
  return { ok: true };
}
