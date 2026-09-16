import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INPUTS, DISCOUNT_RATE, POLICIES, UTILITY_OFFSET,
  scoreForeignTrajectory, scoreTrajectory, simulateProfile, solveModel,
  type Objective, type Policy, type ProfileOutcome, type RegionYear, type SolveResult,
} from './pirates-model';
import { analyzeCoordinateVotes, analyzeMajority, changedPolicyAxes, countVotes, solveVoting, voterUtilities, workerVoterCount, VOTER_COUNT, VOTES_REQUIRED, WORKER_VOTERS } from './pirates-voting';

const policy = (pace: number, tax = 0, replacement = 0, safetyNet = 0, workerTax = 0): Policy =>
  POLICIES.find(p => p.pace === pace && p.tax === tax && p.replacement === replacement && p.safetyNet === safetyNet && p.workerTax === workerTax)!;
const utility = (index: number) => Math.log((index / 100 + UTILITY_OFFSET) / (1 + UTILITY_OFFSET));
const mean = (values: ArrayLike<number>) => Array.from(values).reduce((sum, value) => sum + value, 0) / values.length;
const vector = (value: number) => new Float64Array(VOTER_COUNT).fill(value);


interface SyntheticPayoff {
  us: number;
  usOwners?: number;
  foreignWorkers: number;
  foreignOwners?: number;
  foreignOutput?: number;
}

/** Small, rectangular games isolate the game rules from the production model. */
function strategicFixture(
  policies: readonly Policy[], foreignPolicies: readonly Policy[],
  payoff: (row: number, column: number) => SyntheticPayoff,
  foreignObjective: Objective = 'prosperity',
): SolveResult {
  const template = solveModel({}, { mode: 'us-only', objective: 'prosperity', pace: policies[0]!.pace });
  const trajectory = (workerIndex: number, ownerIndex = workerIndex, output = 100): RegionYear[] => [{
    ...template.baseline.us[0]!, year: 1, unemployment: 0, newlyDisplaced: 0, longTermDisplaced: 0,
    workerIncomeIndex: workerIndex, employedIncomeIndex: workerIndex,
    newlyDisplacedIncomeIndex: workerIndex, longTermDisplacedIncomeIndex: workerIndex,
    ownerIncomeIndex: ownerIndex, output,
  }];
  const outcomes: ProfileOutcome[] = policies.flatMap((usPolicy, row) => foreignPolicies.map((foreignPolicy, column) => {
    const values = payoff(row, column);
    const us = trajectory(values.us, values.usOwners);
    const foreign = trajectory(values.foreignWorkers, values.foreignOwners, values.foreignOutput);
    return {
      ...template.outcomes[0]!, id: `${usPolicy.id}|${foreignPolicy.id}`, usPolicy, foreignPolicy, us, foreign,
      usScore: scoreTrajectory(us, 'prosperity'), foreignScore: scoreForeignTrajectory(foreign, foreignObjective),
    };
  }));
  return {
    ...template, mode: 'strategic', effectiveMode: 'strategic', foreignObjective,
    policies, foreignPolicies, outcomes, baseline: outcomes[0]!, selected: outcomes[0]!,
    coordinated: outcomes[0]!, usBestResponse: outcomes[0]!, equilibria: [],
  };
}

