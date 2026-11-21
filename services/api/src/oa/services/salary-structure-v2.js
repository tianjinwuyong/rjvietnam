/**
 * 薪资结构 v2 服务（薪酬项目字典 + 版本化架构 + 职类/员工绑定）
 * ------------------------------------------------------------
 * 与旧 `salary-service.js` 的分工：
 *   · 旧服务 = v1 口径（月薪 + 3 桶倍率 + 逐员工写死社保费率）→ 冻结，不再新增功能
 *   · 本服务 = v2 口径（月薪制 + 14 段倍率 + 分险种费率 + 项目字典驱动）
 *
 * 三条设计铁律（写在这里防止后来人改错）：
 *   1. **架构里不存加班倍率**。倍率只有一处真值：attendance_time_band（14 段）。
 *      旧表的 ot_rate_weekday/weekend/holiday 已废弃，本服务既不读也不写。
 *   2. **架构里不存社保费率**。费率只有一处真值：salary_insurance_rate（分险种 + 封顶）。
 *      旧结构把 8%/1.5%/1% 和封顶 106.2M 写进每个员工明细，那是"每人一份真值"，
 *      改一次政策要改 300 条记录 → 已标记 auto_from_rate，本服务不再生成这类可填行。
 *   3. **金额只在明细行（salary_structure_line.value）里**。salary_structure 上的
 *      base_salary / post_allowance 两列仅作为 v1 兼容镜像同步，v2 计算不读它们。
 */
import { query, one, transaction } from '../db/index.js';

/** 收入类项目：参与 G / 工资条，可在结构里填金额 */
const INCOME_CATS = ['base', 'perf', 'ot', 'earning', 'allowance'];
/** 自动扣款类项目：由费率表 / 时段算法产生，结构里不可填 */
const AUTO_CATS = ['insurance_personal', 'insurance_company', 'union_fee', 'absent', 'late_early', 'deduction'];

/**
 * 可在结构明细行上配置的「发放规则」。
 * 用户口径（2026-10-28）：除基本工资、职务津贴外，其余各项可选：
 *   per_day   按出勤天数
 *   per_night 按夜班天数
 *   hour_rule 工时阶梯（<A 全发 / A~B 发 50% / ≥B 不发）
 * 其余 calc_mode 属于系统自动项（base_ratio/seniority_tier/import 等），结构行不得改。
 */
export const PAY_RULE_MODES = ['fixed', 'per_day', 'per_night', 'per_shift', 'hour_rule', 'prorate_attendance'];

/** 字典允许的全部 calc_mode（与迁移 112 里的 CHECK 约束保持一致） */
export const ALL_CALC_MODES = [
  ...PAY_RULE_MODES,
  'base_ratio', 'ot_band', 'absent', 'late_early', 'perf_coef', 'perf_abs',
  'manual', 'per_hour', 'full_attendance', 'import', 'seniority_tier'
];

const num = v => (v === null || v === undefined || v === '' ? 0 : Number(v));
const r2 = v => Math.round(Number(v || 0) * 100) / 100;

/** 读参数（时薪分母、最低工资）—— 60 秒缓存由调用方决定，这里直接查 */
async function loadBaseParams() {
  const rows = (await query(
    `SELECT param_key, param_value FROM salary_param
      WHERE param_key IN ('hourly_denominator','min_wage_monthly','min_wage_hourly')`
  )).rows;
  const m = Object.fromEntries(rows.map(r => [r.param_key, Number(r.param_value)]));
  return {
    denom: m.hourly_denominator || 208,
    minWageMonthly: m.min_wage_monthly || 0,
    minWageHourly: m.min_wage_hourly || 0
  };
}

// ============================================================
// 一、薪酬项目字典
// ============================================================
export async function listItems() {
  const rows = (await query(
    `SELECT i.*, (SELECT count(*)::int FROM salary_structure_line l WHERE l.item_id = i.id) AS used_count
       FROM salary_item i ORDER BY i.sort_order, i.id`
  )).rows;
  return rows.map(r => ({
    id: r.id,
    code: r.code,
    name: r.name,
    nameVi: r.name_vi,
    category: r.category,
    calcMode: r.calc_mode,
    valueDefault: Number(r.value_default || 0),
    inHourlyBase: r.in_hourly_base,
    inInsuranceBase: r.in_insurance_base,
    taxable: r.taxable,
    taxExemptRule: r.tax_exempt_rule,
    prorateByAttendance: r.prorate_by_attendance,
    sortOrder: r.sort_order,
    active: r.active,
    remark: r.remark,
    isCustom: !!r.is_custom,
    rule: (r.config && r.config.rule) || null,
    usedCount: r.used_count
  }));
}

/**
 * 新增 / 修改字典项。5 个属性位是全部语义，改这几个开关就等于改变这个项目怎么参与计薪。
 */
