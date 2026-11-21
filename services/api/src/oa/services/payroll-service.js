/**
 * 薪资发放服务（批次生成 / 工资单 / 递延台账）
 * ------------------------------------------------------------
 * 与 salary-service.js（v1）并列，互不覆盖：
 *   v1 走「工资结构明细行 + attendance_summary」，口径是 3 桶倍率；
 *   v2 走「时段切片 + 14 段倍率 + 分险种社保 + 免税个税 + 首月递延」。
 *   两者写同一张 salary_record，用 engine_version 区分（v1 为 NULL / '1.x'，v2 为 'v2.x'）。
 *
 * 三个必须守住的口径：
 *   1. **草稿不碰台账**。试算/生成草稿只把递延计划写在 salary_record.detail 里，
 *      真正改 payroll_deferral 只在「确认批次」时做——否则试算一次账就乱了。
 *   2. **确认过的批次不许重算**。要改先作废（void），否则会出现「一半旧数一半新数」。
 *   3. **递延是垫付不是免除**。首月三项照算，全额记 pending；离职月强制结清。
 */
import { query, many, one, transaction } from '../db/index.js';
import { computePayslip } from './salary-engine-v2.js';
import { getParams } from './salary-engine-v2.js';
import { computePayslipV3 } from './salary-engine-v3.js';
import { hasMonthLeave } from './leave-type.js';
import { loadTaxContext, loadInsuranceRates } from './payroll-deduction.js';
import { syncClassesFromPositions } from './salary-structure-v2.js';
import { round } from '../lib/payroll-core.js';

export const ENGINE_VERSION = 'v2.1.0';

// ============================================================
// 一、取数
// ============================================================
function periodRange(period) {
  const [y, m] = period.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: period + '-01', to: period + '-' + String(last).padStart(2, '0'), lastDay: last };
}

/** 某月候选人：在职 + 当月有打卡（或显式指定） */
export async function listCandidates({ period, userIds = null, includeNoPunch = false }) {
  const { from, to } = periodRange(period);
  const params = [from, to];
  let cond = '';
  if (Array.isArray(userIds) && userIds.length) {
    params.push(userIds.map(Number));
    cond = ` AND u.id = ANY($${params.length}::bigint[])`;
  }
  const rows = await many(
    `SELECT u.id, u.real_name, u.employee_no, u.salary_class_id, u.hire_date, u.active,
            COUNT(r.id)::int AS punch_days
       FROM org_user u
       LEFT JOIN attendance_raw r
         ON r.user_id = u.id AND r.work_date BETWEEN $1::date AND $2::date AND r.check_in IS NOT NULL
      WHERE u.active = TRUE
        AND COALESCE(u.is_system, FALSE) = FALSE${cond}
      GROUP BY u.id, u.real_name, u.employee_no, u.salary_class_id, u.hire_date, u.active
      ORDER BY u.id`,
    params
  );
  return rows
    .map(r => ({
      userId: Number(r.id),
      realName: r.real_name,
      employeeNo: r.employee_no,
      salaryClassId: r.salary_class_id ? Number(r.salary_class_id) : null,
      hireDate: r.hire_date ? String(r.hire_date).slice(0, 10) : null,
      punchDays: Number(r.punch_days) || 0
    }))
    .filter(r => includeNoPunch || r.punchDays > 0);
}

/** 员工花名册（薪资控制台用，含入职日期缺失提示） */
export async function listEmployees() {
  const rows = await many(
    `SELECT u.id, u.real_name, u.employee_no, u.username, u.salary_class_id, u.hire_date,
            c.name AS class_name,
            (SELECT count(*)::int FROM salary_structure s
              WHERE s.user_id = u.id AND s.status = 'approved') AS personal_structures
       FROM org_user u
       LEFT JOIN salary_class c ON c.id = u.salary_class_id
      WHERE u.active = TRUE
        AND COALESCE(u.is_system, FALSE) = FALSE
      ORDER BY u.employee_no NULLS LAST, u.id`
  );
  return rows.map(r => ({
    userId: Number(r.id),
    realName: r.real_name,
    employeeNo: r.employee_no,
    username: r.username,
    salaryClassId: r.salary_class_id ? Number(r.salary_class_id) : null,
    className: r.class_name,
    hireDate: r.hire_date ? String(r.hire_date).slice(0, 10) : null,
    personalStructures: Number(r.personal_structures) || 0,
    hireDateMissing: !r.hire_date
  }));
}

