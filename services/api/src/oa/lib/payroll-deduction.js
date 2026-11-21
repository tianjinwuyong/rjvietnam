/**
 * 扣款链纯函数库（社保分险种 / 工会费 / 个税 / 首月递延）
 * ============================================================
 * 与 payroll-core.js 一样：**零外部依赖、零 DB、零 IO**，
 * 服务端 salary-engine-v2 与前端试算台共用同一份实现，禁止复制第二份。
 *
 * 口径依据：方案 v1.6 §5.4（免税）与 §5.9（递延）
 *
 *   应发 gross      = G + H × (W − B) + 不计时津贴
 *   免税收入        = H × Σ(计薪工时 × 免税系数)  ← payroll-core.computeExemptIncome
 *   社保基数        = G（基本工资+岗位津贴，**不含加班费**），分险种各自封顶
 *   个人社保        = Σ min(基数, 该险种封顶) × 该险种个人比例
 *   工会费          = 每人每月定额（27,000，仅工会会员；2026-10-28 改为绝对值，不再按 1%）
 *   应税所得        = gross − 免税收入 − 个人社保 − 工会费 − 本人减除 − 抚养人×6.2M
 *   个税            = 应税所得 × 档位税率 − 速算扣除数
 *   实发 net        = gross − 个人社保 − 工会费 − 本月实扣个税 − 结清的上期递延
 *
 * 首月递延（§5.9）：入职当月三项**照常计算但一分不扣**，全额记入台账；
 * 次月起连本带「上月递延」一起扣；离职月强制结清。
 * 这是公司垫付，不是免除——免除会让员工社保断档，公司还要担税务逾期。
 */

const EPS = 1e-9;

/** 四舍五入到 n 位小数，规避浮点噪声 */
export function round(n, digits = 4) {
  const f = Math.pow(10, digits);
  return Math.round((Number(n) + Number.EPSILON) * f) / f;
}

/** 金额取整：unit=1 取整到越盾，unit=1000 取整到千盾 */
export function roundMoney(n, unit = 1) {
  const u = Number(unit) > 0 ? Number(unit) : 1;
  return Math.round(Number(n) / u) * u;
}

// ============================================================
// 一、社保 / 工会费
// ============================================================
/**
 * 缴费基数。
 * @param {object} p
 *   @param {number} p.G      月薪基数（基本工资 + 岗位津贴）
 *   @param {number} [p.gross] 应发（仅 base_mode='gross' 的险种用）
 *   @param {string} [p.baseMode='salary']
 *   @param {number} [p.minBase=0] 最低缴费基数（0=不启用）
 */
export function insuranceBase({ G, gross, baseMode = 'salary', minBase = 0 }) {
  let base = baseMode === 'gross' ? Number(gross) || 0 : Number(G) || 0;
  const floor = Number(minBase) || 0;
  if (floor > 0 && base < floor) base = floor;
  return round(base, 2);
}

/**
 * 分险种计算社保与工会费。
 *
 * 为什么必须分险种：BHXH/BHYT 与 BHTN 的**封顶口径不同**
 * （20×参考工资 46,800,000 vs 20×地区最低工资 106,200,000）。
 * 用单一封顶会让高薪员工的失业险少缴，或让普通员工的养老险多缴。
 *
 * 两种口径（salary_insurance_rate.mode）：
 *   ratio  按缴费基数 × 百分比（社保各险种）
 *   fixed  每期定额，与工资无关（工会费，用户 2026-10-28 口径）
 * 工会费同时受员工「工会会员」标志控制：非会员一律 0。
 *
 * @param {object} p
 *   @param {number} p.G
 *   @param {number} [p.gross]
 *   @param {Array}  p.rates  [{ code, name, employee_rate, company_rate, base_mode, cap_base, active }]
 *   @param {number} [p.minBase=0]
 * @returns {{items:Array, insurance:{employee:number,company:number,items:Array},
 *            union:{employee:number,items:Array}, employeeTotal:number, companyTotal:number,
 *            base:number, warnings:Array}}
 */
