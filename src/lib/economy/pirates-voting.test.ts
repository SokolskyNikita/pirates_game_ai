import { describe, expect, it } from 'vitest';
import { EQUILIBRIUM_TOLERANCE, solveModel, type LightProfile, type Policy, type ProfileOutcome } from './pirates-model';
import {
  changedPolicyAxes, coordinateAlternatives, countVotes, hasMajority, solveWeightedGame,
  type WeightedGame,
} from './pirates-voting';

function policy(changes: Partial<Policy> = {}): Policy {
  const fields = {
    pace: 1, replacement: 0, welfareScale: 1, benefitFormula: 'current' as const,
    laborTax: .2, capitalTax: .2, ...changes,
  };
  return {
    ...fields,
    id: [fields.pace, fields.replacement, fields.welfareScale, fields.benefitFormula, fields.laborTax, fields.capitalTax].join('|'),
    label: 'Synthetic policy',
  };
}

function fixture(
  policies: readonly Policy[], weights: readonly number[],
  utilities: (us: Policy, foreign?: Policy) => number[],
  foreignPolicies: readonly Policy[] = [],
  foreignPayoff: (us: Policy, foreign: Policy) => number = () => 0,
): WeightedGame {
  const evaluateLight = (us: Policy, foreign?: Policy): LightProfile => ({
    id: `${us.id}/${foreign?.id ?? ''}`, usPolicy: us, foreignPolicy: foreign,
    usUtilities: Float64Array.from(utilities(us, foreign)), usScore: 0, usAdmissible: true, foreignAdmissible: foreign ? true : undefined,
    foreignScore: foreign ? foreignPayoff(us, foreign) : undefined,
  });
  return {
    policies, foreignPolicies, weights, currentPolicy: policies[0]!, foreignCurrentPolicy: foreignPolicies[0],
    evaluateLight, evaluateForeign: foreignPayoff,
    evaluate: (us, foreign): ProfileOutcome => ({ ...evaluateLight(us, foreign), us: [], foreign: foreign ? [] : undefined, feasible: true, fundingGap: 0 }),
  };
}

function independentStrongest(game: WeightedGame, us: Policy, foreign?: Policy): number {
  const incumbent = game.evaluateLight(us, foreign);
  return Math.max(0, ...coordinateAlternatives(game.policies, us).filter(challenger => game.evaluateLight(challenger, foreign).usAdmissible).map(challenger =>
    countVotes(game.evaluateLight(challenger, foreign).usUtilities, incumbent.usUtilities, game.weights)));
}

function certify(game: WeightedGame, result: ReturnType<typeof solveWeightedGame>) {
  const selected = result.selected;
  const strongest = independentStrongest(game, selected.usPolicy, selected.foreignPolicy);
  expect(selected.usDeviationVotes).toBeCloseTo(strongest, 10);
  if (result.selection === 'verified-stable') {
    expect(selected.usAdmissible).toBe(true);
    expect(hasMajority(strongest)).toBe(false);
  }
  if (game.foreignPolicies.length) {
    const best = Math.max(...game.foreignPolicies.filter(foreign => game.evaluateLight(selected.usPolicy, foreign).foreignAdmissible).map(foreign => game.evaluateLight(selected.usPolicy, foreign).foreignScore!));
    expect(selected.foreignBestResponseGain).toBeCloseTo(Math.max(0, best - selected.foreignScore!), 12);
    if (result.selection === 'verified-stable') expect(best - selected.foreignScore!).toBeLessThanOrEqual(EQUILIBRIUM_TOLERANCE);
  }
}

