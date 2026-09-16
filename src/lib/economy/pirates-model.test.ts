import { describe, expect, it } from 'vitest';
import {
  analyzePayoffs, BASELINE_POLICY, DEFAULT_INPUTS, DISCOUNT_RATE, EQUILIBRIUM_TOLERANCE,
  INPUT_SPECS, normalizeInputs, POLICIES, scoreTrajectory, simulateProfile, solveModel,
  UTILITY_OFFSET, type ModelInputs, type Objective, type Policy,
} from './pirates-model';

const policy = (overrides: Partial<Policy> = {}): Policy => {
  const want = { pace: 1, replacement: 0, safetyNet: 0, workerTax: 0, tax: 0, ...overrides };
  return POLICIES.find(p => p.pace === want.pace && p.replacement === want.replacement
    && p.safetyNet === want.safetyNet && p.workerTax === want.workerTax && p.tax === want.tax)!;
};
const solo = (p: Policy, inputs: Partial<ModelInputs> = {}) =>
  simulateProfile({ ...DEFAULT_INPUTS, ...inputs }, p, undefined, 'us-only', 'prosperity', p.pace);

describe('Private retention and public support are distinct', () => {
  it('no adoption or taxes preserves the baseline exactly', () => {
    const r = simulateProfile(DEFAULT_INPUTS, BASELINE_POLICY, BASELINE_POLICY, 'strategic', 'prosperity', 0);
    for (const y of [...r.us, ...r.foreign!]) {
      expect(y.output).toBe(100);
      expect(y.workerIncome).toBe(64);
      expect(y.ownerIncome).toBe(36);
      expect(y.consumption).toBe(100);
      expect(y.employerPay + y.publicSupport + y.taxRevenue).toBe(0);
      expect(y.employedWorkers).toBe(1);
    }
  });

  it('retention keeps an obsolete role on payroll, transferring capital income without adding output', () => {
    const inputs = { investmentResponse: 0 };
    const layoff = solo(policy(), inputs);
    const retain = solo(policy({ replacement: 1 }), inputs);
    for (let t = 1; t <= 10; t++) {
      const a = layoff.us[t]!, b = retain.us[t]!;
      expect(b.output).toBe(a.output);
      expect(b.laborIncome).toBe(a.laborIncome);
      expect(b.totalLaborIncome).toBeCloseTo(b.laborIncome + b.employerPay, 11);
      expect(b.employerPay).toBeCloseTo(60 * b.unemployment, 11);
      expect(b.publicSupport).toBe(0);
      expect(b.taxRevenue).toBe(0);
      expect(b.retainedWorkers).toBe(b.unemployment);
      expect(b.laidOffWorkers).toBe(0);
      expect(b.employedWorkers).toBe(1);
      expect(a.laidOffWorkers).toBe(a.unemployment);
      expect(a.ownerIncome - b.ownerIncome).toBeCloseTo((1 - DEFAULT_INPUTS.workerOwnership) * b.employerPay, 10);
    }
  });

  it('a public floor supports laid-off workers without retaining their jobs', () => {
    const r = solo(policy({ safetyNet: 1, tax: 1 }), { investmentResponse: 0 });
    for (const y of r.us.slice(1)) {
      expect(y.employerPay).toBe(0);
      expect(y.retainedWorkers).toBe(0);
      expect(y.laidOffWorkers).toBe(y.unemployment);
      expect(y.publicSupportRatio).toBeCloseTo(1, 11);
      expect(y.netWageIncomeRatio).toBeCloseTo(1, 11);
      expect(y.supportCost).toBe(y.publicSupport);
    }
  });

  it('the public floor tops up net retained wages instead of paying the floor twice', () => {
    const r = solo(policy({ replacement: .5, safetyNet: 1, workerTax: .5, tax: 1 }), { investmentResponse: 0 });
    for (const y of r.us.slice(1)) {
      expect(y.employerPayRatio).toBeCloseTo(.5, 11);
      expect(y.employerNetPayRatio).toBeCloseTo(.25, 11);
      expect(y.publicSupportRatio).toBeCloseTo(.75, 11);
      expect(y.netWageIncomeRatio).toBeCloseTo(1, 11);
      expect(y.safetyNetRequired).toBeCloseTo(60 * y.unemployment * .75, 11);
    }
  });

  it('a 100% worker tax does not defeat the net public floor by taxing transfers recursively', () => {
    const r = solo(policy({ replacement: 1, safetyNet: 1, workerTax: 1, tax: 1 }), { investmentResponse: 0 });
    for (const y of r.us.slice(1)) {
      expect(y.employerPayRatio).toBeCloseTo(1, 11);
      expect(y.employerNetPayRatio).toBe(0);
      expect(y.publicSupportRatio).toBeCloseTo(1, 11);
      expect(y.workerTaxRevenue).toBeCloseTo(y.workerTaxBase, 11);
      expect(y.ownerTaxRevenue).toBeCloseTo(y.ownerTaxBase, 11);
      expect(y.netWageIncomeRatio).toBeCloseTo(1, 11);
    }
  });

  it('reports employer and public shortfalls without double-counting overlapping missing income', () => {
    const r = solo(policy({ replacement: 1.25, safetyNet: 1 }), {
      productivityGain: 0, displacement: 1, reemployment: 0, investmentResponse: 0, workerOwnership: 0,
    });
    const y = r.us[10]!;
    expect(y.employerFundingGap).toBeGreaterThan(0);
    expect(y.safetyNetFundingGap).toBeGreaterThan(0);
    expect(y.feasible).toBe(false);
    expect(y.ownerIncome).toBe(0);
    expect(y.publicSupport).toBe(0);
    expect(y.unfundedSupport).toBeCloseTo(75 - y.employerPay, 11);
    expect(y.unfundedSupport).toBeLessThan(y.employerFundingGap + y.safetyNetFundingGap);
    expect(Number.isFinite(r.usScore)).toBe(true);
  });
});

