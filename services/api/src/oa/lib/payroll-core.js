/**
 * 越南工厂计薪核心算法库（纯函数，无任何外部依赖）
 * ============================================================
 * 单一事实来源：服务端 attendance-band.js / salary-engine-v2.js 与前端试算台
 * 都从这里取算法。浏览器版由 tools/build-payroll-core-browser.mjs 自动生成，
 * 禁止手工复制——一旦出现第二份实现，两边的数就会漂移。
 *
 * 口径依据：方案 v1.4（deliverables/gstack/design-越南工资架构与时段计薪-2026-10-26.md）
 *   - 月薪制：应发 = G + H × (W − B) + 津贴
 *   - H = G ÷ 208（固定分母，不随月份浮动）
 *   - B = 当月应出勤正班工时（按日封顶 8h 累加，不封 208）
 *   - W = Σ(各段计薪工时 × 采用倍率)
 *   - 采用倍率 = MAX(表内倍率, 法定下限)
 *
 * 时间轴：以「归属日 00:00」为 0 的分钟偏移，取值 0..2880。
 *   跨午夜班次的 outMin > 1440；整班归属「起班当天」的日历属性，不在午夜切分。
 */

// ============================================================
// 一、班次定义（2026-10-27 用户澄清：实际只有两种 12 小时班）
// ============================================================
// 白班 08:00-20:00：8 小时正班（① 08:00-16:30）+ 3 小时延时（④ 17:00-20:00）
// 夜班 20:00-08:00：8 小时正班（② 20:00-22:00 + ③ 22:00-04:30）+ 3 小时加班（05:00-08:00）
// 两者都是「12 小时跨度 / 扣 1 小时用餐 / 11 小时计薪 / 其中 8 小时计入正班配额」。
//
// 特殊情况会推迟下班（白班延到 22:00 甚至更晚，夜班同理）。延时部分必须**继续按加班**
// 计价，不能退回正班倍率——这就是时段必须带 shiftType 的原因。
export const SHIFT_DEFS = [
  { code: 'day',   name: '白班', nameVi: 'Ca ngày', start: '08:00', end: '20:00', crossDay: false, shiftType: 'day'   },
  { code: 'night', name: '夜班', nameVi: 'Ca đêm',  start: '20:00', end: '08:00', crossDay: true,  shiftType: 'night' }
];