describe('Equal votes with survey population weights', () => {
  it('requires strictly more than half of all citizens, without a 0.1% synthetic voter increment', () => {
    expect(countVotes([1, -1], [0, 0], [.5, .5])).toBe(50);
    expect(hasMajority(50)).toBe(false);
    expect(hasMajority(countVotes([1, -1], [0, 0], [.500001, .499999]))).toBe(true);
    expect(hasMajority(countVotes([1, 0, -1], [0, 0, 0], [49, 11, 40]))).toBe(false);
    expect(countVotes([1, 0, -1], [0, 0, 0], [49, 11, 40])).toBe(49);
  });

  it('is invariant to scaling, consistent permutation and subdivision of identical cells', () => {
    const baseline = countVotes([2, 0, 3], [1, 0, 4], [3.7, 1.1, 2.3]);
    expect(countVotes([2, 0, 3], [1, 0, 4], [370, 110, 230])).toBeCloseTo(baseline, 12);
    expect(countVotes([3, 2, 0], [4, 1, 0], [2.3, 3.7, 1.1])).toBeCloseTo(baseline, 12);
    expect(countVotes([2, 2, 0, 3], [1, 1, 0, 4], [1.8, 1.9, 1.1, 2.3])).toBeCloseTo(baseline, 12);
  });

  it('does not give a high-income cell more votes or discard nonworking citizens', () => {
    // Equal utility gains can describe any income level; only population counts.
    expect(countVotes([1, 1000, -1], [0, 0, 0], [30, 10, 60])).toBe(40);
    expect(countVotes([1000, 1, -1], [0, 0, 0], [30, 10, 60])).toBe(40);
    expect(countVotes([1, 1, -1], [0, 0, 0], [30, 25, 45])).toBe(55);
  });

  it('keeps utility indifference separate from population-sum tolerance', () => {
    expect(countVotes([EQUILIBRIUM_TOLERANCE, 0], [0, 0], [90, 10])).toBe(0);
    expect(countVotes([EQUILIBRIUM_TOLERANCE * 1.01, 0], [0, 0], [90, 10])).toBe(90);
    expect(hasMajority(50 + 1e-12)).toBe(false);
    expect(hasMajority(50 + 1e-8)).toBe(true);
  });

  it('rejects malformed weights and mismatched or nonfinite utilities', () => {
    for (const weights of [[], [0, 0], [-1, 2], [Infinity, 1], [NaN, 1]]) {
      expect(() => countVotes([1, 1], [0, 0], weights)).toThrow(RangeError);
    }
    expect(() => countVotes([1], [0, 0], [1, 1])).toThrow(RangeError);
    expect(() => countVotes([1, NaN], [0, 0], [1, 1])).toThrow(RangeError);
  });
});