/** 打卡 → 引擎需要的 punches */
export async function loadPunches(userId, period) {
  const { from, to } = periodRange(period);
  const rows = await many(
    `SELECT r.work_date,
            MIN(r.check_in)  AS check_in,
            MAX(r.check_out) AS check_out
       FROM attendance_raw r
      WHERE r.user_id = $1 AND r.work_date BETWEEN $2::date AND $3::date
        AND r.check_in IS NOT NULL
      GROUP BY r.work_date
      ORDER BY r.work_date`,
    [userId, from, to]
  );
  const shifts = await many(
    `SELECT work_date, shift_code FROM attendance_schedule
      WHERE user_id = $1 AND work_date BETWEEN $2::date AND $3::date`,
    [userId, from, to]
  );
  const shiftMap = new Map(shifts.map(s => [String(s.work_date).slice(0, 10), s.shift_code]));
  return rows.map(r => {
    const d = String(r.work_date).slice(0, 10);
    return {
      workDate: d,
      checkIn: r.check_in,
      checkOut: r.check_out,
      shiftCode: shiftMap.get(d) || null
    };
  });
}

// ============================================================
// 二、批次
// ============================================================
async function nextRunNo(period) {
  const r = await one(`SELECT COALESCE(MAX(run_no), 0) + 1 AS n FROM payroll_run WHERE period = $1`, [period]);
  return Number(r.n);
}

/**
 * 生成某月工资单。
 *
 * @param {object} p
 *   @param {string} p.period 'YYYY-MM'
 *   @param {number[]} [p.userIds] 只算指定员工
 *   @param {boolean} [p.dryRun=false] 只算不写库
 *   @param {number} [p.createdBy]
 *   @param {boolean} [p.includeNoPunch=false]
 */
