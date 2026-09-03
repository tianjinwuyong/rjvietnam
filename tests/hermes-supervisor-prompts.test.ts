import { describe, expect, it } from 'vitest';
import { buildHermesSupervisorPrompt, hermesPromptProfile } from '../services/api/src/virtual-employees/hermes-supervisor.js';

describe('Hermes supervisor prompts', () => {
  it('builds a governed replenishment prompt with supplied facts', () => {
    const prompt = buildHermesSupervisorPrompt({
      operation: 'replenish',
      now: '2026-09-03T08:00:00.000Z',
      context: { materialCode: 'MAT-001', availableQty: 20, safetyStockQty: 50 },
    });
    expect(prompt).toContain('OPS-SUPERVISOR-VIRTUAL-01');
    expect(prompt).toContain('OPERATION: replenish');
    expect(prompt).toContain('MAT-001');
    expect(prompt).toContain('正式PO等待人工批准');
  });

  it('publishes a stable profile and rejects unknown operations', () => {
    expect(hermesPromptProfile()).toMatchObject({ id: 'HERMES_OPS_SUPERVISOR_V1', version: '1.0.0' });
    expect(() => buildHermesSupervisorPrompt({ operation: 'delete-everything' })).toThrow('Unsupported Hermes operation');
  });

  it('rejects oversized context', () => {
    expect(() => buildHermesSupervisorPrompt({ context: { raw: 'x'.repeat(100_001) } })).toThrow('exceeds 100000');
  });
});
