/**
 * 计时制计薪纯函数库（SRS V1.0 §4.4 十步公式链）
 * ============================================================
 * 零依赖、零 DB、零 IO —— 服务端 salary-engine-v3 与前端试算台共用同一份实现。
 *
 * 口径（《员工薪酬与工资核算系统需求规格说明书》2026-10-27）：
 *
 *   Step 1  时薪     = 该用途计薪基数 ÷ 计薪分母工时（按用途分别算）
 *   Step 2  折算工时 = Σ（各时段计薪小时 × 该时段采用倍率）
 *   Step 3  工时工资 = Σ(用途时薪 × 该用途折算工时)
 *   Step 4  带薪假工资 = 时薪 × 8 × 带薪假天数
 *   Step 5  应发     = 工时工资 + 带薪假工资 + 补贴合计 − 无薪扣减
 *   Step 6  免税收入 = Σ（加班/夜班小时 × 对应用途时薪 × 免税系数）
 *   Step 7  应税工资 = 应发 − 免税收入
 *   Step 8~9 个税   见 lib/payroll-deduction.js
 *   Step 10 实发     = 应发 − 社保个人 − 个税 − 工会费 − 其他扣款
 *
 * 与 v2（月薪制 G + H×(W−B)）的关系：
 *   v2 是「月薪保底 + 差额」写法；SRS 还原出来的现行做法是**纯计时制**
 *   （Excel 就是 时薪 × 折算工时）。全员满勤时两者等价，短月/缺勤时不等价。
 *   v3 默认走计时制，pay_mode='monthly' 可回退，便于双轨对账。
 *
 * 舍入（SRS 4.5，须原样保留以实现对账）：
 *   各工资项金额 ROUND(x, -2) → 百位；实发 ROUND(x, -3) → 千位；
 *   小时保留 1 位；时薪保留 2 位参与后续乘法。
 *   未舍入值一并返回，避免累计舍入误差无法解释。
 */

const EPS = 1e-9;

/**
 * 四舍五入到指定位数；digits 可为负数（-2 = 到百位，-3 = 到千位）。
 * 这是 Excel ROUND(x, -2) 的等价实现，用于对齐现行工资表。
 */
export function roundStep(n, digits = 0) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  const d = Math.trunc(Number(digits) || 0);
  const f = Math.pow(10, d);
  // 先按 1e-6 收敛浮点噪声，再按目标位数取整，避免 1234.4999999 → 1200
  return Math.round((v + Math.sign(v) * EPS) * f) / f;
}

/** 时薪 = 基数 ÷ 分母（默认保留 2 位，SRS 4.5） */
export function hourRate(base, denominator = 208, digits = 2) {
  const b = Number(base) || 0;
  const d = Number(denominator) || 0;
  if (!(d > 0)) return 0;
  const raw = b / d;
  return { raw, rate: roundStep(raw, digits) };
}

/**
 * 时段归属哪个基数用途。
 *   法定假日（⑨⑩）→ holiday
 *   加班段（④⑤⑥⑦⑧ 及排班延长段）→ overtime
 *   其余（①②③ 正班）→ normal
 */
export function purposeOfSegment(seg) {
  if (!seg) return 'normal';
  if (seg.dayKind === 'holiday') return 'holiday';
  if (seg.isOt) return 'overtime';
  return 'normal';
}

/** 新开一个空累加器 */
function emptyAcc() {
  return {
    normal:   { purpose: 'normal',   payableHours: 0, convertedHours: 0, exemptHours: 0, days: 0 },
    overtime: { purpose: 'overtime', payableHours: 0, convertedHours: 0, exemptHours: 0, days: 0 },
    holiday:  { purpose: 'holiday',  payableHours: 0, convertedHours: 0, exemptHours: 0, days: 0 }
  };
}

/**
 * 把 computeMonthSheet() 的 days[] 拆成「按用途 × 试用期/正式期」的工时台账。
 *
 * @param {Array} days  attend-band 返回的逐日切片（含 segments）
 * @param {object} [opt]
 *   @param {string|null} [opt.probationEnd] 'YYYY-MM-DD'；<= 该日算试用期
 * @param {string} [opt.stdHoursPerDay] 折算用不到，仅注释保留
 * @returns {{regular:object, probation:object, totals:object}}
 */