export async function generateRun({ period, userIds = null, dryRun = false, createdBy = null, includeNoPunch = false, engine = 'v3' }) {
  if (!/^\d{4}-\d{2}$/.test(String(period))) {
    throw Object.assign(new Error('薪资周期格式应为 YYYY-MM'), { statusCode: 400 });
  }

  const existing = await one(
    `SELECT id, run_no, status FROM payroll_run WHERE period = $1 AND status = 'confirmed' ORDER BY run_no DESC LIMIT 1`,
    [period]
  );
  if (existing && !dryRun) {
    throw Object.assign(new Error(
      period + ' 已有确认过的批次 #' + existing.run_no + '（id=' + existing.id + '）。' +
      '要重算请先作废该批次，否则会出现新旧数混在一张表里。'
    ), { statusCode: 409 });
  }

  const params = await getParams();
  // 职类＝岗位：生成前把岗位字典镜像到 salary_class 并刷新派生职类缓存，
  // 否则新入职/刚改过岗位的人会因为缓存没跟上而被判成「未配置结构」
  await syncClassesFromPositions();
  const taxCtx = await loadTaxContext(period);
  const rates = await loadInsuranceRates('VN', period + '-01');
  if (!rates.length) {
    throw Object.assign(new Error('未配置社保费率（salary_insurance_rate），无法生成工资单'), { statusCode: 500 });
  }

  const candidates = await listCandidates({ period, userIds, includeNoPunch });
  const engineLabel = engine === 'v2' ? ENGINE_VERSION : (engine === 'monthly' ? 'v3-monthly' : 'v3.0.0');

  const records = [];
  const skipped = [];

  // 系统/服务账号（admin、wms_bot 等）不是员工，一律不算工资。
  // listCandidates 已经在 SQL 里排除了，这里额外把「显式选了却被挡掉」的人
  // 记进 skipped，否则用户会看到「明明勾了人却少了一个」，以为系统漏算。
  if (Array.isArray(userIds) && userIds.length) {
    const sysRows = await many(
      `SELECT id, real_name, employee_no FROM org_user
        WHERE id = ANY($1::bigint[]) AND COALESCE(is_system, FALSE) = TRUE`,
      [userIds.map(Number)]
    );
    for (const r of sysRows) {
      skipped.push({
        userId: Number(r.id), realName: r.real_name, employeeNo: r.employee_no,
        reason: 'system_account', message: '系统账号，不参与工资核算'
      });
    }
  }

  if (!candidates.length) {
    return {
      period, dryRun, engine: engineLabel, runId: null, runNo: null,
      employeeCount: 0, skippedCount: skipped.length, skipped, records: [],
      totals: { gross: 0, ins: 0, union: 0, pit: 0, deferIn: 0, deferOut: 0, net: 0, cost: 0 },
      message: skipped.length
        ? '指定的账号都是系统账号，不参与工资核算。'
        : '该月没有任何员工的打卡记录，无法生成工资单。请先导入打卡或用「试算」录入。'
    };
  }

  let runId = null;
  let runNo = null;
  if (!dryRun) {
    runNo = await nextRunNo(period);
    const run = await one(
      `INSERT INTO payroll_run (period, run_no, status, engine, params_snapshot, created_by)
       VALUES ($1, $2, 'draft', $3, $4, $5) RETURNING *`,
      [period, runNo, engineLabel, JSON.stringify({ params, taxCtxSummary: {
        enabled: taxCtx.enabled, brackets: taxCtx.brackets.length,
        effectiveFrom: taxCtx.bracketsEffectiveFrom,
        selfDeduction: taxCtx.selfDeduction, dependentDeduction: taxCtx.dependentDeduction
      }, rates }), createdBy]
    );
    runId = Number(run.id);
  }

  for (const c of candidates) {
    try {
      const punches = await loadPunches(c.userId, period);
      if (!punches.length) {
        // 没打卡≠不用发钱：整月在休带薪假（年假/婚丧假等）的人必须照算，
        // 否则「全月休假」会被当成「该月没上班」直接跳过。
        const onLeave = await hasMonthLeave(c.userId, period);
        if (!onLeave) {
          skipped.push({ userId: c.userId, realName: c.realName, employeeNo: c.employeeNo, reason: 'no_punch', message: '该月没有打卡，也没有休假记录' });
          continue;
        }
      }
      const slip = engine === 'v2'
        ? await computePayslip({
          userId: c.userId, period, punches,
          forceSettle: false, taxCtx, rates, hireDate: c.hireDate
        })
        : await computePayslipV3({
          userId: c.userId, period, punches,
          forceSettle: false, taxCtx, rates, hireDate: c.hireDate,
          engine: engine === 'monthly' ? 'monthly' : 'v3'
        });

      const fatal = (slip.checks || []).filter(x => x.level === 'error');
      if (fatal.length) {
        skipped.push({
          userId: c.userId, realName: c.realName, employeeNo: c.employeeNo,
          reason: fatal[0].code, message: fatal[0].message
        });
        continue;
      }

      const rec = dryRun ? buildRecordPayload(slip, c, engineLabel) : await writeRecord({ slip, candidate: c, runId, createdBy, engineLabel });
      records.push(rec);
    } catch (err) {
      skipped.push({
        userId: c.userId, realName: c.realName, employeeNo: c.employeeNo,
        reason: 'error', message: err.message
      });
    }
  }

  const totals = sumTotals(records);

  if (!dryRun) {
    await query(
      `UPDATE payroll_run SET employee_count = $2, skipped_count = $3,
              total_gross = $4, total_ins = $5, total_union = $6, total_pit = $7,
              total_defer_in = $8, total_defer_out = $9, total_net = $10, total_cost = $11
        WHERE id = $1`,
      [runId, records.length, skipped.length, totals.gross, totals.ins, totals.union,
        totals.pit, totals.deferIn, totals.deferOut, totals.net, totals.cost]
    );
  }

  return {
    period, dryRun, engine: engineLabel, runId, runNo,
    employeeCount: records.length,
    skippedCount: skipped.length,
    skipped,
    totals,
    records
  };
}

function sumTotals(records) {
  const f = k => round(records.reduce((a, r) => a + (Number(r[k]) || 0), 0), 2);
  return {
    gross: f('gross'), ins: f('insEmployee'), union: f('unionFee'), pit: f('pitPaid'),
    deferIn: f('deferIn'), deferOut: f('deferOut'), net: f('net'), cost: f('employerCost')
  };
}