describe('Representative voter trajectories', () => {
  it.each([0, .2, 1])('reconciles individual expected utility with macro welfare at reemployment %s', reemployment => {
    for (const displacement of [0, .35, 1]) {
      const inputs = { ...DEFAULT_INPUTS, reemployment, displacement, workerOwnership: 0, capitalMobility: 1 };
      const profile = simulateProfile(inputs, policy(1, 1, 1, .5, .5), policy(.67, .5, .5, 1));
      for (const trajectory of [profile.us, profile.foreign!]) {
        const voters = voterUtilities(trajectory, reemployment);
        expect(voters).toHaveLength(VOTER_COUNT);
        expect(Array.from(voters).every(Number.isFinite)).toBe(true);
        expect(mean(voters.slice(0, WORKER_VOTERS))).toBeCloseTo(scoreTrajectory(trajectory, 'workers'), 11);
        expect(mean(voters)).toBeCloseTo(scoreTrajectory(trajectory, 'prosperity'), 11);
        expect(new Set(voters.slice(WORKER_VOTERS)).size).toBe(1);
      }
    }
  });

  it('splits a fractional displacement boundary and expires new-displacement status in the next year', () => {
    const initial = simulateProfile({}, policy(0), undefined, 'us-only').us[0]!;
    const newMass = 1 / (2 * WORKER_VOTERS); // Half of the first representative worker's cell.
    const first: RegionYear = {
      ...initial, year: 1, newlyDisplaced: newMass, longTermDisplaced: 0, unemployment: newMass,
      employedIncomeIndex: 100, newlyDisplacedIncomeIndex: 50, longTermDisplacedIncomeIndex: 100,
    };
    const second: RegionYear = {
      ...initial, year: 2, newlyDisplaced: 0, longTermDisplaced: newMass / 2, unemployment: newMass / 2,
      employedIncomeIndex: 100, newlyDisplacedIncomeIndex: 100, longTermDisplacedIncomeIndex: 0,
    };
    const voters = voterUtilities([initial, first, second], .5);
    const firstWeight = (1 + DISCOUNT_RATE) ** -1;
    const secondWeight = (1 + DISCOUNT_RATE) ** -2;
    const expected = (firstWeight * .5 * utility(50) + secondWeight * .25 * utility(0)) / (firstWeight + secondWeight);
    expect(voters[0]).toBeCloseTo(expected, 12);
    expect(Array.from(voters.slice(1)).every(value => value === 0)).toBe(true);
    expect(mean(voters.slice(0, WORKER_VOTERS))).toBeCloseTo(scoreTrajectory([initial, first, second], 'workers'), 12);
  });

  it('handles every worker displaced and zero income without inventing resources', () => {
    const inputs = { ...DEFAULT_INPUTS, displacement: 1, reemployment: 0, workerOwnership: 0,
      productivityGain: 0, investmentResponse: 0 };
    const profile = simulateProfile(inputs, policy(1), undefined, 'us-only');
    const last = profile.us.at(-1)!;
    expect(last.unemployment).toBeCloseTo(1, 12);
    expect(last.displacedIncome).toBe(0);
    const voters = voterUtilities(profile.us, 0);
    expect(Array.from(voters).every(Number.isFinite)).toBe(true);
    expect(Array.from(voters.slice(0, WORKER_VOTERS)).every(value => value < 0)).toBe(true);
    expect(mean(voters.slice(0, WORKER_VOTERS))).toBeCloseTo(scoreTrajectory(profile.us, 'workers'), 11);
  });

  it.each([.01, .137, .5, .9, .99])('uses exactly the specified worker-to-owner ratio at worker share %s', workerShare => {
    const inputs = { ...DEFAULT_INPUTS, workerShare, displacement: 1, reemployment: 0, workerOwnership: 0 };
    const profile = simulateProfile(inputs, policy(1, .5, 1), undefined, 'us-only');
    const voters = voterUtilities(profile.us, 0, workerShare);
    const workers = workerVoterCount(workerShare);
    expect(workers).toBe(Math.round(workerShare * 1000));
    expect(voters).toHaveLength(1000);
    expect(mean(voters.slice(0, workers))).toBeCloseTo(scoreTrajectory(profile.us, 'workers'), 11);
    expect(mean(voters)).toBeCloseTo(scoreTrajectory(profile.us, 'prosperity'), 11);
    expect(new Set(voters.slice(workers)).size).toBe(1);
  });
});

