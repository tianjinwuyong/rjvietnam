/**
 * 薪资 v2 路由（/api/payroll/*）
 * ------------------------------------------------------------
 * 权限：
 *   · 管理类（参数/费率/时段/批次/全员工资单/递延）：salary:manage
 *   · 本人工资单：任何登录用户只能看自己（路由内强制 userId = req.user.id）
 *
 * 口径：v2 = 月薪制 + 14 段倍率 + 分险种社保 + 免税个税 + 首月递延。
 *       与 v1（/api/salary/*）并存，互不影响。
 */
import { authenticate, ok, wrap, requirePermission } from '../middleware/index.js';
import { query, many, one } from '../db/index.js';
import * as payroll from '../services/payroll-service.js';
import * as structure from '../services/salary-structure-v2.js';
import { computePayslip, getParams } from '../services/salary-engine-v2.js';
import * as engineV3 from '../services/salary-engine-v3.js';
import * as leaveType from '../services/leave-type.js';
import * as leaveBalance from '../services/leave-balance.js';
import * as salaryAdjust from '../services/salary-adjust.js';
import { loadInsuranceRates, loadTaxContext, clearDeductionCache } from '../services/payroll-deduction.js';
import { clearBandCache } from '../services/attendance-band.js';
import { DEFAULT_BANDS, DEFAULT_MEALS, SHIFT_DEFS } from '../lib/payroll-core.js';
import { validateBrackets } from '../lib/payroll-deduction.js';

const MANAGE = requirePermission('salary:manage');

/** 允许从界面改的参数白名单（其余参数改动必须走迁移，防止误改分母） */
const EDITABLE_PARAMS = new Set([
  'exempt_mode', 'payroll_deferral_mode', 'payroll_pit_exempt_deduct',
  'ins_min_base', 'payroll_net_round', 'quota_cap_hours', 'hourly_denominator'
]);