export async function saveItem(data = {}, userId = null) {
  const code = String(data.code || '').trim();
  if (!/^[a-z][a-z0-9_]{1,39}$/.test(code)) {
    throw Object.assign(new Error('项目编码只能用 a-z0-9_，且以字母开头'), { statusCode: 400 });
  }
  if (!data.name) throw Object.assign(new Error('项目名称必填'), { statusCode: 400 });

  const category = String(data.category || 'allowance');
  if (![...INCOME_CATS, ...AUTO_CATS].includes(category)) {
    throw Object.assign(new Error('项目类别不合法：' + category), { statusCode: 400 });
  }
  const calcMode = String(data.calcMode || 'fixed');
  if (!ALL_CALC_MODES.includes(calcMode)) {
    throw Object.assign(new Error('发放规则（calc_mode）不合法：' + calcMode), { statusCode: 400 });
  }
  const exempt = String(data.taxExemptRule || 'none');

  // 发放规则参数（per_day / per_night / hour_rule 的阈值）
  const rule = normalizeRule(data.rule, calcMode);
  const config = rule ? JSON.stringify({ rule }) : '{}';

  const fields = [
    data.name, data.nameVi || null, category, calcMode,
    num(data.valueDefault),
    !!data.inHourlyBase, !!data.inInsuranceBase, data.taxable !== false, exempt,
    data.prorateByAttendance !== false,
    Number(data.sortOrder) || 100, data.active !== false, data.remark || null,
    !!data.isCustom
  ];

  if (data.id) {
    const cur = await one(`SELECT * FROM salary_item WHERE id = $1`, [Number(data.id)]);
    if (!cur) throw Object.assign(new Error('项目不存在'), { statusCode: 404 });
    // 编码不可改：结构明细按 code 快照过名字，改码会让历史工资条对不上
    await query(
      `UPDATE salary_item SET
         name=$1, name_vi=$2, category=$3, calc_mode=$4, value_default=$5,
         in_hourly_base=$6, in_insurance_base=$7, taxable=$8, tax_exempt_rule=$9,
         prorate_by_attendance=$10, sort_order=$11, active=$12, remark=$13,
         is_custom=$14, config=$15::jsonb, updated_at=now()
       WHERE id=$16`,
      [...fields, config, Number(data.id)]
    );
    return { id: Number(data.id) };
  }

  // 新建
  const dup = await one(`SELECT id FROM salary_item WHERE code = $1`, [code]);
  if (dup) throw Object.assign(new Error('项目编码已存在：' + code), { statusCode: 400 });
  const r = (await query(
    `INSERT INTO salary_item
       (code, name, name_vi, category, calc_mode, value_default,
        in_hourly_base, in_insurance_base, taxable, tax_exempt_rule,
        prorate_by_attendance, sort_order, active, remark, is_custom, config, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17) RETURNING id`,
    [code, ...fields, config, userId || null]
  )).rows[0];
  return { id: r.id };
}

/**
 * 归一化发放规则参数。
 *   per_day / per_night / per_shift：无需参数（只记 mode）
 *   hour_rule：fullBelow（小于该值全发）/ noneFrom（≥ 该值不发），中间段发 50%
 *              metric = attendance（出勤工时，默认）| absent（缺勤工时）
 */
function normalizeRule(rule, calcMode) {
  const src = rule && typeof rule === 'object' ? rule : {};
  const mode = String(src.mode || calcMode || 'fixed');
  if (mode === 'hour_rule') {
    // 2026-10-28：支持任意档位与任意比例（不再固定「全发 / 50% / 不发」）
    // tiers: [{ lt: 8, ratio: 1 }, { lt: 12, ratio: 0.5 }, { lt: 16, ratio: 0.1 }]
    //   含义：工时 < 8h 发 100%；< 12h 发 50%；< 16h 发 10%；其余按 fallback（默认 0%）
    // 兼容旧数据（只有 fullBelow / noneFrom）：等价转换为 100% / 50% 两档 + 末尾 0%。
    const metric = String(src.metric || 'absent');
    if (Array.isArray(src.tiers) && src.tiers.length) {
      const tiers = src.tiers
        .map(t => ({ lt: fin(t?.lt, NaN), ratio: normRatio(t?.ratio) }))
        .filter(t => Number.isFinite(t.lt) && t.lt >= 0);
      if (!tiers.length) {
        throw Object.assign(new Error('比例阶梯至少要有一档有效阈值'), { statusCode: 400 });
      }
      tiers.sort((a, b) => a.lt - b.lt);
      for (let i = 1; i < tiers.length; i++) {
        if (tiers[i].lt === tiers[i - 1].lt) {
          throw Object.assign(new Error('比例阶梯的阈值不能重复'), { statusCode: 400 });
        }
      }
      return { mode, metric, tiers, fallback: normRatio(src.fallback ?? 0) };
    }
    const fullBelow = fin(src.fullBelow, 8);
    const noneFrom = fin(src.noneFrom, fullBelow * 2);
    if (!(fullBelow >= 0) || !(noneFrom > fullBelow)) {
      throw Object.assign(new Error('工时阶梯规则的阈值不合法：不发阈值必须大于全发阈值'), { statusCode: 400 });
    }
    return {
      mode, metric,
      tiers: [{ lt: fullBelow, ratio: 1 }, { lt: noneFrom, ratio: 0.5 }],
      fallback: 0,
      fullBelow, noneFrom
    };
  }
  if (['per_day', 'per_night', 'per_shift'].includes(mode)) return { mode };
  return null;
}

/** 发放比例归一：允许 0.1 与 10（百分数），越界报错 */
function normRatio(v) {
  const n = fin(v, 0);
  const r = n > 1 ? n / 100 : n;
  if (!(r >= 0) || r > 1) {
    throw Object.assign(new Error('发放比例必须在 0%~100% 之间'), { statusCode: 400 });
  }
  return Math.round(r * 10000) / 10000;
}

function fin(v, dft) {
  if (v === null || v === undefined || v === '') return dft;
  const n = Number(v);
  return Number.isFinite(n) ? n : dft;
}

