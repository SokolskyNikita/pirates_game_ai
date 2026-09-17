import { describe, expect, it } from 'vitest';
import type { Policy, RegionYear } from '../api/types';
import { policyDecisions } from './policy-decisions';

const policy = {
  id: 'test', label: 'test', pace: 0, replacement: 0, welfareScale: 1,
  benefitFormula: 'current', laborTax: 0.2, capitalTax: 0.2, allowFreeTrade: true,
} as Policy;
const end = {
  baselineBenefits: 100, benefitsRequired: 100, benefitsPaid: 100,
  benefitsScalePaid: 1, effectiveLaborTax: 0.2, effectiveCapitalTax: 0.2,
  retainedWorkers: 0,
} as RegionYear;

describe('pause policy presentation', () => {
  for (const region of ['us', 'foreign'] as const) {
    it(`shows None for ${region} employer retention during a pause`, () => {
      const html = policyDecisions(policy, end, { region, mode: 'strategic' });
      expect(html).toContain('>None</h');
      expect(html).toContain('Employer retention is fixed to None when AI is paused.');
      expect(html).toContain('Workers can still be displaced by foreign competition');
      expect(html).not.toContain('Retain at');
    });
  }
  it('preserves wage-retention choices when AI continues', () => {
    const html = policyDecisions({ ...policy, pace: 1, replacement: 1 }, end, { region: 'us', mode: 'us-only' });
    expect(html).toContain('Retain at 100%');
    expect(html).not.toContain('>None</h');
  });
});