// ============================================================
// 二、时段字典（按「班次 × 日型」定义）
// ============================================================
// shiftType：'day' 只给白班用 / 'night' 只给夜班用 / 'any' 两个班次通用。
//
// 为什么工作日必须分班次：同一个钟点 20:00-22:00，对夜班是「正班前 2 小时」（1.0），
// 对白班是「延时加班」（1.5）；22:00 之后，对夜班仍是正班（1.3，只含夜班津贴），
// 对白班则是夜间加班（2.15 = 1.5×1.3+0.2）。只按钟点分，两种情况必然有一种算错。
//
// 周日/假日不需要分班次：越南口径是「整日按日型倍率」，加班与否不再叠加，
// 所以 ⑦⑨ 覆盖 06:00-22:00 一段到底，⑧⑩ 覆盖 22:00-06:00，两个班次通用。
//
// standardHours 仅用于自检（段跨度 − 用餐交叠），不参与计算。
export const DEFAULT_BANDS = [
  // ---- 白班 · 工作日 ----
  { seq: 1,  code: '①', shiftType: 'day',   dayKind: 'workday', name: '白班·正班 08:00-16:30',     start: '08:00', end: '16:30', crossDay: false, standardHours: 8.0,  tableRate: 1.00, legalMinRate: 1.0, exemptA: 0.00, exemptB: 0.00, isOt: false, countsTowardOtCap: false },
  { seq: 2,  code: '④', shiftType: 'day',   dayKind: 'workday', name: '白班·延时 16:30-20:00',     start: '16:30', end: '20:00', crossDay: false, standardHours: 3.0,  tableRate: 1.50, legalMinRate: 1.5, exemptA: 0.50, exemptB: 1.50, isOt: true,  countsTowardOtCap: true  },
  { seq: 3,  code: '⑪', shiftType: 'day',   dayKind: 'workday', name: '白班·延到深夜 20:00-22:00', start: '20:00', end: '22:00', crossDay: false, standardHours: 2.0,  tableRate: 1.50, legalMinRate: 1.5, exemptA: 0.50, exemptB: 1.50, isOt: true,  countsTowardOtCap: true  },
  { seq: 4,  code: '⑫', shiftType: 'day',   dayKind: 'workday', name: '白班·延到凌晨 22:00-06:00', start: '22:00', end: '06:00', crossDay: true,  standardHours: 7.0,  tableRate: 2.15, legalMinRate: 2.1, exemptA: 1.15, exemptB: 2.15, isOt: true,  countsTowardOtCap: true  },
  { seq: 5,  code: '⑬', shiftType: 'day',   dayKind: 'workday', name: '白班·凌晨延时 06:00-08:00', start: '06:00', end: '08:00', crossDay: false, standardHours: 2.0,  tableRate: 1.50, legalMinRate: 1.5, exemptA: 0.50, exemptB: 1.50, isOt: true,  countsTowardOtCap: true  },
  // ---- 夜班 · 工作日 ----
  { seq: 6,  code: '②', shiftType: 'night', dayKind: 'workday', name: '夜班·正班 20:00-22:00',     start: '20:00', end: '22:00', crossDay: false, standardHours: 2.0,  tableRate: 1.00, legalMinRate: 1.0, exemptA: 0.00, exemptB: 0.00, isOt: false, countsTowardOtCap: false },
  { seq: 7,  code: '③', shiftType: 'night', dayKind: 'workday', name: '夜班·正班 22:00-04:30',     start: '22:00', end: '04:30', crossDay: true,  standardHours: 6.0,  tableRate: 1.30, legalMinRate: 1.3, exemptA: 0.30, exemptB: 0.30, isOt: false, countsTowardOtCap: false },
  { seq: 8,  code: '⑤', shiftType: 'night', dayKind: 'workday', name: '夜班·加班 04:30-06:00',     start: '04:30', end: '06:00', crossDay: false, standardHours: 1.0,  tableRate: 2.15, legalMinRate: 2.1, exemptA: 1.15, exemptB: 2.15, isOt: true,  countsTowardOtCap: true  },
  { seq: 9,  code: '⑥', shiftType: 'night', dayKind: 'workday', name: '夜班·加班 06:00-08:00',     start: '06:00', end: '08:00', crossDay: false, standardHours: 2.0,  tableRate: 1.50, legalMinRate: 1.5, exemptA: 0.50, exemptB: 1.50, isOt: true,  countsTowardOtCap: true  },
  { seq: 10, code: '⑭', shiftType: 'night', dayKind: 'workday', name: '夜班·延到白天 08:00-20:00', start: '08:00', end: '20:00', crossDay: false, standardHours: 11.0, tableRate: 1.50, legalMinRate: 1.5, exemptA: 0.50, exemptB: 1.50, isOt: true,  countsTowardOtCap: true  },
  // ---- 周日 / 法定假日：与班次无关 ----
  { seq: 11, code: '⑦', shiftType: 'any',   dayKind: 'sunday',  name: '周日·日间 06:00-22:00',     start: '06:00', end: '22:00', crossDay: false, standardHours: 15.0, tableRate: 2.00, legalMinRate: 2.0, exemptA: 1.00, exemptB: 2.00, isOt: true,  countsTowardOtCap: true  },
  { seq: 12, code: '⑧', shiftType: 'any',   dayKind: 'sunday',  name: '周日·夜间 22:00-06:00',     start: '22:00', end: '06:00', crossDay: true,  standardHours: 7.0,  tableRate: 2.80, legalMinRate: 2.7, exemptA: 1.80, exemptB: 2.80, isOt: true,  countsTowardOtCap: true  },
  { seq: 13, code: '⑨', shiftType: 'any',   dayKind: 'holiday', name: '法定假日·日间 06:00-22:00', start: '06:00', end: '22:00', crossDay: false, standardHours: 15.0, tableRate: 3.00, legalMinRate: 3.0, exemptA: 2.00, exemptB: 3.00, isOt: true,  countsTowardOtCap: true  },
  { seq: 14, code: '⑩', shiftType: 'any',   dayKind: 'holiday', name: '法定假日·夜间 22:00-06:00', start: '22:00', end: '06:00', crossDay: true,  standardHours: 7.0,  tableRate: 4.10, legalMinRate: 3.9, exemptA: 3.10, exemptB: 4.10, isOt: true,  countsTowardOtCap: true  }
];

