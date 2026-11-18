/**
 * 薪资补发 / 扣发（salary_adjust 电子流的业务侧）
 * ------------------------------------------------------------
 * 用户口径（2026-10-28）：
 *   工资核算完之后留一个补发/扣发窗口，必须写原因，走电子流；
 *   人事助理提交，人事主管/经理（现由总经理助理兼任）批准后并入当月工资。
 *
 * 三条约束落在本文件里：
 *   1. 金额校验在「提交」和「审批通过」两处都做 —— 审批人改单也拦得住
 *   2. 一条流程只落一条台账（instance_id 唯一），重复调用幂等
 *   3. 并入工资是税后加减，不参与社保/个税基数（见 salary-engine-v3 的 adjustments 段）
 */
import { one, many, query, transaction } from '../db/index.js';

const CAT = 'salary_adjust';

/** 金额归一到 2 位小数 */
const r2 = v => Math.round((Number(v) || 0) * 100) / 100;

/**
 * 校验单据金额与归属月份。抛出的错误带 statusCode=400 / isBiz，
 * 由路由或流程引擎原样回显给申请人。
 *
 * @param {object} formData flow_instance.form_data
 * @returns {{userId:number, period:string, payAmount:number, deductAmount:number, netAmount:number, reason:string}}
 */
export function parseAdjustForm(formData = {}) {
  const userId = Number(formData.user_id || formData.userId || formData.on_behalf_of || 0);
  if (!userId) {
    throw Object.assign(new Error('请选择员工（工号+姓名）'), { statusCode: 400, isBiz: true });
  }
  const period = String(formData.period || '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    throw Object.assign(new Error('归属工资月份格式应为 YYYY-MM，例如 2026-11'), { statusCode: 400, isBiz: true });
  }
  const payAmount = r2(formData.pay_amount);
  const deductAmount = r2(formData.deduct_amount);
  const reason = String(formData.reason || '').trim();

  if (deductAmount > 0) {
    throw Object.assign(
      new Error('扣发金额请填负数（例如 -500000）。如果是要发钱，请填在「补发金额」里'),
      { statusCode: 400, isBiz: true }
    );
  }
  if (Math.abs(payAmount) < 0.005 && Math.abs(deductAmount) < 0.005) {
    throw Object.assign(new Error('补发金额与扣发金额不能都为 0'), { statusCode: 400, isBiz: true });
  }
  if (payAmount < 0) {
    throw Object.assign(new Error('补发金额不能为负；要扣钱请填在「扣发金额」并写成负数'), { statusCode: 400, isBiz: true });
  }
  if (!reason) {
    throw Object.assign(new Error('必须写明补发/扣发原因'), { statusCode: 400, isBiz: true });
  }
  return {
    userId, period, payAmount, deductAmount,
    netAmount: r2(payAmount + deductAmount), reason
  };
}

/**
 * 流程终态回调：审批通过 → 落 salary_adjustment（幂等）。
 *
 * @param {number} instanceId
 * @returns {Promise<{ok:boolean, action:string, id?:number, reason?:string}>}
 */
export async function onSalaryAdjustClosed(instanceId) {
  try {
    const inst = await one(
      `SELECT fi.*, fd.code AS def_code
         FROM flow_instance fi JOIN flow_definition fd ON fd.id = fi.definition_id
        WHERE fi.id = $1`,
      [instanceId]
    );
    if (!inst) return { ok: false, action: 'skipped', reason: '实例不存在' };
    if (inst.def_code !== CAT) {
      return { ok: false, action: 'skipped', reason: `非 ${CAT} 流程：${inst.def_code}` };
    }

    let f;
    try {
      f = parseAdjustForm(inst.form_data || {});
    } catch (e) {
      // 审批通过但金额不合法：不落台账，留 warn 让人工处理（流程不回滚）
      console.warn(`[salary-adjust] 单据 ${inst.instance_no} 校验未过：${e.message}`);
      return { ok: false, action: 'skipped', reason: e.message };
    }

    const emp = await one(
      `SELECT id, employee_no, real_name FROM org_user WHERE id = $1`,
      [f.userId]
    );
    if (!emp) return { ok: false, action: 'skipped', reason: '员工不存在：' + f.userId };

    const row = await one(
      `INSERT INTO salary_adjustment
         (instance_id, instance_no, user_id, employee_no, real_name, period,
          pay_amount, deduct_amount, net_amount, reason, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active')
       ON CONFLICT (instance_id) DO UPDATE SET
         period        = EXCLUDED.period,
         pay_amount    = EXCLUDED.pay_amount,
         deduct_amount = EXCLUDED.deduct_amount,
         net_amount    = EXCLUDED.net_amount,
         reason        = EXCLUDED.reason,
         updated_at    = now()
       RETURNING id`,
      [instanceId, inst.instance_no || null, f.userId, emp.employee_no, emp.real_name,
        f.period, f.payAmount, f.deductAmount, f.netAmount, f.reason]
    );

    return {
      ok: true, action: 'created', id: Number(row.id),
      userId: f.userId, period: f.period,
      payAmount: f.payAmount, deductAmount: f.deductAmount, netAmount: f.netAmount
    };
  } catch (err) {
    console.warn(`[salary-adjust] onSalaryAdjustClosed 失败（已忽略）instance=${instanceId}:`, err?.message || err);
    return { ok: false, action: 'skipped', reason: err?.message || String(err) };
  }
}