function buildRecordPayload(slip, candidate, engineLabel = ENGINE_VERSION) {
  const d = slip.deductions;
  return {
    userId: slip.userId,
    realName: candidate.realName,
    employeeNo: candidate.employeeNo,
    period: slip.period,
    engine: engineLabel,
    G: slip.pay.G,
    hourRate: slip.pay.hourRate,
    B: slip.pay.B,
    W: slip.pay.W,
    deltaHours: slip.pay.deltaHours,
    deltaPay: slip.pay.deltaPay,
    allowance: slip.pay.allowance,
    gross: slip.pay.gross,
    exemptIncome: slip.exempt.exemptIncome,
    insEmployee: d.insurance.employee,
    insCompany: d.insurance.company,
    unionFee: d.union.employee,
    pit: d.pit.amount,
    pitPaid: slip.net.pitPaid,
    deferIn: d.deferral.plan.deferIn,
    deferOut: d.deferral.plan.deferOut,
    deferBalance: d.deferral.balance,
    net: slip.net.net,
    employerCost: d.employerCost,
    firstMonth: d.deferral.firstMonth,
    firstMonthReason: d.deferral.firstMonthReason,
    blockedDays: slip.attendance.blockedDays,
    otHours: slip.attendance.otHours,
    deductions: d,
    netDetail: slip.net,
    warnings: slip.warnings
  };
}