describe('Five independent majority decisions', () => {
  it('treats benefit formula as an independent coordinate', () => {
    const base = policy();
    expect(changedPolicyAxes(base, policy({ benefitFormula: 'flat' }))).toEqual(['benefitFormula']);
    expect(changedPolicyAxes(base, policy({ benefitFormula: 'flat', welfareScale: 1.5 })))
      .toEqual(['welfareScale', 'benefitFormula']);
    const policies = ['current', 'flat', 'prior-income'].map(benefitFormula => policy({ benefitFormula: benefitFormula as Policy['benefitFormula'] }));
    const game = fixture(policies, [.4, .35, .25], us => us.benefitFormula === 'flat' ? [2, 2, 0] : us.benefitFormula === 'current' ? [1, 1, 1] : [0, 0, 2]);
    const result = solveWeightedGame(game);
    expect(result.selected.usPolicy.benefitFormula).toBe('flat');
    expect(result.selection).toBe('verified-stable');
    certify(game, result);
  });

  it('finds and independently verifies all five coordinate decisions', () => {
    const policies = [0, 1].flatMap(replacement => [1, 2].flatMap(welfareScale =>
      (['current', 'flat'] as const).flatMap(benefitFormula => [.2, .4].flatMap(laborTax => [.2, .4].map(capitalTax =>
        policy({ replacement, welfareScale, benefitFormula, laborTax, capitalTax }))))));
    const game = fixture(policies, [3, 2, 1], us => {
      const payoff = us.replacement + us.welfareScale + (us.benefitFormula === 'flat' ? 1 : 0) + us.laborTax + us.capitalTax;
      return [payoff, payoff, payoff];
    });
    const result = solveWeightedGame(game);
    expect(result.selection).toBe('verified-stable');
    expect(result.selected.usPolicy).toMatchObject({ replacement: 1, welfareScale: 2, benefitFormula: 'flat', laborTax: .4, capitalTax: .4 });
    expect(result.searchComplete).toBe(false);
    certify(game, result);
  });

  it('keeps the designated current policy on complete indifference, instead of forcing zero taxes or benefits', () => {
    const policies = [0, .2].flatMap(laborTax => [0, 1].map(welfareScale => policy({ laborTax, welfareScale })));
    const game = fixture(policies, [7, 3], () => [0, 0]);
    game.currentPolicy = policies.at(-1)!;
    const result = solveWeightedGame(game);
    expect(result.selected.usPolicy.id).toBe(game.currentPolicy.id);
    expect(result.selected.usPolicy).toMatchObject({ laborTax: .2, welfareScale: 1 });
    expect(result.selected.usDeviationVotes).toBe(0);
    expect(result.selection).toBe('verified-stable');
  });

  it('does not claim package stability for a separately stable result', () => {
    const policies = [0, 1].flatMap(replacement => [1, 2].map(welfareScale => policy({ replacement, welfareScale })));
    const game = fixture(policies, [6, 4], us => {
      const payoff = us.replacement === 1 && us.welfareScale === 2 ? 2 : us.replacement === 0 && us.welfareScale === 1 ? 1 : 0;
      return [payoff, payoff];
    });
    const result = solveWeightedGame(game);
    expect(result.selection).toBe('verified-stable');
    expect(result.selected.usPolicy.id).toBe(policies[0]!.id);
    expect(countVotes(game.evaluateLight(policies[3]!).usUtilities, result.selected.usUtilities, game.weights)).toBe(100);
    expect(result.selected.usPackageDeviationVotes).toBeUndefined();
    certify(game, result);
  });

  it('reports an unresolved majority cycle as search-incomplete, never as proof of no equilibrium', () => {
    const policies = [0, 1, 2].map(welfareScale => policy({ welfareScale }));
    const preferences = [[3, 1, 2], [2, 3, 1], [1, 2, 3]];
    const game = fixture(policies, [.35, .35, .3], us => preferences[us.welfareScale]!);
    const result = solveWeightedGame(game);
    expect(result.selection).toBe('search-incomplete');
    expect(result.majorityStable).toEqual([]);
    expect(result.hasMajorityCycle).toBe(true);
    expect(result.searchComplete).toBe(false);
    expect(hasMajority(result.selected.usDeviationVotes)).toBe(true);
    certify(game, result);
  });

  it('rechecks the actual last amendment when a walk exhausts its budget', () => {
    const policies = [0, 1, 2, 3].map(welfareScale => policy({ welfareScale }));
    const game = fixture(policies, [1], us => [us.welfareScale]);
    const result = solveWeightedGame(game, { starts: 1, rounds: 1, amendments: 1 });
    expect(result.selection).toBe('search-incomplete');
    expect(result.selected.usPolicy.welfareScale).toBe(1);
    expect(result.selected.usDeviationVotes).toBe(100);
    certify(game, result);
  });

  it('rejects an incomplete coordinate menu and a missing current-policy baseline', () => {
    const game = fixture([policy(), policy({ replacement: 1, welfareScale: 2 })], [1], () => [0]);
    expect(() => solveWeightedGame(game)).toThrow(/complete menu/);
    const complete = fixture([policy()], [1], () => [0]);
    complete.currentPolicy = policy({ laborTax: .7 });
    expect(() => solveWeightedGame(complete)).toThrow(/baseline/);
  });
});