// ============================================================
// 二·补、旧版十段（只用于回归对照，不再参与计算）
// ============================================================
// 保留它是为了证明「新表在标准 12 小时班下与旧十段逐段等价」——
// 见 assertStandardShiftMatchesLegacy()。一旦不等价，说明新表改坏了。
export const LEGACY_BANDS = [
  { seq: 1,  code: '①', shiftType: 'any', name: '周一至周六·白班 08:00-16:30',   dayKind: 'workday', start: '08:00', end: '16:30', crossDay: false, standardHours: 8.0,  tableRate: 1.00, legalMinRate: 1.0, exemptA: 0.00, exemptB: 0.00, isOt: false, countsTowardOtCap: false },
  { seq: 2,  code: '②', shiftType: 'any', name: '周一至周六·晚间 20:00-22:00',   dayKind: 'workday', start: '20:00', end: '22:00', crossDay: false, standardHours: 2.0,  tableRate: 1.00, legalMinRate: 1.0, exemptA: 0.00, exemptB: 0.00, isOt: false, countsTowardOtCap: false },
  { seq: 3,  code: '③', shiftType: 'any', name: '周一至周六·夜班 22:00-04:30',   dayKind: 'workday', start: '22:00', end: '04:30', crossDay: true,  standardHours: 6.0,  tableRate: 1.30, legalMinRate: 1.3, exemptA: 0.30, exemptB: 0.30, isOt: false, countsTowardOtCap: false },
  { seq: 4,  code: '④', shiftType: 'any', name: '周一至周六·延时 16:30-20:00',   dayKind: 'workday', start: '16:30', end: '20:00', crossDay: false, standardHours: 3.0,  tableRate: 1.50, legalMinRate: 1.5, exemptA: 0.50, exemptB: 1.50, isOt: true,  countsTowardOtCap: true  },
  { seq: 5,  code: '⑤', shiftType: 'any', name: '周一至周六·夜间延时 05:00-06:00', dayKind: 'workday', start: '05:00', end: '06:00', crossDay: false, standardHours: 1.0,  tableRate: 2.15, legalMinRate: 2.1, exemptA: 1.15, exemptB: 2.15, isOt: true,  countsTowardOtCap: true  },
  { seq: 6,  code: '⑥', shiftType: 'any', name: '周一至周六·延时 06:00-08:00',   dayKind: 'workday', start: '06:00', end: '08:00', crossDay: false, standardHours: 2.0,  tableRate: 1.50, legalMinRate: 1.5, exemptA: 0.50, exemptB: 1.50, isOt: true,  countsTowardOtCap: true  },
  { seq: 7,  code: '⑦', shiftType: 'any', name: '周日·白班 08:00-22:00',        dayKind: 'sunday',  start: '08:00', end: '22:00', crossDay: false, standardHours: 13.0, tableRate: 2.00, legalMinRate: 2.0, exemptA: 1.00, exemptB: 2.00, isOt: true,  countsTowardOtCap: true  },
  { seq: 8,  code: '⑧', shiftType: 'any', name: '周日·夜间 22:00-06:00',        dayKind: 'sunday',  start: '22:00', end: '06:00', crossDay: true,  standardHours: 7.0,  tableRate: 2.80, legalMinRate: 2.7, exemptA: 1.80, exemptB: 2.80, isOt: true,  countsTowardOtCap: true  },
  { seq: 9,  code: '⑨', shiftType: 'any', name: '法定假日·白班 06:00-22:00',     dayKind: 'holiday', start: '06:00', end: '22:00', crossDay: false, standardHours: 15.0, tableRate: 3.00, legalMinRate: 3.0, exemptA: 2.00, exemptB: 3.00, isOt: true,  countsTowardOtCap: true  },
  { seq: 10, code: '⑩', shiftType: 'any', name: '法定假日·夜间 22:00-06:00',     dayKind: 'holiday', start: '22:00', end: '06:00', crossDay: true,  standardHours: 7.0,  tableRate: 4.10, legalMinRate: 3.9, exemptA: 3.10, exemptB: 4.10, isOt: true,  countsTowardOtCap: true  }
];

// ============================================================
// 二、默认不计薪用餐窗口（4 段）
// ============================================================
// 第 4 段 04:30-05:00 是关键：漏了它，跨 05:00 的周日/假日夜班每班多算 0.5h。
export const DEFAULT_MEALS = [
  { seq: 1, name: '午餐 11:30-12:00',   start: '11:30', end: '12:00', crossDay: false, minutes: 30 },
  { seq: 2, name: '晚餐 16:30-17:00',   start: '16:30', end: '17:00', crossDay: false, minutes: 30 },
  { seq: 3, name: '夜宵 23:30-00:00',   start: '23:30', end: '00:00', crossDay: true,  minutes: 30 },
  { seq: 4, name: '夜间餐 04:30-05:00', start: '04:30', end: '05:00', crossDay: false, minutes: 30 }
];

// ============================================================
// 三、基础工具
// ============================================================
const MIN_PER_DAY = 1440;
const EPS = 1e-9;

/** 'HH:MM' → 分钟数 */
export function timeToMinutes(hhmm) {
  if (typeof hhmm !== 'string') throw new TypeError('时间必须是 HH:MM 字符串：' + hhmm);
  const parts = hhmm.split(':');
  const h = Number(parts[0]);
  const m = Number(parts[1] || 0);
  if (!Number.isFinite(h) || !Number.isFinite(m)) throw new TypeError('时间格式非法：' + hhmm);
  return h * 60 + m;
}