// ============================================================
// 二、结构列表 / 详情
// ============================================================
export async function listStructures({ status = null, bindLevel = null, keyword = null } = {}) {
  const wh = ['1=1'];
  const args = [];
  if (status) { args.push(status); wh.push(`s.status = $${args.length}`); }
  if (bindLevel === 'class') wh.push('s.user_id IS NULL AND s.class_id IS NOT NULL');
  if (bindLevel === 'user') wh.push('s.user_id IS NOT NULL');
  if (keyword) { args.push('%' + keyword + '%'); wh.push(`(u.real_name ILIKE $${args.length} OR c.name ILIKE $${args.length} OR u.employee_no ILIKE $${args.length})`); }

  const rows = (await query(
    `SELECT s.*, u.real_name AS user_name, u.employee_no, c.name AS class_name, c.name_vi AS class_name_vi,
            (SELECT count(*)::int FROM salary_structure_line l WHERE l.structure_id = s.id AND l.item_id IS NOT NULL) AS line_count
       FROM salary_structure s
       LEFT JOIN org_user u     ON u.id = s.user_id
       LEFT JOIN salary_class c ON c.id = s.class_id
      WHERE ${wh.join(' AND ')}
      ORDER BY s.status = 'draft' DESC, s.effective_from DESC NULLS LAST, s.version DESC`,
    args
  )).rows;

  const params = await loadBaseParams();

  // 明细聚合：只取收入类，按 in_hourly_base 拆 G 与津贴
  // 老结构（v1 写的行）config 里没有属性位快照 → 回落到字典上的属性，避免"有金额却显示 G=0"
  const sums = (await query(
    `SELECT l.structure_id,
            COALESCE(SUM(l.value) FILTER (
              WHERE COALESCE((l.config->>'in_hourly_base')::bool, i.in_hourly_base, false)), 0) AS g,
            COALESCE(SUM(l.value) FILTER (
              WHERE NOT COALESCE((l.config->>'in_hourly_base')::bool, i.in_hourly_base, false)
                AND COALESCE(i.category, l.category) = ANY('{base,perf,ot,earning,allowance}')), 0) AS extra
       FROM salary_structure_line l
       LEFT JOIN salary_item i ON i.id = l.item_id
      GROUP BY l.structure_id`
  )).rows;
  const sumMap = new Map(sums.map(x => [String(x.structure_id), { g: Number(x.g), extra: Number(x.extra) }]));

  // 覆盖人数：职类结构 = 该职类人数；个人结构 = 1
  const classCnt = (await query(
    `SELECT salary_class_id::text AS cid, count(*)::int AS n FROM org_user
      WHERE salary_class_id IS NOT NULL GROUP BY salary_class_id`
  )).rows;
  const cntMap = new Map(classCnt.map(x => [x.cid, x.n]));

  return rows.map(r => {
    const s = sumMap.get(String(r.id)) || { g: 0, extra: 0 };
    const isClass = r.user_id === null && r.class_id !== null;
    return {
      id: r.id,
      bindLevel: isClass ? 'class' : 'user',
      bindId: isClass ? r.class_id : r.user_id,
      bindName: isClass ? r.class_name : r.user_name,
      bindNameVi: isClass ? r.class_name_vi : null,
      employeeNo: r.employee_no || null,
      version: r.version,
      status: r.status,
      effectiveFrom: r.effective_from,
      effectiveTo: r.effective_to,
      currency: r.currency || 'VND',
      remark: r.remark || null,
      templateCode: r.template_code || null,
      regionCode: r.region_code || null,
      G: r2(s.g),
      extraTotal: r2(s.extra),
      monthlyTotal: r2(s.g + s.extra),
      hourRate: params.denom ? r2(s.g / params.denom) : 0,
      headcount: isClass ? (cntMap.get(String(r.class_id)) || 0) : 1,
      lineCount: r.line_count,
      belowMin: params.minWageMonthly > 0 && s.g > 0 && s.g < params.minWageMonthly,
      approvedAt: r.approved_at,
      createdAt: r.created_at
    };
  });
}

