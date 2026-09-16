import { describe, expect, it } from 'vitest';
import { solveScenario } from './simulation';
import { DEFAULT_INPUTS, POLICIES, currentPolicy, solveModel, EQUILIBRIUM_TOLERANCE } from './pirates-model';
import { tallyPackageBallot } from './package-ballot';

describe('One full-policy ballot scenario snapshots', () => {
  it('includes all deployment options, exact current-policy fallback, and only leading profiles', () => {
    const s = solveScenario({ id: 1, inputs: DEFAULT_INPUTS, mode: 'us-only', foreignObjective: 'prosperity' });
    expect(structuredClone(s).selected.usUtilities).toEqual(s.selected.usUtilities);
    expect(s.policyCount).toBe(POLICIES.length);
    expect(s.ballot.candidateCount).toBe(POLICIES.length);
    expect(new Set(POLICIES.map(p => p.pace))).toEqual(new Set([0, 1, 2]));
    expect(s.alternatives.length).toBeLessThanOrEqual(8);
    expect(s.leading?.usPolicy.id).toBe(s.ballot.leadingPolicyId);
    expect(s.selected.usPolicy.id).toBe(s.ballot.enactedPolicyId);
    expect(s.statusQuo.usPolicy.id).toBe(currentPolicy(1).id);
    expect(s.baseline.us.at(-1)!.allIncomeIndex).toBeCloseTo(100, 8);
    expect(s.selection).toBe('domestic-ballot');
    expect('treaty' in s).toBe(false);
    for (const p of s.alternatives) expect(p.usAdmissible).toBe(true);
    for (const y of s.selected.us) expect(y.resourceResidual).toBeCloseTo(0, 6);
  }, 60000);

  it('independently repeats the full ballot and foreign response at the actually enacted US package', () => {
    const s = solveScenario({ id: 2, inputs: DEFAULT_INPUTS, mode: 'strategic', foreignObjective: 'workers' });
    const model = solveModel(DEFAULT_INPUTS, { mode: 'strategic', objective: 'workers', foreignObjective: 'workers' });
    const foreign = s.selected.foreignPolicy!;
    const ballot = tallyPackageBallot({ weights: model.weights, statusQuoId: currentPolicy(1).id,
      candidates: (function* () { for (const policy of POLICIES) { const p = model.evaluateLight(policy, foreign); yield { id: policy.id, utilities: p.usUtilities, fullyFunded: p.usAdmissible }; } })() });
    expect(ballot).toEqual(s.ballot);
    expect(s.selected.usPolicy.id).toBe(ballot.enactedPolicyId);
    expect(s.statusQuo.foreignPolicy?.id).toBe(foreign.id);
    let best = -Infinity;
    for (const policy of model.foreignPolicies) best = Math.max(best, model.evaluateForeign(s.selected.usPolicy, policy));
    expect(Math.max(0, best - s.selected.foreignScore!)).toBeCloseTo(s.foreignBestResponseGain!, 10);
    if (s.selection === 'verified-consistent') {
      expect(s.selected.foreignAdmissible).toBe(true);
      expect(best - s.selected.foreignScore!).toBeLessThanOrEqual(EQUILIBRIUM_TOLERANCE);
      expect(s.search.consistentPairsFound).toBeGreaterThan(0);
    } else {
      expect(s.search.consistentPairsFound).toBe(0);
      expect(s.search.reason).toContain('not an equilibrium');
    }
    for (const y of [...s.selected.us, ...s.selected.foreign!]) expect(y.resourceResidual).toBeCloseTo(0, 6);
    for (let y = 0; y < s.selected.us.length; y++) {
      expect(s.selected.us[y]!.netRentFlow + s.inputs.foreignMarketSize * s.selected.foreign![y]!.netRentFlow).toBeCloseTo(0, 6);
    }
  }, 60000);

  it('ignores old URL deployment constraints because the full deployment choice is now voted on', () => {
    const inputs = { ...DEFAULT_INPUTS, displacement: 1, reemployment: 0, productivityGain: .5 };
    const pausedLink = solveScenario({ id: 3, inputs, mode: 'us-only', foreignObjective: 'output', pace: 0 });
    const oldFullLink = solveScenario({ id: 4, inputs, mode: 'us-only', foreignObjective: 'output', pace: 1 });
    expect(pausedLink.ballot).toEqual(oldFullLink.ballot);
    expect(pausedLink.selected.id).toBe(oldFullLink.selected.id);
    expect(pausedLink.statusQuo.usPolicy.pace).toBe(1);
    expect(pausedLink.ballot.candidateCount).toBe(POLICIES.length);
    if (!pausedLink.ballot.winnerId) expect(pausedLink.selected.usPolicy.id).toBe(currentPolicy(1).id);
  }, 60000);
});