async function writeRecord({ slip, candidate, runId, createdBy, engineLabel = ENGINE_VERSION }) {
  const p = buildRecordPayload(slip, candidate, engineLabel);
  const detail = {
    engine: engineLabel,
    payMode: slip.payMode || null,
    scheme: slip.scheme || null,
    bases: slip.bases || null,
    hourRates: slip.hourRates || null,
    profile: slip.profile || null,
    srs: { wageRows: slip.pay.wageRows, allowanceRows: slip.pay.allowanceRows, exempt: slip.exempt },
    pay: slip.pay,
    exempt: slip.exempt,
    deductions: p.deductions,
    // 补发 / 扣发（salary_adjust 电子流）：税后加减，单列以便工资单逐条展示
    adjustments: slip.adjustments || null,
    net: p.netDetail,
    attendance: {
      workdaysInCalendar: slip.attendance.workdaysInCalendar,
      attendDays: slip.attendance.attendDays,
      blockedDays: slip.attendance.blockedDays,
      payableHours: slip.attendance.payableHours,
      convertedHours: slip.attendance.convertedHours,
      naturalConvertedHours: slip.attendance.naturalConvertedHours,
      penaltyDeductHours: slip.attendance.penaltyDeductHours,
      punctuality: slip.attendance.punctuality,
      paidLeaveHours: slip.attendance.paidLeaveHours,
      exemptHours: slip.attendance.exemptHours,
      otHours: slip.attendance.otHours,
      bands: slip.attendance.bands
    },
    params: slip.params,
    warnings: p.warnings
  };

  const row = await one(
    `INSERT INTO salary_record
       (user_id, period, structure_version, base_salary, ot_pay, allowances, deductions, gross, net,
        detail, currency, status, taxable_income, pit, dependents, tax_detail,
        engine_version, monthly_base, hour_rate, quota_hours, quota_cap_hours, converted_hours,
        delta_hours, delta_pay, paid_leave_hours, exempt_income, ot_hours, calc_run_id,
        ins_employee, ins_company, union_fee, pit_paid, defer_in, defer_out, defer_balance, employer_cost,
        base_scheme_id, pay_mode, hour_rate_normal, hour_rate_ot, hour_rate_holiday,
        w_normal, w_ot, w_holiday, probation_hours, probation_rate, gross_unrounded, net_unrounded)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'VND','draft',$11,$12,$13,$14,
             $15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,
             $27,$28,$29,$30,$31,$32,$33,$34,
             $35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46)
     ON CONFLICT (user_id, period) DO UPDATE SET
       structure_version = EXCLUDED.structure_version,
       base_salary = EXCLUDED.base_salary,
       ot_pay = EXCLUDED.ot_pay,
       allowances = EXCLUDED.allowances,
       deductions = EXCLUDED.deductions,
       gross = EXCLUDED.gross,
       net = EXCLUDED.net,
       detail = EXCLUDED.detail,
       status = CASE WHEN salary_record.status = 'confirmed' THEN salary_record.status ELSE 'draft' END,
       taxable_income = EXCLUDED.taxable_income,
       pit = EXCLUDED.pit,
       dependents = EXCLUDED.dependents,
       tax_detail = EXCLUDED.tax_detail,
       engine_version = EXCLUDED.engine_version,
       monthly_base = EXCLUDED.monthly_base,
       hour_rate = EXCLUDED.hour_rate,
       quota_hours = EXCLUDED.quota_hours,
       quota_cap_hours = EXCLUDED.quota_cap_hours,
       converted_hours = EXCLUDED.converted_hours,
       delta_hours = EXCLUDED.delta_hours,
       delta_pay = EXCLUDED.delta_pay,
       paid_leave_hours = EXCLUDED.paid_leave_hours,
       exempt_income = EXCLUDED.exempt_income,
       ot_hours = EXCLUDED.ot_hours,
       calc_run_id = EXCLUDED.calc_run_id,
       ins_employee = EXCLUDED.ins_employee,
       ins_company = EXCLUDED.ins_company,
       union_fee = EXCLUDED.union_fee,
       pit_paid = EXCLUDED.pit_paid,
       defer_in = EXCLUDED.defer_in,
       defer_out = EXCLUDED.defer_out,
       defer_balance = EXCLUDED.defer_balance,
       employer_cost = EXCLUDED.employer_cost,
       base_scheme_id = EXCLUDED.base_scheme_id,
       pay_mode = EXCLUDED.pay_mode,
       hour_rate_normal = EXCLUDED.hour_rate_normal,
       hour_rate_ot = EXCLUDED.hour_rate_ot,
       hour_rate_holiday = EXCLUDED.hour_rate_holiday,
       w_normal = EXCLUDED.w_normal,
       w_ot = EXCLUDED.w_ot,
       w_holiday = EXCLUDED.w_holiday,
       probation_hours = EXCLUDED.probation_hours,
       probation_rate = EXCLUDED.probation_rate,
       gross_unrounded = EXCLUDED.gross_unrounded,
       net_unrounded = EXCLUDED.net_unrounded
       /* created_at 有意不更新（QA 缺陷 B5）：
        *   原为 created_at = now()，导致每次重算（试算→改结构→再试算 的日常路径）
        *   都把「首次生成时间」刷成本次时间，历史信息永久丢失且无任何提示。
        *   salary_record 没有 updated_at 列，按「不改表结构」的约束这里直接不动时间戳；
        *   口径与 salary-service.js（v1 试算路径）保持一致。
        *   注：记录级 ON CONFLICT 守卫（WHERE status IN (...)）未在此实现，
        *   因为 generateRun:147-158 已有批次级 409 守卫、且 voidRun:545 会把记录同步置 void，
        *   工作流层面已闭环 —— 列为纵深防御技术债，不阻塞本次修复。
        */
     RETURNING id, user_id, period, status, gross, net`,
    [
      p.userId, p.period, slip.structure ? slip.structure.version : null,
      round(p.G, 2),
      round(p.gross - p.G - p.allowance, 2),   // ot_pay = 差额工资（正班以外）
      p.allowance,
      round(p.insEmployee + p.unionFee + p.deferIn, 2),
      p.gross, p.net,
      JSON.stringify(detail),
      p.deductions.pit.taxableIncome, p.pit, p.deductions.pit.dependents,
      JSON.stringify(p.deductions.pit.detail || {}),
      ENGINE_VERSION, round(p.G, 2), p.hourRate, p.B, slip.params.quotaCapHours,
      p.W, p.deltaHours, p.deltaPay, slip.attendance.paidLeaveHours,
      p.exemptIncome, p.otHours, runId,
      p.insEmployee, p.insCompany, p.unionFee, p.pitPaid,
      p.deferIn, p.deferOut, p.deferBalance, p.employerCost,
      slip.scheme ? slip.scheme.id : null,
      slip.payMode || null,
      slip.hourRates?.normal?.rate ?? null,
      slip.hourRates?.overtime?.rate ?? null,
      slip.hourRates?.holiday?.rate ?? null,
      slip.attendance?.carriedHours?.normal ?? 0,
      slip.attendance?.carriedHours?.overtime ?? 0,
      slip.attendance?.carriedHours?.holiday ?? 0,
      slip.attendance?.probationHours ?? 0,
      slip.pay?.probationRate ?? null,
      slip.pay?.grossRaw ?? null,
      slip.net?.netRaw ?? null
    ]
  );

  // 补发/扣发：记录「已并入哪一期」（只作对账留痕，不影响下月重算时是否读取）
  const adjItems = (slip.adjustments && slip.adjustments.items) || [];
  if (adjItems.length) {
    try {
      const mod = await import('./salary-adjust.js');
      await mod.settleAdjustments({
        ids: adjItems.map(x => x.id),
        runId,
        salaryRecordId: Number(row.id),
        period: p.period
      });
    } catch (err) {
      console.warn('[payroll] 标记补发/扣发已并入失败（已忽略）:', err?.message || err);
    }
  }

  return {
    recordId: Number(row.id),
    ...p
  };
}