describe('Absolute-majority rule and sophisticated voting', () => {
  it('requires 501 strict votes, counts all owners, and retains indifference', () => {
    const incumbent = vector(0);
    const fiveHundred = vector(-1); fiveHundred.fill(1, 0, 500);
    expect(countVotes(fiveHundred, incumbent)).toBe(500);
    fiveHundred[500] = 1;
    expect(countVotes(fiveHundred, incumbent)).toBe(VOTES_REQUIRED);
    const ownersAndWorkers = vector(-1); ownersAndWorkers.fill(1, 0, 400); ownersAndWorkers.fill(1, 900);
    expect(countVotes(ownersAndWorkers, incumbent)).toBe(500);
    ownersAndWorkers[400] = 1;
    expect(countVotes(ownersAndWorkers, incumbent)).toBe(501);
    const plurality = vector(0); plurality.fill(1, 0, 499); plurality.fill(-1, 499, 899);
    expect(countVotes(plurality, incumbent)).toBe(499);
    expect(countVotes(incumbent, plurality)).toBe(400);
    const analysis = analyzeMajority([incumbent, plurality]);
    expect(analysis.condorcetWinners).toEqual([]);
    expect(analysis.unbeaten).toEqual([0, 1]);
    expect(analysis.selection).toBe('majority-unbeaten');
    expect(analysis.selected).toBe(0);
  });

  it('treats numerical indifference before counting voters', () => {
    const challenger = vector(0); challenger.fill(1e-10, 0, 501);
    expect(countVotes(challenger, vector(0))).toBe(0);
    challenger.fill(1.01e-10, 0, 501);
    expect(countVotes(challenger, vector(0))).toBe(501);
    expect(() => countVotes([1], [0])).toThrow(RangeError);
  });

  it.each([.499, .5, .501])('counts workers as %s of the electorate at the majority boundary', workerShare => {
    const workers = workerVoterCount(workerShare);
    const challenger = vector(-1); challenger.fill(1, 0, workers);
    const analysis = analyzeMajority([vector(0), challenger]);
    expect(analysis.pairwiseVotes[1]![0]).toBe(workers);
    expect(analysis.selected).toBe(workers >= VOTES_REQUIRED ? 1 : 0);
  });

  it('preserves exact votes while merging misaligned and singleton utility runs', () => {
    const challenger = vector(-1); challenger.fill(2, 0, 200); challenger.fill(1, 200, 800);
    const incumbent = vector(2); incumbent.fill(1, 0, 400); incumbent.fill(0, 400, 600);
    const alternating = Float64Array.from({ length: 1000 }, (_, voter) => voter % 2 ? 2 : -1);
    const toleranceBoundary = Float64Array.from(incumbent, (value, voter) => value + (voter % 3 ? 1e-10 : 1.01e-10));
    const alternatives = [challenger, incumbent, alternating, toleranceBoundary];
    const result = analyzeMajority(alternatives);
    expect(result.pairwiseVotes[0]![1]).toBe(400);
    for (let first = 0; first < alternatives.length; first++) for (let second = 0; second < alternatives.length; second++) {
      expect(result.pairwiseVotes[first]![second]).toBe(countVotes(alternatives[first]!, alternatives[second]!));
    }
  });

  it('requires strict wins over every policy and distinguishes indifferent duplicates', () => {
    const strict = analyzeMajority([vector(0), vector(1), vector(2)]);
    expect(strict.condorcetWinners).toEqual([2]);
    expect(strict.selected).toBe(2);
    expect(strict.selection).toBe('condorcet');
    const duplicates = analyzeMajority([vector(0), vector(1), vector(1)]);
    expect(duplicates.condorcetWinners).toEqual([]);
    expect(duplicates.unbeaten).toEqual([1, 2]);
    expect(duplicates.equivalentGroups).toEqual([[1, 2]]);
    expect(duplicates.hasMajorityCycle).toBe(false);
  });

  it('does not turn a chain of approximate indifferences into an equivalence group', () => {
    const analysis = analyzeMajority([vector(0), vector(.75e-10), vector(-.75e-10)]);
    expect(analysis.equivalentGroups).toEqual([[0, 1]]);
    expect(analysis.pairwiseVotes[1]![2]).toBe(1000);
  });

  it('solves a genuine majority cycle backward and exposes agenda dependence', () => {
    // The last 100 entries are identical owners. A > B: 650; B > C: 700; C > A: 650.
    const a = [...Array(350).fill(3), ...Array(350).fill(1), ...Array(300).fill(2)];
    const b = [...Array(350).fill(2), ...Array(350).fill(3), ...Array(300).fill(1)];
    const c = [...Array(350).fill(1), ...Array(350).fill(2), ...Array(300).fill(3)];
    const abc = analyzeMajority([a, b, c], 0, [0, 1, 2]);
    expect(abc.pairwiseVotes[0]![1]).toBe(650);
    expect(abc.pairwiseVotes[1]![2]).toBe(700);
    expect(abc.pairwiseVotes[2]![0]).toBe(650);
    expect(abc.condorcetWinners).toEqual([]);
    expect(abc.unbeaten).toEqual([]);
    expect(abc.hasMajorityCycle).toBe(true);
    expect(abc.selection).toBe('agenda-majority');
    expect(abc.selected).toBe(1); // Sincere forward voting would incorrectly select C.
    expect(abc.agendaSteps[0]).toMatchObject({
      incumbent: 0, challenger: 1, continuationIfRejected: 2, continuationIfAccepted: 1,
      votesForChange: 700, accepted: true,
    });
    const acb = analyzeMajority([a, b, c], 0, [0, 2, 1]);
    expect(acb.selected).toBe(0);
    expect(abc.pairwiseVotes[0]![abc.selected]).toBe(650); // Agenda selection is not stability.
  });

  it('rejects malformed electorates and agendas', () => {
    expect(() => analyzeMajority([])).toThrow(RangeError);
    expect(() => analyzeMajority([vector(NaN)])).toThrow(RangeError);
    expect(() => analyzeMajority([vector(0)], 1)).toThrow(RangeError);
    expect(() => analyzeMajority([vector(0), vector(1)], 0, [0, 0])).toThrow(RangeError);
  });
});