describe('Taxes, universal rebates and resource accounting', () => {
  it.each([.25, 1, 4])('conserves resources and international rents at foreign population %s', foreignMarketSize => {
    const r = simulateProfile({ ...DEFAULT_INPUTS, foreignMarketSize, capitalMobility: 1 },
      policy({ replacement: .5, safetyNet: 1, workerTax: .5, tax: 1 }),
      policy({ replacement: 1, safetyNet: .5, workerTax: 1, tax: .5 }), 'strategic', 'prosperity', 1);
    for (let t = 0; t <= 10; t++) {
      const a = r.us[t]!, b = r.foreign![t]!;
      expect(a.netRentFlow + foreignMarketSize * b.netRentFlow).toBeCloseTo(0, 10);
      for (const y of [a, b]) {
        expect(y.workerTaxRevenue + y.ownerTaxRevenue).toBeCloseTo(y.taxRevenue, 11);
        expect(y.publicSupport + y.totalDividend).toBeCloseTo(y.taxRevenue, 11);
        expect(y.workerDividend + y.ownerDividend).toBeCloseTo(y.totalDividend, 11);
        expect(y.workerIncome + y.ownerIncome).toBeCloseTo(y.output - y.investmentCost - y.adjustmentCost + y.netRentFlow, 10);
        expect(y.employedIncome + y.displacedIncome).toBeCloseTo(y.workerIncome, 11);
        expect(y.newlyDisplaced + y.longTermDisplaced).toBeCloseTo(y.unemployment, 11);
        expect(y.productiveWorkers + y.retainedWorkers + y.laidOffWorkers).toBeCloseTo(1, 11);
        expect(y.baselineTaxRevenue).toBe(0);
      }
    }
  });

  it('taxes both household bases once and gives every voter the same residual dividend', () => {
    const r = solo(policy({ replacement: .5, safetyNet: .5, workerTax: .5, tax: 1 }), { investmentResponse: 0, workerShare: .3 });
    for (const y of r.us.slice(1)) {
      expect(y.workerTaxBase).toBeCloseTo(y.laborIncome + y.employerPay + DEFAULT_INPUTS.workerOwnership * y.capitalAfterRetention, 11);
      expect(y.ownerTaxBase).toBeCloseTo((1 - DEFAULT_INPUTS.workerOwnership) * y.capitalAfterRetention, 11);
      expect(y.workerTaxRevenue).toBeCloseTo(.5 * y.workerTaxBase, 11);
      expect(y.ownerTaxRevenue).toBeCloseTo(y.ownerTaxBase, 11);
      expect(y.workerDividend / .3).toBeCloseTo(y.ownerDividend / .7, 11);
      expect(y.ownerIncome).toBeCloseTo(y.ownerDividend, 11);
    }
  });

  it('changing the public floor reallocates receipts without changing tax bases or total consumption', () => {
    const base = { replacement: .5, workerTax: .5, tax: .5 };
    const a = solo(policy({ ...base, safetyNet: 0 }), { investmentResponse: 0 });
    const b = solo(policy({ ...base, safetyNet: 1 }), { investmentResponse: 0 });
    for (let t = 1; t <= 10; t++) {
      expect(a.us[t]!.taxRevenue).toBe(b.us[t]!.taxRevenue);
      expect(a.us[t]!.consumption).toBeCloseTo(b.us[t]!.consumption, 11);
      expect(b.us[t]!.publicSupport).toBeGreaterThan(a.us[t]!.publicSupport);
      expect(b.us[t]!.totalDividend).toBeLessThan(a.us[t]!.totalDividend);
    }
  });
});