/** 两个区间的交叠长度 */
function overlapLen(a1, a2, b1, b2) {
  const lo = Math.max(a1, b1);
  const hi = Math.min(a2, b2);
  return hi > lo ? hi - lo : 0;
}

/** 四舍五入到 n 位小数，规避 0.1+0.2 类浮点噪声 */
export function round(n, digits = 4) {
  const f = Math.pow(10, digits);
  return Math.round((n + Number.EPSILON) * f) / f;
}

/** 采用倍率 = MAX(表内倍率, 法定下限) */
export function adoptedRate(band) {
  return Math.max(Number(band.tableRate) || 0, Number(band.legalMinRate) || 0);
}

/** 取指定口径的免税系数 */
export function exemptFactor(band, mode = 'B') {
  return mode === 'A' ? (Number(band.exemptA) || 0) : (Number(band.exemptB) || 0);
}

// ============================================================
// 四、核心：单个班次实例的时段切片
// ============================================================
/**
 * 把一段实际出勤切成若干计薪时段。
 *
 * @param {object} shift
 *   @param {number} shift.inMin    上班时刻（相对归属日 00:00 的分钟，0..2880）
 *   @param {number} shift.outMin   下班时刻（跨午夜已 +1440；若 <= inMin 会自动再 +1440）
 *   @param {string} shift.dayKind  'workday' | 'sunday' | 'holiday' | 'rest'
 *   @param {string} [shift.shiftType]  'day'（白班）| 'night'（夜班）；不传则不过滤
 * @param {Array}  [shift.bands]   时段字典，默认 DEFAULT_BANDS
 * @param {Array}  [shift.meals]   用餐窗口，默认 DEFAULT_MEALS
 * @param {string} [shift.exemptMode='B']
 * @return {object} 切片结果
 */