export function computeInsurance({ G, gross, rates = [], minBase = 0, unionMember = true }) {
  const items = [];
  const warnings = [];
  let base = 0;

  for (const r of rates) {
    if (r.active === false) continue;
    const isUnion = String(r.code).toLowerCase() === 'union';
    const mode = String(r.mode || 'ratio').toLowerCase() === 'fixed' ? 'fixed' : 'ratio';

    // 工会费按「会员标志」计：非会员一律 0，但仍列出 0 行，界面好解释
    if (isUnion && unionMember === false) {
      items.push({
        code: r.code, name: r.name, mode: 'fixed',
        rate: 0, companyRate: 0, base: 0, rawBase: 0, capped: false, capBase: null,
        employee: 0, company: 0, kind: 'union', member: false,
        note: '非工会会员'
      });
      continue;
    }

    if (mode === 'fixed') {
      // 定额口径（用户 2026-10-28：工会费是绝对值，不是按比例）
      const emp = round(Number(r.employee_fixed) || 0, 2);
      const com = round(Number(r.company_fixed) || 0, 2);
      if (!emp && !com) continue;
      items.push({
        code: r.code, name: r.name, mode: 'fixed',
        rate: null, companyRate: null,
        base: 0, rawBase: 0, capped: false, capBase: null,
        employee: emp, company: com,
        kind: isUnion ? 'union' : 'insurance',
        fixed: true
      });
      continue;
    }

    const empRate = Number(r.employee_rate) || 0;
    const comRate = Number(r.company_rate) || 0;
    if (!empRate && !comRate) continue;

    const b = insuranceBase({ G, gross, baseMode: r.base_mode || 'salary', minBase });
    base = b;

    const cap = r.cap_base == null || r.cap_base === '' ? null : Number(r.cap_base);
    const usedBase = cap != null && cap > 0 ? Math.min(b, cap) : b;

    const emp = round(usedBase * empRate / 100, 2);
    const com = round(usedBase * comRate / 100, 2);

    items.push({
      code: r.code,
      name: r.name,
      mode: 'ratio',
      rate: empRate,
      companyRate: comRate,
      base: round(usedBase, 2),
      rawBase: b,
      capped: cap != null && b > cap,
      capBase: cap,
      employee: emp,
      company: com,
      kind: isUnion ? 'union' : 'insurance'
    });
  }

  const insItems = items.filter(x => x.kind === 'insurance');
  const unionItems = items.filter(x => x.kind === 'union');
  if (!insItems.length) {
    warnings.push('未配置社保费率（salary_insurance_rate 为空或未生效），个人社保按 0 计');
  }
  if (!unionItems.length) {
    // 工会费缺失不阻断，但要说出来——否则实发会偏大
    warnings.push('未配置工会费费率，工会费按 0 计');
  }

  const insEmployee = round(insItems.reduce((a, x) => a + x.employee, 0), 2);
  const insCompany = round(insItems.reduce((a, x) => a + x.company, 0), 2);
  const unionEmployee = round(unionItems.reduce((a, x) => a + x.employee, 0), 2);

  return {
    items,
    base,
    insurance: { employee: insEmployee, company: insCompany, items: insItems },
    union: { employee: unionEmployee, items: unionItems },
    employeeTotal: round(insEmployee + unionEmployee, 2),
    companyTotal: insCompany,
    warnings
  };
}

// ============================================================
// 二、个人所得税
// ============================================================
/**
 * 越南居民个税（5 级累进，月度）。
 *
 * 应税所得 = 应发 − 免税加班收入 − 个人社保 − 工会费 − 本人减除 − 抚养人×每名减除
 * 应纳税额 = 应税所得 × 档位税率 − 速算扣除数
 *
 * 关键：**免税收入必须先扣**。v1 直接把应发全额计税，加班费被课了税，
 * 等于多扣员工钱（口径 B 下加班费几乎全免，差额可达数百万越盾/月）。
 *
 * @param {object} p
 *   @param {number} p.gross
 *   @param {number} [p.exemptIncome=0]   免税加班收入
 *   @param {number} p.insurance          个人社保
 *   @param {number} p.unionFee
 *   @param {number} [p.dependents=0]
 *   @param {boolean} [p.resident=true]
 *   @param {number} [p.selfDeduction=15500000]
 *   @param {number} [p.dependentDeduction=6200000]
 *   @param {Array}  p.brackets [{lower, rate, quick}]
 *   @param {boolean} [p.deductExempt=true] 是否先扣免税收入（关掉即退回 v1 口径）
 */