// ============================================================
// 三、确认批次 —— 唯一会动递延台账的地方
// ============================================================
export async function confirmRun(runId, userId) {
  const run = await one(`SELECT * FROM payroll_run WHERE id = $1`, [runId]);
  if (!run) throw Object.assign(new Error('批次不存在：' + runId), { statusCode: 404 });
  if (run.status === 'confirmed') throw Object.assign(new Error('该批次已确认，无需重复确认'), { statusCode: 409 });
  if (run.status === 'void') throw Object.assign(new Error('该批次已作废，不能确认'), { statusCode: 409 });

  const records = await many(
    `SELECT * FROM salary_record WHERE calc_run_id = $1 ORDER BY user_id`, [runId]
  );

  await transaction(async client => {
    for (const r of records) {
      const detail = r.detail || {};
      const def = detail.deductions && detail.deductions.deferral;
      if (!def) continue;

      // 1) 结清历史递延
      for (const s of (def.settle || [])) {
        await client.query(
          `UPDATE payroll_deferral
              SET status = 'settled', settled_period = $1, settle_run_id = $2, settled_at = now()
            WHERE user_id = $3 AND source_period = $4 AND item_type = $5 AND status = 'pending'`,
          [run.period, runId, r.user_id, s.sourcePeriod, s.itemType]
        );
      }
      // 2) 登记本期新增递延（首月）
      for (const n of (def.newDeferral || [])) {
        await client.query(
          `INSERT INTO payroll_deferral (user_id, source_period, item_type, amount, status, note)
           VALUES ($1, $2, $3, $4, 'pending', $5)
           ON CONFLICT (user_id, source_period, item_type)
           DO UPDATE SET amount = EXCLUDED.amount
             WHERE payroll_deferral.status = 'pending'`,
          [r.user_id, run.period, n.itemType, n.amount,
            '首月垫付（' + run.period + '），次月起扣回']
        );
      }
    }
    await client.query(
      `UPDATE salary_record SET status = 'confirmed' WHERE calc_run_id = $1`, [runId]
    );
    await client.query(
      `UPDATE payroll_run SET status = 'confirmed', confirmed_by = $2, confirmed_at = now() WHERE id = $1`,
      [runId, userId || null]
    );
  });

  return {
    runId, period: run.period, confirmedRecords: records.length,
    message: '批次已确认：工资单锁定，递延台账已更新'
  };
}

/** 作废批次（已确认的会回滚递延？——不自动回滚，只解绑工资单，避免动已发钱） */
export async function voidRun(runId, userId, reason = '') {
  const run = await one(`SELECT * FROM payroll_run WHERE id = $1`, [runId]);
  if (!run) throw Object.assign(new Error('批次不存在：' + runId), { statusCode: 404 });
  if (run.status === 'void') throw Object.assign(new Error('该批次已作废'), { statusCode: 409 });

  await transaction(async client => {
    await client.query(
      `UPDATE payroll_run SET status = 'void',
              params_snapshot = jsonb_set(COALESCE(params_snapshot,'{}'::jsonb), '{void_reason}', to_jsonb($2::text))
        WHERE id = $1`, [runId, reason || '']
    );
    await client.query(
      `UPDATE salary_record SET status = 'void' WHERE calc_run_id = $1`, [runId]
    );
  });
  return { runId, status: 'void', message: '批次已作废。若该批已确认过，递延台账需人工核对并回滚。' };
}