export function sliceShift(shift) {
  const bands = shift.bands && shift.bands.length ? shift.bands : DEFAULT_BANDS;
  const meals = shift.meals && shift.meals.length ? shift.meals : DEFAULT_MEALS;
  const exemptMode = shift.exemptMode || 'B';
  const dayKind = shift.dayKind || 'workday';

  let inMin = Number(shift.inMin);
  let outMin = Number(shift.outMin);
  if (!Number.isFinite(inMin) || !Number.isFinite(outMin)) {
    throw new TypeError('inMin / outMin 必须是数字');
  }
  // 跨午夜：下班 <= 上班 → +24h
  while (outMin <= inMin + EPS) outMin += MIN_PER_DAY;
  const spanMin = outMin - inMin;

  // 只取「当天 × 本班次」的时段。整班归属起班当天的日历属性；
  // shiftType 用来区分同一个钟点在白班/夜班里含义不同的情况
  // （20:00-22:00：夜班是正班 1.0，白班延时是加班 1.5）。
  // 不传 shiftType 时不过滤，兼容旧版只有「按钟点」的时段表。
  const st = shift.shiftType || null;
  // 时段表里若含「班次专用」段，就必须明确告诉我是哪个班次。
  // 否则白班和夜班的同名钟点段会同时命中（如 08:00-20:00 既是白班全日段，
  // 也是夜班延到白天段），工时被翻倍且不易察觉。宁可报错，不可静默算错。
  if (!st && bands.some(b => b.dayKind === dayKind && (b.shiftType === 'day' || b.shiftType === 'night'))) {
    throw new TypeError('时段表含班次专用段，sliceShift 必须传 shiftType（day / night）');
  }
  const dayBands = bands.filter(b =>
    b.dayKind === dayKind &&
    (!st || !b.shiftType || b.shiftType === 'any' || b.shiftType === st)
  );

  // 桶：同一 band code 在轴上可能出现两次（跨日班次），必须合并——数据库有
  // UNIQUE(instance_id, band_code)，且合并后金额口径不变（倍率相同）。
  const bucket = new Map();

  // 遍历班次覆盖的每一个日基（正常 1 个；>24h 班次才有 2 个）
  const baseFrom = Math.floor(inMin / MIN_PER_DAY) * MIN_PER_DAY;
  const baseTo = Math.floor(outMin / MIN_PER_DAY) * MIN_PER_DAY;

  for (let base = baseFrom; base <= baseTo; base += MIN_PER_DAY) {
    for (const band of dayBands) {
      const s = timeToMinutes(band.start) + base;
      let e = timeToMinutes(band.end) + base;
      if (e <= s + EPS) e += MIN_PER_DAY; // crossDay 段

      const segLen = overlapLen(inMin, outMin, s, e);
      if (segLen <= EPS) continue;

      const segStart = Math.max(inMin, s);
      const segEnd = Math.min(outMin, e);

      // 该段内的用餐扣除：逐窗口求交叠，窗口也同样按日基展开
      let mealMin = 0;
      const mealDetail = [];
      for (const meal of meals) {
        const ms0 = timeToMinutes(meal.start);
        let me0 = timeToMinutes(meal.end);
        if (me0 <= ms0 + EPS) me0 += MIN_PER_DAY;

        // 用餐窗口相对"段所在那天"定位：用段起点所在日基做基准
        const mBase = Math.floor((segStart - MIN_PER_DAY + EPS) / MIN_PER_DAY) * MIN_PER_DAY;
        for (let mb = mBase; mb <= base + MIN_PER_DAY; mb += MIN_PER_DAY) {
          const m1 = ms0 + mb;
          const m2 = me0 + mb;
          const ov = overlapLen(segStart, segEnd, m1, m2);
          if (ov > EPS) {
            mealMin += ov;
            mealDetail.push({ seq: meal.seq, name: meal.name, minutes: ov });
          }
        }
      }
      // 用餐扣除不得超过段本身
      mealMin = Math.min(mealMin, segLen);

      const prev = bucket.get(band.code);
      if (prev) {
        prev.rawMin += segLen;
        prev.mealMin += mealMin;
        prev.mealDetail = prev.mealDetail.concat(mealDetail);
        prev.axisStart = Math.min(prev.axisStart, segStart);
        prev.axisEnd = Math.max(prev.axisEnd, segEnd);
      } else {
        bucket.set(band.code, {
          code: band.code,
          seq: band.seq,
          name: band.name,
          dayKind,
          shiftType: band.shiftType || 'any',
          axisStart: segStart,
          axisEnd: segEnd,
          rawMin: segLen,
          mealMin,
          mealDetail,
          rate: adoptedRate(band),
          exemptFactor: exemptFactor(band, exemptMode),
          isOt: !!band.isOt,
          countsTowardOtCap: !!band.countsTowardOtCap
        });
      }
    }
  }

  // 未落入任何时段的出勤（如 04:30-05:00 这类"真空档"外的时刻）必须报出来，
  // 不能静默丢掉——静默丢工时会变成少发钱且查不出原因。
  const segments = [...bucket.values()].sort((a, b) => a.seq - b.seq).map(s => {
    const rawHours = round(s.rawMin / 60);
    const mealHours = round(s.mealMin / 60);
    // 用「未四舍五入的计薪工时」乘倍率，避免 2.6667×1.5=4.0001 这类误差被放大后一路带进 W
    const payableExact = Math.max(0, s.rawMin - s.mealMin) / 60;
    const payableHours = round(payableExact);
    return {
      code: s.code,
      seq: s.seq,
      name: s.name,
      dayKind: s.dayKind,
      shiftType: s.shiftType,
      segStartMin: Math.round(s.axisStart),
      segEndMin: Math.round(s.axisEnd),
      rawHours,
      mealHours,
      payableHours,
      adoptedRate: s.rate,
      convertedHours: round(payableExact * s.rate),
      exemptHours: round(payableExact * s.exemptFactor),
      isOt: s.isOt,
      countsTowardOtCap: s.countsTowardOtCap,
      mealDetail: s.mealDetail.map(m => ({ seq: m.seq, name: m.name, hours: round(m.minutes / 60) }))
    };
  });

  const coveredMin = segments.reduce((a, s) => a + Math.round(s.rawHours * 60), 0);
  const uncoveredMin = Math.round(spanMin - coveredMin);

  const payableHours = round(segments.reduce((a, s) => a + s.payableHours, 0));
  const convertedHours = round(segments.reduce((a, s) => a + s.convertedHours, 0));
  const exemptHours = round(segments.reduce((a, s) => a + s.exemptHours, 0));
  const otHours = round(segments.filter(s => s.isOt).reduce((a, s) => a + s.payableHours, 0));

  // 首段 / 尾段倍率：迟到按首段倍率、早退按尾段倍率折成折算工时
  // （早退砍掉的是班次尾部的加班，1 小时就是 1.5 倍，不是 1.0 倍）
  const paid = segments.filter(s => s.payableHours > 0);
  const headRate = paid.length
    ? paid.reduce((a, s) => (s.segStartMin < a.segStartMin ? s : a)).adoptedRate : 1;
  const tailRate = paid.length
    ? paid.reduce((a, s) => (s.segEndMin > a.segEndMin ? s : a)).adoptedRate : 1;

  return {
    dayKind,
    shiftType: st,
    spanMinutes: Math.round(spanMin),
    spanHours: round(spanMin / 60),
    segments,
    payableHours,
    convertedHours,
    exemptHours,
    otHours,
    headRate,
    tailRate,
    uncoveredMinutes: uncoveredMin,
    uncoveredWarning: uncoveredMin > 0
      ? '有 ' + (uncoveredMin / 60).toFixed(2) + ' 小时不在任何计薪时段内，请检查时段设置是否有空档'
      : null
  };
}