export function computePit({
  gross, exemptIncome = 0, insurance = 0, unionFee = 0,
  dependents = 0, resident = true,
  selfDeduction = 15500000, dependentDeduction = 6200000,
  brackets = [], deductExempt = true
}) {
  const g = Number(gross) || 0;
  const ex = deductExempt ? Math.max(0, Number(exemptIncome) || 0) : 0;
  const ins = Math.max(0, Number(insurance) || 0);
  const uni = Math.max(0, Number(unionFee) || 0);
  const deps = Math.max(0, Math.floor(Number(dependents) || 0));
  const list = Array.isArray(brackets) ? brackets : [];

  const detailBase = {
    gross: round(g, 2),
    exemptIncome: round(ex, 2),
    insurance: round(ins, 2),
    unionFee: round(uni, 2)
  };

  // 非居民：不享受减除，按 20% 单一税率对「应发 − 免税收入 − 社保」课征
  if (resident === false) {
    const base = Math.max(0, g - ex - ins);
    return {
      pit: roundMoney(base * 0.2, 1),
      taxableIncome: round(base, 2),
      deduction: 0,
      bracket: null,
      level: null,
      detail: { ...detailBase, resident: false, rate: 0.2, quick: 0, bracketsMissing: false }
    };
  }

  if (!list.length) {
    return {
      pit: 0, taxableIncome: 0, deduction: 0, bracket: null, level: null,
      detail: { ...detailBase, bracketsMissing: true, warning: '税率表为空，个税按 0 计' }
    };
  }

  const self = Math.max(0, Number(selfDeduction) || 0);
  const perDep = Math.max(0, Number(dependentDeduction) || 0);
  const dependentDeductionTotal = deps * perDep;
  const totalDeduction = self + dependentDeductionTotal;

  const taxable = Math.max(0, g - ex - ins - uni - totalDeduction);

  let picked = list[0];
  for (const b of list) if (taxable >= Number(b.lower)) picked = b;

  const pit = taxable > 0
    ? Math.max(0, roundMoney(taxable * Number(picked.rate) - Number(picked.quick), 1))
    : 0;

  return {
    pit,
    taxableIncome: round(taxable, 2),
    deduction: round(totalDeduction, 2),
    bracket: picked,
    level: picked.seq ?? null,
    detail: {
      ...detailBase,
      resident: true,
      dependents: deps,
      selfDeduction: round(self, 2),
      dependentDeduction: round(dependentDeductionTotal, 2),
      perDependent: round(perDep, 2),
      totalDeduction: round(totalDeduction, 2),
      rate: Number(picked.rate),
      quick: Number(picked.quick),
      level: picked.seq ?? null,
      bracketsMissing: false
    }
  };
}

/** 校验税率表：速算扣除数应满足 本级下限×(本级税率−上级税率)+上级速算 */
export function validateBrackets(brackets = []) {
  const issues = [];
  const list = [...brackets].sort((a, b) => Number(a.lower) - Number(b.lower));
  for (let i = 1; i < list.length; i++) {
    const cur = list[i], prev = list[i - 1];
    const expect = Number(cur.lower) * (Number(cur.rate) - Number(prev.rate)) + Number(prev.quick);
    if (Math.abs(expect - Number(cur.quick)) > 1) {
      issues.push({
        level: cur.seq ?? i + 1,
        lower: Number(cur.lower),
        expectedQuick: round(expect, 2),
        actualQuick: Number(cur.quick),
        message: '第 ' + (cur.seq ?? i + 1) + ' 级速算扣除数应为 ' + round(expect, 2) + '，库中为 ' + Number(cur.quick)
      });
    }
  }
  return { ok: issues.length === 0, issues };
}

// ============================================================
// 三、首月递延
// ============================================================
/**
 * 判断某期是否为「入职第一个月」。
 * @param {string|Date|null} hireDate 'YYYY-MM-DD'
 * @param {string} period 'YYYY-MM'
 * @returns {{firstMonth:boolean, reason:string, hireDate:string|null, monthsSinceHire:number|null}}
 */
export function resolveFirstMonth(hireDate, period) {
  if (!hireDate) {
    return { firstMonth: false, reason: 'hire_date_missing', hireDate: null, monthsSinceHire: null };
  }
  const hd = String(hireDate).slice(0, 10);
  const hm = hd.slice(0, 7);
  if (hm > period) {
    return { firstMonth: false, reason: 'hired_after_period', hireDate: hd, monthsSinceHire: null };
  }
  const [hy, hmn] = hm.split('-').map(Number);
  const [py, pmn] = period.split('-').map(Number);
  const months = (py - hy) * 12 + (pmn - hmn);
  return {
    firstMonth: months === 0,
    reason: months === 0 ? 'first_month' : 'after_first_month',
    hireDate: hd,
    monthsSinceHire: months
  };
}