describe('Behavioral responses and supported populations', () => {
  it('retention obligations and ownership-weighted levies both deter deployment when the response is active', () => {
    const base = solo(policy(), { investmentResponse: 1 });
    const retain = solo(policy({ replacement: 1 }), { investmentResponse: 1 });
    const taxed = solo(policy({ tax: 1 }), { investmentResponse: 1 });
    expect(retain.us[10]!.adoption).toBeLessThan(base.us[10]!.adoption);
    expect(taxed.us[10]!.adoption).toBeLessThan(base.us[10]!.adoption);
    expect(solo(policy({ replacement: 1, tax: 1 }), { investmentResponse: 0 }).us[10]!.adoption).toBe(1);
  });

  it('100% household levies have explicit investment and labor consequences at full sensitivity', () => {
    const r = solo(policy({ workerTax: 1, tax: 1 }), { investmentResponse: 1 });
    expect(r.us[10]!.adoption).toBe(0);
    expect(r.us[10]!.laborEffort).toBe(0);
    expect(r.us[10]!.laborIncome).toBe(0);
    expect(r.us[10]!.output).toBe(40);
    expect(Number.isFinite(r.usScore)).toBe(true);
  });

  it('imported automation creates both affected workers and retention burdens during a domestic pause', () => {
    const r = simulateProfile({ ...DEFAULT_INPUTS, tradeIntensity: 1 },
      policy({ pace: 0, replacement: 1 }), policy(), 'strategic', 'prosperity', 0);
    const y = r.us[10]!;
    expect(y.adoption).toBe(0);
    expect(y.exposure).toBeGreaterThan(0);
    expect(y.investmentBurden).toBeGreaterThan(0);
    expect(y.employerPay).toBeGreaterThan(0);
  });

  it.each([.01, .5, .99])('uses worker share %s for per-household wages, rebates and welfare weights', workerShare => {
    const r = solo(policy({ replacement: .5, safetyNet: .5, workerTax: .5, tax: .5 }), { workerShare });
    for (const y of r.us) {
      expect(y.priorWage).toBeCloseTo(60 / workerShare, 10);
      expect(y.workerShare).toBe(workerShare);
      expect(y.workerDividend).toBeCloseTo(workerShare * y.totalDividend, 11);
      expect(y.ownerDividend).toBeCloseTo((1 - workerShare) * y.totalDividend, 11);
    }
    let owners = 0, weightSum = 0;
    for (const y of r.us.slice(1)) {
      const weight = (1 + DISCOUNT_RATE) ** -y.year;
      owners += weight * Math.log((y.ownerIncomeIndex / 100 + UTILITY_OFFSET) / (1 + UTILITY_OFFSET));
      weightSum += weight;
    }
    expect(r.usScore).toBeCloseTo(workerShare * scoreTrajectory(r.us, 'workers') + (1 - workerShare) * owners / weightSum, 11);
  });

  it('permits every job to become obsolete and every unprotected worker to receive zero income', () => {
    const r = solo(policy(), { displacement: 1, reemployment: 0, workerOwnership: 0, productivityGain: 0, investmentResponse: 0 });
    expect(r.us[10]!.unemployment).toBeCloseTo(1, 12);
    expect(r.us[10]!.workerIncome).toBeCloseTo(0, 11);
    expect(Number.isFinite(r.us[10]!.employedIncomeIndex)).toBe(true);
    expect(Number.isFinite(r.usScore)).toBe(true);
  });

  it('keeps budgets and all income fields valid at every corner of the input domain', () => {
    for (let mask = 0; mask < 2 ** INPUT_SPECS.length; mask++) {
      const inputs = Object.fromEntries(INPUT_SPECS.map((s, i) => [s.key, mask & (1 << i) ? s.max : s.min])) as unknown as ModelInputs;
      const r = simulateProfile(inputs, policy({ replacement: 1.25, safetyNet: 1, workerTax: 1, tax: 1 }), policy(), 'strategic', 'prosperity', 1);
      for (const y of [...r.us, ...(r.foreign ?? [])]) {
        expect(Object.values(y).filter(v => typeof v === 'number').every(Number.isFinite)).toBe(true);
        expect(y.workerIncome).toBeGreaterThanOrEqual(-1e-10);
        expect(y.ownerIncome).toBeGreaterThanOrEqual(-1e-10);
        expect(Math.abs(y.resourceResidual)).toBeLessThan(1e-9);
        expect(y.unemployment).toBeGreaterThanOrEqual(0);
        expect(y.unemployment).toBeLessThanOrEqual(1);
      }
    }
  }, 15000);
});

