import { describe, expect, it } from 'vitest';
import { buildPutawayPath, evaluatePutawayLocation, PUTAWAY_RULES, rankPutawayLocations } from '../services/api/src/virtual-employees/putaway-recommendation.js';

const base = { code: 'A-01', status: 'active', warehouseStatus: 'ACTIVE', zoneStatus: 'ACTIVE', zoneType: 'STANDARD', allowPutaway: true, capacityQty: 100, occupiedQty: 40, maxPallets: 10, occupiedPallets: 2, msdAllowed: true };

describe('put-away recommendation', () => {
  it('blocks pending IQC goods from normal storage', () => {
    expect(evaluatePutawayLocation(base, { qty: 10, iqcStatus: 'pending' }).rejected).toContain('IQC_HOLD_ZONE_REQUIRED');
  });

  it('blocks capacity, dimensions and MSD violations', () => {
    const result = evaluatePutawayLocation({ ...base, zoneType: 'IQC_HOLD', capacityQty: 45, lengthCm: 100, widthCm: 80, heightCm: 50, msdAllowed: false }, { qty: 10, iqcStatus: 'hold', msdLevel: '3', lengthCm: 120, widthCm: 90, heightCm: 60 });
    expect(result.rejected).toEqual(expect.arrayContaining(['CAPACITY_EXCEEDED', 'MSD_NOT_ALLOWED', 'FOOTPRINT_EXCEEDED', 'HEIGHT_EXCEEDED']));
  });

  it('prefers a compliant same-material location', () => {
    const goods = { qty: 10, iqcStatus: 'released' };
    const ranked = rankPutawayLocations([{ ...base, code: 'B-01' }, { ...base, code: 'A-01', sameMaterialLots: 2 }], goods);
    expect(ranked[0].code).toBe('A-01');
    expect(ranked[0].reasons).toContain('SAME_MATERIAL_CONSOLIDATION');
  });

  it('returns an auditable hierarchy path and scan confirmation', () => {
    const path = buildPutawayPath({ code: 'BIN-01', warehouseCode: 'WH-A', zoneCode: 'IQC', aisleCode: 'A02', rackCode: 'R03', levelCode: 'L02', binCode: 'B01', xCoord: 12, yCoord: 9 }, { code: 'RECV-01', xCoord: 2, yCoord: 9 });
    expect(path.steps.map(step => step.type)).toEqual(['START', 'WAREHOUSE', 'ZONE', 'AISLE', 'RACK', 'LEVEL', 'BIN', 'SCAN_CONFIRM']);
    expect(path.estimatedDistance).toBe(10);
    expect(PUTAWAY_RULES.filter(rule => rule.type === 'HARD')).toHaveLength(5);
  });
});