/**
 * 递延计划：本月扣多少、新增多少、结清多少。
 *
 * 规则（§5.9）：
 *   · 首月：本月三项全部进台账，本月一分不扣；历史遗留递延照样结清。
 *   · 次月起：本月三项照扣 + 结清全部 pending 递延。
 *   · 离职月：调用方传 forceSettle=true，本月三项照扣 + 结清全部递延。
 *   · mode='none'：永不递延（当月照扣），仅用于兼容/临时关停。
 *
 * @param {object} p
 *   @param {boolean} p.firstMonth
 *   @param {string} [p.mode='defer']
 *   @param {number} p.insurance   本月个人社保
 *   @param {number} p.unionFee    本月工会费
 *   @param {number} p.pit         本月个税
 *   @param {Array}  [p.pending=[]] 待结清递延 [{itemType, amount, sourcePeriod}]
 * @returns {{chargeInsurance:number, chargeUnion:number, chargePit:number,
 *            newDeferral:Array, settle:Array, deferIn:number, deferOut:number,
 *            totalCashDeduct:number, notes:Array}}
 */
export function planDeferral({
  firstMonth, mode = 'defer', insurance = 0, unionFee = 0, pit = 0, pending = []
}) {
  const ins = round(Number(insurance) || 0, 2);
  const uni = round(Number(unionFee) || 0, 2);
  const tax = round(Number(pit) || 0, 2);
  const deferOn = mode !== 'none';

  const settle = (pending || [])
    .filter(x => x && x.status !== 'settled' && x.status !== 'waived')
    .map(x => ({
      itemType: x.itemType || x.item_type,
      amount: round(Number(x.amount) || 0, 2),
      sourcePeriod: x.sourcePeriod || x.source_period
    }));

  const settleTotal = round(settle.reduce((a, x) => a + x.amount, 0), 2);

  if (deferOn && firstMonth) {
    const newDeferral = [
      { itemType: 'insurance', amount: ins },
      { itemType: 'union', amount: uni },
      { itemType: 'pit', amount: tax }
    ].filter(x => x.amount > 0);
    const deferOut = round(newDeferral.reduce((a, x) => a + x.amount, 0), 2);
    return {
      chargeInsurance: 0,
      chargeUnion: 0,
      chargePit: 0,
      newDeferral,
      settle,
      deferIn: settleTotal,
      deferOut,
      totalCashDeduct: round(settleTotal, 2),
      notes: [
        '入职首月：社保 ' + ins + ' + 工会费 ' + uni + ' + 个税 ' + tax +
        ' 合计 ' + deferOut + ' 越盾由公司先行垫付，次月工资中一并扣回（不是免除）。'
      ]
    };
  }

  return {
    chargeInsurance: ins,
    chargeUnion: uni,
    chargePit: round(tax + settle.filter(x => x.itemType === 'pit').reduce((a, x) => a + x.amount, 0), 2),
    newDeferral: [],
    settle,
    deferIn: round(settle.filter(x => x.itemType !== 'pit').reduce((a, x) => a + x.amount, 0), 2),
    deferOut: 0,
    totalCashDeduct: round(ins + uni + tax + settleTotal, 2),
    notes: settle.length
      ? ['结清上期递延 ' + settleTotal + ' 越盾（' + settle.map(x => x.itemType + ' ' + x.amount).join('、') + '）。']
      : []
  };
}

// ============================================================
// 四、实发
// ============================================================
/**
 * 实发工资。
 *
 *   net = 应发 − 个人社保 − 工会费 − 本月实扣个税 − 结清的上期社保/工会递延
 *
 * 个税递延已在 chargePit 里合并（见 planDeferral），这里不再重复减。
 *
 * @param {object} p
 *   @param {number} p.gross
 *   @param {number} p.insurance          个人社保（本月）
 *   @param {number} p.unionFee           工会费（本月）
 *   @param {number} p.pitPaid            本月实扣个税（含结清递延个税）
 *   @param {number} [p.deferIn=0]        结清的上期社保/工会递延
 *   @param {number} [p.otherDeduction=0] 其他扣款（借支、罚款等）
 *   @param {number} [p.unit=1]           取整单位
 */
export function computeNetPay({
  gross, insurance = 0, unionFee = 0, pitPaid = 0, deferIn = 0, otherDeduction = 0, unit = 1
}) {
  const g = Number(gross) || 0;
  const ins = Number(insurance) || 0;
  const uni = Number(unionFee) || 0;
  const tax = Number(pitPaid) || 0;
  const din = Number(deferIn) || 0;
  const oth = Number(otherDeduction) || 0;

  const totalDeduct = round(ins + uni + tax + din + oth, 2);
  const rawNet = round(g - totalDeduct, 2);
  return {
    gross: round(g, 2),
    insurance: round(ins, 2),
    unionFee: round(uni, 2),
    pitPaid: round(tax, 2),
    deferIn: round(din, 2),
    otherDeduction: round(oth, 2),
    totalDeduct,
    netRaw: rawNet,
    net: roundMoney(Math.max(0, rawNet), unit),
    negative: rawNet < 0
  };
}

export const VERSION = '1.0.0';