describe('Finite comparison benchmarks', () => {
  it('returns all pure equilibria and distinguishes collective optima from unilateral stability', () => {
    const coordination = analyzePayoffs([[{ us: 3, foreign: 3 }, { us: 0, foreign: 0 }], [{ us: 0, foreign: 0 }, { us: 2, foreign: 2 }]]);
    expect(coordination.equilibria.map(p => [p.row, p.column])).toEqual([[0, 0], [1, 1]]);
    const dilemma = analyzePayoffs([[{ us: 3, foreign: 3 }, { us: 0, foreign: 5 }], [{ us: 5, foreign: 0 }, { us: 1, foreign: 1 }]]);
    expect(dilemma.equilibria.map(p => [p.row, p.column])).toEqual([[1, 1]]);
  });

  it('reports no pure equilibrium and minimum regret for matching pennies', () => {
    const r = analyzePayoffs([[{ us: 1, foreign: -1 }, { us: -1, foreign: 1 }], [{ us: -1, foreign: 1 }, { us: 1, foreign: -1 }]]);
    expect(r.equilibria).toEqual([]);
    expect(r.selection).toBe('min-regret');
    expect(r.selected.maxRegret).toBe(2);
  });

  it.each(['prosperity', 'workers', 'output'] as Objective[])('%s checks every unilateral change within the 108-policy menu', objective => {
    const r = solveModel(DEFAULT_INPUTS, { mode: 'strategic', objective, pace: 1 });
    expect(r.policies).toHaveLength(108);
    expect(r.outcomes).toHaveLength(11664);
    expect(r.outcomes.every(p => p.usPolicy.pace === 1 && p.foreignPolicy!.pace === 1)).toBe(true);
    for (const e of r.equilibria) {
      const usMoves = r.outcomes.filter(p => p.foreignPolicy!.id === e.foreignPolicy!.id);
      const foreignMoves = r.outcomes.filter(p => p.usPolicy.id === e.usPolicy.id);
      expect(Math.max(...usMoves.map(p => p.usScore)) - e.usScore).toBeLessThanOrEqual(EQUILIBRIUM_TOLERANCE);
      expect(Math.max(...foreignMoves.map(p => p.foreignScore!)) - e.foreignScore!).toBeLessThanOrEqual(EQUILIBRIUM_TOLERANCE);
    }
    if (!r.equilibria.length) {
      expect(r.selection).toBe('min-regret');
      expect(r.selected.maxRegret).toBeCloseTo(Math.min(...r.outcomes.map(p => p.maxRegret)), 10);
    }
    expect(r.coordinated.globalScore).toBeCloseTo(Math.max(...r.outcomes.map(p => p.globalScore)), 10);
  });

  it('US-only ignores foreign inputs and zero capability removes the rival', () => {
    const a = solveModel(DEFAULT_INPUTS, { mode: 'us-only', objective: 'workers', pace: 1 });
    const inputs = { ...DEFAULT_INPUTS, foreignStrength: 0, foreignMarketSize: 4, capitalMobility: 1, tradeIntensity: 1 };
    const b = solveModel(inputs, { mode: 'strategic', objective: 'workers', pace: 1 });
    expect(a.outcomes).toEqual(b.outcomes);
    expect(b.effectiveMode).toBe('us-only');
    expect(b.baseline.us[10]!.adoption).toBe(0);
  });

  it('normalizes population shares and rejects invalid policies and matrices', () => {
    expect(normalizeInputs({ workerShare: .456789 }).workerShare).toBe(.457);
    expect(normalizeInputs({ workerShare: 0 }).workerShare).toBe(.01);
    expect(normalizeInputs({ workerShare: 1 }).workerShare).toBe(.99);
    expect(() => solo({ ...policy(), workerTax: 2 })).toThrow(RangeError);
    expect(() => analyzePayoffs([])).toThrow(RangeError);
    expect(() => analyzePayoffs([[{ us: NaN, foreign: 0 }]])).toThrow(RangeError);
  });
});