describe('Voting over the economic policy menu', () => {
  it('lets every self-interested voter reject a higher owner tax when its investment cost lowers their own income', () => {
    const inputs = { ...DEFAULT_INPUTS, workerShare: .55, workerOwnership: .5,
      investmentResponse: 1, productivityGain: 1, displacement: 0 };
    const compare = (investmentResponse: number) => {
      const parameters = { ...inputs, investmentResponse };
      const halfTax = simulateProfile(parameters, policy(1, .5), undefined, 'us-only');
      const fullTax = simulateProfile(parameters, policy(1, 1), undefined, 'us-only');
      return {
        half: voterUtilities(halfTax.us, parameters.reemployment, parameters.workerShare),
        full: voterUtilities(fullTax.us, parameters.reemployment, parameters.workerShare),
      };
    };
    const withResponse = compare(1);
    const workers = workerVoterCount(inputs.workerShare);
    expect(Array.from(withResponse.half.slice(0, workers)).every((value, voter) => value > withResponse.full[voter]!)).toBe(true);
    expect(Array.from(withResponse.half.slice(workers)).every((value, owner) => value > withResponse.full[workers + owner]!)).toBe(true);
    expect(countVotes(withResponse.half, withResponse.full)).toBe(1000);

    // Holding production unchanged reverses workers' private income incentive:
    // 550 workers favor the larger transfer; 450 owners favor the lower levy.
    const withoutResponse = compare(0);
    expect(countVotes(withoutResponse.full, withoutResponse.half)).toBe(550);
    expect(countVotes(withoutResponse.half, withoutResponse.full)).toBe(450);
  });

  it('keeps separate-decision stability distinct from a winning joint package', () => {
    const policies = [policy(1, 0, 0, 0), policy(1, 0, 1, 0), policy(1, 0, 0, 1), policy(1, 0, 1, 1)];
    const votes = analyzeMajority([vector(1), vector(0), vector(0), vector(2)]).pairwiseVotes;
    const separate = analyzeCoordinateVotes(policies, votes, 0);
    expect(separate.stable).toEqual([0, 3]);
    expect(separate.selected).toBe(0);
    expect(separate.maxDeviationVotes[0]).toBe(0);
    expect(votes[3]![0]).toBe(1000);
    expect(separate.agenda.winner).toBe(3); // The fallback agenda does not override a stable status quo.
    expect(changedPolicyAxes(policy(1, 0, 0, 0, .5), policy(1))).toEqual(['workerTax']);
    expect(changedPolicyAxes(policy(1, .5, 0, 0, .5), policy(1))).toEqual(['workerTax', 'tax']);
  });

  it('solves a coordinate cycle using state-dependent amendments and reports its remaining defeat', () => {
    const policies = [policy(1, 0, 0, 0), policy(1, 0, 1, 0), policy(1, 0, 0, 1), policy(1, 0, 1, 1)];
    const preferences = [
      [...Array(350).fill(3), ...Array(350).fill(1), ...Array(300).fill(4)],
      [...Array(350).fill(4), ...Array(350).fill(2), ...Array(300).fill(2)],
      [...Array(350).fill(2), ...Array(350).fill(4), ...Array(300).fill(1)],
      [...Array(350).fill(1), ...Array(350).fill(3), ...Array(300).fill(3)],
    ];
    const votes = analyzeMajority(preferences).pairwiseVotes;
    const separate = analyzeCoordinateVotes(policies, votes, 0);
    expect(separate.stable).toEqual([]);
    expect(separate.hasMajorityCycle).toBe(true);
    expect(separate.selected).toBe(0); // Naive forward voting would incorrectly end at D.
    expect(separate.maxDeviationVotes[separate.selected]).toBe(700);
    expect(separate.agenda.steps.find(step => step.axis === 'replacement' && step.value === 1)).toMatchObject({
      incumbent: 0, challenger: 1, continuationIfRejected: 0, continuationIfAccepted: 3,
      votesForChange: 350, accepted: false,
    });
    expect(separate.agenda.agenda.some(amendment => amendment.axis === 'pace')).toBe(false);
  });

  it('uses the fixed-pace voting status quo and does not use scalar welfare to choose policies', () => {
    const model = solveModel(DEFAULT_INPUTS, { mode: 'us-only', objective: 'output', pace: 1 });
    const result = solveVoting(model);
    expect(result.outcomes).toHaveLength(108);
    expect(result.statusQuo.usPolicy).toMatchObject({ pace: 1, tax: 0, replacement: 0, safetyNet: 0, workerTax: 0 });
    expect(result.statusQuo.id).not.toBe(model.baseline.id);
    expect(result.agendaOrder[0]).toBe(result.statusQuo.usPolicy.id);
    expect(result.ballots).toBe('separate');
    for (const incumbent of result.outcomes) {
      const independentMaximum = Math.max(...result.outcomes.filter(challenger => changedPolicyAxes(challenger.usPolicy, incumbent.usPolicy).length === 1).map(challenger =>
        countVotes(voterUtilities(challenger.us, model.inputs.reemployment), voterUtilities(incumbent.us, model.inputs.reemployment))));
      expect(incumbent.usDeviationVotes).toBe(independentMaximum);
    }
    const changedScores = { ...model, outcomes: model.outcomes.map((outcome, index) => ({
      ...outcome, usScore: -index * 1000, globalScore: index * 1000,
    })) };
    const rescored = solveVoting(changedScores);
    expect(rescored.selected.id).toBe(result.selected.id);
    expect(rescored.pairwiseVotes).toEqual(result.pairwiseVotes);
    expect(result.selected.usPackageDeviationVotes).toBe(Math.max(...result.outcomes.map(challenger => result.votesForChange(challenger, result.selected))));
  });

  it('keeps an entirely indifferent menu majority-unbeaten and preserves its status quo', () => {
    const model = solveModel({}, { mode: 'us-only', objective: 'workers', pace: 0 });
    const result = solveVoting({ ...model, outcomes: model.outcomes.map(outcome => ({ ...outcome, us: model.baseline.us })) });
    expect(result.condorcetWinners).toHaveLength(0);
    expect(result.majorityUnbeaten).toHaveLength(108);
    expect(result.majorityStable).toHaveLength(108);
    expect(result.equivalentPolicyGroups).toHaveLength(1);
    expect(result.equivalentPolicyGroups[0]).toHaveLength(108);
    expect(result.selected).toBe(result.statusQuo);
    expect(result.selected.maxDeviationVotes).toBe(0);
    expect(result.hasMajorityCycle).toBe(false);
  });

  it('compares supplied trajectories even when a profile reuses an existing policy ID', () => {
    const model = solveModel({}, { mode: 'us-only', objective: 'workers', pace: 0 });
    const result = solveVoting(model);
    const incumbent = result.statusQuo;
    const challenger = { ...incumbent, us: incumbent.us.map(point => ({
      ...point, employedIncomeIndex: 200, ownerIncomeIndex: 200,
    })) };
    expect(challenger.id).toBe(incumbent.id);
    expect(result.votesForChange(challenger, incumbent)).toBe(1000);
  });

  it('checks US majority deviations and every foreign package in a rectangular international game', () => {
    const usPolicies = [policy(1), policy(1, .5)];
    const foreignPolicies = [policy(1), policy(1, .5), policy(.33, 1, 1, 1, .5)];
    const model = strategicFixture(usPolicies, foreignPolicies, (row, column) => ({
      us: row === 1 ? 150 : 100,
      foreignWorkers: [100, 50, 200][column]!,
    }));
    const result = solveVoting(model);
    expect(result.outcomes).toHaveLength(6);
    const independentStable: string[] = [];
    for (const incumbent of result.outcomes) {
      const usAlternatives = result.outcomes.filter(challenger =>
        challenger.foreignPolicy!.id === incumbent.foreignPolicy!.id
        && changedPolicyAxes(challenger.usPolicy, incumbent.usPolicy).length === 1);
      const usMaximum = Math.max(0, ...usAlternatives.map(challenger => result.votesForChange(challenger, incumbent)));
      const foreignAlternatives = result.outcomes.filter(challenger => challenger.usPolicy.id === incumbent.usPolicy.id);
      const foreignBestScore = Math.max(...foreignAlternatives.map(challenger => challenger.foreignScore!));
      const foreignGain = foreignBestScore - incumbent.foreignScore!;
      expect(incumbent.usDeviationVotes).toBe(usMaximum);
      expect(incumbent.maxDeviationVotes).toBe(usMaximum);
      expect(incumbent.foreignBestResponseGain).toBeCloseTo(foreignGain, 12);
      expect(incumbent.foreignBestResponsePolicyId).toBe(foreignPolicies[2]!.id);
      if (usMaximum < VOTES_REQUIRED && foreignGain <= 1e-10) independentStable.push(incumbent.id);
    }
    expect(result.majorityStable.map(outcome => outcome.id)).toEqual(independentStable);
    expect(result.majorityStable).toHaveLength(1);
    expect(result.selection).toBe('international-stable');
    expect(result.selected.usPolicy.id).toBe(usPolicies[1]!.id);
    expect(result.selected.foreignPolicy!.id).toBe(foreignPolicies[2]!.id);
    expect(result.selected.foreignPolicy!.pace).not.toBe(result.selected.usPolicy.pace);
    expect(changedPolicyAxes(foreignPolicies[0]!, foreignPolicies[2]!).length).toBeGreaterThan(1);
    expect(result.selected.foreignBestResponseGain).toBe(0);
    expect(result.selected.usPackageDeviationVotes).toBe(0);

    // Even under separate US ballots, the foreign actor can change its entire package.
    expect(result.statusQuo.foreignBestResponseGain).toBeGreaterThan(0);
    expect(result.statusQuo.foreignBestResponsePolicyId).toBe(foreignPolicies[2]!.id);
  });

  it.each([.5, .501])('still requires 501 US votes in the international game at worker share %s', workerShare => {
    const usPolicies = [policy(1), policy(1, .5)];
    const model = strategicFixture(usPolicies, [policy(1)], row => ({
      us: row === 1 ? 200 : 100, usOwners: row === 1 ? 50 : 100, foreignWorkers: 100,
    }));
    model.inputs.workerShare = workerShare;
    for (const outcome of model.outcomes) for (const point of outcome.us) point.workerShare = workerShare;
    const result = solveVoting(model);
    expect(result.statusQuo.usDeviationVotes).toBe(Math.round(workerShare * VOTER_COUNT));
    expect(result.selected.usPolicy.id).toBe(usPolicies[workerShare > .5 ? 1 : 0]!.id);
    expect(result.selection).toBe('international-stable');
    expect(result.selected.foreignBestResponseGain).toBe(0);
  });

  it.each([
    ['workers', 0], ['prosperity', 1], ['output', 2],
  ] as const)('lets the foreign actor optimize %s without replacing US voters with an aggregate objective', (foreignObjective, expectedColumn) => {
    const usPolicies = [policy(1), policy(1, .5)];
    const foreignPolicies = [policy(1), policy(.67, .5), policy(.33, 1)];
    const foreignPayoffs = [
      { foreignWorkers: 150, foreignOwners: 1, foreignOutput: 100 },
      { foreignWorkers: 140, foreignOwners: 400, foreignOutput: 120 },
      { foreignWorkers: 100, foreignOwners: 100, foreignOutput: 200 },
    ];
    const model = strategicFixture(usPolicies, foreignPolicies, (row, column) => ({
      us: row === 1 ? 150 : 100, ...foreignPayoffs[column]!,
    }), foreignObjective);
    const result = solveVoting(model);
    expect(result.selected.usPolicy.id).toBe(usPolicies[1]!.id);
    expect(result.selected.foreignPolicy!.id).toBe(foreignPolicies[expectedColumn]!.id);
    expect(result.selected.foreignBestResponseGain).toBe(0);
    expect(result.selection).toBe('international-stable');

    const rescored = solveVoting({ ...model, objective: 'output', outcomes: model.outcomes.map(outcome => ({
      ...outcome, usScore: outcome.usPolicy.id === usPolicies[0]!.id ? 1e6 : -1e6,
      globalScore: outcome.usPolicy.id === usPolicies[0]!.id ? 1e6 : -1e6,
    })) });
    expect(rescored.selected.id).toBe(result.selected.id);
    expect(rescored.outcomes.map(outcome => outcome.usDeviationVotes)).toEqual(result.outcomes.map(outcome => outcome.usDeviationVotes));
  });

  it('retains all tied foreign best responses and an already stable status quo', () => {
    const foreignPolicies = [policy(1), policy(.33, 1, 1, 1)];
    const model = strategicFixture([policy(1)], foreignPolicies, () => ({ us: 100, foreignWorkers: 100 }));
    const result = solveVoting(model);
    expect(result.majorityStable).toHaveLength(2);
    expect(result.majorityStable.every(outcome => outcome.foreignBestResponseGain === 0)).toBe(true);
    expect(result.selected).toBe(result.statusQuo);
    expect(result.selection).toBe('international-stable');
    expect(result.hasMajorityCycle).toBe(false);
  });

  it('reports no stable pair and keeps the foreign actor rational in a matching-pennies game', () => {
    const policies = [policy(1), policy(1, .5)];
    const model = strategicFixture(policies, policies, (row, column) => ({
      us: row === column ? 200 : 50,
      foreignWorkers: row !== column ? 200 : 50,
    }));
    const result = solveVoting(model);
    expect(result.majorityStable).toHaveLength(0);
    expect(result.selection).toBe('foreign-best-response-fallback');
    expect(result.selected.usDeviationVotes).toBe(1000);
    expect(result.selected.maxDeviationVotes).toBe(1000);
    expect(result.selected.foreignBestResponseGain).toBe(0);
    expect(result.hasMajorityCycle).toBe(true);
    expect(result.selected.id).not.toBe(result.statusQuo.id);
    const foreignBestResponses = result.outcomes.filter(outcome => outcome.foreignBestResponseGain <= 1e-10);
    expect(foreignBestResponses).toHaveLength(2);
    expect(result.selected.usDeviationVotes).toBe(Math.min(...foreignBestResponses.map(outcome => outcome.usDeviationVotes)));
  });
});