export async function getStructure(id) {
  const s = await one(
    `SELECT s.*, u.real_name AS user_name, u.employee_no, c.name AS class_name
       FROM salary_structure s
       LEFT JOIN org_user u     ON u.id = s.user_id
       LEFT JOIN salary_class c ON c.id = s.class_id
      WHERE s.id = $1`, [Number(id)]
  );
  if (!s) return null;

  const lines = (await query(
    `SELECT l.*, i.code AS item_code, i.name AS item_name, i.name_vi AS item_name_vi,
            i.category AS item_category, i.calc_mode AS item_mode,
            i.in_hourly_base, i.in_insurance_base, i.taxable, i.tax_exempt_rule,
            i.prorate_by_attendance, i.active AS item_active
       FROM salary_structure_line l
       LEFT JOIN salary_item i ON i.id = l.item_id
      WHERE l.structure_id = $1
      ORDER BY COALESCE(i.sort_order, l.seq), l.seq`, [s.id]
  )).rows;

  const params = await loadBaseParams();
  const isClass = s.user_id === null && s.class_id !== null;
  // 属性位优先取明细快照；老行没有快照时回落到字典
  const flag = (l, key, fallback) =>
    (l.config && l.config[key] !== undefined) ? !!l.config[key] : fallback;
  const income = lines.filter(l => INCOME_CATS.includes(l.item_category || l.category));
  const G = income.filter(l => flag(l, 'in_hourly_base', !!l.in_hourly_base)).reduce((a, l) => a + num(l.value), 0);
  const extra = income.filter(l => !flag(l, 'in_hourly_base', !!l.in_hourly_base)).reduce((a, l) => a + num(l.value), 0);
  const minWage = params.minWageMonthly;

  const warnings = [];
  if (G <= 0) warnings.push('尚未填写任何金额，生成工资单时该结构会被跳过（不会推出 0 元工资）。');
  if (minWage > 0 && G > 0 && G < minWage) {
    warnings.push(`正班工资 ${G.toLocaleString('en-US')} 低于地区最低工资 ${minWage.toLocaleString('en-US')}，审批会被拦截（差额 ${(minWage - G).toLocaleString('en-US')}）。`);
  }

  return {
    id: s.id,
    bindLevel: isClass ? 'class' : 'user',
    bindId: isClass ? s.class_id : s.user_id,
    bindName: isClass ? s.class_name : s.user_name,
    employeeNo: s.employee_no || null,
    version: s.version,
    status: s.status,
    effectiveFrom: s.effective_from,
    effectiveTo: s.effective_to,
    currency: s.currency || 'VND',
    remark: s.remark || null,
    templateCode: s.template_code || null,
    regionCode: s.region_code || 'VN',
    summary: {
      G: r2(G),
      extraTotal: r2(extra),
      monthlyTotal: r2(G + extra),
      hourRate: params.denom ? r2(G / params.denom) : 0,
      denominator: params.denom,
      minWageMonthly: minWage,
      belowMin: minWage > 0 && G > 0 && G < minWage
    },
    warnings,
    lines: lines.map(l => ({
      id: l.id,
      itemId: l.item_id,
      code: l.item_code || l.code,
      name: l.item_name || l.name,
      nameVi: l.item_name_vi || l.name_vi,
      category: l.item_category || l.category,
      calcMode: l.item_mode || l.calc_mode,
      value: num(l.value),
      inHourlyBase: flag(l, 'in_hourly_base', !!l.in_hourly_base),
      inInsuranceBase: flag(l, 'in_insurance_base', !!l.in_insurance_base),
      taxable: flag(l, 'taxable', l.taxable !== false),
      prorate: flag(l, 'prorate_by_attendance', !!l.prorate_by_attendance),
      auto: !!(l.config && l.config.auto_from_rate),
      legacy: !!(l.config && l.config.legacy),
      // 发放规则：保存时已把「行级覆盖 or 字典默认」快照进行 config.rule
      rule: (l.config && l.config.rule) || null,
      itemActive: l.item_active !== false
    }))
  };
}

// ============================================================
// 三、新建 / 修改
// ============================================================
/**
 * 新建或保存结构。
 * @param {object} d
 *   @param {number} [d.id]            有则更新（仅 draft）
 *   @param {string} d.bindLevel       'class' 职类模板 / 'user' 员工专属
 *   @param {number} [d.classId]
 *   @param {number} [d.userId]
 *   @param {string} d.effectiveFrom   YYYY-MM-DD
 *   @param {string} [d.currency]
 *   @param {string} [d.remark]
 *   @param {Array}  [d.lines]         [{ itemId|code, value }]，不传则按字典默认带出
 */