export function accumulateByPurpose(days = [], { probationEnd = null } = {}) {
  const regular = emptyAcc();
  const probation = emptyAcc();
  const pe = probationEnd ? String(probationEnd).slice(0, 10) : null;

  let workdayAttendDays = 0;
  let totalPayable = 0;
  let totalConverted = 0;
  const byDayKind = { workday: 0, sunday: 0, holiday: 0 };

  for (const d of days) {
    if (!d || d.status !== 'computed') continue;
    const isProbation = !!(pe && String(d.workDate).slice(0, 10) <= pe);
    const bucket = isProbation ? probation : regular;
    if (d.dayKind === 'workday') workdayAttendDays += 1;
    if (byDayKind[d.dayKind] != null) byDayKind[d.dayKind] += 1;

    for (const s of d.segments || []) {
      const p = purposeOfSegment(s);
      const a = bucket[p];
      a.payableHours += Number(s.payableHours) || 0;
      a.convertedHours += Number(s.convertedHours) || 0;
      a.exemptHours += Number(s.exemptHours) || 0;
      totalPayable += Number(s.payableHours) || 0;
      totalConverted += Number(s.convertedHours) || 0;
    }
    // 有出勤但没有任何可计薪时段（例如只落在空档）不算出勤用途
    const touched = (d.segments || []).some(s => (Number(s.payableHours) || 0) > 0);
    if (touched) {
      const target = bucket[purposeOfFirstPaid(d.segments)] || bucket.normal;
      target.days += 1;
    }
  }

  const norm = acc => {
    for (const k of Object.keys(acc)) {
      acc[k].payableHours = roundStep(acc[k].payableHours, 1);
      acc[k].convertedHours = roundStep(acc[k].convertedHours, 3);
      acc[k].exemptHours = roundStep(acc[k].exemptHours, 3);
    }
    return acc;
  };

  return {
    regular: norm(regular),
    probation: norm(probation),
    totals: {
      payableHours: roundStep(totalPayable, 1),
      convertedHours: roundStep(totalConverted, 3),
      workdayAttendDays,
      attendDays: byDayKind.workday + byDayKind.sunday + byDayKind.holiday,
      byDayKind,
      probationHours: roundStep(
        ['normal', 'overtime', 'holiday'].reduce((a, k) => a + probation[k].payableHours, 0), 1
      )
    }
  };
}

function purposeOfFirstPaid(segments = []) {
  const s = segments.find(x => (Number(x.payableHours) || 0) > 0);
  return s ? purposeOfSegment(s) : 'normal';
}

/**
 * 组装时薪表：{ normal, overtime, holiday, severance }
 * @param {object} bases    { normal: 基数, overtime: 基数, holiday: 基数, severance: 基数 }
 * @param {number} denom    计薪分母工时
 * @param {number} [digits=2]
 */
export function buildHourRates(bases = {}, denom = 208, digits = 2) {
  const out = {};
  for (const k of ['normal', 'overtime', 'holiday', 'severance']) {
    const base = Number(bases[k]) || 0;
    const r = hourRate(base, denom, digits);
    out[k] = { purpose: k, base: roundStep(base, 2), denominator: Number(denom) || 208, rateRaw: r.raw, rate: r.rate };
  }
  // 用途未配置时回落：加班/假日沿用 normal，避免算成 0
  if (!out.overtime.base) { out.overtime = { ...out.normal, purpose: 'overtime', fallback: true }; }
  if (!out.holiday.base)  { out.holiday  = { ...out.normal, purpose: 'holiday',  fallback: true }; }
  return out;
}

/**
 * Step 3~5：工时工资 + 带薪假 + 补贴 − 无薪扣减。
 *
 * @param {object} p
 *   @param {object} p.rates        buildHourRates 的结果
 *   @param {object} p.acc          accumulateByPurpose 的结果
 *   @param {number} [p.paidLeaveHours=0]
 *   @param {Array}  [p.allowances=[]]   [{ code, name, amount }]（未舍入）
 *   @param {Array}  [p.unpaidDeductions=[]] [{ code, name, amount }]
 *   @param {number} [p.probationRate=0.85]
 *   @param {number} [p.itemDigits=-2]
 */
