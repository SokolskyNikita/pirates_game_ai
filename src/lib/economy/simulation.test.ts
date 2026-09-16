import { describe, expect, it } from 'vitest';
import { DEFAULT_INPUTS, EQUILIBRIUM_TOLERANCE, POLICIES, evaluateProfile, scoreForeignTrajectory, type Objective } from './pirates-model';
import { solveScenario } from './simulation';

describe('browser calculation snapshots', () => {
  it.each(['workers', 'prosperity', 'output'] as const)('sends a cloneable compact %s scenario with a foreign best response', (foreignObjective: Objective) => {
    const snapshot = solveScenario({ id: 1, inputs: DEFAULT_INPUTS, mode: 'strategic', foreignObjective, pace: 1 });
    const copy = structuredClone(snapshot);
    expect(copy.foreignObjective).toBe(foreignObjective);
    expect(copy.pairCount).toBe(108 * 432);
    expect(copy.alternatives).toHaveLength(108);
    expect(copy.alternatives.every(profile => profile.foreignPolicy?.id === copy.selected.foreignPolicy?.id)).toBe(true);
    expect(copy.selected.us).toHaveLength(11);
    expect(copy.selected.foreign).toHaveLength(11);
    expect(copy.selected.foreignBestResponseGain).toBeLessThanOrEqual(EQUILIBRIUM_TOLERANCE);
    // Recompute every foreign deviation independently of the solver's cached
    // regret field and compact snapshot, including all four deployment paces.
    const selectedForeignScore = scoreForeignTrajectory(copy.selected.foreign!, foreignObjective);
    const foreignScores = POLICIES.map(foreignPolicy => {
      const alternative = evaluateProfile(DEFAULT_INPUTS, copy.selected.usPolicy, foreignPolicy,
        'strategic', 'prosperity', foreignObjective);
      return scoreForeignTrajectory(alternative.foreign!, foreignObjective);
    });
    expect(foreignScores).toHaveLength(432);
    expect(copy.selected.foreignScore).toBeCloseTo(selectedForeignScore, 12);
    expect(Math.max(...foreignScores) - selectedForeignScore).toBeLessThanOrEqual(EQUILIBRIUM_TOLERANCE);
    expect(copy.statusQuo.usPolicy.pace).toBe(1);
    expect(copy.statusQuo.foreignPolicy?.id).toBe(copy.selected.foreignPolicy?.id);
    if (copy.stableCount) expect(copy.selected.usDeviationVotes).toBeLessThan(501);
    expect(copy.selected.us.every(point => Math.abs(point.resourceResidual) < 1e-8)).toBe(true);
  });

  it('keeps a paused US distinct from an independently deploying foreign actor', () => {
    const snapshot = solveScenario({ id: 2, inputs: { ...DEFAULT_INPUTS, displacement: 0, investmentResponse: 0 }, mode: 'strategic', foreignObjective: 'output', pace: 0 });
    expect(snapshot.selected.usPolicy.pace).toBe(0);
    expect(snapshot.selected.foreignPolicy?.pace).toBe(1);
    expect(snapshot.selected.us.at(-1)!.exposure).toBeGreaterThan(0);
  });
});