export async function saveStructure(d = {}, userId = null) {
  const bindLevel = d.bindLevel === 'user' ? 'user' : 'class';
  const classId = bindLevel === 'class' ? Number(d.classId) || null : null;
  const userKey = bindLevel === 'user' ? Number(d.userId) || null : null;
  if (bindLevel === 'class' && !classId) throw Object.assign(new Error('请选择职类'), { statusCode: 400 });
  if (bindLevel === 'user' && !userKey) throw Object.assign(new Error('请选择员工'), { statusCode: 400 });

  if (bindLevel === 'class') {
    const c = await one(`SELECT id FROM salary_class WHERE id = $1`, [classId]);
    if (!c) throw Object.assign(new Error('职类不存在'), { statusCode: 400 });
  } else {
    const u = await one(`SELECT id FROM org_user WHERE id = $1`, [userKey]);
    if (!u) throw Object.assign(new Error('员工不存在'), { statusCode: 400 });
  }

  const effectiveFrom = d.effectiveFrom || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
    throw Object.assign(new Error('生效日期格式应为 YYYY-MM-DD'), { statusCode: 400 });
  }

  // 明细：itemId 或 code 都可以，统一解析成字典行
  const allItems = (await query(`SELECT * FROM salary_item ORDER BY sort_order, id`)).rows;
  const byId = new Map(allItems.map(i => [String(i.id), i]));
  const byCode = new Map(allItems.map(i => [i.code, i]));

  let input = Array.isArray(d.lines) ? d.lines : null;
  if (!input) {
    // 默认带出：启用的收入类项目（不含 ot_band —— 它由时段自动算，不填数）
    input = allItems
      .filter(i => i.active && INCOME_CATS.includes(i.category) && i.calc_mode !== 'ot_band')
      .map(i => ({ itemId: i.id, value: Number(i.value_default || 0) }));
  }

  const resolved = [];
  const seen = new Set();
  for (const ln of input) {
    const item = ln.itemId ? byId.get(String(ln.itemId)) : byCode.get(String(ln.code || ''));
    if (!item) throw Object.assign(new Error('薪酬项目不存在：' + (ln.itemId || ln.code)), { statusCode: 400 });
    if (AUTO_CATS.includes(item.category)) {
      throw Object.assign(new Error(`「${item.name}」由费率表或时段算法自动产生，不能在结构里填金额`), { statusCode: 400 });
    }
    if (item.calc_mode === 'ot_band') {
      throw Object.assign(new Error('「加班/夜班工资」由 14 段倍率按实际打卡自动计算，不能在结构里填固定金额'), { statusCode: 400 });
    }
    if (seen.has(String(item.id))) continue;
    seen.add(String(item.id));
    const value = num(ln.value);
    if (value < 0) throw Object.assign(new Error(`「${item.name}」金额不能为负`), { statusCode: 400 });

    // 发放规则可在结构行覆盖（用户口径 2026-10-28）：
    //   基本工资 / 职务津贴是计薪基数本体，只有金额，不参与「按天/按夜班/阶梯」规则。
    const isBaseItem = ['base', 'post_allowance'].includes(item.code) || item.in_hourly_base === true;
    const modeOverride = (!isBaseItem && ln.calcMode && PAY_RULE_MODES.includes(String(ln.calcMode)))
      ? String(ln.calcMode) : null;
    const ruleOverride = (!isBaseItem && ln.rule && typeof ln.rule === 'object') ? ln.rule : null;

    resolved.push({ item, value, modeOverride, ruleOverride });
  }
  if (!resolved.length) throw Object.assign(new Error('至少需要一个收入类薪酬项目'), { statusCode: 400 });

  const G = resolved.filter(x => x.item.in_hourly_base).reduce((a, x) => a + x.value, 0);
  const params = await loadBaseParams();
  const warnings = [];
  if (G <= 0) warnings.push('正班工资为 0，可以存草稿，但审批会被拦截。');
  if (params.minWageMonthly > 0 && G > 0 && G < params.minWageMonthly) {
    warnings.push(`正班工资低于最低工资 ${params.minWageMonthly.toLocaleString('en-US')}，差 ${(params.minWageMonthly - G).toLocaleString('en-US')}。`);
  }

  const scopeCol = bindLevel === 'user' ? 'user_id' : 'class_id';
  const scopeVal = bindLevel === 'user' ? userKey : classId;
  const baseAmount = resolved.filter(x => x.item.code === 'base').reduce((a, x) => a + x.value, 0);
  const postAmount = resolved.filter(x => x.item.code === 'post_allowance').reduce((a, x) => a + x.value, 0);

  const out = await transaction(async client => {
    let id = Number(d.id) || null;
    let version;

    if (id) {
      const cur = (await client.query(`SELECT * FROM salary_structure WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      if (!cur) throw Object.assign(new Error('结构不存在'), { statusCode: 404 });
      if (cur.status !== 'draft') {
        throw Object.assign(new Error('只有草稿可以修改；已审批的请新建版本'), { statusCode: 409 });
      }
      version = cur.version;
      await client.query(
        `UPDATE salary_structure SET
           user_id=$2, class_id=$3, effective_from=$4, currency=$5, remark=$6,
           base_salary=$7, post_allowance=$8, is_template=$9
         WHERE id=$1`,
        [id, userKey, classId, effectiveFrom, d.currency || 'VND', d.remark || null,
          baseAmount, postAmount, bindLevel === 'class']
      );
    } else {
      // 同作用域 + 同生效日已有版本 → 拒绝（避免两个同日起效的真值）
      const dup = (await client.query(
        `SELECT id, version FROM salary_structure
          WHERE ${scopeCol} = $1 AND effective_from = $2::date`, [scopeVal, effectiveFrom]
      )).rows[0];
      if (dup) {
        throw Object.assign(new Error(`该${bindLevel === 'class' ? '职类' : '员工'}在 ${effectiveFrom} 已有一个版本（v${dup.version}），请编辑它或换生效日期`), { statusCode: 409 });
      }
      const cur = (await client.query(
        `SELECT COALESCE(MAX(version),0)::int AS v FROM salary_structure WHERE ${scopeCol} = $1`, [scopeVal]
      )).rows[0];
      version = (cur.v || 0) + 1;
      id = (await client.query(
        `INSERT INTO salary_structure
           (user_id, class_id, version, effective_from, currency, remark,
            base_salary, post_allowance, ot_rate_weekday, ot_rate_weekend, ot_rate_holiday,
            status, created_by, is_template, region_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1.5,2.0,3.0,'draft',$9,$10,'VN')
         RETURNING id`,
        [userKey, classId, version, effectiveFrom, d.currency || 'VND', d.remark || null,
          baseAmount, postAmount, userId || null, bindLevel === 'class']
      )).rows[0].id;
    }

    // 只重写收入类行；保险/扣款等自动行原样保留（v1 老代码路径仍在读）
    await client.query(
      `DELETE FROM salary_structure_line
        WHERE structure_id = $1
          AND (item_id IN (SELECT id FROM salary_item WHERE category = ANY($2::text[]))
               OR (item_id IS NULL AND category = ANY($2::text[])))`,
      [id, INCOME_CATS]
    );

    let seq = 0;
    for (const { item, value, modeOverride, ruleOverride } of resolved) {
      seq += 10;
      // 行级规则优先于字典默认值；字典 config.rule 是「这类项默认怎么发」
      const cfg = item.config && typeof item.config === 'object' ? item.config : {};
      const rule = ruleOverride || cfg.rule || null;
      await client.query(
        `INSERT INTO salary_structure_line
           (structure_id, seq, code, name, name_vi, category, calc_mode, value, config, item_id, display_group)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)`,
        [id, seq, item.code, item.name, item.name_vi, item.category,
          modeOverride || item.calc_mode, value,
          JSON.stringify({
            in_hourly_base: item.in_hourly_base,
            in_insurance_base: item.in_insurance_base,
            taxable: item.taxable,
            tax_exempt_rule: item.tax_exempt_rule,
            prorate_by_attendance: item.prorate_by_attendance,
            ...(rule ? { rule } : {})
          }),
          item.id,
          INCOME_CATS.includes(item.category) ? 'income' : 'other']
      );
    }
    return { id, version };
  });

  return {
    ...out,
    summary: {
      G: r2(G),
      hourRate: params.denom ? r2(G / params.denom) : 0,
      denominator: params.denom,
      lineCount: resolved.length
    },
    warnings
  };
}

/** 删除草稿 */
export async function deleteStructure(id) {
  const cur = await one(`SELECT * FROM salary_structure WHERE id = $1`, [id]);
  if (!cur) throw Object.assign(new Error('结构不存在'), { statusCode: 404 });
  if (cur.status !== 'draft') throw Object.assign(new Error('只有草稿可以删除'), { statusCode: 409 });
  await transaction(async client => {
    await client.query(`DELETE FROM salary_structure_line WHERE structure_id = $1`, [id]);
    await client.query(`DELETE FROM salary_structure WHERE id = $1`, [id]);
  });
  return { id };
}

/**
 * 审批：draft → approved。硬拦两道：正班工资 > 0、≥ 最低工资。
 * 同一作用域内更早的版本自动补 effective_to（保留历史，不做删除）。
 */
export async function approveStructure(id, approvedBy) {
  const s = await one(`SELECT * FROM salary_structure WHERE id = $1`, [id]);
  if (!s) throw Object.assign(new Error('结构不存在'), { statusCode: 404 });
  if (s.status === 'approved') return getStructure(id);

  const lines = (await query(
    `SELECT l.value, l.config, l.item_id, i.in_hourly_base, i.name
       FROM salary_structure_line l LEFT JOIN salary_item i ON i.id = l.item_id
      WHERE l.structure_id = $1`, [id]
  )).rows;
  const G = lines
    .filter(l => (l.config && l.config.in_hourly_base) === true || l.in_hourly_base === true)
    .reduce((a, l) => a + num(l.value), 0);
  const params = await loadBaseParams();

  if (G <= 0) {
    throw Object.assign(new Error('正班工资为 0，不能审批。请先在明细里填金额（基本工资/职务津贴等计入时薪基数的项目）。'), { statusCode: 400 });
  }
  if (params.minWageMonthly > 0 && G < params.minWageMonthly) {
    throw Object.assign(new Error(
      `正班工资 ${G.toLocaleString('en-US')} 低于越南地区最低工资 ${params.minWageMonthly.toLocaleString('en-US')}，差额 ${(params.minWageMonthly - G).toLocaleString('en-US')}。` +
      `这是劳动法硬约束（第 90 条 + 第 38/2022/NĐ-CP），系统不允许审批通过。`
    ), { statusCode: 400 });
  }

  const scopeCol = s.user_id ? 'user_id' : 'class_id';
  const scopeVal = s.user_id || s.class_id;

  await transaction(async client => {
    // 同作用域、同生效日已有 approved → 冲突
    const clash = (await client.query(
      `SELECT id FROM salary_structure
        WHERE ${scopeCol} = $1 AND effective_from = $2::date AND status = 'approved' AND id <> $3`,
      [scopeVal, s.effective_from, id]
    )).rows[0];
    if (clash) {
      throw Object.assign(new Error('同一生效日已有审批通过的版本，请先作废或换生效日期'), { statusCode: 409 });
    }
    // 更早的版本补失效日（生效日 - 1 天），保留历史而不是删除
    await client.query(
      `UPDATE salary_structure
          SET effective_to = ($2::date - INTERVAL '1 day')::date
        WHERE ${scopeCol} = $1 AND status = 'approved' AND effective_to IS NULL
          AND effective_from < $2::date`,
      [scopeVal, s.effective_from]
    );
    await client.query(
      `UPDATE salary_structure
          SET status='approved', approved_by=$2, approved_at=now()
        WHERE id = $1`, [id, approvedBy || null]
    );
  });

  return getStructure(id);
}

/** 作废（approved → archived），用于审批错了要撤回 */
export async function archiveStructure(id) {
  const s = await one(`SELECT * FROM salary_structure WHERE id = $1`, [id]);
  if (!s) throw Object.assign(new Error('结构不存在'), { statusCode: 404 });
  if (s.status === 'draft') throw Object.assign(new Error('草稿请直接删除'), { statusCode: 400 });
  await query(`UPDATE salary_structure SET status='archived', effective_to=COALESCE(effective_to, CURRENT_DATE) WHERE id=$1`, [id]);
  return { id };
}

/**
 * 撤销作废（archived → approved），用于「作废点错了」。
 * 作废时把 effective_to 写成了当天，撤销时不能简单置空：
 *   · 若同作用域下有更晚的已审批版本，失效日必须回到「下一版生效日 - 1 天」，否则两个版本日期区间重叠；
 *   · 若没有更晚的版本，失效日置空（长期有效）。
 * 同作用域同生效日已有别的已审批版本时拒绝，避免出现两个同日生效的真值。
 */
export async function restoreStructure(id, operatorId = null) {
  const s = await one(`SELECT * FROM salary_structure WHERE id = $1`, [Number(id)]);
  if (!s) throw Object.assign(new Error('结构不存在'), { statusCode: 404 });
  if (s.status !== 'archived') {
    throw Object.assign(new Error('只有已作废的版本可以撤销作废；草稿直接编辑即可'), { statusCode: 400 });
  }
  const scopeCol = s.user_id ? 'user_id' : 'class_id';
  const scopeVal = s.user_id || s.class_id;

  await transaction(async client => {
    const clash = (await client.query(
      `SELECT id, version FROM salary_structure
        WHERE ${scopeCol} = $1 AND effective_from = $2::date AND status = 'approved' AND id <> $3`,
      [scopeVal, s.effective_from, s.id]
    )).rows[0];
    if (clash) {
      throw Object.assign(new Error(
        `同一生效日（${String(s.effective_from).slice(0, 10)}）已有审批通过的 v${clash.version}，不能同时存在两个。请先作废它，或改用「复制为新版本」并换生效日。`
      ), { statusCode: 409 });
    }
    const next = (await client.query(
      `SELECT effective_from FROM salary_structure
        WHERE ${scopeCol} = $1 AND status = 'approved' AND effective_from > $2::date
        ORDER BY effective_from LIMIT 1`,
      [scopeVal, s.effective_from]
    )).rows[0];

    await client.query(
      `UPDATE salary_structure
          SET status = 'approved',
              effective_to = CASE WHEN $2::date IS NULL THEN NULL ELSE ($2::date - INTERVAL '1 day')::date END,
              approved_by = COALESCE(approved_by, $3)
        WHERE id = $1`,
      [s.id, next ? next.effective_from : null, operatorId || null]
    );
  });

  return getStructure(s.id);
}

// ============================================================
// 四、职类 = 岗位字典（salary_class 是 sys_i18n_dict(position) 的镜像）
// ------------------------------------------------------------
// 用户口径（2026-10-27）：「不要这样分职类，按照这个岗位字典里面的分」。
// 原 salary_class 只有 3 条手工分类（生产员工 / 越籍主管 / 中方人员），按「身份」分；
// 而岗位字典 13 条按「职责」分，薪资结构本该按岗位设计。两套标准必然对不上。
//
// 因此本节所有「职类」一律指岗位字典里的岗位：
//   · 列表以 sys_i18n_dict(dict_type='position') 为驱动，salary_class 只作外键锚点；
//   · 人数按 org_user.position_code 统计（真实岗位口径），不数 salary_class_id；
//   · org_user.salary_class_id 是**派生缓存**，由 syncClassesFromPositions() 刷新。
//
// 为什么用应用层同步而不用数据库触发器：触发器会在 sys_i18n_dict 上引入隐藏写放大，
// 且岗位维护只走 position-service.js 一条路径，应用层同步更可控、可测、可追溯。
// ============================================================

/** 把岗位字典镜像到 salary_class，并刷新员工的派生职类缓存（幂等，可反复调用） */
export async function syncClassesFromPositions() {
  const up = await query(
    `INSERT INTO salary_class (code, name, name_vi, name_en, sort_order, active, source)
     SELECT d.code, d.name_zh, COALESCE(d.name_vi, ''), COALESCE(d.name_en, ''),
            COALESCE(d.sort_order, 0), COALESCE(d.active, TRUE), 'position'
       FROM sys_i18n_dict d
      WHERE d.dict_type = 'position'
     ON CONFLICT (code) DO UPDATE
        SET name       = EXCLUDED.name,
            name_vi    = EXCLUDED.name_vi,
            name_en    = EXCLUDED.name_en,
            sort_order = EXCLUDED.sort_order,
            active     = EXCLUDED.active,
            source     = 'position'`
  );
  const set = await query(
    `UPDATE org_user u SET salary_class_id = c.id
       FROM salary_class c
      WHERE c.source = 'position' AND c.active = TRUE
        AND u.position_code = c.code
        AND u.salary_class_id IS DISTINCT FROM c.id`
  );
  // 岗位已从字典里删掉的，镜像行要停用（否则 listClasses 看不到它，员工却还能套到它的结构）
  const off = await query(
    `UPDATE salary_class c SET active = FALSE
      WHERE c.source = 'position' AND c.active = TRUE
        AND NOT EXISTS (SELECT 1 FROM sys_i18n_dict d
                         WHERE d.dict_type = 'position' AND d.code = c.code)`
  );
  // 反向清理：岗位被清空/改成别的岗位/岗位停用时，缓存里那条旧职类必须清掉，
  // 否则会出现「人已经没岗位了，却还按老岗位套结构」这种看不出原因的错误工资
  const clear = await query(
    `UPDATE org_user u SET salary_class_id = NULL
      WHERE u.salary_class_id IS NOT NULL
        AND NOT EXISTS (
              SELECT 1 FROM salary_class c
               WHERE c.id = u.salary_class_id
                 AND c.source = 'position' AND c.active = TRUE
                 AND c.code = u.position_code)`
  );
  return { classes: up.rowCount, assigned: set.rowCount, disabled: off.rowCount, cleared: clear.rowCount };
}

/** 岗位（＝职类）列表：含在职人数、已审批生效结构、草稿结构 */
export async function listClasses() {
  await syncClassesFromPositions();
  const rows = (await query(
    `SELECT d.code, d.name_zh, d.name_vi, d.name_en, d.sort_order, d.active AS pos_active,
            c.id AS class_id, c.active AS class_active,
            (SELECT count(*)::int FROM org_user u
              WHERE u.position_code = d.code AND COALESCE(u.active, TRUE)
                AND NOT COALESCE(u.is_system, FALSE)) AS member_count,
            (SELECT s.id FROM salary_structure s
              WHERE s.class_id = c.id AND s.user_id IS NULL AND s.status = 'approved'
              ORDER BY s.effective_from DESC LIMIT 1) AS active_structure_id,
            (SELECT s.version FROM salary_structure s
              WHERE s.class_id = c.id AND s.user_id IS NULL AND s.status = 'approved'
              ORDER BY s.effective_from DESC LIMIT 1) AS active_version,
            (SELECT s.id FROM salary_structure s
              WHERE s.class_id = c.id AND s.user_id IS NULL AND s.status = 'draft'
              ORDER BY s.version DESC LIMIT 1) AS draft_structure_id
       FROM sys_i18n_dict d
       LEFT JOIN salary_class c ON c.code = d.code AND c.source = 'position'
      WHERE d.dict_type = 'position'
      ORDER BY COALESCE(d.sort_order, 999), d.code`
  )).rows;

  const counts = await one(
    `SELECT count(*) FILTER (WHERE COALESCE(u.active, TRUE) AND NOT COALESCE(u.is_system, FALSE))::int AS active_total,
            count(*) FILTER (WHERE COALESCE(u.active, TRUE) AND NOT COALESCE(u.is_system, FALSE)
                              AND NOT EXISTS (SELECT 1 FROM sys_i18n_dict d
                                               WHERE d.dict_type = 'position'
                                                 AND d.code = u.position_code
                                                 AND d.active))::int AS no_position
       FROM org_user u`
  );

  return {
    classes: rows.map(r => ({
      id: r.class_id ? Number(r.class_id) : null,
      code: r.code,
      name: r.name_zh,
      nameVi: r.name_vi,
      nameEn: r.name_en,
      sortOrder: Number(r.sort_order) || 0,
      members: Number(r.member_count) || 0,
      memberCount: Number(r.member_count) || 0,
      activeStructureId: r.active_structure_id ? Number(r.active_structure_id) : null,
      activeVersion: r.active_version,
      draftStructureId: r.draft_structure_id ? Number(r.draft_structure_id) : null,
      active: !!r.pos_active
    })),
    unassignedCount: counts.no_position,
    employeeTotal: counts.active_total,
    source: 'position_dict'
  };
}

/**
 * 把员工设到某个岗位（＝职类）。
 * 注意：这里是**写 HR 岗位**（org_user.position_code / position），不只是计薪归属——
 * 岗位同时被流程引擎用来找人，所以文案必须说清"会改岗位"，不能伪装成只改工资口径。
 * 已在目标岗位的人自动跳过，不产生更新。
 */
export async function assignClass({ userIds = [], classId } = {}) {
  const cid = Number(classId) || null;
  if (!cid) throw Object.assign(new Error('请选择岗位'), { statusCode: 400 });
  const ids = (Array.isArray(userIds) ? userIds : []).map(Number).filter(Boolean);
  if (!ids.length) throw Object.assign(new Error('请至少选择一名员工'), { statusCode: 400 });

  const cls = await one(
    `SELECT id, code, name FROM salary_class WHERE id = $1 AND source = 'position'`,
    [cid]
  );
  if (!cls) throw Object.assign(new Error('岗位不存在，或不是岗位字典里的岗位'), { statusCode: 400 });

  const r = await query(
    `UPDATE org_user
        SET position_code = $1, position = $2, salary_class_id = $3
      WHERE id = ANY($4::bigint[])
        AND COALESCE(position_code, '') <> $1`,
    [cls.code, cls.name, cid, ids]
  );
  return { classId: cid, className: cls.name, positionCode: cls.code, updated: r.rowCount };
}

/** 员工下拉（含岗位、派生职类、结构来源：个人专属 / 岗位模板 / 未配置） */
export async function listEmployeesForBind({ keyword = null } = {}) {
  const args = [];
  // 注意：org_user 用 active(bool) 而不是 status，早先写成 status 会触发 42703
  let wh = `COALESCE(u.active, TRUE) = TRUE`;
  if (keyword) {
    args.push('%' + keyword + '%');
    wh = `(${wh}) AND (COALESCE(u.real_name,'') ILIKE $1 OR COALESCE(u.employee_no,'') ILIKE $1)`;
  }
  const rows = (await query(
    `SELECT u.id, u.real_name, u.employee_no, u.salary_class_id, u.position_code,
            COALESCE(d.name_zh, c.name) AS position_name,
            COALESCE(d.name_vi, c.name_vi) AS position_vi,
            c.id AS class_id,
            (SELECT count(*)::int FROM salary_structure s
              WHERE s.user_id = u.id AND s.status = 'approved') AS personal_approved,
            (SELECT s.version FROM salary_structure s
              WHERE s.user_id = u.id AND s.status = 'approved'
              ORDER BY s.effective_from DESC, s.version DESC LIMIT 1) AS personal_version,
            (SELECT s.version FROM salary_structure s
              WHERE s.class_id = c.id AND s.user_id IS NULL AND s.status = 'approved'
              ORDER BY s.effective_from DESC LIMIT 1) AS class_version,
            u.hire_date
       FROM org_user u
       LEFT JOIN salary_class c ON c.id = u.salary_class_id
       LEFT JOIN sys_i18n_dict d ON d.dict_type = 'position' AND d.code = u.position_code
      WHERE ${wh}
      ORDER BY COALESCE(u.employee_no, ''), u.id LIMIT 500`, args
  )).rows;
  return rows.map(r => {
    let source = 'none';
    if (r.personal_approved > 0) source = 'personal';
    else if (r.class_version) source = 'class';
    else if (!r.position_code) source = 'no_position';
    return {
      id: Number(r.id),
      name: r.real_name,
      employeeNo: r.employee_no,
      positionCode: r.position_code,
      positionName: r.position_name,
      positionVi: r.position_vi,
      classId: r.class_id ? Number(r.class_id) : null,
      className: r.position_name,
      hasApproved: r.personal_approved > 0,
      personalVersion: r.personal_version,
      classVersion: r.class_version,
      source,
      hireDate: r.hire_date
    };
  });
}