describe('One foreign optimizer with its own full policy menu', () => {
  it('tests every foreign package, including different pace and combined decisions', () => {
    const policies = [policy(), policy({ replacement: 1 })];
    const foreign = [0, .33, .67, 1].flatMap(pace => [0, 1].flatMap(replacement => [.2, .8].map(capitalTax =>
      policy({ pace, replacement, capitalTax }))));
    const scored = new Set<string>();
    const game = fixture(policies, [.6, .4], us => [us.replacement, us.replacement], foreign,
      (_, other) => other.pace === 1 && other.replacement === 1 && other.capitalTax === .8 ? 5 : 0);
    const evaluateForeign = game.evaluateForeign!;
    game.evaluateForeign = (us, other) => { scored.add(other.id); return evaluateForeign(us, other); };
    const result = solveWeightedGame(game);
    expect(result.selection).toBe('verified-stable');
    expect(result.selected.foreignPolicy).toMatchObject({ pace: 1, replacement: 1, capitalTax: .8 });
    expect(scored.size).toBe(foreign.length);
    expect(result.selected.foreignBestResponseGain).toBe(0);
    expect(result.selected.usPolicy.replacement).toBe(1);
    certify(game, result);
  });

  it('allows foreign indifference without manufacturing votes for that actor', () => {
    const foreign = [policy({ pace: 0 }), policy({ pace: 1 })];
    const game = fixture([policy()], [.8, .2], () => [0, 0], foreign, () => 1);
    game.foreignCurrentPolicy = foreign[1];
    const result = solveWeightedGame(game);
    expect(result.selected.foreignPolicy?.id).toBe(foreign[1]!.id);
    expect(result.selected.foreignBestResponseGain).toBe(0);
    expect(result.selected).not.toHaveProperty('foreignDeviationVotes');
    certify(game, result);
  });

  it('keeps US majority challenges distinct from foreign utility in a game without a pure stable pair', () => {
    const policies = [policy({ replacement: 0 }), policy({ replacement: 1 })];
    const foreign = [policy({ pace: 0 }), policy({ pace: 1 })];
    const game = fixture(policies, [.7, .3], (us, other) => us.replacement === other!.pace ? [1, 1] : [0, 0],
      foreign, (us, other) => us.replacement === other.pace ? 0 : 1000000);
    const result = solveWeightedGame(game);
    expect(result.selection).toBe('search-incomplete');
    expect(result.selected.foreignBestResponseGain).toBe(0);
    expect(result.selected.usDeviationVotes).toBe(100);
    expect(result.majorityStable).toEqual([]);
    certify(game, result);
  });

  it('uses a true foreign maximum rather than chaining tolerant improvements', () => {
    const foreign = [0, .33, .67, 1].map(pace => policy({ pace }));
    const game = fixture([policy()], [1], () => [0], foreign, (_, other) => foreign.indexOf(other) * .75e-10);
    const result = solveWeightedGame(game);
    expect(result.selected.foreignPolicy?.id).toBe(foreign[3]!.id);
    expect(result.selected.foreignBestResponseGain).toBe(0);
    certify(game, result);
  });

  it('rejects nonfinite foreign payoff instead of returning a stable label', () => {
    const game = fixture([policy()], [1], () => [0], [policy({ pace: 0 })], () => NaN);
    expect(() => solveWeightedGame(game)).toThrow(/finite payoff/);
  });
});


describe('Fiscal availability is a constraint, not an invented majority', () => {
  it('excludes an attractive but unavailable US amendment', () => {
    const policies = [policy(), policy({ capitalTax: 0 })];
    const game = fixture(policies, [1], us => [us.capitalTax === 0 ? 100 : 0]);
    const originalLight = game.evaluateLight;
    game.evaluateLight = (us, foreign) => ({ ...originalLight(us, foreign), usAdmissible: us.capitalTax !== 0 });
    game.evaluate = (us, foreign) => ({ ...game.evaluateLight(us, foreign), us: [], foreign: undefined, feasible: true, fundingGap: 0 });
    const result = solveWeightedGame(game);
    expect(result.selection).toBe('verified-stable');
    expect(result.selected.usPolicy.capitalTax).toBe(.2);
    expect(result.selected.usDeviationVotes).toBe(0);
    certify(game, result);
  });

  it('can repair an unavailable starting policy without labeling the repair a majority vote', () => {
    const policies = [0, .2, .4].map(capitalTax => policy({ capitalTax }));
    const game = fixture(policies, [1], us => [us.capitalTax === 0 ? 100 : us.capitalTax]);
    const originalLight = game.evaluateLight;
    game.evaluateLight = (us, foreign) => ({ ...originalLight(us, foreign), usAdmissible: us.capitalTax !== 0 });
    game.evaluate = (us, foreign) => ({ ...game.evaluateLight(us, foreign), us: [], foreign: undefined, feasible: true, fundingGap: 0 });
    const result = solveWeightedGame(game);
    expect(result.selection).toBe('verified-stable');
    expect(result.selected.usPolicy.capitalTax).toBe(.4);
    expect(result.selected.usDeviationVotes).toBe(0);
    expect(result.agendaSteps).toEqual([]);
    certify(game, result);
  });

  it('never labels an unavailable incumbent stable just because it has no available neighbor', () => {
    const game = fixture([policy()], [1], () => [0]);
    const originalLight = game.evaluateLight;
    game.evaluateLight = (us, foreign) => ({ ...originalLight(us, foreign), usAdmissible: false });
    game.evaluate = (us, foreign) => ({ ...game.evaluateLight(us, foreign), us: [], foreign: undefined, feasible: false, fundingGap: 1 });
    const result = solveWeightedGame(game);
    expect(result.selection).toBe('search-incomplete');
    expect(result.majorityStable).toEqual([]);
    expect(result.selected.usAdmissible).toBe(false);
  });

  it('excludes unavailable foreign packages from their optimizer', () => {
    const foreign = [policy({ pace: 0 }), policy({ pace: 1 })];
    const game = fixture([policy()], [1], () => [0], foreign, (_, other) => other.pace === 0 ? 0 : 100);
    const originalLight = game.evaluateLight;
    game.evaluateLight = (us, other) => ({ ...originalLight(us, other), foreignAdmissible: other?.pace === 0 });
    game.evaluateForeign = (_, other) => other.pace === 0 ? 0 : -Infinity;
    game.evaluate = (us, other) => ({ ...game.evaluateLight(us, other), us: [], foreign: [], feasible: true, foreignFeasible: other?.pace === 0, fundingGap: 0 });
    const result = solveWeightedGame(game);
    expect(result.selection).toBe('verified-stable');
    expect(result.selected.foreignPolicy?.pace).toBe(0);
    expect(result.selected.foreignBestResponseGain).toBe(0);
    certify(game, result);
  });
});