export function computeTimeRatePay({
  rates, acc, paidLeaveHours = 0, allowances = [], unpaidDeductions = [],
  probationRate = 0.85, itemDigits = -2
}) {
  const pr = Number(probationRate);
  const rate = Number.isFinite(pr) && pr > 0 ? pr : 0.85;
  const reg = acc.regular;
  const pro = acc.probation;

  // --- Step 3 工时工资 ---
  const wageRows = [];
  let wageRaw = 0;
  for (const k of ['normal', 'overtime', 'holiday']) {
    const r = rates[k] || { rate: 0, base: 0 };
    const hr = Number(r.rate) || 0;
    const hReg = Number(reg[k]?.convertedHours) || 0;
    const hPro = Number(pro[k]?.convertedHours) || 0;
    const amtReg = hr * hReg;
    const amtPro = hr * hPro * rate;
    wageRaw += amtReg + amtPro;
    if (hReg || hPro) {
      wageRows.push({
        purpose: k,
        base: Number(r.base) || 0,
        rate: hr,
        hoursRegular: roundStep(hReg, 3),
        hoursProbation: roundStep(hPro, 3),
        amountRegular: roundStep(amtReg, itemDigits),
        amountProbation: roundStep(amtPro, itemDigits),
        amount: roundStep(amtReg + amtPro, itemDigits),
        amountRaw: roundStep(amtReg + amtPro, 4)
      });
    }
  }
  // 若某用途无工时，也补一行 0，界面能看出「这套基数算出来是 0」
  for (const k of ['normal', 'overtime', 'holiday']) {
    if (!wageRows.some(x => x.purpose === k)) {
      wageRows.push({
        purpose: k, base: Number(rates[k]?.base) || 0, rate: Number(rates[k]?.rate) || 0,
        hoursRegular: 0, hoursProbation: 0, amountRegular: 0, amountProbation: 0, amount: 0, amountRaw: 0
      });
    }
  }

  // --- Step 4 带薪假工资 ---
  const leaveRate = Number(rates.normal?.rate) || 0;
  const paidLeaveRaw = leaveRate * (Number(paidLeaveHours) || 0);

  // --- Step 5 应发 ---
  const allowanceRows = (allowances || []).map(a => ({
    code: a.code,
    name: a.name,
    amountRaw: roundStep(Number(a.amount) || 0, 4),
    amount: roundStep(Number(a.amount) || 0, itemDigits),
    mode: a.mode || null,
    qty: a.qty != null ? a.qty : null
  }));
  const unpaidRows = (unpaidDeductions || []).map(a => ({
    code: a.code,
    name: a.name,
    amountRaw: roundStep(Number(a.amount) || 0, 4),
    amount: roundStep(Number(a.amount) || 0, itemDigits),
    mode: a.mode || null,
    qty: a.qty != null ? a.qty : null
  }));

  const wageAmount = roundStep(wageRaw, itemDigits);
  const leaveAmount = roundStep(paidLeaveRaw, itemDigits);
  const allowanceTotal = roundStep(allowanceRows.reduce((a, x) => a + x.amount, 0), itemDigits);
  const unpaidTotal = roundStep(unpaidRows.reduce((a, x) => a + x.amount, 0), itemDigits);
  const gross = roundStep(wageAmount + leaveAmount + allowanceTotal - unpaidTotal, itemDigits);

  return {
    wageRows,
    wageAmount,
    wageRaw: roundStep(wageRaw, 4),
    paidLeaveRate: leaveRate,
    paidLeaveHours: roundStep(Number(paidLeaveHours) || 0, 2),
    paidLeaveAmount: leaveAmount,
    paidLeaveRaw: roundStep(paidLeaveRaw, 4),
    allowanceRows,
    allowanceTotal,
    unpaidRows,
    unpaidTotal,
    probationRate: rate,
    gross,
    grossRaw: roundStep(wageRaw + paidLeaveRaw + allowanceTotal + 0 - unpaidTotal, 4),
    itemDigits,
    // 供工资单顺序展示（对齐 SRS 4.4 的 5 步）
    explain: [
      '工时工资 = Σ(用途时薪 × 该用途折算工时) = ' + fmt(wageAmount),
      '带薪假工资 = 时薪 × 8 × 天数 = ' + fmt(leaveAmount) + '（' + roundStep(Number(paidLeaveHours) || 0, 1) + ' 小时）',
      '补贴合计 = ' + fmt(allowanceTotal),
      '无薪扣减 = ' + fmt(unpaidTotal),
      '应发 = ' + fmt(gross)
    ]
  };
}

