import { describe, expect, it } from 'vitest';
import { EQUILIBRIUM_TOLERANCE, makePolicy, type LightProfile, type Policy, type ProfileOutcome } from './pirates-model';
import { changedPolicyAxes, countVotes, hasMajority } from './pirates-voting';
import { solveTreatyGame, type TreatyGame } from './pirates-treaty';

const policy = (changes: Partial<Policy> = {}): Policy => makePolicy({
  pace: 1, replacement: 0, welfareScale: 1, benefitFormula: 'current', laborTax: .2, capitalTax: .2, ...changes,
});
const base = policy();
const retention = policy({ replacement: .5 });
const welfare = policy({ welfareScale: 1.5 });
const paused = policy({ pace: 0 });

type Payoff = { utilities: number[]; foreign: number; usAdmissible?: boolean; foreignAdmissible?: boolean };
function fixture(policies: Policy[], payoff: (us: Policy, foreign: Policy) => Payoff, weights = [60, 30, 10]): TreatyGame {
  const evaluateLight = (us: Policy, foreign: Policy): LightProfile => {
    const p = us.id === base.id && foreign.id === base.id ? { utilities: weights.map(() => 0), foreign: 0 } : payoff(us, foreign);
    return {
      id: JSON.stringify([us.id, foreign.id]), usPolicy: us, foreignPolicy: foreign,
      usUtilities: Float64Array.from(p.utilities), foreignScore: p.foreign,
      usScore: 0, usAdmissible: p.usAdmissible ?? true, foreignAdmissible: p.foreignAdmissible ?? true,
    };
  };
  const evaluate = (us: Policy, foreign: Policy): ProfileOutcome => ({ ...evaluateLight(us, foreign), us: [], foreign: [], feasible: true, foreignFeasible: true, fundingGap: 0, foreignFundingGap: 0 });
  return { policies, weights, evaluateLight, evaluate, disagreement: evaluate(base, base), disagreementVerified: true };
}
const reject: Payoff = { utilities: [-1, -1, -1], foreign: -1 };

