import { describe, expect, it } from 'vitest';
import { makePolicy, type Policy } from './pirates-model';
import { solvePackageElection, type PackageElectionModel } from './package-election';

const base = { pace: 1, replacement: 0, welfareScale: 1, benefitFormula: 'current' as const, laborTax: .2, capitalTax: .2 };
const current = { ...makePolicy(base), id: 'current' };
const pause = { ...makePolicy({ ...base, pace: 0 }), id: 'pause' };
const accelerate = { ...makePolicy({ ...base, pace: 2 }), id: 'accelerate' };
const other = { ...makePolicy({ ...base, replacement: 1 }), id: 'other' };
interface Fixture {
  policies?: Policy[]; foreign?: Policy[]; weights?: number[];
  utilities: (us: Policy, foreign?: Policy) => number[];
  score?: (us: Policy, foreign: Policy) => number;
  funded?: (us: Policy, foreign?: Policy) => boolean;
  foreignFunded?: (us: Policy, foreign: Policy) => boolean;
}
function fixture(f: Fixture): PackageElectionModel {
  return {
    mode: f.foreign ? 'strategic' : 'us-only', policies: f.policies ?? [current, pause, accelerate], foreignPolicies: f.foreign ?? [],
    currentPolicy: current, weights: f.weights ?? [1],
    evaluateLight: (us, foreign) => ({ id: us.id + '::' + foreign?.id, usPolicy: us, foreignPolicy: foreign,
      usUtilities: new Float64Array(f.utilities(us, foreign)), usScore: 0, usAdmissible: f.funded?.(us, foreign) ?? true,
      foreignScore: foreign ? f.score?.(us, foreign) ?? 0 : undefined,
      foreignAdmissible: foreign ? f.foreignFunded?.(us, foreign) ?? true : undefined }),
    evaluateForeign: (us, foreign) => (f.foreignFunded?.(us, foreign) ?? true) ? f.score?.(us, foreign) ?? 0 : -Infinity,
  };
}

