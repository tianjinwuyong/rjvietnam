export type WorkOrderType = 1 | 2 | 3;

export type WorkOrderCodeInput = {
  date: Date;
  workOrderType: WorkOrderType;
  lineCode: string;
  serialNo?: number;
};

const WORK_ORDER_CODE_PATTERN = /^\d{11}$/;
const WORK_ORDER_CODE_LENGTH = 11;

// ── In-memory serial counter ───────────────────────────────────────
// Keyed by "YYMMtypeLineCode" — auto-increments per month/type/line.
// Resets when the calendar month changes (rule 3.2.4).

const serialCounters = new Map<string, number>();
let lastCounterMonth = "";

/** Reset all serial counters — called on month boundary or for testing. */
export function resetSerialCounters(): void {
  serialCounters.clear();
  lastCounterMonth = "";
}

/**
 * Get the next serial number for the given date, work order type and line.
 * Automatically resets all counters when the month changes.
 */
export function getNextSerial(
  date: Date,
  workOrderType: WorkOrderType,
  lineCode: string,
): number {
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const currentMonth = `${yy}${mm}`;
  const normalizedLine = normalizeNumericLineCode(lineCode);
  const key = `${currentMonth}${workOrderType}${normalizedLine}`;

  // Reset all counters when month changes (rule 3.2.4)
  if (lastCounterMonth !== "" && lastCounterMonth !== currentMonth) {
    serialCounters.clear();
  }
  lastCounterMonth = currentMonth;

  const next = (serialCounters.get(key) ?? 0) + 1;
  serialCounters.set(key, next);
  return next;
}

export function normalizeNumericLineCode(lineCode: string): string {
  const numeric = lineCode.trim().match(/\d+/)?.[0] ?? "";
  if (!numeric) {
    throw new Error("lineCode must contain a numeric production line code");
  }

  return numeric.padStart(2, "0").slice(-2);
}

export function generateWorkOrderCode(input: WorkOrderCodeInput): string {
  const yy = String(input.date.getFullYear()).slice(-2);
  const mm = String(input.date.getMonth() + 1).padStart(2, "0");
  const lineCode = normalizeNumericLineCode(input.lineCode);

  // Auto-generate serial if not provided (rule 3.2.3, 3.2.4)
  const serialNo = input.serialNo ?? getNextSerial(input.date, input.workOrderType, input.lineCode);

  if (input.serialNo !== undefined) {
    if (!Number.isInteger(input.serialNo) || input.serialNo < 1 || input.serialNo > 9999) {
      throw new Error("serialNo must be an integer from 1 to 9999");
    }
  }

  const serialStr = String(serialNo).padStart(4, "0");
  return `${yy}${mm}${input.workOrderType}${lineCode}${serialStr}`;
}

export function validateWorkOrderCode(code: string): boolean {
  return typeof code === "string" && code.length === WORK_ORDER_CODE_LENGTH && WORK_ORDER_CODE_PATTERN.test(code);
}

export function explainWorkOrderCode(code: string) {
  if (!validateWorkOrderCode(code)) {
    throw new Error("work order code must be 11 numeric digits");
  }

  return {
    year: Number(`20${code.slice(0, 2)}`),
    month: Number(code.slice(2, 4)),
    workOrderType: Number(code.slice(4, 5)) as WorkOrderType,
    lineCode: code.slice(5, 7),
    serialNo: Number(code.slice(7, 11)),
  };
}

/** Placeholder: a work order code is considered voided if the system marks it so. */
export function isVoidedCode(_code: string): boolean {
  return false;
}