/**
 * Step 6 免税收入 = Σ(用途时薪 × 该用途免税工时 × 试用期系数)
 * 口径 B（加班小时工资全额 + 夜班津贴全额）由时段表的 exempt_factor 决定，
 * 这里只负责乘时薪与系数，不判断口径。
 */
export function computeExemptByPurpose({ rates, acc, probationRate = 0.85, cap = null }) {
  const pr = Number(probationRate) > 0 ? Number(probationRate) : 0.85;
  const rows = [];
  let raw = 0;
  for (const k of ['overtime', 'holiday', 'normal']) {
    const hr = Number(rates[k]?.rate) || 0;
    const hReg = Number(acc.regular[k]?.exemptHours) || 0;
    const hPro = Number(acc.probation[k]?.exemptHours) || 0;
    if (!hReg && !hPro) continue;
    const amt = hr * hReg + hr * hPro * pr;
    raw += amt;
    rows.push({
      purpose: k, rate: hr,
      hoursRegular: roundStep(hReg, 3), hoursProbation: roundStep(hPro, 3),
      amount: roundStep(amt, 2)
    });
  }
  const capped = cap != null && raw > Number(cap) + 0.01;
  return {
    rows,
    raw: roundStep(raw, 2),
    exemptIncome: roundStep(capped ? Number(cap) : raw, 2),
    capped
  };
}

/**
 * 加班小时（SRS FR-ATT-08）：加班小时 = 当月计薪工时合计 − 8 × 平日出勤天数。
 * 明确禁止「把 ④~⑩ 的工时累加」——那会漏掉白班延时里的 ② 2 小时/天。
 */
export function computeOtHours({ payableHours, workdayAttendDays, stdHoursPerDay = 8 }) {
  const total = Number(payableHours) || 0;
  const wd = Number(workdayAttendDays) || 0;
  const std = Number(stdHoursPerDay) || 8;
  const ot = total - std * wd;
  return {
    otHours: roundStep(Math.max(0, ot), 1),
    /** 理论上限：正班 8h/天，超出部分才算加班；为负说明缺勤，不是负加班 */
    raw: roundStep(ot, 3),
    totalPayableHours: roundStep(total, 1),
    workdayAttendDays: wd,
    stdHoursPerDay: std
  };
}

/**
 * 扣款限额（SRS FR-ALL-06 / V-13）：单月扣款总额 ≤ 应发 × 比例，且扣后不低于最低工资。
 * @returns {{cap:number, over:boolean, belowMin:boolean, net:number, messages:Array}}
 */
export function checkDeductionCap({ gross, totalDeduction, ratio = 0.3, minWage = 0 }) {
  const g = Number(gross) || 0;
  const d = Number(totalDeduction) || 0;
  const r = Number(ratio) > 0 ? Number(ratio) : 0.3;
  const cap = roundStep(g * r, 2);
  const net = roundStep(g - d, 2);
  const msgs = [];
  if (d > cap + 0.01) {
    msgs.push('本月扣款合计 ' + fmt(d) + ' 超过应发的 ' + Math.round(r * 100) + '%（上限 ' + fmt(cap) + '），需授权放行（SRS V-13）');
  }
  const mw = Number(minWage) || 0;
  if (mw > 0 && net < mw) {
    msgs.push('扣款后实发 ' + fmt(net) + ' 低于最低工资 ' + fmt(mw) + '，禁止发放（SRS V-12）');
  }
  return { cap, over: d > cap + 0.01, belowMin: mw > 0 && net < mw, net, messages: msgs };
}

/** 千分位格式（仅用于 explain 文案，不参与计算） */
function fmt(n) {
  const v = Math.round(Number(n) || 0);
  return v.toLocaleString('en-US');
}

export const VERSION = '3.0.0';