// ============================================================
// 五、迟到 / 早退阶梯
// ============================================================
/**
 * 迟到惩罚工时（公司口径，v1.4 §5.7）
 *   ≤5 分钟       → 0
 *   6–30 分钟     → 0.5h
 *   31–60 分钟    → 1.0h
 *   61 分钟以上   → 1.0h + 每满 30 分 +0.5h，单日封顶 4h
 */
export function latePenaltyHours(lateMinutes) {
  const m = Math.max(0, Math.round(Number(lateMinutes) || 0));
  if (m <= 5) return 0;
  if (m <= 30) return 0.5;
  if (m <= 60) return 1.0;
  const extra = Math.floor((m - 60) / 30) * 0.5;
  return Math.min(4.0, round(1.0 + extra, 2));
}

/**
 * 把「惩罚工时」落成当日实际折算工时。
 *
 * 关键：迟到本身已经让实际工时变少了，直接再从 W 里减惩罚工时就是重复扣款。
 * 正确做法 = 自然折算 − MAX(0, 惩罚工时 − 实际短缺工时)
 *
 * @param {number} naturalConverted 按打卡算出的当日折算工时（已经含迟到造成的减少）
 * @param {number} expectedPayable  当日应出勤计薪工时（按班次标准，如 8）
 * @param {number} penaltyHours     阶梯算出的惩罚工时
 */
/**
 * 早退惩罚工时（2026-10-27 新增，公司口径）
 *   未提前        → 0
 *   1–30 分钟     → 0.5h
 *   31–60 分钟    → 1.0h
 *   60 分钟以上   → 1.0h + 每满 30 分 +0.5h，单日封顶 4h
 *
 * 注意与迟到的差别：早退**没有 5 分钟宽限**——只要提前下班就至少少算半小时。
 */
export function earlyPenaltyHours(earlyMinutes) {
  const m = Math.max(0, Math.round(Number(earlyMinutes) || 0));
  if (m <= 0) return 0;
  if (m <= 30) return 0.5;
  if (m <= 60) return 1.0;
  const extra = Math.floor((m - 60) / 30) * 0.5;
  return Math.min(4.0, round(1.0 + extra, 2));
}

/**
 * 把「惩罚工时」落成当日折算工时（迟到 / 早退共用一套，v2 起统一）。
 *
 * 关键点一：惩罚工时必须乘该处倍率，因为扣的是「折算工时」而不是「钟点」。
 *   早退砍掉的是班次尾部（白班 ④ 1.5、夜班 ⑥ 1.5），所以「少算半小时」
 *   实际等于 0.5 × 1.5 = 0.75 折算工时；迟到砍的是班次头部（① / ② 都是 1.0），
 *   乘 1.0 后正是「少算半小时」。用 1.0 一刀切，早退就会少扣 1/3。
 *
 * 关键点二：必须减掉「自然短缺」，否则同一天被扣两次。
 *   W_日 = 自然折算 − MAX(0, 惩罚折算 − 自然短缺折算)
 *
 * @param {object} p
 *   @param {number} p.naturalConverted  按实际打卡算出的当日折算工时
 *   @param {number} p.expectedConverted 按计划班次算出的当日折算工时
 *   @param {number} p.penaltyHours      阶梯算出的惩罚工时（钟点口径）
 *   @param {number} [p.cutRate=1]       被砍位置的倍率（早退传 tailRate，迟到传 headRate）
 */
export function applyPunctualityPenalty({ naturalConverted, expectedConverted, penaltyHours, cutRate = 1 }) {
  const natural = Number(naturalConverted) || 0;
  const expected = Number(expectedConverted) || 0;
  const pen = Number(penaltyHours) || 0;
  const rate = Number(cutRate) || 1;
  if (!pen) {
    return { converted: round(natural), penaltyConverted: 0, shortfall: 0, extraDeduct: 0, cutRate: rate };
  }
  const penaltyConverted = round(pen * rate);
  const shortfall = round(Math.max(0, expected - natural));
  const extraDeduct = round(Math.max(0, penaltyConverted - shortfall));
  return {
    converted: round(Math.max(0, natural - extraDeduct)),
    penaltyConverted,
    shortfall,
    extraDeduct,
    cutRate: rate
  };
}

/**
 * 迟到惩罚（旧签名，等价于 cutRate = 1 的统一口径）。
 * 新代码请直接用 applyPunctualityPenalty，把 sliceShift 返回的 headRate 传进来。
 */