describe('Binding treaty ratification', () => {
  it('requires a strict weighted US majority and strictly better foreign payoff; indifference keeps no treaty', () => {
    const tiedUS = fixture([base, retention], () => ({ utilities: [1, -1], foreign: 1 }), [50, 50]);
    expect(solveTreatyGame(tiedUS).status).toBe('no-agreement');
    const justOverHalf = { ...tiedUS, weights: [50.00001, 49.99999] };
    const signed = solveTreatyGame(justOverHalf);
    expect(signed.status).toBe('signed');
    expect(signed.support).toBeCloseTo(50.00001, 10);
    for (const foreign of [-1, 0, EQUILIBRIUM_TOLERANCE]) {
      const game = fixture([base, retention], () => ({ utilities: [1, 1, 1], foreign }));
      expect(solveTreatyGame(game).status).toBe('no-agreement');
    }
  });

  it('the foreign proposer maximizes its objective among ratifiable offers, rather than maximizing US support', () => {
    const game = fixture([base, retention, welfare], (us, foreign) => us.id === foreign.id
      ? us.id === retention.id ? { utilities: [1, -1, -1], foreign: 10 } : { utilities: [1, 1, -1], foreign: 5 }
      : reject);
    const result = solveTreatyGame(game);
    expect(result.status).toBe('signed');
    expect(result.proposal!.usPolicy.id).toBe(retention.id);
    expect(result.support).toBe(60);
    expect(result.foreignGain).toBe(10);
    expect(result.acceptableOfferCount).toBe(2);
  });

  it('breaks exact foreign-payoff ties by support, then fixed agenda order; tiny real payoff differences remain decisive', () => {
    const menu = [base, retention, welfare, paused];
    const game = fixture(menu, (us, foreign) => us.id !== foreign.id ? reject : {
      utilities: us.id === retention.id ? [1, -1, -1] : [1, 1, -1], foreign: 2,
    });
    expect(solveTreatyGame(game).proposal!.usPolicy.id).toBe(welfare.id);
    const higher = fixture(menu, (us, foreign) => us.id !== foreign.id ? reject : {
      utilities: us.id === retention.id ? [1, -1, -1] : [1, 1, -1],
      foreign: us.id === retention.id ? 2 + EQUILIBRIUM_TOLERANCE / 2 : 2,
    });
    expect(solveTreatyGame(higher).proposal!.usPolicy.id).toBe(retention.id);
  });

  it.each(['usAdmissible', 'foreignAdmissible'] as const)('excludes offers that cannot fund %s public services', field => {
    const game = fixture([base, retention], () => ({ utilities: [1, 1, 1], foreign: 10, [field]: false }));
    const result = solveTreatyGame(game);
    expect(result.status).toBe('no-agreement');
    expect(result.admissibleOfferCount).toBe(0);
    expect(result.proposal).toBeUndefined();
  });

  it('supports reciprocal asymmetric changes, including deployment, without requiring identical policies', () => {
    const game = fixture([base, retention, paused], (us, foreign) => us.id === retention.id && foreign.id === paused.id
      ? { utilities: [1, -1, -1], foreign: 1 } : reject);
    const result = solveTreatyGame(game);
    expect(result.status).toBe('signed');
    expect(result.proposal!.usPolicy.replacement).toBe(.5);
    expect(result.proposal!.foreignPolicy!.pace).toBe(0);
    expect(result.proposal!.usPolicy.pace).toBe(1);
  });

  it('checks the stated menu exactly once per pair and selects its true maximum, without claiming all asymmetric combinations', () => {
    const policies = [1, 0].flatMap(pace => [0, .5].flatMap(replacement => [.2, .4].map(laborTax => policy({ pace, replacement, laborTax }))));
    const calls = new Set<string>();
    const game = fixture(policies, (us, foreign) => {
      const i = policies.findIndex(p => p.id === us.id), j = policies.findIndex(p => p.id === foreign.id);
      return { utilities: [(i + j) % 3 - 1, i % 2, j % 2], foreign: i * 10 + j };
    });
    const original = game.evaluateLight;
    game.evaluateLight = (us, foreign) => {
      const key = `${us.id}/${foreign.id}`;
      expect(calls.has(key)).toBe(false);
      calls.add(key);
      return original(us, foreign);
    };
    let expectedCount = 0, acceptableCount = 0, expectedScore = -Infinity, expectedSupport = 0;
    for (const us of policies) for (const foreign of policies) {
      if (us.id === base.id && foreign.id === base.id) continue;
      const inMenu = us.id === foreign.id || us.id === base.id || foreign.id === base.id
        || (changedPolicyAxes(base, us).length === 1 && changedPolicyAxes(base, foreign).length === 1);
      if (!inMenu) continue;
      expectedCount++;
      const p = original(us, foreign), votes = countVotes(p.usUtilities, game.disagreement.usUtilities, game.weights);
      if (!hasMajority(votes) || p.foreignScore! <= EQUILIBRIUM_TOLERANCE) continue;
      acceptableCount++;
      if (p.foreignScore! > expectedScore || (p.foreignScore === expectedScore && votes > expectedSupport)) {
        expectedScore = p.foreignScore!; expectedSupport = votes;
      }
    }
    const result = solveTreatyGame(game);
    expect(result.evaluatedOfferCount).toBe(expectedCount);
    expect(calls.size).toBe(expectedCount);
    expect(expectedCount).toBeLessThan(policies.length ** 2 - 1);
    expect(result.acceptableOfferCount).toBe(acceptableCount);
    expect(result.foreignGain).toBe(expectedScore);
    expect(result.support).toBe(expectedSupport);
  });

  it('does not imply an agreement is impossible when it exists only outside the finite offer menu', () => {
    const first = policy({ replacement: .5, welfareScale: 1.5 });
    const second = policy({ pace: 0, laborTax: .4 });
    const game = fixture([base, first, second], (us, foreign) => us.id === first.id && foreign.id === second.id
      ? { utilities: [1, 1, 1], foreign: 10 } : reject);
    const excluded = game.evaluateLight(first, second);
    expect(countVotes(excluded.usUtilities, game.disagreement.usUtilities, game.weights)).toBe(100);
    const result = solveTreatyGame(game);
    expect(result.status).toBe('no-agreement');
    expect(result.menuDescription).toContain('Other asymmetric packages are not searched');
  });

  it('does not negotiate against an unverified no-treaty equilibrium', () => {
    const game = fixture([base, retention], () => ({ utilities: [1, 1, 1], foreign: 1 }));
    game.disagreementVerified = false;
    game.evaluateLight = () => { throw new Error('No treaty offers should be evaluated.'); };
    const result = solveTreatyGame(game);
    expect(result.status).toBe('not-evaluated');
    expect(result.evaluatedOfferCount).toBe(0);
    expect(result.proposal).toBeUndefined();
    expect(result.noTreaty).toBe(game.disagreement);
  });

  it('recertifies materialized ratification payoffs rather than labeling a changed result signed', () => {
    const game = fixture([base, retention], () => ({ utilities: [1, 1, 1], foreign: 1 }));
    const original = game.evaluate;
    game.evaluate = (us, foreign) => ({ ...original(us, foreign), usUtilities: Float64Array.from([-1, -1, -1]) });
    expect(() => solveTreatyGame(game)).toThrow(/ratification certificate/);
  });
});