export default async function payrollRoutes(app) {
  app.addHook('preHandler', authenticate);

  // ---------------- 概览 ----------------
  app.get('/api/payroll/overview', wrap(async (req, reply) => {
    const period = req.query?.period || new Date().toISOString().slice(0, 7);
    const params = await getParams();
    const rates = await loadInsuranceRates('VN', period + '-01');
    const taxCtx = await loadTaxContext(period);
    const runs = await payroll.listRuns(period, 5);
    const deferral = await payroll.deferralSummary();
    const latest = runs.find(r => r.status === 'confirmed') || runs[0] || null;

    const employees = await payroll.listEmployees();
    const bracketCheck = validateBrackets(taxCtx.brackets);

    return ok(reply, {
      period,
      engine: payroll.ENGINE_VERSION,
      employees: employees.length,
      hireDateMissing: employees.filter(e => e.hireDateMissing).length,
      latestRun: latest,
      runs,
      deferral,
      params: {
        exemptMode: params.exempt_mode || 'B',
        deferralMode: params.payroll_deferral_mode || 'defer',
        pitExemptDeduct: String(params.payroll_pit_exempt_deduct ?? 'true') !== 'false',
        hourlyDenominator: params.hourly_denominator,
        quotaCapHours: params.quota_cap_hours,
        otCapMonth: params.ot_cap_month,
        otCapYear: params.ot_cap_year,
        minWageMonthly: params.min_wage_monthly,
        insMinBase: params.ins_min_base
      },
      insurance: {
        rates,
        employeeTotalRate: rates.filter(r => r.code !== 'union').reduce((a, r) => a + r.employee_rate, 0),
        companyTotalRate: rates.filter(r => r.code !== 'union').reduce((a, r) => a + r.company_rate, 0)
      },
      tax: {
        enabled: taxCtx.enabled,
        brackets: taxCtx.brackets,
        effectiveFrom: taxCtx.bracketsEffectiveFrom,
        selfDeduction: taxCtx.selfDeduction,
        dependentDeduction: taxCtx.dependentDeduction,
        bracketsValid: bracketCheck.ok,
        bracketIssues: bracketCheck.issues
      }
    });
  }));

  // ---------------- 参数 ----------------
  app.get('/api/payroll/params', { preHandler: MANAGE }, wrap(async (req, reply) => {
    const rows = await many(
      `SELECT DISTINCT ON (param_key) param_key, param_value, value_type, label, effective_from
         FROM salary_param WHERE region_code = 'VN'
        ORDER BY param_key, effective_from DESC`
    );
    return ok(reply, {
      editable: [...EDITABLE_PARAMS],
      items: rows.map(r => ({
        key: r.param_key,
        value: r.param_value,
        type: r.value_type,
        label: r.label,
        effectiveFrom: r.effective_from,
        editable: EDITABLE_PARAMS.has(r.param_key)
      }))
    });
  }));

  app.put('/api/payroll/params', { preHandler: MANAGE }, wrap(async (req, reply) => {
    const body = req.body || {};
    const updates = Object.entries(body).filter(([k]) => EDITABLE_PARAMS.has(k));
    if (!updates.length) {
      return ok(reply, { updated: 0 }, '没有可修改的参数（白名单外的参数需走迁移）');
    }
    const today = new Date().toISOString().slice(0, 10);
    const changed = [];
    for (const [key, value] of updates) {
      const old = await one(
        `SELECT param_value, value_type FROM salary_param
          WHERE param_key = $1 AND region_code = 'VN'
          ORDER BY effective_from DESC LIMIT 1`, [key]
      );
      if (!old) continue;
      const v = value === null || value === undefined ? '' : String(value);
      if (String(old.param_value) === v) continue;
      await query(
        `INSERT INTO salary_param (param_key, region_code, effective_from, param_value, value_type, label, updated_by, updated_at)
         SELECT param_key, region_code, $2::date, $3, value_type, label, $4, now()
           FROM salary_param WHERE param_key = $1 AND region_code = 'VN'
          ORDER BY effective_from DESC LIMIT 1
         ON CONFLICT (param_key, region_code, effective_from)
         DO UPDATE SET param_value = EXCLUDED.param_value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [key, today, v, req.user.id || null]
      );
      changed.push({ key, from: old.param_value, to: v });
    }
    clearDeductionCache();
    clearBandCache();
    return ok(reply, { updated: changed.length, changed },
      changed.length ? '参数已生效（60 秒缓存内自动刷新），如需套用到已生成工资单请重算' : '参数无变化');
  }));

  // ---------------- 社保费率 ----------------
  app.get('/api/payroll/insurance-rates', { preHandler: MANAGE }, wrap(async (req, reply) => {
    const date = req.query?.date || new Date().toISOString().slice(0, 10);
    const rows = await many(
      `SELECT * FROM salary_insurance_rate WHERE region_code = 'VN' AND effective_from <= $1::date
        AND (effective_to IS NULL OR effective_to >= $1::date)
        ORDER BY sort_order, code`, [date]
    );
    return ok(reply, rows.map(r => ({
      id: Number(r.id),
      code: r.code, name: r.name, nameVi: r.name_vi,
      mode: r.mode || 'ratio',
      employeeRate: Number(r.employee_rate), companyRate: Number(r.company_rate),
      employeeFixed: Number(r.employee_fixed) || 0,
      companyFixed: Number(r.company_fixed) || 0,
      baseMode: r.base_mode, capBase: r.cap_base == null ? null : Number(r.cap_base),
      capNote: r.cap_note, active: r.active, effectiveFrom: r.effective_from
    })));
  }));

  app.put('/api/payroll/insurance-rates/:id', { preHandler: MANAGE }, wrap(async (req, reply) => {
    const id = Number(req.params.id);
    const b = req.body || {};
    const cur = await one(`SELECT * FROM salary_insurance_rate WHERE id = $1`, [id]);
    if (!cur) { reply.code(404); return ok(reply, null, '费率不存在'); }

    // 改费率必须「新开一版」，不能就地改——否则历史月份重算会跟着变
    const today = new Date().toISOString().slice(0, 10);
    const nextFrom = b.effectiveFrom || today;
    const mode = String(b.mode || cur.mode || 'ratio').toLowerCase() === 'fixed' ? 'fixed' : 'ratio';
    const empRate = b.employeeRate != null ? Number(b.employeeRate) : Number(cur.employee_rate);
    const comRate = b.companyRate != null ? Number(b.companyRate) : Number(cur.company_rate);
    const empFixed = b.employeeFixed != null ? Number(b.employeeFixed) : (Number(cur.employee_fixed) || 0);
    const comFixed = b.companyFixed != null ? Number(b.companyFixed) : (Number(cur.company_fixed) || 0);
    const cap = b.capBase === undefined ? (cur.cap_base == null ? null : Number(cur.cap_base))
      : (b.capBase === null || b.capBase === '' ? null : Number(b.capBase));
    const active = b.active === undefined ? cur.active : !!b.active;

    if (empRate < 0 || comRate < 0) { reply.code(400); return ok(reply, null, '费率不能为负'); }
    if (empFixed < 0 || comFixed < 0) { reply.code(400); return ok(reply, null, '定额不能为负'); }
    if (mode === 'fixed' && !empFixed && !comFixed) {
      reply.code(400); return ok(reply, null, '定额模式下每期定额不能为 0');
    }

    const row = await one(
      `INSERT INTO salary_insurance_rate
         (region_code, code, name, name_vi, employee_rate, company_rate, mode, employee_fixed, company_fixed,
          base_mode, cap_base, cap_note, sort_order, active, effective_from)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (region_code, code, effective_from) DO UPDATE SET
         employee_rate = EXCLUDED.employee_rate, company_rate = EXCLUDED.company_rate,
         mode = EXCLUDED.mode, employee_fixed = EXCLUDED.employee_fixed,
         company_fixed = EXCLUDED.company_fixed,
         cap_base = EXCLUDED.cap_base, active = EXCLUDED.active, updated_at = now()
       RETURNING *`,
      [cur.region_code, cur.code, cur.name, cur.name_vi, empRate, comRate, mode, empFixed, comFixed,
        cur.base_mode, cap, cur.cap_note, cur.sort_order, active, nextFrom]
    );

    // 工会费口径：金额/模式同步回 salary_param，老页面读参数时不会看到另一个数字
    if (String(cur.code).toLowerCase() === 'union') {
      for (const [key, value] of [
        ['union_fee_mode', mode],
        ['union_fee_fixed', String(empFixed)]
      ]) {
        await query(
          `INSERT INTO salary_param (region_code, param_key, effective_from, param_value, value_type)
           VALUES ('VN', $1, $2::date, $3, $4)
           ON CONFLICT (region_code, param_key, effective_from)
           DO UPDATE SET param_value = EXCLUDED.param_value, updated_at = now()`,
          [key, nextFrom, value, key === 'union_fee_fixed' ? 'number' : 'string']
        );
      }
    }

    clearDeductionCache();
    return ok(reply, { id: Number(row.id), effectiveFrom: row.effective_from, mode },
      mode === 'fixed'
        ? '已按生效日新增一版定额（每人每月 ' + empFixed + '），历史月份不受影响'
        : '费率已按生效日新增一版，历史月份不受影响');
  }));

  // ---------------- 时段与倍率 ----------------
  app.get('/api/payroll/bands', wrap(async (req, reply) => {
    const set = await one(
      `SELECT * FROM attendance_time_band_set WHERE status = 'published'
        ORDER BY effective_from DESC, version DESC LIMIT 1`
    );
    if (!set) {
      return ok(reply, { set: null, bands: DEFAULT_BANDS, meals: DEFAULT_MEALS, shifts: SHIFT_DEFS, source: 'default' });
    }
    const bands = await many(
      `SELECT * FROM attendance_time_band WHERE set_id = $1 AND active = TRUE ORDER BY seq`, [set.id]
    );
    const meals = await many(
      `SELECT * FROM attendance_time_band_meal WHERE set_id = $1 ORDER BY seq`, [set.id]
    );
    return ok(reply, {
      set: { id: Number(set.id), code: set.code, version: set.version, effectiveFrom: set.effective_from, name: set.name },
      bands: bands.map(b => ({
        id: Number(b.id), seq: b.seq, code: b.code, name: b.name, nameVi: b.name_vi,
        dayKind: b.day_kind, shiftType: b.shift_type,
        start: String(b.start_time).slice(0, 5), end: String(b.end_time).slice(0, 5),
        standardHours: Number(b.standard_hours),
        tableRate: Number(b.table_rate), legalMinRate: Number(b.legal_min_rate),
        adoptedRate: Number(b.adopted_rate),
        exemptA: Number(b.exempt_factor_a), exemptB: Number(b.exempt_factor_b),
        isOt: b.is_ot, countsTowardOtCap: b.counts_toward_ot_cap
      })),
      meals: meals.map(m => ({
        seq: m.seq, name: m.name,
        start: String(m.start_time).slice(0, 5), end: String(m.end_time).slice(0, 5),
        minutes: m.minutes
      })),
      shifts: SHIFT_DEFS,
      source: 'db'
    });
  }));

  app.put('/api/payroll/bands/:id', { preHandler: MANAGE }, wrap(async (req, reply) => {
    const id = Number(req.params.id);
    const b = req.body || {};
    const cur = await one(`SELECT * FROM attendance_time_band WHERE id = $1`, [id]);
    if (!cur) { reply.code(404); return ok(reply, null, '时段不存在'); }

    const tableRate = b.tableRate != null ? Number(b.tableRate) : Number(cur.table_rate);
    const legalMin = Number(cur.legal_min_rate);
    if (tableRate < legalMin) {
      reply.code(400);
      return ok(reply, null, `表内倍率 ${tableRate} 低于法定下限 ${legalMin}，不允许保存（采用倍率会取两者较大值，但表内值不应低于法定）`);
    }
    const adopted = Math.max(tableRate, legalMin);
    const row = await one(
      `UPDATE attendance_time_band
          SET table_rate = $2, adopted_rate = $3,
              exempt_factor_a = COALESCE($4, exempt_factor_a),
              exempt_factor_b = COALESCE($5, exempt_factor_b)
        WHERE id = $1 RETURNING *`,
      [id, tableRate, adopted,
        b.exemptA != null ? Number(b.exemptA) : null,
        b.exemptB != null ? Number(b.exemptB) : null]
    );
    clearBandCache();
    return ok(reply, { id: Number(row.id), tableRate: Number(row.table_rate), adoptedRate: Number(row.adopted_rate) },
      '已保存。倍率变更会影响 W，已生成的工资单需重算。');
  }));

  // ---------------- 花名册 ----------------
  app.get('/api/payroll/employees', { preHandler: MANAGE }, wrap(async (req, reply) => {
    return ok(reply, await payroll.listEmployees());
  }));

  app.put('/api/payroll/employees/:id/hire-date', { preHandler: MANAGE }, wrap(async (req, reply) => {
    const id = Number(req.params.id);
    const hire = req.body?.hireDate || null;
    if (hire && !/^\d{4}-\d{2}-\d{2}$/.test(hire)) {
      reply.code(400); return ok(reply, null, '入职日期格式应为 YYYY-MM-DD');
    }
    const row = await one(
      `UPDATE org_user SET hire_date = $2::date, updated_at = now() WHERE id = $1 RETURNING id, real_name, hire_date`,
      [id, hire]
    );
    if (!row) { reply.code(404); return ok(reply, null, '员工不存在'); }
    return ok(reply, { userId: Number(row.id), hireDate: row.hire_date }, '入职日期已更新（首月递延据此判定）');
  }));

  // ---------------- 日历（试算台要用工作日列表造打卡） ----------------
  app.get('/api/payroll/calendar', wrap(async (req, reply) => {
    const period = req.query?.period || new Date().toISOString().slice(0, 7);
    const cal = await one(`SELECT days FROM attendance_work_calendar WHERE year_month = $1`, [period]);
    if (!cal || !cal.days) {
      return ok(reply, { period, ok: false, workdays: 0, days: [], message: '该月日历缺失，无法计算应出勤工时' });
    }
    const days = Object.keys(cal.days)
      .sort()
      .map(d => ({ day: d, date: period + '-' + String(d).padStart(2, '0'), weight: Number(cal.days[d]) || 0 }));
    const workdays = days.filter(d => d.weight > 0);
    return ok(reply, {
      period, ok: true, workdays: workdays.length,
      quotaHours: workdays.length * 8,
      days: workdays
    });
  }));

  // ---------------- 试算 ----------------
  app.post('/api/payroll/trial', wrap(async (req, reply) => {
    const b = req.body || {};
    const period = b.period || new Date().toISOString().slice(0, 7);
    const canManage = req.user.isAdmin || (req.user.permissions || []).includes('salary:manage');
    // 不传 userId 时按「本人」试算：个税登记、递延台账都落在本人头上，
    // 不会因为试算别的员工而误读/误挂别人的数据。
    const userId = canManage ? Number(b.userId || req.user.id) : Number(req.user.id);

    // 系统/服务账号（admin、wms_bot 等）不是员工，v2/v3 都不许计薪。
    // v3 引擎内部还有一道同样的闸（防脚本直调），这里放在引擎选择之前，
    // 保证 v2 分支也挡得住。
    const acc = await one(
      `SELECT real_name, COALESCE(is_system, FALSE) AS is_system FROM org_user WHERE id = $1`,
      [userId]
    );
    if (acc?.is_system) {
      return reply.code(400).send({ code: 1, msg: `「${acc.real_name || userId}」是系统账号，不参与工资核算` });
    }

    // 允许两种入参：显式 punches（试算台）或从打卡表取（批量预演）
    let punches = Array.isArray(b.punches) ? b.punches : null;
    if (!punches) punches = await payroll.loadPunches(userId, period);

    const paramsOverride = {};
    if (b.exemptMode) paramsOverride.exempt_mode = b.exemptMode;

    // engine: v3 = SRS 十步计时制（默认）；v2 = 旧月薪制；monthly = v3 内的月薪制回退
    const engine = String(b.engine || req.query?.engine || 'v3').toLowerCase();
    if (engine !== 'v2') {
      const slip3 = await engineV3.computePayslipV3({
        userId, period, punches,
        paidLeaveDays: Number(b.paidLeaveDays) || 0,
        shiftCode: b.shiftCode || null,
        shiftType: b.shiftType || null,
        forceSettle: !!b.forceSettle,
        skipDeduction: !!b.skipDeduction,
        hireDate: b.hireDate !== undefined ? b.hireDate : undefined,
        paramsOverride: Object.keys(paramsOverride).length ? paramsOverride : null,
        engine: engine === 'monthly' ? 'monthly' : 'v3',
        manualBases: b.manualBases || null
      });
      return ok(reply, slip3);
    }

    const slip = await computePayslip({
      userId, period, punches,
      paidLeaveDays: Number(b.paidLeaveDays) || 0,
      manualG: b.manualG != null ? Number(b.manualG) : null,
      shiftCode: b.shiftCode || null,
      shiftType: b.shiftType || null,
      forceSettle: !!b.forceSettle,
      skipDeduction: !!b.skipDeduction,
      // hireDate 传了就以它判首月（模拟新员工），不传则读花名册
      hireDate: b.hireDate !== undefined ? b.hireDate : undefined,
      paramsOverride: Object.keys(paramsOverride).length ? paramsOverride : null
    });
    return ok(reply, slip);
  }));

  // ---------------- 计薪方案（SRS 4.1 多用途计薪基数） ----------------
  app.get('/api/payroll/schemes', { preHandler: MANAGE }, wrap(async (req, reply) => {
    return ok(reply, await engineV3.listSchemes({ status: req.query?.status || null }));
  }));

  app.get('/api/payroll/schemes/:id', { preHandler: MANAGE }, wrap(async (req, reply) => {
    return ok(reply, await engineV3.getScheme(Number(req.params.id)));
  }));

  app.post('/api/payroll/schemes', { preHandler: MANAGE }, wrap(async (req, reply) => {
    const s = await engineV3.saveScheme(req.body || {}, req.user.id);
    return ok(reply, s, '计薪方案已保存');
  }));

  app.put('/api/payroll/schemes/:id', { preHandler: MANAGE }, wrap(async (req, reply) => {
    const s = await engineV3.saveScheme({ ...(req.body || {}), id: Number(req.params.id) }, req.user.id);
    return ok(reply, s, '计薪方案已保存');
  }));

  // ---------------- 员工计薪统计属性（参保状态 / 工会会员 / 试用期） ----------------
  app.get('/api/payroll/stat-profiles', { preHandler: MANAGE }, wrap(async (req, reply) => {
    return ok(reply, await engineV3.listStatProfiles({
      period: req.query?.period || null,
      keyword: req.query?.keyword || null
    }));
  }));

  app.put('/api/payroll/stat-profiles', { preHandler: MANAGE }, wrap(async (req, reply) => {
    const r = await engineV3.saveStatProfile(req.body || {}, req.user.id);
    return ok(reply, r, '已保存');
  }));

  // ---------------- 工龄津贴分档（SRS 4.5 thâm niên） ----------------
  app.get('/api/payroll/seniority-tiers', { preHandler: MANAGE }, wrap(async (req, reply) => {
    return ok(reply, await engineV3.listSeniorityTiers());
  }));

  app.put('/api/payroll/seniority-tiers', { preHandler: MANAGE }, wrap(async (req, reply) => {
    const b = req.body || {};
    const list = await engineV3.saveSeniorityTiers({
      effectiveFrom: b.effectiveFrom || null,
      tiers: Array.isArray(b.tiers) ? b.tiers : []
    });
    return ok(reply, list, '工龄津贴分档已保存');
  }));

  // ---------------- SRS 对标自检（口径一致性，不涉及真人数据） ----------------
  app.get('/api/payroll/srs-check', { preHandler: MANAGE }, wrap(async (req, reply) => {
    return ok(reply, await engineV3.srsSelfCheck());
  }));

  // ---------------- 休假类型字典（越南法规口径） ----------------
  app.get('/api/payroll/leave-types', wrap(async (req, reply) => {
    return ok(reply, await leaveType.listLeaveTypes({
      includeInactive: String(req.query?.all || '') === '1'
    }));
  }));

  app.put('/api/payroll/leave-types/:code', { preHandler: MANAGE }, wrap(async (req, reply) => {
    const b = req.body || {};
    const code = String(req.params.code);
    const exists = await one(`SELECT code FROM attendance_leave_type WHERE code = $1`, [code]);
    if (!exists) {
      return reply.code(404).send({ code: 404, msg: '休假类型不存在：' + code });
    }
    const fields = [];
    const vals = [];
    const put = (col, v) => { if (v !== undefined) { vals.push(v); fields.push(`${col} = $${vals.length}`); } };
    put('name', b.name);
    put('name_vi', b.nameVi);
    put('name_en', b.nameEn);
    put('pay_wage', b.payWage === undefined ? undefined : !!b.payWage);
    put('counts_as_attendance', b.countsAsAttendance === undefined ? undefined : !!b.countsAsAttendance);
    put('statutory_days', b.statutoryDays === undefined ? undefined
      : (b.statutoryDays == null || b.statutoryDays === '' ? null : Number(b.statutoryDays)));
    // 额度控制（迁移 107）：年假按月累积、超额是否允许
    if (b.accrualMode !== undefined && !['none', 'per_month'].includes(String(b.accrualMode))) {
      return reply.code(400).send({ code: 400, msg: '累积方式只能是 none / per_month' });
    }
    put('accrual_mode', b.accrualMode === undefined ? undefined : String(b.accrualMode));
    put('accrual_per_month', b.accrualPerMonth === undefined ? undefined
      : Math.max(0, Number(b.accrualPerMonth) || 0));
    put('annual_cap', b.annualCap === undefined ? undefined
      : (b.annualCap == null || b.annualCap === '' ? null : Number(b.annualCap)));
    put('allow_negative', b.allowNegative === undefined ? undefined : !!b.allowNegative);
    put('carry_over', b.carryOver === undefined ? undefined : !!b.carryOver);
    put('day_rule', b.dayRule);
    put('legal_basis', b.legalBasis);
    put('active', b.active === undefined ? undefined : !!b.active);
    put('remark', b.remark);
    if (!fields.length) return reply.code(400).send({ code: 400, msg: '没有可更新的字段' });
    vals.push(code);
    await query(
      `UPDATE attendance_leave_type SET ${fields.join(', ')}, updated_at = now() WHERE code = $${vals.length}`,
      vals
    );
    leaveType.invalidateLeaveTypeCache();
    return ok(reply, { code }, '已保存');
  }));

  app.get('/api/payroll/leave-summary', { preHandler: MANAGE }, wrap(async (req, reply) => {
    const period = req.query?.period || new Date().toISOString().slice(0, 7);
    const userId = Number(req.query?.userId);
    if (!userId) return reply.code(400).send({ code: 400, msg: '缺少 userId' });
    const cal = await one(`SELECT days FROM attendance_work_calendar WHERE year_month = $1`, [period]);
    return ok(reply, await leaveType.loadMonthLeave({
      userId, period,
      calendarDays: cal && cal.days ? cal.days : null
    }));
  }));

  /**
   * 休假额度余额（年假按月累积口径）
   * 本人可查自己；salary:manage / 管理员可查他人（请假前先看还剩几天）。
   * GET /api/payroll/leave-balance?userId=&year=&asOf=
   */
  app.get('/api/payroll/leave-balance', wrap(async (req, reply) => {
    const selfId = Number(req.user.id);
    const askId = Number(req.query?.userId) || selfId;
    const canOther = !!req.user.isAdmin ||
      (Array.isArray(req.user.permissions) && req.user.permissions.includes('salary:manage'));
    if (askId !== selfId && !canOther) {
      return reply.code(403).send({ code: 403, msg: '只能查询本人休假额度' });
    }
    const asOf = req.query?.asOf ? String(req.query.asOf).slice(0, 10) : null;
    if (asOf && !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
      return reply.code(400).send({ code: 400, msg: 'asOf 需为 YYYY-MM-DD' });
    }
    const year = Number(req.query?.year) || Number((asOf || new Date().toISOString()).slice(0, 4));
    const hireDate = await leaveBalance.getHireDate(askId);
    return ok(reply, {
      userId: askId,
      hireDate,
      year,
      asOf: asOf || new Date().toISOString().slice(0, 10),
      balances: await leaveBalance.listLeaveBalances({ userId: askId, year, asOf })
    });
  }));

  // ============================================================
  // 年假台账（全员）+ 手工记账
  // ------------------------------------------------------------
  // 期中切系统的场景：员工在旧系统/纸面已休的年假、跨年结转额度，都要能录进来，
  // 与电子流（flow_instance code='leave'）合计才是真实占用。
  // 台账口径：系统按月累积 + 结转 + 调账 − 切换前已休 − 电子流占用 = 可休。
  // ============================================================
  app.get('/api/payroll/leave-quota', { preHandler: MANAGE }, wrap(async (req, reply) => {
    return ok(reply, await leaveBalance.listQuotaLedger({
      year: req.query?.year || null,
      code: req.query?.code || 'annual',
      keyword: req.query?.keyword || null,
      asOf: req.query?.asOf || null
    }));
  }));

  /** 批量保存台账里的「结转额度 / 切换前已休」两列（只提交改过的行） */
  app.post('/api/payroll/leave-quota/batch', { preHandler: MANAGE }, wrap(async (req, reply) => {
    const b = req.body || {};
    const r = await leaveBalance.saveQuotaBatch({
      year: b.year,
      code: b.code || 'annual',
      rows: b.rows,
      operatorId: req.user.id
    });
    return ok(reply, r, `已保存 ${r.employees} 人的记账（写入 ${r.saved} 项，清空 ${r.cleared} 项）`);
  }));

  /** 单条记账：txnType = carry_in（结转）/ opening_used（切换前已休）/ adjust（调账，可负） */
  app.post('/api/payroll/leave-quota/txn', { preHandler: MANAGE }, wrap(async (req, reply) => {
    const b = req.body || {};
    const r = await leaveBalance.upsertQuotaTxn({
      userId: b.userId,
      code: b.code || 'annual',
      year: b.year,
      txnType: b.txnType,
      days: b.days,
      remark: b.remark || null,
      effectiveDate: b.effectiveDate || null,
      operatorId: req.user.id
    });
    return ok(reply, r, r.cleared ? '已清空该格' : '已记账');
  }));

  app.get('/api/payroll/leave-quota/txn', { preHandler: MANAGE }, wrap(async (req, reply) => {
    const userId = Number(req.query?.userId);
    if (!userId) return reply.code(400).send({ code: 400, msg: '缺少 userId' });
    return ok(reply, await leaveBalance.listQuotaTxn({
      userId, code: req.query?.code || 'annual', year: req.query?.year || null
    }));
  }));

  app.delete('/api/payroll/leave-quota/txn/:id', { preHandler: MANAGE }, wrap(async (req, reply) => {
    return ok(reply, await leaveBalance.deleteQuotaTxn(req.params.id), '已删除');
  }));

  // ---------------- 补发 / 扣发（salary_adjust 电子流） ----------------
  /*
   * 台账查询。salary:manage 可看全员；其他人只能看自己（自助工资单要显示自己的补发扣发）。
   */
  app.get('/api/payroll/adjustments', wrap(async (req, reply) => {
    const canManage = req.user.isAdmin || (req.user.permissions || []).includes('salary:manage');
    const uid = canManage ? (req.query?.userId || null) : req.user.id;
    return ok(reply, await salaryAdjust.listAdjustments({
      userId: uid,
      period: req.query?.period || null,
      status: req.query?.status || null,
      limit: Number(req.query?.limit) || 300
    }));
  }));

  /* 作废（已并入工资的不能作废，只能开反向单） */
  app.post('/api/payroll/adjustments/:id/void', { preHandler: MANAGE }, wrap(async (req, reply) => {
    const r = await salaryAdjust.voidAdjustment(
      Number(req.params.id), req.body?.reason, req.user.id
    );
    return ok(reply, r, '已作废，本月重算时不再并入');
  }));

  // ---------------- 批次 ----------------
  app.post('/api/payroll/run', { preHandler: MANAGE }, wrap(async (req, reply) => {
    const b = req.body || {};
    const r = await payroll.generateRun({
      period: b.period,
      userIds: Array.isArray(b.userIds) && b.userIds.length ? b.userIds : null,
      dryRun: !!b.dryRun,
      createdBy: req.user.id || null,
      includeNoPunch: !!b.includeNoPunch,
      engine: String(b.engine || 'v3').toLowerCase()
    });
    const msg = r.dryRun
      ? `试算完成：${r.employeeCount} 人，跳过 ${r.skippedCount} 人（未写库）`
      : `批次 #${r.runNo} 已生成：${r.employeeCount} 人，跳过 ${r.skippedCount} 人，实发合计 ${Math.round(r.totals.net).toLocaleString('en-US')}`;
    return ok(reply, r, msg);
  }));

  app.get('/api/payroll/runs', { preHandler: MANAGE }, wrap(async (req, reply) => {
    return ok(reply, await payroll.listRuns(req.query?.period || null, Number(req.query?.limit) || 24));
  }));

  app.post('/api/payroll/runs/:id/confirm', { preHandler: MANAGE }, wrap(async (req, reply) => {
    const r = await payroll.confirmRun(Number(req.params.id), req.user.id);
    return ok(reply, r, r.message);
  }));

  app.post('/api/payroll/runs/:id/void', { preHandler: MANAGE }, wrap(async (req, reply) => {
    const r = await payroll.voidRun(Number(req.params.id), req.user.id, req.body?.reason || '');
    return ok(reply, r, r.message);
  }));

  // ---------------- 工资单 ----------------
  app.get('/api/payroll/payslips', wrap(async (req, reply) => {
    const canManage = req.user.isAdmin || (req.user.permissions || []).includes('salary:manage');
    const q = {
      period: req.query?.period || null,
      userId: canManage ? (req.query?.userId || null) : req.user.id,
      status: req.query?.status || null,
      page: Number(req.query?.page) || 1,
      pageSize: Number(req.query?.pageSize) || 50
    };
    return ok(reply, await payroll.listPayslips(q));
  }));

  // ---------------- 员工自助 ----------------
  // 本人可查月份清单（在职期间所有月份；作废单不列）
  // 注意：必须注册在 /self/:period 之前，虽然 find-my-way 静态优先，
  //       但显式前置更稳，避免换个路由器实现就被 :period 吃掉。
  app.get('/api/payroll/self/periods', wrap(async (req, reply) => {
    return ok(reply, await payroll.listSelfPayslipPeriods(req.user.id, {
      includeVoid: String(req.query?.includeVoid || '') === '1'
    }));
  }));

  // 本人指定月份（无需 salary:manage）
  app.get('/api/payroll/self/:period', wrap(async (req, reply) => {
    const r = await payroll.getPayslip(req.user.id, req.params.period);
    if (!r) { reply.code(404); return ok(reply, null, '该月没有工资单'); }
    if (r.status === 'void') { reply.code(404); return ok(reply, null, '该月工资单已作废'); }
    // 自助页不允许拿别人的：路由内写死 req.user.id，userId 参数一律忽略
    return ok(reply, r);
  }));

  app.get('/api/payroll/payslips/:userId/:period', wrap(async (req, reply) => {
    const canManage = req.user.isAdmin || (req.user.permissions || []).includes('salary:manage');
    const uid = Number(req.params.userId);
    if (!canManage && uid !== Number(req.user.id)) {
      reply.code(403); return ok(reply, null, '只能查看本人工资单');
    }
    const r = await payroll.getPayslip(uid, req.params.period);
    if (!r) { reply.code(404); return ok(reply, null, '没有该月工资单'); }
    return ok(reply, r);
  }));

  // ---------------- 递延台账 ----------------
  app.get('/api/payroll/deferrals', { preHandler: MANAGE }, wrap(async (req, reply) => {
    const items = await payroll.listDeferrals({
      status: req.query?.status || null,
      userId: req.query?.userId || null,
      period: req.query?.period || null,
      limit: Number(req.query?.limit) || 200
    });
    return ok(reply, { summary: await payroll.deferralSummary(), items });
  }));

  app.post('/api/payroll/deferrals/:id/waive', { preHandler: MANAGE }, wrap(async (req, reply) => {
    const r = await payroll.waiveDeferral(Number(req.params.id), req.body?.reason || '', req.user.id);
    return ok(reply, r, '已豁免（留痕在备注里），本月不再扣这笔');
  }));

  // ============================================================
  // 薪资结构 v2（薪酬项目字典 + 版本化架构 + 职类/员工绑定）
  // 与旧 /api/salary/structures 的区别：
  //   · 不再接收 otRateWeekday/Weekend/Holiday（倍率只有 14 段一个真值）
  //   · 不再接收 shiftAllowanceEnabled（夜班津贴由倍率差额自动产生）
  //   · 明细按 salary_item 字典挂 item_id，并把 5 个属性位快照进 line.config
  // ============================================================

  app.get('/api/payroll/items', { preHandler: MANAGE }, wrap(async (req, reply) => {
    return ok(reply, await structure.listItems());
  }));

  app.post('/api/payroll/items', { preHandler: MANAGE }, wrap(async (req, reply) => {
    const r = await structure.saveItem(req.body || {}, req.user.id);
    return ok(reply, r, '薪酬项目已新增');
  }));

  app.put('/api/payroll/items/:id', { preHandler: MANAGE }, wrap(async (req, reply) => {
    const r = await structure.saveItem({ ...(req.body || {}), id: Number(req.params.id) }, req.user.id);
    return ok(reply, r, '薪酬项目已更新（下一次重算生效）');
  }));

  app.get('/api/payroll/structures', { preHandler: MANAGE }, wrap(async (req, reply) => {
    const rows = await structure.listStructures({
      status: req.query?.status || null,
      bindLevel: req.query?.bindLevel || null,
      keyword: req.query?.keyword || null
    });
    return ok(reply, rows);
  }));

  app.get('/api/payroll/structures/:id', { preHandler: MANAGE }, wrap(async (req, reply) => {
    const r = await structure.getStructure(Number(req.params.id));
    if (!r) { reply.code(404); return ok(reply, null, '结构不存在'); }
    return ok(reply, r);
  }));

  app.post('/api/payroll/structures', { preHandler: MANAGE }, wrap(async (req, reply) => {
    const r = await structure.saveStructure(req.body || {}, req.user.id);
    const msg = r.warnings?.length ? `已存为草稿 v${r.version}（${r.warnings.length} 条提醒）` : `已存为草稿 v${r.version}`;
    return ok(reply, r, msg);
  }));

  app.put('/api/payroll/structures/:id', { preHandler: MANAGE }, wrap(async (req, reply) => {
    const r = await structure.saveStructure({ ...(req.body || {}), id: Number(req.params.id) }, req.user.id);
    return ok(reply, r, '草稿已保存');
  }));

  app.delete('/api/payroll/structures/:id', { preHandler: MANAGE }, wrap(async (req, reply) => {
    const r = await structure.deleteStructure(Number(req.params.id));
    return ok(reply, r, '草稿已删除');
  }));

  app.post('/api/payroll/structures/:id/approve', { preHandler: MANAGE }, wrap(async (req, reply) => {
    const r = await structure.approveStructure(Number(req.params.id), req.user.id);
    return ok(reply, r, '已审批通过，从生效日起按此结构计薪');
  }));

  app.post('/api/payroll/structures/:id/archive', { preHandler: MANAGE }, wrap(async (req, reply) => {
    const r = await structure.archiveStructure(Number(req.params.id));
    return ok(reply, r, '已作废');
  }));

  // 撤销作废：作废点错时的回退通道（archived → approved，失效日按下一版重算）
  app.post('/api/payroll/structures/:id/restore', { preHandler: MANAGE }, wrap(async (req, reply) => {
    const r = await structure.restoreStructure(Number(req.params.id), req.user.id);
    return ok(reply, r, '已撤销作废，该版本从生效日起重新参与计薪');
  }));

  app.get('/api/payroll/classes', { preHandler: MANAGE }, wrap(async (req, reply) => {
    return ok(reply, await structure.listClasses());
  }));

  // 岗位字典改动后手工刷新职类镜像（正常不需要：列表接口与生成批次前都会自动同步）
  app.post('/api/payroll/classes/sync', { preHandler: MANAGE }, wrap(async (req, reply) => {
    const r = await structure.syncClassesFromPositions();
    return ok(reply, r, `已同步 ${r.classes} 个岗位，刷新 ${r.assigned} 人的职类`);
  }));

  app.post('/api/payroll/classes/assign', { preHandler: MANAGE }, wrap(async (req, reply) => {
    const r = await structure.assignClass(req.body || {});
    return ok(reply, r, `已把 ${r.updated} 人的岗位设为「${r.className}」`);
  }));

  app.get('/api/payroll/bind-employees', { preHandler: MANAGE }, wrap(async (req, reply) => {
    return ok(reply, await structure.listEmployeesForBind({ keyword: req.query?.keyword || null }));
  }));
}