describe('Complete-package election and known foreign choices', () => {
  it('keeps exact current policy after one split 40/35/25 ballot', () => {
    const policies = [current, pause, accelerate, other];
    const result = solvePackageElection(fixture({ policies, weights: [40, 35, 25], utilities: us =>
      us.id === 'current' ? [0, 0, 0] : us.id === 'pause' ? [3, 1, 1] : us.id === 'accelerate' ? [1, 3, 1] : [1, 1, 3] }));
    expect(result.ballot.voterChoices).toEqual(['pause', 'accelerate', 'other']);
    expect(result.ballot.topSupportPercent).toBe(40);
    expect(result.usPolicy).toBe(current);
    expect(result.selection).toBe('domestic-ballot');
    expect(result.evaluations).toBe(4);
    expect(result.search.ballotsEvaluated).toBe(1);
  });

  it('includes deployment in the full package and enacts a strict majority', () => {
    const result = solvePackageElection(fixture({ weights: [51, 49], utilities: us => us.id === 'accelerate' ? [2, -2] : [0, 0] }));
    expect(result.usPolicy.pace).toBe(2);
    expect(result.ballot.winnerId).toBe('accelerate');
    expect(result.ballot.topSupportPercent).toBe(51);
  });

  it('never lets voters choose a more attractive but underfunded package', () => {
    const result = solvePackageElection(fixture({ funded: us => us.id !== 'accelerate', utilities: us => [us.id === 'accelerate' ? 100 : us.id === 'pause' ? 1 : 0] }));
    expect(result.usPolicy).toBe(pause);
    expect(result.ballot.unfundedCandidateCount).toBe(1);
    expect(result.ballot.voterChoices).toEqual(['pause']);
  });

  it('keeps the precise status quo even if it is underfunded and nobody can vote for it', () => {
    const result = solvePackageElection(fixture({ weights: [50, 50], funded: us => us.id !== 'current', utilities: us =>
      us.id === 'current' ? [100, 100] : us.id === 'pause' ? [2, 0] : [0, 2] }));
    expect(result.usPolicy).toBe(current);
    expect(result.usPolicy.pace).toBe(1);
    expect(result.ballot.statusQuoFullyFunded).toBe(false);
    expect(result.ballot.statusQuoReason).toBe('no-majority');
  });

  it('makes the foreign actor respond to the enacted fallback, not the plurality leader', () => {
    const model = fixture({ policies: [current, pause, accelerate, other], foreign: [current, pause, accelerate], weights: [40, 35, 25],
      utilities: us => us.id === 'current' ? [0, 0, 0] : us.id === 'pause' ? [3, 1, 1] : us.id === 'accelerate' ? [1, 3, 1] : [1, 1, 3],
      score: (us, foreign) => foreign.id === (us.id === 'current' ? 'accelerate' : 'pause') ? 3 : 0 });
    const result = solvePackageElection(model);
    expect(result.ballot.leadingPolicyId).toBe('pause');
    expect(result.ballot.winnerId).toBeNull();
    expect(result.usPolicy).toBe(current);
    expect(result.foreignPolicy).toBe(accelerate);
    expect(result.selection).toBe('verified-consistent');
    expect(result.foreignBestResponseGain).toBe(0);
  });

  it('finds and certifies a mutual fixed point through complete response menus', () => {
    const model = fixture({ foreign: [current, pause, accelerate], utilities: (us, foreign) => [us.id === (foreign?.id === 'accelerate' ? 'pause' : 'accelerate') ? 2 : 0],
      score: (_us, foreign) => foreign.id === 'accelerate' ? 3 : 0 });
    const result = solvePackageElection(model);
    expect(result.usPolicy).toBe(pause);
    expect(result.foreignPolicy).toBe(accelerate);
    expect(result.selection).toBe('verified-consistent');
    expect(result.search.consistentPairsFound).toBe(1);
    expect(result.search.ballotsEvaluated).toBe(3);
    expect(result.search.foreignResponsesEvaluated).toBe(2);
    expect(result.search.iterations).toBeGreaterThan(result.search.ballotsEvaluated);
  });

  it('reports cycles without inventing an equilibrium or a second election', () => {
    const result = solvePackageElection(fixture({ policies: [current, pause], foreign: [current, pause],
      utilities: (us, foreign) => [us.id === foreign?.id ? 1 : 0],
      score: (us, foreign) => us.id !== foreign.id ? 1 : 0 }));
    expect(result.selection).toBe('search-incomplete');
    expect(result.search.consistentPairsFound).toBe(0);
    expect(result.search.cycleCount).toBe(2);
    expect(result.foreignBestResponseGain).toBe(1);
    expect(result.search.reason).toContain('not an equilibrium');
    expect(result.search.ballotsEvaluated).toBe(2);
    expect(result.search.foreignResponsesEvaluated).toBe(2);
  });

  it('distinguishes a round limit from an observed cycle', () => {
    const result = solvePackageElection(fixture({ policies: [current, pause], foreign: [current, pause],
      utilities: (us, foreign) => [us.id === foreign?.id ? 1 : 0], score: (us, foreign) => us.id !== foreign.id ? 1 : 0 }),
    { maxRounds: 1, foreignSeeds: [current] });
    expect(result.selection).toBe('search-incomplete');
    expect(result.search.cycleCount).toBe(0);
    expect(result.search.exhaustedStarts).toBe(1);
  });

  it('accepts an incumbent tied for the true foreign maximum, avoiding artificial cycles', () => {
    const result = solvePackageElection(fixture({ foreign: [current, pause, accelerate], utilities: () => [0], score: () => 2 }));
    expect(result.selection).toBe('verified-consistent');
    expect(result.foreignPolicy).toBe(current);
    expect(result.foreignBestPolicy).toBe(current);
    expect(result.search.consistentPairsFound).toBe(3);
    expect(result.search.cycleCount).toBe(0);
  });

  it('breaks nonincumbent exact foreign utility ties canonically', () => {
    const model = fixture({ foreign: [pause, current, accelerate], utilities: () => [0], score: (_us, foreign) => foreign.id === 'current' ? 0 : 1 });
    const first = solvePackageElection(model, { foreignSeeds: [current] });
    const reversed = solvePackageElection({ ...model, foreignPolicies: [...model.foreignPolicies].reverse() }, { foreignSeeds: [current] });
    expect(first.foreignPolicy).toBe(accelerate);
    expect(reversed.foreignPolicy).toBe(accelerate);
  });

  it('does not certify a foreign fallback when every foreign package is underfunded', () => {
    const result = solvePackageElection(fixture({ foreign: [current, pause], utilities: () => [0], score: () => 100, foreignFunded: () => false }));
    expect(result.selection).toBe('search-incomplete');
    expect(result.foreignBestPolicy).toBeUndefined();
    expect(result.foreignBestResponseGain).toBeUndefined();
    expect(result.search.reason).toContain('no fully funded foreign response');
    expect(result.search.consistentPairsFound).toBe(0);
  });

  it('excludes unfunded foreign maxima before certifying the response', () => {
    const result = solvePackageElection(fixture({ foreign: [current, pause, accelerate], utilities: () => [0],
      score: (_us, foreign) => foreign.id === 'accelerate' ? 100 : foreign.id === 'pause' ? 2 : 0,
      foreignFunded: (_us, foreign) => foreign.id !== 'accelerate' }), { foreignSeeds: [current] });
    expect(result.foreignPolicy).toBe(pause);
    expect(result.selection).toBe('verified-consistent');
  });

  it('rejects missing current-policy packages and invalid bounded-search settings', () => {
    const model = fixture({ foreign: [current, pause], utilities: () => [0] });
    expect(() => solvePackageElection({ ...model, policies: [pause] })).toThrow(/exact status quo/);
    expect(() => solvePackageElection({ ...model, foreignPolicies: [pause] })).toThrow(/exact status quo/);
    expect(() => solvePackageElection(model, { foreignSeeds: [] })).toThrow(/seeds/);
    expect(() => solvePackageElection(model, { foreignSeeds: [other] })).toThrow(/seeds/);
    expect(() => solvePackageElection(model, { maxRounds: 0 })).toThrow(/rounds/);
  });
});