describe('Calibrated model and voting integration', () => {
  it.each(['workers', 'prosperity', 'output'] as const)('independently verifies the international certificate for foreign %s', foreignObjective => {
    const model = solveModel({}, { mode: 'strategic', objective: 'workers', foreignObjective, pace: 1 });
    const game: WeightedGame = {
      policies: model.policies, foreignPolicies: model.foreignPolicies, weights: model.weights,
      currentPolicy: model.currentPolicy, foreignCurrentPolicy: model.currentPolicy,
      evaluate: model.evaluate, evaluateLight: model.evaluateLight, evaluateForeign: model.evaluateForeign,
    };
    const result = solveWeightedGame(game);
    const { usPolicy, foreignPolicy } = result.selected;
    const actualMaximum = Math.max(0, ...coordinateAlternatives(model.policies, usPolicy)
      .map(policy => model.evaluateLight(policy, foreignPolicy)).filter(profile => profile.usAdmissible)
      .map(profile => countVotes(profile.usUtilities, result.selected.usUtilities, model.weights)));
    const foreignMaximum = Math.max(...model.foreignPolicies.map(policy => model.evaluateForeign(usPolicy, policy)));
    expect(result.selected.usDeviationVotes).toBeCloseTo(actualMaximum, 10);
    expect(result.selected.foreignBestResponseGain).toBeCloseTo(Math.max(0, foreignMaximum - result.selected.foreignScore!), 10);
    if (result.selection === 'verified-stable') {
      expect(result.selected.usAdmissible).toBe(true);
      expect(result.selected.foreignAdmissible).toBe(true);
      expect(hasMajority(actualMaximum)).toBe(false);
      expect(foreignMaximum - result.selected.foreignScore!).toBeLessThanOrEqual(EQUILIBRIUM_TOLERANCE);
    } else {
      expect(result.searchComplete).toBe(false);
      expect(result.majorityStable).toEqual([]);
    }
    expect(usPolicy.pace).toBe(1);
    expect(result.evaluations).toBeLessThan(model.policies.length * model.foreignPolicies.length);
  });
});


describe('Foreign availability can differ across US starting policies', () => {
  function blockedFirstSeed() {
    const policies = [policy({ replacement: 0 }), policy({ replacement: 1 })];
    const foreign = [policy({ pace: 0 }), policy({ pace: 1 })];
    const game = fixture(policies, [1], () => [0], foreign, () => 0);
    const originalLight = game.evaluateLight;
    game.evaluateLight = (us, other) => ({ ...originalLight(us, other), foreignAdmissible: us.replacement === 1 });
    game.evaluateForeign = (us) => us.replacement === 1 ? 0 : -Infinity;
    game.evaluate = (us, other) => ({ ...game.evaluateLight(us, other), us: [], foreign: [], feasible: true, foreignFeasible: us.replacement === 1, fundingGap: 0 });
    return game;
  }

  it('continues to a second seed after the first US policy makes every foreign policy unavailable', () => {
    const game = blockedFirstSeed();
    const result = solveWeightedGame(game);
    expect(result.startsTried).toBe(2);
    expect(result.selection).toBe('verified-stable');
    expect(result.selected.usPolicy.replacement).toBe(1);
    expect(result.selected.foreignAdmissible).toBe(true);
    certify(game, result);
  });

  it('describes a failed bounded search without claiming no feasible equilibrium exists', () => {
    // A verified pair exists at the second seed; this run deliberately omits it.
    const game = blockedFirstSeed();
    expect(() => solveWeightedGame(game, { starts: 1 }))
      .toThrow('No fiscally admissible international candidate found in bounded search.');
  });
});