export function applyLatePenalty(naturalConverted, expectedPayable, penaltyHours, cutRate = 1) {
  return applyPunctualityPenalty({
    naturalConverted, expectedConverted: expectedPayable, penaltyHours, cutRate
  }).converted;
}

// ============================================================
// 六、月度：正班配额 B、折算工时 W、应发
// ============================================================
/**
 * 正班配额 B = 当月应出勤正班工时。
 * 「应出勤」与打卡无关：日历上是工作日且排了班，就计入；按日封顶 8h；不封 208。
 * 这是 v1.4 的核心改动——B 不再取「实际出勤」，缺勤才会由 W−B 自动变负。
 *
 * @param {object} p
 *   @param {number} p.workdayCount 当月工作日天数（日历 workday）
 *   @param {number} [p.stdHoursPerDay=8]
 *   @param {number|null} [p.capHours=null] 若设 208 则 B 封顶（对齐"按天递增"口径）
 */
export function computeQuota({ workdayCount, stdHoursPerDay = 8, capHours = null }) {
  let b = (Number(workdayCount) || 0) * (Number(stdHoursPerDay) || 8);
  if (capHours != null && Number.isFinite(Number(capHours)) && Number(capHours) > 0) {
    b = Math.min(b, Number(capHours));
  }
  return round(b);
}

/**
 * 月度应发
 *
 *   G = 基本工资 + 岗位津贴（in_hourly_base 的项）
 *   H = G ÷ 208
 *   B = 应出勤正班工时
 *   W = Σ 折算工时（含带薪假补记）
 *   应发 = G + H × (W − B) + 不计时津贴
 *
 * @param {object} p
 *   @param {number} p.G              月薪基数
 *   @param {number} p.B              应出勤正班工时
 *   @param {number} p.W              实际折算工时合计（不含带薪假）
 *   @param {number} [p.paidLeaveHours=0]  带薪假补记工时（已按 1.0 倍）
 *   @param {number} [p.allowance=0]  不计时津贴（固定额，不参与折算）
 *   @param {number} [p.hourlyDenominator=208]
 */
export function computeMonthSalary({
  G, B, W, paidLeaveHours = 0, allowance = 0, hourlyDenominator = 208
}) {
  const g = Number(G) || 0;
  const denom = Number(hourlyDenominator) || 208;
  const H = denom > 0 ? g / denom : 0;
  const wEff = round((Number(W) || 0) + (Number(paidLeaveHours) || 0));
  const b = Number(B) || 0;
  const deltaHours = round(wEff - b);
  const deltaPay = round(H * deltaHours);
  const gross = round(g + deltaPay + (Number(allowance) || 0), 2);

  return {
    G: round(g, 2),
    hourRate: round(H, 6),
    dayRate: round(H * 8, 2),
    B: round(b),
    W: wEff,
    WActual: round(Number(W) || 0),
    paidLeaveHours: round(Number(paidLeaveHours) || 0),
    deltaHours,
    deltaPay,
    allowance: round(Number(allowance) || 0, 2),
    gross,
    // 供界面解释用
    explain: buildExplain({ g, H, b, wEff, paidLeaveHours, deltaHours, deltaPay, allowance, gross })
  };
}

function buildExplain({ g, H, b, wEff, paidLeaveHours, deltaHours, deltaPay, allowance, gross }) {
  const fmt = n => Math.round(n).toLocaleString('en-US');
  const lines = [];
  lines.push('月薪基数 G = ' + fmt(g) + ' 越盾（时薪 H = G ÷ 208 = ' + H.toFixed(2) + '）');
  lines.push('应出勤 B = ' + b.toFixed(1) + ' 小时' + (paidLeaveHours > 0 ? '；带薪假补记 ' + paidLeaveHours + ' 小时' : ''));
  lines.push('实际折算 W = ' + wEff.toFixed(2) + ' 小时 → 差额 ' + (deltaHours >= 0 ? '+' : '') + deltaHours.toFixed(2) + ' 小时');
  lines.push('差额工资 = H × 差额 = ' + (deltaPay >= 0 ? '+' : '') + fmt(deltaPay));
  if (allowance) lines.push('不计时津贴 = +' + fmt(allowance));
  lines.push('应发 = ' + fmt(g) + (deltaPay >= 0 ? ' + ' : ' − ') + fmt(Math.abs(deltaPay)) + (allowance ? ' + ' + fmt(allowance) : '') + ' = ' + fmt(gross));
  return lines;
}

/**
 * 免税收入（越南个税口径）
 *   exemptIncome = H × Σ(计薪工时 × 免税系数)
 * 断言：免税收入不得超过「差额工资」为正时的金额（防止时段配置把正班也免税）
 */
