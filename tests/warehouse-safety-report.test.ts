import { describe, expect, it } from 'vitest';
import { classifySafetyStock, safetyReportTaskKey } from '../services/api/src/virtual-employees/warehouse-safety-report.js';

describe('warehouse safety-stock report', () => {
  it('classifies shortage severity deterministically', () => {
    expect(classifySafetyStock({ availableQty: 0, minStockQty: 10, safetyStockQty: 20 })).toBe('P3');
    expect(classifySafetyStock({ availableQty: 10, minStockQty: 10, safetyStockQty: 20 })).toBe('P3');
    expect(classifySafetyStock({ availableQty: 15, minStockQty: 10, safetyStockQty: 20 })).toBe('P2');
    expect(classifySafetyStock({ availableQty: 30, minStockQty: 10, safetyStockQty: 20 })).toBe('P1');
  });

  it('creates a stable recipient report key per time bucket', () => {
    expect(safetyReportTaskKey('pmc-virtual-01', '2026-09-03T08')).toBe('SAFETY_STOCK_REPORT:2026-09-03T08:PMC-VIRTUAL-01');
  });
});