// ============================================================
// 四、查询
// ============================================================
export async function listRuns(period = null, limit = 24) {
  const rows = await many(
    `SELECT r.*, u.real_name AS created_by_name
       FROM payroll_run r LEFT JOIN org_user u ON u.id = r.created_by
      WHERE ($1::text IS NULL OR r.period = $1)
      ORDER BY r.period DESC, r.run_no DESC LIMIT $2`,
    [period, limit]
  );
  return rows.map(mapRun);
}

function mapRun(r) {
  return {
    id: Number(r.id),
    period: r.period,
    runNo: r.run_no,
    status: r.status,
    engine: r.engine,
    employeeCount: r.employee_count,
    skippedCount: r.skipped_count,
    totals: {
      gross: Number(r.total_gross), ins: Number(r.total_ins), union: Number(r.total_union),
      pit: Number(r.total_pit), deferIn: Number(r.total_defer_in),
      deferOut: Number(r.total_defer_out), net: Number(r.total_net), cost: Number(r.total_cost)
    },
    createdBy: r.created_by_name || null,
    createdAt: r.created_at,
    confirmedAt: r.confirmed_at
  };
}

export async function listPayslips({ period, userId = null, status = null, page = 1, pageSize = 50 } = {}) {
  const cond = [];
  const params = [];
  if (period) { params.push(period); cond.push(`r.period = $${params.length}`); }
  if (userId) { params.push(Number(userId)); cond.push(`r.user_id = $${params.length}`); }
  if (status) { params.push(status); cond.push(`r.status = $${params.length}`); }
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';

  const total = await one(
    `SELECT count(*)::int n FROM salary_record r ${where}`, params
  );
  params.push(Number(pageSize) || 50, (Number(page) - 1) * (Number(pageSize) || 50));
  const rows = await many(
    `SELECT r.*, u.real_name, u.employee_no
       FROM salary_record r LEFT JOIN org_user u ON u.id = r.user_id
      ${where}
      ORDER BY r.period DESC, u.employee_no NULLS LAST, r.user_id
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return {
    total: total.n,
    page: Number(page),
    pageSize: Number(pageSize),
    items: rows.map(mapRecord)
  };
}

function mapRecord(r) {
  return {
    id: Number(r.id),
    userId: Number(r.user_id),
    realName: r.real_name,
    employeeNo: r.employee_no,
    period: r.period,
    status: r.status,
    engine: r.engine_version,
    G: Number(r.monthly_base),
    hourRate: Number(r.hour_rate),
    B: Number(r.quota_hours),
    W: Number(r.converted_hours),
    deltaHours: Number(r.delta_hours),
    deltaPay: Number(r.delta_pay),
    gross: Number(r.gross),
    exemptIncome: Number(r.exempt_income),
    insEmployee: Number(r.ins_employee),
    insCompany: Number(r.ins_company),
    unionFee: Number(r.union_fee),
    pit: Number(r.pit),
    pitPaid: Number(r.pit_paid),
    deferIn: Number(r.defer_in),
    deferOut: Number(r.defer_out),
    deferBalance: Number(r.defer_balance),
    net: Number(r.net),
    employerCost: Number(r.employer_cost),
    otHours: Number(r.ot_hours),
    runId: r.calc_run_id ? Number(r.calc_run_id) : null
  };
}

/**
 * 本人可查的工资单月份清单（自助查询用）
 * ------------------------------------------------------------
 * 只回「本人 + 未作废」的月份：作废单不进列表，避免员工拿着废单来问。
 * 金额只给 gross/net，够渲染左侧月份列表；完整构成按需再取 self/:period。
 */
export async function listSelfPayslipPeriods(userId, { includeVoid = false } = {}) {
  const rows = await many(
    `SELECT r.period, r.status, r.gross, r.net, r.engine_version, r.created_at,
            r.pit_paid, r.ins_employee, r.union_fee,
            (r.detail->'adjustments'->>'net') AS adj_net
       FROM salary_record r
      WHERE r.user_id = $1 ${includeVoid ? '' : "AND r.status <> 'void'"}
      ORDER BY r.period DESC`,
    [Number(userId)]
  );
  const items = rows.map(r => ({
    period: r.period,
    status: r.status,
    confirmed: r.status === 'confirmed',
    engine: r.engine_version || null,
    gross: Number(r.gross) || 0,
    net: Number(r.net) || 0,
    pit: Number(r.pit_paid) || 0,
    insEmployee: Number(r.ins_employee) || 0,
    unionFee: Number(r.union_fee) || 0,
    adjustNet: Number(r.adj_net) || 0,
    updatedAt: r.created_at
  }));
  const confirmed = items.filter(x => x.confirmed);
  const sum = k => round(items.reduce((a, x) => a + (Number(x[k]) || 0), 0), 2);
  return {
    items,
    periods: items.map(x => x.period),
    latest: items.length ? items[0].period : null,
    latestConfirmed: confirmed.length ? confirmed[0].period : null,
    summary: {
      months: items.length,
      confirmedMonths: confirmed.length,
      totalGross: sum('gross'),
      totalNet: sum('net'),
      totalPit: sum('pit'),
      totalInsurance: sum('insEmployee'),
      totalUnion: sum('unionFee')
    }
  };
}

export async function getPayslip(userId, period) {
  const r = await one(
    `SELECT r.*, u.real_name, u.employee_no FROM salary_record r
       LEFT JOIN org_user u ON u.id = r.user_id
      WHERE r.user_id = $1 AND r.period = $2`,
    [Number(userId), period]
  );
  if (!r) return null;
  return { ...mapRecord(r), detail: r.detail, warnings: r.detail?.warnings || [] };
}

// ============================================================
// 五、递延台账
// ============================================================
export async function listDeferrals({ status = null, userId = null, period = null, limit = 200 } = {}) {
  const cond = [];
  const params = [];
  if (status) { params.push(status); cond.push(`d.status = $${params.length}`); }
  if (userId) { params.push(Number(userId)); cond.push(`d.user_id = $${params.length}`); }
  if (period) { params.push(period); cond.push(`d.source_period = $${params.length}`); }
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  params.push(Number(limit) || 200);

  const rows = await many(
    `SELECT d.*, u.real_name, u.employee_no
       FROM payroll_deferral d LEFT JOIN org_user u ON u.id = d.user_id
      ${where}
      ORDER BY d.source_period DESC, u.employee_no NULLS LAST, d.item_type
      LIMIT $${params.length}`,
    params
  );
  return rows.map(r => ({
    id: Number(r.id),
    userId: Number(r.user_id),
    realName: r.real_name,
    employeeNo: r.employee_no,
    sourcePeriod: r.source_period,
    itemType: r.item_type,
    amount: Number(r.amount),
    status: r.status,
    settledPeriod: r.settled_period,
    settleRunId: r.settle_run_id ? Number(r.settle_run_id) : null,
    note: r.note,
    createdAt: r.created_at,
    settledAt: r.settled_at
  }));
}

export async function deferralSummary() {
  const rows = await many(
    `SELECT status, count(*)::int n, COALESCE(SUM(amount),0) AS amount
       FROM payroll_deferral GROUP BY status`
  );
  const out = { pending: { count: 0, amount: 0 }, settled: { count: 0, amount: 0 }, waived: { count: 0, amount: 0 } };
  for (const r of rows) {
    out[r.status] = { count: Number(r.n), amount: Number(r.amount) };
  }
  return out;
}

/** 豁免递延（离职不追、或 HR 决定不扣）——必须留痕 */
export async function waiveDeferral(id, reason, userId) {
  const row = await one(`SELECT * FROM payroll_deferral WHERE id = $1`, [id]);
  if (!row) throw Object.assign(new Error('递延记录不存在：' + id), { statusCode: 404 });
  if (row.status !== 'pending') {
    throw Object.assign(new Error('只有 pending 状态可以豁免，当前：' + row.status), { statusCode: 409 });
  }
  await query(
    `UPDATE payroll_deferral
        SET status = 'waived', note = COALESCE(note,'') || ' | 豁免：' || $2,
            settled_at = now()
      WHERE id = $1`,
    [id, (reason || '未说明') + '（操作人 ' + (userId || '-') + '）']
  );
  return { id, status: 'waived' };
}
