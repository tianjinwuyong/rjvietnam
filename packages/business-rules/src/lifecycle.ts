/**
 * lifecycle.ts — Component shelf-life & expiry math
 *
 * Formulas derived from the 仓库电子元器件寿命管参考 Excel:
 *
 *   到期日期 = 生产日期 + 封存有效期(月)          (I = F + H months)
 *   已使用时间(月) = DATEDIF(生产日期, TODAY(), "m")   (J = months elapsed)
 *   剩余寿命(月) = 封存有效期 - 已使用时间           (K = H - J)
 *   剩余天数 = 到期日期 - TODAY()                   (L = I - TODAY())
 *
 * Alert thresholds (based on remaining days L):
 *   L < 0       → EXPIRED     (超期隔离)
 *   0–30 days   → RED_L3      (三级预警 红色)
 *   31–90 days  → BLUE_L2     (二级预警 蓝色)
 *   91–180 days → YELLOW_L1  (一级预警 黄色)
 *   > 180 days  → NORMAL      (正常在用)
 */

export type AlertLevel = "EXPIRED" | "RED_L3" | "BLUE_L2" | "YELLOW_L1" | "NORMAL";

export interface LifecycleInput {
  /** 生产日期 — when the component was manufactured */
  manufacturingDate: Date | string;
  /** 封存有效期(月) — shelf life in sealed packaging, in months */
  shelfLifeMonths: number;
}

export interface LifecycleResult {
  /** ISO string of when this lot expires */
  expiryDate: string;
  /** Whole months elapsed since manufacturing */
  usedMonths: number;
  /** Remaining shelf life in months (can be negative = expired) */
  remainingMonths: number;
  /** Remaining shelf life in days (can be negative = overdue) */
  remainingDays: number;
  alertLevel: AlertLevel;
  statusLabel: string; // human-readable: "正常在用", "三级预警(红)", etc.
  statusColor: string;  // CSS color class: green, red, orange, yellow, blue
}

/** Threshold constants (days) */
const THRESHOLD_RED   = 0;   // expired if ≤ 0
const THRESHOLD_BLUE = 30;  // ≤ 30 days → red L3
const THRESHOLD_YELLOW = 90; // ≤ 90 days → blue L2
const THRESHOLD_NORMAL = 180; // ≤ 180 days → yellow L1

/** Approximate days per month (used for DATEDIF-equivalent) */
const DAYS_PER_MONTH = 30.44;

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

/**
 * Compute DATEDIF-equivalent: whole months between two dates.
 * Excel DATEDIF(start, end, "m") returns complete elapsed months.
 * For "m" unit, it counts month boundaries crossed, ignoring day-of-month.
 */
function monthsBetween(start: Date, end: Date): number {
  let months =
    (end.getFullYear() - start.getFullYear()) * 12 +
    (end.getMonth() - start.getMonth());
  // If end day < start day, the incomplete month doesn't count
  if (end.getDate() < start.getDate()) {
    months -= 1;
  }
  return Math.max(0, months);
}

/**
 * computeLifecycle — core pure function
 *
 * Mirrors Sheet1 columns F→I→J→K→L with alert logic in column P.
 */
export function computeLifecycle(input: LifecycleInput): LifecycleResult {
  const mfg = typeof input.manufacturingDate === "string"
    ? new Date(input.manufacturingDate)
    : input.manufacturingDate;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // I = F + H months
  const expiry = addMonths(mfg, input.shelfLifeMonths);

  // J = DATEDIF(F, TODAY(), "m") — complete months since manufacture
  const usedMonths = monthsBetween(mfg, today);

  // K = H - J
  const remainingMonths = input.shelfLifeMonths - usedMonths;

  // L = I - TODAY() in days
  const remainingDays = Math.round((expiry.getTime() - today.getTime()) / 86_400_000);

  // Alert level from L
  let alertLevel: AlertLevel;
  let statusLabel: string;
  let statusColor: string;

  if (remainingDays <= THRESHOLD_RED) {
    alertLevel = "EXPIRED";
    statusLabel = "超期隔离";
    statusColor = "red";
  } else if (remainingDays <= THRESHOLD_BLUE) {
    alertLevel = "RED_L3";
    statusLabel = "三级预警(红)";
    statusColor = "red";
  } else if (remainingDays <= THRESHOLD_YELLOW) {
    alertLevel = "BLUE_L2";
    statusLabel = "二级预警(蓝)";
    statusColor = "blue";
  } else if (remainingDays <= THRESHOLD_NORMAL) {
    alertLevel = "YELLOW_L1";
    statusLabel = "一级预警(黄)";
    statusColor = "yellow";
  } else {
    alertLevel = "NORMAL";
    statusLabel = "正常在用";
    statusColor = "green";
  }

  return {
    expiryDate: expiry.toISOString().slice(0, 10),
    usedMonths,
    remainingMonths,
    remainingDays,
    alertLevel,
    statusLabel,
    statusColor,
  };
}

/**
 * computeAllLotLifecycle — batch version for API use
 */
export function computeAllLotLifecycle(
  lots: Array<{
    manufacturingDate: Date | string;
    shelfLifeDays: number; // DB stores days; convert to months internally
  }>
): LifecycleResult[] {
  return lots.map((lot) =>
    computeLifecycle({
      manufacturingDate: lot.manufacturingDate,
      shelfLifeMonths: Math.round(lot.shelfLifeDays / DAYS_PER_MONTH),
    })
  );
}