/**
 * 取某人某月应并入的补发/扣发记录。计薪时调用。
 *
 * 口径说明：只按「归属月份 + 非作废」筛选，**不看 settled 状态**。
 * 因为同一月份可能会重算多次（改结构、补打卡、作废重跑），
 * 如果第一次算完就把它排除掉，重算时这笔补发会凭空消失。
 * settled 只用来记录「已经算进哪一期」，供对账展示。
 *
 * @param {number} userId
 * @param {string} period YYYY-MM
 */
export async function loadActiveAdjustments(userId, period) {
  const rows = await many(
    `SELECT id, instance_no, pay_amount, deduct_amount, net_amount, reason, status, created_at
       FROM salary_adjustment
      WHERE user_id = $1 AND period = $2 AND status <> 'void'
      ORDER BY id`,
    [Number(userId), String(period)]
  );
  return rows.map(r => ({
    id: Number(r.id),
    instanceNo: r.instance_no,
    payAmount: r2(r.pay_amount),
    deductAmount: r2(r.deduct_amount),
    netAmount: r2(r.net_amount),
    reason: r.reason
  }));
}

/**
 * 工资落库后把并入的记录标记 settled，避免下个月被重复并入。
 *
 * @param {object} p { ids, runId, salaryRecordId, period }
 */
export async function settleAdjustments({ ids = [], runId = null, salaryRecordId = null, period = null }) {
  const list = (ids || []).map(Number).filter(Boolean);
  if (!list.length) return { settled: 0 };
  const r = await query(
    `UPDATE salary_adjustment
        SET status = 'settled', run_id = $2, salary_record_id = $3,
            settled_period = $4, settled_at = now(), updated_at = now()
      WHERE id = ANY($1::bigint[]) AND status = 'active'`,
    [list, runId ? Number(runId) : null, salaryRecordId ? Number(salaryRecordId) : null, period]
  );
  return { settled: r.rowCount || 0 };
}

/** 台账查询（核算页 / 自助工资单共用） */
export async function listAdjustments({ userId = null, period = null, status = null, limit = 300 } = {}) {
  const cond = ['1=1'];
  const args = [];
  if (userId) { args.push(Number(userId)); cond.push(`a.user_id = $${args.length}`); }
  if (period) { args.push(String(period)); cond.push(`a.period = $${args.length}`); }
  if (status) { args.push(String(status)); cond.push(`a.status = $${args.length}`); }
  args.push(Number(limit) || 300);

  const rows = await many(
    `SELECT a.*, u.employee_no AS emp_no, u.real_name AS emp_name
       FROM salary_adjustment a
       LEFT JOIN org_user u ON u.id = a.user_id
      WHERE ${cond.join(' AND ')}
      ORDER BY a.period DESC, a.id DESC
      LIMIT $${args.length}`,
    args
  );
  return rows.map(r => ({
    id: Number(r.id),
    instanceId: Number(r.instance_id),
    instanceNo: r.instance_no,
    userId: Number(r.user_id),
    employeeNo: r.emp_no || r.employee_no,
    realName: r.emp_name || r.real_name,
    period: r.period,
    payAmount: r2(r.pay_amount),
    deductAmount: r2(r.deduct_amount),
    netAmount: r2(r.net_amount),
    reason: r.reason,
    status: r.status,
    settledPeriod: r.settled_period,
    settledAt: r.settled_at,
    createdAt: r.created_at
  }));
}

/** 作废（撤回窗口：已审批但还没并进工资的单，可以作废） */
export async function voidAdjustment(id, reason, userId = null) {
  const row = await one(`SELECT * FROM salary_adjustment WHERE id = $1`, [Number(id)]);
  if (!row) throw Object.assign(new Error('调整记录不存在'), { statusCode: 404 });
  if (row.status === 'settled') {
    throw Object.assign(new Error('这条记录已并入 ' + row.settled_period + ' 的工资，不能作废；请开一张反向的补发/扣发单'), { statusCode: 409 });
  }
  await query(
    `UPDATE salary_adjustment
        SET status = 'void', reason = COALESCE(reason,'') || ' | 作废：' || $2,
            updated_at = now()
      WHERE id = $1`,
    [Number(id), (reason || '未说明') + '（操作人 ' + (userId || '-') + '）']
  );
  return { id: Number(id), status: 'void' };
}
