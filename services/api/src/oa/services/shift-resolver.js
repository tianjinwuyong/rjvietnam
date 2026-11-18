// ============================================================
// shift-resolver —— 班次输入的宽容解析：编码 / 中文名 / 越文名 → 编码
// ------------------------------------------------------------
// 为什么需要：
//   排班导入只认编码（day / night / regular_day / regular_night / rest），
//   而现场填表的人写的是「白班」「夜班」「Ca đêm」。改造前输入中文名 = 整行报
//   「班次编码不存在」，48 小时两班倒的厂里这个错误几乎每月都会出现一次。
//
// 口径（严格向后兼容）：
//   1) **编码优先**：命中 attendance_shift_def.code 且大小写一致 → 原样返回，
//      与改造前行为逐字节一致（不动任何已被接受的值）；
//   2) 否则按名称匹配（name / name_vi / name_en），大小写与空格不敏感；
//   3) 都不中 → null，由调用方报错（**不要**在这里猜或返回默认班次：
//      猜错等于给某人排错班，比报错难查一百倍）。
// ============================================================

/**
 * 归一化比较键：去空白、转小写、**折叠越南语声调**。
 * 折叠是因为现场越籍员工打字经常不带声调（「ca ngay」= 「Ca ngày」），
 * 带不带声调应当都认；đ 不在 NFD 分解范围（它是独立字母），单独替换。
 */
function key(s) {
  return String(s == null ? '' : s)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // 去掉组合用声调符号
    .replace(/đ/g, 'd')
    .replace(/[\s\u3000]+/g, '');
}

/**
 * @param {Array<{code:string,name?:string,name_vi?:string,name_en?:string}>} rows 班次定义
 * @returns {(input:any)=>string|null}
 */
export function makeShiftResolver(rows = []) {
  const codes = new Set();
  const alias = new Map();

  for (const r of rows) {
    if (!r || !r.code) continue;
    codes.add(r.code);
    alias.set(key(r.code), r.code);
    for (const n of [r.name, r.name_vi, r.name_en]) {
      if (!n) continue;
      const k = key(n);
      // 同一名称指向两个编码 = 配置冲突，保留先出现的（按 sort_order 排过序），
      // 不能静默覆盖，也不能抛错阻断导入 —— 记一条日志便于事后修配置。
      if (alias.has(k) && alias.get(k) !== r.code) {
        console.warn(`[shift-resolver] 名称「${n}」同时对应 ${alias.get(k)} 与 ${r.code}，按先出现的 ${alias.get(k)} 处理`);
        continue;
      }
      alias.set(k, r.code);
    }
  }

  // 休息：库里没有这一行（REST_CODE 是虚拟码），但下拉里会给人选
  for (const n of ['休息', '休', 'nghỉ', 'nghi', 'off', 'rest']) {
    if (!alias.has(key(n))) alias.set(key(n), 'rest');
  }

  return function resolve(input) {
    const raw = String(input == null ? '' : input).trim();
    if (!raw) return null;
    if (codes.has(raw)) return raw;          // ① 编码原样
    const hit = alias.get(key(raw));
    if (hit && (codes.has(hit) || hit === 'rest')) return hit;  // ② 名称/别名
    return null;
  };
}
