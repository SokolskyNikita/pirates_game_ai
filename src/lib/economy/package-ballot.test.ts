import { describe, expect, it } from 'vitest';
import { packageHasMajority, tallyPackageBallot, type PackageBallotCandidate } from './package-ballot';

const statusQuo = (utilities: number[]): PackageBallotCandidate => ({ id: 'current', utilities, fullyFunded: true });

function vote(candidates: Iterable<PackageBallotCandidate>, weights: number[]) {
  return tallyPackageBallot({ candidates, weights, statusQuoId: 'current' });
}

function support(result: ReturnType<typeof vote>, id: string): number {
  return result.tallies.find(tally => tally.policyId === id)!.supportPercent;
}

describe('One ballot over complete policy packages', () => {
  it('keeps the status quo when support splits 40/35/25, even if everyone prefers every change', () => {
    const result = vote([
      statusQuo([0, 0, 0]),
      { fullyFunded: true, id: 'A', utilities: [3, 1, 1] },
      { fullyFunded: true, id: 'B', utilities: [1, 3, 1] },
      { fullyFunded: true, id: 'C', utilities: [1, 1, 3] },
    ], [40, 35, 25]);
    expect(result.voterChoices).toEqual(['A', 'B', 'C']);
    expect(result.tallies.map(tally => tally.supportPercent)).toEqual([40, 35, 25, 0]);
    expect(result.leadingPolicyId).toBe('A');
    expect(result.topSupportPercent).toBe(40);
    expect(result.winnerId).toBeNull();
    expect(result.enactedPolicyId).toBe('current');
    expect(result.statusQuoReason).toBe('no-majority');
  });

  it('enacts a package with a strict absolute majority, counting people rather than utility gains', () => {
    const result = vote([statusQuo([0, 0]), { fullyFunded: true, id: 'reform', utilities: [1, -1000] }], [51, 49]);
    expect(result.winnerId).toBe('reform');
    expect(result.enactedPolicyId).toBe('reform');
    expect(result.topSupportPercent).toBe(51);
    expect(result.statusQuoReason).toBeNull();
  });

  it('does not pass an exact 50/50 result or floating arithmetic noise', () => {
    const result = vote([statusQuo([0, 0]), { fullyFunded: true, id: 'reform', utilities: [1, -1] }], [50, 50]);
    expect(result.winnerId).toBeNull();
    expect(result.enactedPolicyId).toBe('current');
    expect(packageHasMajority(50 + 1e-12)).toBe(false);
    expect(packageHasMajority(50 + 1e-8)).toBe(true);
  });

  it('distinguishes a majority voting for current policy from a fragmented ballot', () => {
    const result = vote([statusQuo([1, 0]), { fullyFunded: true, id: 'reform', utilities: [0, 1] }], [60, 40]);
    expect(result.winnerId).toBe('current');
    expect(result.enactedPolicyId).toBe('current');
    expect(result.statusQuoReason).toBe('status-quo-majority');
  });

  it('retains an underfunded status quo when no package receives a majority', () => {
    const current = { ...statusQuo([100, 100]), fullyFunded: false };
    const result = vote([current, { fullyFunded: true, id: 'A', utilities: [2, 1] }, { fullyFunded: true, id: 'B', utilities: [1, 2] }], [50, 50]);
    expect(result.enactedPolicyId).toBe('current');
    expect(result.statusQuoReason).toBe('no-majority');
    expect(result.statusQuoFullyFunded).toBe(false);
    expect(result.voterChoices).toEqual(['A', 'B']);
    expect(result.tallies.some(tally => tally.policyId === 'current')).toBe(false);
  });

  it('excludes an attractive underfunded policy before every voter selects their favorite', () => {
    const candidate = { fullyFunded: false, id: 'unfunded', utilities: [100, 100] };
    const result = vote([statusQuo([0, 0]), candidate, { fullyFunded: true, id: 'reform', utilities: [2, 1] }], [60, 40]);
    expect(result.winnerId).toBe('reform');
    expect(result.voterChoices).toEqual(['reform', 'reform']);
    expect(result.tallies.some(tally => tally.policyId === 'unfunded')).toBe(false);
    expect(result.candidateCount).toBe(3);
    expect(result.eligibleCandidateCount).toBe(2);
    expect(result.unfundedCandidateCount).toBe(1);
    expect(result.statusQuoFullyFunded).toBe(true);
  });

  it('cannot elect an underfunded current policy even when everyone prefers it', () => {
    const result = vote([
      { ...statusQuo([100, 100]), fullyFunded: false },
      { fullyFunded: true, id: 'reform', utilities: [0, 0] },
    ], [60, 40]);
    expect(result.winnerId).toBe('reform');
    expect(result.enactedPolicyId).toBe('reform');
    expect(result.statusQuoFullyFunded).toBe(false);
  });

  it('casts no votes and reports the underfunded fallback when every package is excluded', () => {
    const result = vote([
      { ...statusQuo([0, 0]), fullyFunded: false },
      { fullyFunded: false, id: 'unfunded', utilities: [100, 100] },
    ], [60, 40]);
    expect(result.tallies).toEqual([]);
    expect(result.voterChoices).toEqual([null, null]);
    expect(result.leadingPolicyId).toBeNull();
    expect(result.topSupportPercent).toBe(0);
    expect(result.winnerId).toBeNull();
    expect(result.enactedPolicyId).toBe('current');
    expect(result.statusQuoReason).toBe('no-eligible-policies');
    expect(result.statusQuoFullyFunded).toBe(false);
    expect(result.candidateCount).toBe(2);
    expect(result.eligibleCandidateCount).toBe(0);
    expect(result.unfundedCandidateCount).toBe(2);
  });

  it('fails closed when any package omits the funding flag or supplies a nonboolean flag', () => {
    for (const flag of [undefined, null, 0, 1, 'true', 'false']) {
      const candidate = { id: 'reform', utilities: [1], fullyFunded: flag } as unknown as PackageBallotCandidate;
      expect(() => vote([statusQuo([0]), candidate], [1])).toThrow(/fullyFunded/);
    }
    expect(() => vote([{ id: 'current', utilities: [0] } as unknown as PackageBallotCandidate], [1])).toThrow(/fullyFunded/);
  });

  it('validates excluded candidate IDs, utilities, and current-policy presence too', () => {
    const current = { ...statusQuo([0]), fullyFunded: false };
    expect(() => vote([current, current], [1])).toThrow(RangeError);
    expect(() => vote([{ fullyFunded: false, id: 'other', utilities: [0] }], [1])).toThrow(RangeError);
    expect(() => vote([current, { fullyFunded: false, id: '', utilities: [1] }], [1])).toThrow(RangeError);
    expect(() => vote([current, { fullyFunded: false, id: 'other', utilities: [NaN] }], [1])).toThrow(RangeError);
  });

  it('gives each cell one choice and does not tally pairwise approval or only taxpaying citizens', () => {
    const result = vote([
      statusQuo([0, 0, 0]),
      { fullyFunded: true, id: 'A', utilities: [3, 2, 1] },
      { fullyFunded: true, id: 'B', utilities: [2, 3, 2] },
      { fullyFunded: true, id: 'C', utilities: [1, 1, 3] },
    ], [42.7, 30.1, 27.2]);
    expect(result.voterChoices).toEqual(['A', 'B', 'C']);
    expect(result.tallies.reduce((sum, tally) => sum + tally.supportPercent, 0)).toBeCloseTo(100, 12);
    expect(support(result, 'A')).toBeCloseTo(42.7, 12);
    expect(support(result, 'B')).toBeCloseTo(30.1, 12);
    expect(result.winnerId).toBeNull();
  });

  it('gives exact utility ties to current policy, then canonical policy ID, regardless of menu order', () => {
    const candidates = [
      { fullyFunded: true, id: 'Z', utilities: [1, 2] },
      { fullyFunded: true, id: 'A', utilities: [1, 2] },
      statusQuo([1, 0]),
    ];
    const first = vote(candidates, [55, 45]);
    const reversed = vote([...candidates].reverse(), [55, 45]);
    expect(first.voterChoices).toEqual(['current', 'A']);
    expect(reversed).toEqual(first);
  });

  it('selects the exact utility maximum instead of order-dependent epsilon ties', () => {
    const candidates = [statusQuo([1]), { fullyFunded: true, id: 'A', utilities: [1 + 1e-12] }, { fullyFunded: true, id: 'Z', utilities: [1 + 2e-12] }];
    expect(vote(candidates, [1]).winnerId).toBe('Z');
    expect(vote([...candidates].reverse(), [1]).winnerId).toBe('Z');
  });

  it('is invariant to scaling population weights and splitting identical cells', () => {
    const candidates = [statusQuo([0, 0, 0]), { fullyFunded: true, id: 'A', utilities: [2, 2, -1] }];
    const first = vote(candidates, [1.2, 2.5, 3.4]);
    const scaled = vote(candidates, [120, 250, 340]);
    const split = vote([statusQuo([0, 0, 0, 0]), { fullyFunded: true, id: 'A', utilities: [2, 2, 2, -1] }], [.4, .8, 2.5, 3.4]);
    expect(first.winnerId).toBe('A');
    expect(support(scaled, 'A')).toBeCloseTo(support(first, 'A'), 12);
    expect(support(split, 'A')).toBeCloseTo(support(first, 'A'), 12);
  });

  it('streams candidate utilities without retaining previous rows or enumerating the menu twice', () => {
    let visits = 0;
    function* candidates() {
      const row = new Float64Array([0, 0]);
      visits++;
      yield { fullyFunded: true, id: 'current', utilities: row };
      row.set([2, 1]);
      visits++;
      yield { fullyFunded: true, id: 'A', utilities: row };
      row.set([1, 3]);
      visits++;
      yield { fullyFunded: true, id: 'B', utilities: row };
    }
    const result = vote(candidates(), [70, 30]);
    expect(visits).toBe(3);
    expect(result.candidateCount).toBe(3);
    expect(result.voterChoices).toEqual(['A', 'B']);
    expect(result.winnerId).toBe('A');
  });

  it('keeps zero-weight cells from changing election results', () => {
    const result = vote([statusQuo([0, 0]), { fullyFunded: true, id: 'A', utilities: [-1, 1] }], [1, 0]);
    expect(result.voterChoices).toEqual(['current', 'A']);
    expect(result.winnerId).toBe('current');
    expect(support(result, 'A')).toBe(0);
  });

  it('rejects invalid electorates, utility rows, duplicate candidates, and a missing current policy', () => {
    for (const weights of [[], [0], [-1], [NaN], [Infinity]]) {
      expect(() => vote([statusQuo([0])], weights)).toThrow(RangeError);
    }
    for (const utilities of [[], [NaN], [Infinity], [-Infinity]]) {
      expect(() => vote([statusQuo(utilities)], [1])).toThrow(RangeError);
    }
    expect(() => vote([statusQuo([0]), statusQuo([1])], [1])).toThrow(RangeError);
    expect(() => vote([{ fullyFunded: true, id: 'A', utilities: [0] }], [1])).toThrow(RangeError);
    expect(() => vote([], [1])).toThrow(RangeError);
    expect(() => vote([statusQuo([0]), { fullyFunded: true, id: '', utilities: [1] }], [1])).toThrow(RangeError);
  });
});