export function computeExemptIncome({ H, exemptHours, deltaPay }) {
  const raw = round(H * (Number(exemptHours) || 0), 2);
  const cap = Math.max(0, Number(deltaPay) || 0);
  return {
    exemptIncome: round(Math.min(raw, cap), 2),
    rawExemptIncome: raw,
    capped: raw > cap + 0.01,
    warning: raw > cap + 0.01
      ? '免税工时对应的金额超过了差额工资，可能有时段把正班也设成了免税'
      : null
  };
}

// ============================================================
// 七、自检：段跨度 − 用餐交叠 必须等于 standardHours
// ============================================================
export function validateBandSeed(bands = DEFAULT_BANDS, meals = DEFAULT_MEALS) {
  const issues = [];
  for (const band of bands) {
    // 用一个覆盖满段的虚拟班次来测该段自身的计薪工时
    const s = timeToMinutes(band.start);
    let e = timeToMinutes(band.end);
    if (e <= s) e += MIN_PER_DAY;
    const r = sliceShift({
      inMin: s, outMin: e, dayKind: band.dayKind,
      shiftType: band.shiftType === 'any' ? null : band.shiftType,
      bands: [band], meals
    });
    const got = r.payableHours;
    if (Math.abs(got - band.standardHours) > 1e-6) {
      issues.push({
        code: band.code,
        expected: band.standardHours,
        actual: got,
        message: band.code + ' ' + band.name + ' 计薪工时应为 ' + band.standardHours + '，实算 ' + got
      });
    }
  }
  return { ok: issues.length === 0, issues };
}

/**
 * 回归对照：新版「班次相关」时段表，在标准 12 小时班下必须与旧十段逐段等价。
 *
 * 唯一允许的差异是「补齐旧表的空档」，且必须是单向变多：
 *   - 周日夜班 06:00-08:00：旧表无段可落（少 2h），新表按 ⑦ 2.0 补齐；
 *   - 白班延到 22:00 之后：旧表把 20:00-22:00 当 ② 1.0、22:00+ 当 ③ 1.3，
 *     新表按 ⑪ 1.5 / ⑫ 2.15 计价（旧表少算）。
 * 这几处**变多是对的**，因为旧表把它们当成了正班。
 */
export function assertStandardShiftMatchesLegacy() {
  const rows = [];
  const mk = (inT, outT, dayKind, shiftType, bands) => sliceShift({
    inMin: timeToMinutes(inT), outMin: timeToMinutes(outT), dayKind, shiftType, bands
  });

  const cases = [
    { name: '工作日·白班 08:00-20:00', in: '08:00', out: '20:00', dayKind: 'workday', shiftType: 'day' },
    { name: '工作日·夜班 20:00-08:00', in: '20:00', out: '08:00', dayKind: 'workday', shiftType: 'night' },
    { name: '周日·白班 08:00-20:00',   in: '08:00', out: '20:00', dayKind: 'sunday',  shiftType: 'day' },
    { name: '假日·白班 08:00-20:00',   in: '08:00', out: '20:00', dayKind: 'holiday', shiftType: 'day' }
  ];

  for (const c of cases) {
    const neu = mk(c.in, c.out, c.dayKind, c.shiftType, DEFAULT_BANDS);
    const old = mk(c.in, c.out, c.dayKind, null, LEGACY_BANDS);
    const dPay = round(neu.payableHours - old.payableHours);
    const dConv = round(neu.convertedHours - old.convertedHours);
    rows.push({
      name: c.name,
      newPayable: neu.payableHours, oldPayable: old.payableHours, deltaPayable: dPay,
      newConverted: neu.convertedHours, oldConverted: old.convertedHours, deltaConverted: dConv,
      ok: Math.abs(dPay) < 0.006 && Math.abs(dConv) < 0.006
    });
  }

  // 旧表的两处空档，新版必须补上（且只增不减）
  const oldSunNight = mk('20:00', '08:00', 'sunday', null, LEGACY_BANDS);
  const newSunNight = mk('20:00', '08:00', 'sunday', 'night', DEFAULT_BANDS);
  const gaps = [{
    name: '周日夜班 20:00-08:00（旧表 06:00-08:00 无段）',
    oldPayable: oldSunNight.payableHours,
    newPayable: newSunNight.payableHours,
    oldUncoveredMin: oldSunNight.uncoveredMinutes,
    newUncoveredMin: newSunNight.uncoveredMinutes,
    ok: newSunNight.payableHours > oldSunNight.payableHours && newSunNight.uncoveredMinutes === 0
  }];

  return { ok: rows.every(r => r.ok) && gaps.every(g => g.ok), cases: rows, gaps };
}

export const VERSION = '2.0.0';
