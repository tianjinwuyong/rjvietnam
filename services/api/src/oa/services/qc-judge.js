// ============================================================
// qc-judge —— spec 规格解析与逐项/批次判定
//
// 依据：IQC-OA 规格 §6（算法 B）
//
// 关键口径（改动前先读 §6.2 的坑）：
//   1) **否定式必须先匹配**：`不小于5` 里含子串 `小于5`，顺序错会把合格判成 NG；
//   2) **失败即放行**：空值、非数值、规格解析失败一律"没超差"，交检验员手填不良数，
//      系统不得因解析失败而阻拦提交或自动判 NG（§6.3 🔒）；
//   3) `is_pass = defect_qty <= ac`，ac 缺省按 0；不提供手工改 is_pass 的入口（§6.4）。
// ============================================================

/** 全角转半角 + 去空白 + 逗号小数/千分位归一（§6.2 预处理，顺序不可换） */
function prep(text) {
  let s = String(text ?? '')
    .replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, '')
    .trim();
  s = s.replace(/(\d)[,，](\d{1,2})(?!\d)/g, '$1.$2'); // 3,15 → 3.15
  s = s.replace(/(\d)[,，](\d{3})(?!\d)/g, '$1$2');    // 1,000 → 1000
  return s;
}

/** 数值化：支持 10^9、1.5e6、逗号小数（3,15）、千分位（1,000） */
function toNumber(s) {
  let t = String(s).trim();
  if (!t) return null;
  t = t.replace(/(\d)[,，](\d{3})(?!\d)/g, '$1$2'); // 千分位先剥离
  t = t.replace(/(\d)[,，](\d{1,2})(?!\d)/g, '$1.$2'); // 逗号小数
  if (/^\d+(\.\d+)?\^\d+$/.test(t)) {
    const [b, e] = t.split('^');
    return Number(b) ** Number(e);
  }
  const n = Number.parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

/** 从字符串里取第一个数（支持 ±x% 由调用方处理） */
function firstNumber(s) {
  const m = /[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/.exec(String(s));
  return m ? Number.parseFloat(m[0]) : null;
}

/**
 * 解析 spec 文本 → { valid, lsl, usl, lslExclusive, uslExclusive, text, reason }
 * 顺序严格按 §6.2 表格 1..15。
 */
export function parseSpec(specText) {
  const raw = String(specText ?? '');
  const s = prep(raw);
  if (!s) return { valid: false, reason: '规格为空', text: raw };

  const mk = (lsl, usl, lslEx = false, uslEx = false) => ({
    valid: lsl !== null || usl !== null,
    lsl, usl, lslExclusive: lslEx, uslExclusive: uslEx,
    text: raw, reason: null,
  });

  // 1 不小于 / 不低于 → lsl 闭
  let m = /(?:不小于|不低于)([-+]?\d+(?:\.\d+)?)/.exec(s);
  if (m) return mk(Number(m[1]), null);

  // 2 不大于 / 不高于 → usl 闭
  m = /(?:不大于|不高于)([-+]?\d+(?:\.\d+)?)/.exec(s);
  if (m) return mk(null, Number(m[1]));

  // 3 小于 / 低于 → usl 开（等于判 NG）
  m = /(?:小于|低于)([-+]?\d+(?:\.\d+)?)/.exec(s);
  if (m) return mk(null, Number(m[1]), false, true);

  // 4 大于 / 高于 → lsl 开
  m = /(?:大于|高于)([-+]?\d+(?:\.\d+)?)/.exec(s);
  if (m) return mk(Number(m[1]), null, true, false);

  // 5 范围：3.15~4.15 / 10到20 / 5-8 / 5—8 / 5–8 / 5，8（全角～已转半角）
  m = /^([-+]?\d+(?:\.\d+)?)(?:~|〜|到|-|—|–|，|,)([-+]?\d+(?:\.\d+)?)$/.exec(s);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    return mk(Math.min(a, b), Math.max(a, b));
  }

  // 6-9 前缀比较符
  m = /^(?:≤|<=)([-+]?\d+(?:\.\d+)?)$/.exec(s);
  if (m) return mk(null, Number(m[1]));
  m = /^(?:<|＜)([-+]?\d+(?:\.\d+)?)$/.exec(s);
  if (m) return mk(null, Number(m[1]), false, true);
  m = /^(?:≥|>=)([-+]?\d+(?:\.\d+)?)$/.exec(s);
  if (m) return mk(Number(m[1]), null);
  m = /^(?:>|＞)([-+]?\d+(?:\.\d+)?)$/.exec(s);
  if (m) return mk(Number(m[1]), null, true, false);

  // 10-11 MAX / MIN
  m = /^([-+]?\d+(?:\.\d+)?)MAX$/i.exec(s);
  if (m) return mk(null, Number(m[1]));
  m = /^([-+]?\d+(?:\.\d+)?)MIN$/i.exec(s);
  if (m) return mk(Number(m[1]), null);

  // 12 双向公差 10±0.1 / 10±5%
  m = /^([-+]?\d+(?:\.\d+)?)[±\+-]\+?([-+]?\d+(?:\.\d+)?)(%?)$/.exec(s);
  if (m) {
    const base = Number(m[1]);
    const tol = Number(m[2]);
    const isPct = m[3] === '%';
    const d = isPct ? Math.abs(base) * tol / 100 : tol;
    return mk(base - d, base + d);
  }

  // 13 上下偏差 10(+0.1/-0.2) / 10(+0.1,-0.2)
  m = /^([-+]?\d+(?:\.\d+)?)\(?([-+]\d+(?:\.\d+)?)[\/,]([-+]\d+(?:\.\d+)?)\)?$/.exec(s);
  if (m) {
    const base = Number(m[1]);
    return mk(base + Number(m[3]), base + Number(m[2]));
  }

  // 14 纯数字 → 解析失败（要求指定公差）
  if (/^[-+]?\d+(?:\.\d+)?$/.test(s)) {
    return { valid: false, reason: '请指定公差或上下限', text: raw };
  }

  // 15 其它（如"无划伤"）→ 解析失败，交人工
  return { valid: false, reason: '无法识别的规格格式', text: raw };
}

/** 单值是否超差（§6.3） */
export function isOutOfSpec(value, parsed) {
  if (value === null || value === undefined) return false;
  const raw = String(value).trim();
  if (!raw) return false;
  const n = toNumber(raw);
  if (n === null || !Number.isFinite(n)) return false;
  const spec = typeof parsed === 'string' ? parseSpec(parsed) : parsed;
  if (!spec || !spec.valid) return false; // 解析不了不自动判定

  if (spec.lsl !== null && spec.lsl !== undefined) {
    if (n < spec.lsl) return true;
    if (spec.lslExclusive && n === spec.lsl) return true;
  }
  if (spec.usl !== null && spec.usl !== undefined) {
    if (n > spec.usl) return true;
    if (spec.uslExclusive && n === spec.usl) return true;
  }
  return false;
}

/**
 * 单项判定。
 * @param {object} rec { valueType, measuredValue, measuredValues, defectQty, spec }
 * @param {number} ac 接收数
 *
 * ⚠️ 「未录入」必须是 null，不能是 0（规格 §14.2-5：不得用 0 代表未判定）。
 * 旧实现让空录入回落到 defectQty=0 → is_pass=true，等于什么都不填就自动判合格。
 */
export function judgeItem(rec = {}, ac = 0) {
  const acNum = Number.isFinite(Number(ac)) ? Number(ac) : 0;
  const parsed = parseSpec(rec.spec);
  const values = Array.isArray(rec.measuredValues) ? rec.measuredValues : [];
  const nonEmpty = values.filter((v) => v !== null && v !== undefined && String(v).trim() !== '');
  const manualQty = rec.defectQty === null || rec.defectQty === undefined || rec.defectQty === ''
    ? null : Number(rec.defectQty);
  const single = rec.measuredValue === null || rec.measuredValue === undefined
    ? '' : String(rec.measuredValue).trim();

  const isMeasure = rec.valueType === 'measure';

  // ---- 未录入：不判定（is_pass=null），由提交校验拦截，绝不冒充合格 ----
  if (isMeasure) {
    if (nonEmpty.length === 0) {
      return {
        judged: false, specValid: parsed.valid, specReason: parsed.reason || null,
        specMin: parsed.lsl ?? null, specMax: parsed.usl ?? null,
        outCount: 0, measuredCount: 0, defectQty: null, isPass: null, nonNumeric: null,
      };
    }
  } else if (rec.valueType === 'attribute') {
    if (!single && manualQty === null) {
      return {
        judged: false, specValid: parsed.valid, specReason: parsed.reason || null,
        specMin: parsed.lsl ?? null, specMax: parsed.usl ?? null,
        outCount: 0, measuredCount: 0, defectQty: null, isPass: null, nonNumeric: null,
      };
    }
  } else if (!single && manualQty === null && nonEmpty.length === 0) {
    return {
      judged: false, specValid: parsed.valid, specReason: parsed.reason || null,
      specMin: parsed.lsl ?? null, specMax: parsed.usl ?? null,
      outCount: 0, measuredCount: 0, defectQty: null, isPass: null, nonNumeric: null,
    };
  }

  let outCount = 0;
  let nonNumeric = null;
  for (const v of nonEmpty) {
    if (toNumber(v) === null) { nonNumeric = String(v); continue; }
    if (isOutOfSpec(v, parsed)) outCount++;
  }

  // 不良数：尺寸类自动算（超差个数）；非尺寸类用录入值，定性项 NG 记 1 件
  let defectQty;
  if (isMeasure) {
    defectQty = outCount;
  } else if (Number.isFinite(manualQty)) {
    defectQty = manualQty;
  } else if (rec.valueType === 'attribute') {
    defectQty = single.toUpperCase() === 'NG' ? 1 : 0;
  } else {
    defectQty = outCount;
  }

  return {
    judged: true,
    specValid: parsed.valid,
    specReason: parsed.reason || null,
    specMin: parsed.lsl ?? null,
    specMax: parsed.usl ?? null,
    outCount,
    measuredCount: nonEmpty.length,
    defectQty,
    isPass: defectQty <= acNum,
    nonNumeric,
  };
}

/** 批次判定（§6.5）：任一 NG → fail；未判定项不参与推导，但会被提交校验拦住 */
export function judgeBatch(items = []) {
  // ⚠️ 兼容两种字段名：模板层用 camelCase（isPass），记录层落库是 snake_case（is_pass）。
  // 只读一种会让"已判定为 NG"的行被当成未判定而被过滤掉 → 整批被误判合格（端到端测试踩到）。
  const passOf = (it) => (it.isPass !== undefined && it.isPass !== null ? it.isPass : it.is_pass);
  const judged = items.filter((it) => passOf(it) !== null && passOf(it) !== undefined);
  const ngItems = judged.filter((it) => passOf(it) === false);
  const unjudged = items.filter((it) => passOf(it) === null || passOf(it) === undefined);
  return {
    // 全部未判定 → 不给结论（null），绝不返回 pass 让上层误以为"合格"
    result: ngItems.length > 0 ? 'fail' : (judged.length === 0 ? null : 'pass'),
    ngCount: ngItems.length,
    total: items.length,
    unjudgedCount: unjudged.length,
    ngNames: ngItems.map((it) => it.item_name || it.itemName).filter(Boolean),
  };
}

export const DEFECT_TYPES = ['包装', '外观', '尺寸', '功能', '安规', '可靠性', '环保', '无检验资料'];

/** 历史英文值归一（§3.3.4 🔒） */
export function normalizeDefectType(v) {
  const map = {
    packaging: '包装', appearance: '外观', dimension: '尺寸', function: '功能',
    safety: '安规', reliability: '可靠性', environmental: '环保', no_data: '无检验资料',
  };
  const raw = String(v ?? '').trim();
  if (!raw) return null;
  return DEFECT_TYPES.includes(raw) ? raw : (map[raw.toLowerCase()] || null);
}

export { toNumber };
