import {
  CALIBRATION, EQUILIBRIUM_TOLERANCE,
  type LightProfile, type Policy, type ProfileOutcome, type SolveResult,
} from './pirates-model';

/** Population estimates are continuous weights, not a rounded synthetic headcount. */
export const MAJORITY_PERCENT = 50;
export const VOTE_SUM_TOLERANCE = 1e-10;
export const POLICY_AXES = ['replacement', 'welfareScale', 'benefitFormula', 'laborTax', 'capitalTax', 'pace'] as const;
export type PolicyAxis = typeof POLICY_AXES[number];
export type PolicyValue = Policy[PolicyAxis];
export type BallotMode = 'separate';

export function hasMajority(percent: number): boolean {
  return percent > MAJORITY_PERCENT + VOTE_SUM_TOLERANCE;
}

export function changedPolicyAxes(first: Policy, second: Policy): PolicyAxis[] {
  return POLICY_AXES.filter(axis => first[axis] !== second[axis]);
}

function normalizedWeights(weights: ArrayLike<number>): Float64Array {
  if (!weights.length) throw new RangeError('An electorate needs at least one population cell.');
  let total = 0;
  for (let cell = 0; cell < weights.length; cell++) {
    const weight = weights[cell]!;
    if (!Number.isFinite(weight) || weight < 0) throw new RangeError('Population weights must be finite and nonnegative.');
    total += weight;
  }
  if (!Number.isFinite(total) || total <= 0) throw new RangeError('The electorate needs a finite, positive total population.');
  return Float64Array.from(weights, weight => weight / total * 100);
}

function compareUtilities(challenger: ArrayLike<number>, incumbent: ArrayLike<number>, weights: ArrayLike<number>): number {
  if (challenger.length !== weights.length || incumbent.length !== weights.length) {
    throw new RangeError('Every policy must retain the same population cells.');
  }
  let votes = 0;
  for (let cell = 0; cell < weights.length; cell++) {
    const candidate = challenger[cell]!, current = incumbent[cell]!;
    if (!Number.isFinite(candidate) || !Number.isFinite(current)) throw new RangeError('Every voter utility must be finite.');
    if (candidate > current + EQUILIBRIUM_TOLERANCE) votes += weights[cell]!;
  }
  return Math.min(100, Math.max(0, votes));
}

/** Share of all adult citizens strictly preferring a change. Income does not weight a vote. */
export function countVotes(challenger: ArrayLike<number>, incumbent: ArrayLike<number>, weights: ArrayLike<number> = CALIBRATION.weights): number {
  return compareUtilities(challenger, incumbent, normalizedWeights(weights));
}

export const VOTING_NOTES = [
  'Every adult US citizen has equal voting weight. Survey population weights approximate the income and employment distribution; they are not turnout weights. A change needs more than half of the entire electorate to strictly prefer it. Indifference retains the incumbent.',
  'The same population cells and their income histories are compared across every policy. Receiving a benefit or losing a job does not change a citizen’s voting weight. Each preference concerns the citizen’s own discounted expected income utility, including taxes, public payments and economic consequences.',
  'US ballots change one decision at a time: retained wages, the amount of welfare, its distribution rule, tax on labor income, or tax on capital income. US AI deployment is a scenario assumption. A verified stable policy has no single-decision challenger supported by more than 50%; a joint policy package may still defeat it.',
  'The rest of the world is one rational actor with its own objective. It can choose a different policy package and deployment pace. An international result is verified only after checking every available foreign package at the selected US policy, as well as every permitted US amendment at the selected foreign policy.',
  'A policy must fund the modeled baseline public services to be available. Underfunded alternatives cannot win a ballot. Search steps may leave an unavailable starting policy for an available one without calling that move a majority vote.',
  'The solver searches from several fixed starting policies. It follows majority-supported US amendments and foreign best responses. A reported stable result is checked against the entire permitted unilateral menu. Search failure does not prove that no stable result exists, and finding one does not prove it is unique.',
  'The search starts from current-policy tax and welfare settings. When several amendments pass, the search tests the one with the largest supporting population share first, breaking ties by policy order. This is a selection procedure, not an additional voter preference or a claim that an actual legislature would use that agenda.',
] as const;

export interface VotingOutcome extends ProfileOutcome {
  /** Percentage of the entire electorate preferring its strongest one-decision challenger. */
  usDeviationVotes: number;
  foreignBestResponseGain: number;
  foreignBestResponsePolicyId?: string;
  usBestChallengerId?: string;
  /** Not populated by the coordinate search: package stability is not claimed. */
  usPackageDeviationVotes?: number;
}

export interface VotingAgendaStep {
  incumbentId: string;
  challengerId: string;
  votesForChange: number;
  accepted: boolean;
  axis?: PolicyAxis;
  value?: PolicyValue;
}

export interface VotingResult {
  selected: VotingOutcome;
  majorityStable: VotingOutcome[];
  selection: 'verified-stable' | 'search-incomplete';
  evaluations: number;
  startsTried: number;
  iterations: number;
  /** The search never enumerates every pair or claims to find every equilibrium. */
  searchComplete: false;
  agendaSteps: VotingAgendaStep[];
  hasMajorityCycle: boolean;
  bestChallenger?: Policy;
  votesForChange: (challenger: LightProfile, incumbent: LightProfile) => number;
}

export interface WeightedGame {
  policies: readonly Policy[];
  foreignPolicies: readonly Policy[];
  weights: ArrayLike<number>;
  currentPolicy: Policy;
  foreignCurrentPolicy?: Policy;
  evaluateLight: (us: Policy, foreign?: Policy) => LightProfile;
  evaluateForeign?: (us: Policy, foreign: Policy) => number;
  evaluate: (us: Policy, foreign?: Policy) => ProfileOutcome;
}

export interface SearchOptions {
  /** A finite deterministic search; each reported equilibrium still has a complete unilateral check. */
  starts?: number;
  rounds?: number;
  amendments?: number;
  cacheSize?: number;
}

interface USCheck {
  profile: LightProfile;
  votes: number;
  challenger?: LightProfile;
}
interface ForeignCheck { policy?: Policy; score: number }
interface Candidate { check: USCheck; foreign: ForeignCheck }

function policyKey(policy: Policy): string {
  return POLICY_AXES.map(axis => policy[axis]).join('|');
}

/** Build the full one-axis neighborhood without scanning the full menu at every ballot. */
export function coordinateAlternatives(policies: readonly Policy[], policy: Policy): Policy[] {
  return policies.filter(candidate => changedPolicyAxes(policy, candidate).length === 1);
}

function neighborIndex(policies: readonly Policy[]): Map<string, Policy[]> {
  const keys = new Map<string, Policy>();
  const ids = new Set<string>();
  const values = POLICY_AXES.map(axis => [...new Set(policies.map(policy => policy[axis]))]);
  for (const policy of policies) {
    if (keys.has(policyKey(policy)) || ids.has(policy.id)) throw new RangeError('Policy IDs and decision combinations must be unique.');
    keys.set(policyKey(policy), policy);
    ids.add(policy.id);
  }
  const neighbors = new Map<string, Policy[]>();
  for (const policy of policies) {
    const alternatives: Policy[] = [];
    POLICY_AXES.forEach((axis, axisIndex) => {
      for (const value of values[axisIndex]!) {
        if (value === policy[axis]) continue;
        const candidate = keys.get(policyKey({ ...policy, [axis]: value }));
        if (!candidate) throw new RangeError('Separate ballots require a complete menu of decision combinations.');
        alternatives.push(candidate);
      }
    });
    neighbors.set(policy.id, alternatives);
  }
  return neighbors;
}

/**
 * Bounded search with exact certificates. The US uses majority amendments;
 * the foreign bloc uses a scalar best response over its full menu. A failed
 * search never becomes a claim that the game has no equilibrium.
 */
export function solveWeightedGame(game: WeightedGame, options: SearchOptions = {}): VotingResult {
  const weights = normalizedWeights(game.weights);
  if (!game.policies.length) throw new RangeError('The US policy menu must not be empty.');
  const current = game.policies.find(policy => policy.id === game.currentPolicy.id);
  if (!current) throw new RangeError('The current-policy baseline must appear in the US policy menu.');
  const neighbors = neighborIndex(game.policies);
  const strategic = game.foreignPolicies.length > 0;
  if (new Set(game.foreignPolicies.map(policy => policy.id)).size !== game.foreignPolicies.length) {
    throw new RangeError('Foreign policy IDs must be unique.');
  }
  const foreignCurrent = strategic
    ? game.foreignPolicies.find(policy => policy.id === game.foreignCurrentPolicy?.id)
      ?? game.foreignPolicies.find(policy => policy.id === current.id) ?? game.foreignPolicies[0]
    : undefined;
  const starts = options.starts ?? 3, rounds = options.rounds ?? 3, amendments = options.amendments ?? 12;
  const cacheSize = options.cacheSize ?? 256;
  if ([starts, rounds, amendments, cacheSize].some(value => !Number.isInteger(value) || value < 1)) {
    throw new RangeError('Search limits must be positive integers.');
  }
  let evaluations = 0, startsTried = 0, iterations = 0, hasMajorityCycle = false;
  const cache = new Map<string, LightProfile>();
  const foreignBest = new Map<string, ForeignCheck | null>();
  const profileKey = (us: Policy, foreign?: Policy) => JSON.stringify([us.id, foreign?.id ?? null]);
  const evaluate = (us: Policy, foreign?: Policy): LightProfile => {
    const key = profileKey(us, foreign);
    const cached = cache.get(key);
    if (cached) return cached;
    const profile = game.evaluateLight(us, foreign);
    if (profile.usUtilities.length !== weights.length
      || Array.from(profile.usUtilities).some(value => !Number.isFinite(value))) {
      throw new RangeError('Every profile needs finite utilities for the same population cells.');
    }
    if (strategic && !Number.isFinite(profile.foreignScore)) throw new RangeError('The foreign actor needs a finite payoff.');
    evaluations++;
    cache.set(key, profile);
    if (cache.size > cacheSize) cache.delete(cache.keys().next().value!);
    return profile;
  };
  const votesForChange = (challenger: LightProfile, incumbent: LightProfile) =>
    compareUtilities(challenger.usUtilities, incumbent.usUtilities, weights);
  const inspectUS = (us: Policy, foreign?: Policy, materialized?: LightProfile): USCheck => {
    const profile = materialized ?? evaluate(us, foreign);
    let votes = 0;
    let challenger: LightProfile | undefined;
    for (const policy of neighbors.get(us.id)!) {
      const candidate = evaluate(policy, foreign);
      if (!candidate.usAdmissible) continue;
      const support = votesForChange(candidate, profile);
      if (!challenger || support > votes + VOTE_SUM_TOLERANCE) { votes = support; challenger = candidate; }
    }
    return { profile, votes, challenger };
  };
  const bestForeign = (us: Policy): ForeignCheck | null => {
    if (!strategic) return { score: 0 };
    const cached = foreignBest.get(us.id);
    if (cached !== undefined) return cached;
    let best: ForeignCheck | undefined;
    for (const policy of game.foreignPolicies) {
      const candidate = game.evaluateForeign ? undefined : evaluate(us, policy);
      if (candidate && !candidate.foreignAdmissible) continue;
      const score = game.evaluateForeign ? game.evaluateForeign(us, policy) : candidate!.foreignScore!;
      if (game.evaluateForeign) evaluations++;
      if (score === -Infinity) continue; // Unavailable: the policy cannot fund required public services.
      if (!Number.isFinite(score)) throw new RangeError('The foreign actor needs a finite payoff.');
      // Select the true numeric maximum; equilibrium tolerance is applied only
      // when comparing an incumbent with that maximum, not while accumulating it.
      if (!best || score > best.score) best = { policy, score };
    }
    // Foreign fiscal availability depends on the US policy. A failed row says
    // nothing about other starting policies, so remember it and try another seed.
    foreignBest.set(us.id, best ?? null);
    return best ?? null;
  };
  let fallback: Candidate | undefined;
  const remember = (check: USCheck, foreign: ForeignCheck) => {
    // These candidates keep the foreign actor at a full-menu best response.
    // Do not combine voter shares with cardinal foreign utility into one score.
    const admissible = check.profile.usAdmissible && (!strategic || check.profile.foreignAdmissible);
    const previousAdmissible = fallback?.check.profile.usAdmissible && (!strategic || fallback?.check.profile.foreignAdmissible);
    if (!fallback || (admissible && !previousAdmissible)
      || (Boolean(admissible) === Boolean(previousAdmissible) && check.votes < fallback.check.votes - VOTE_SUM_TOLERANCE)) fallback = { check, foreign };
  };
  const finish = (candidate: Candidate, stable: boolean): VotingResult => {
    const { check, foreign } = candidate;
    // Materialize only the chosen profile, after search and certification.
    const full = game.evaluate(check.profile.usPolicy, check.profile.foreignPolicy);
    evaluations++;
    if (strategic && !Number.isFinite(full.foreignScore)) throw new RangeError('The materialized foreign payoff must be finite.');
    const finalCheck = inspectUS(full.usPolicy, full.foreignPolicy, full);
    const gain = strategic ? Math.max(0, foreign.score - full.foreignScore!) : 0;
    const selected: VotingOutcome = {
      ...full, usDeviationVotes: finalCheck.votes, usBestChallengerId: finalCheck.challenger?.usPolicy.id,
      foreignBestResponseGain: gain, foreignBestResponsePolicyId: foreign.policy?.id,
    };
    if (stable && (!full.usAdmissible || (strategic && !full.foreignAdmissible)
      || hasMajority(finalCheck.votes) || gain > EQUILIBRIUM_TOLERANCE)) {
      throw new Error('A candidate failed its equilibrium certificate.');
    }
    return {
      selected, majorityStable: stable ? [selected] : [],
      selection: stable ? 'verified-stable' : 'search-incomplete', evaluations, startsTried, iterations,
      searchComplete: false, agendaSteps: [], hasMajorityCycle,
      bestChallenger: finalCheck.challenger?.usPolicy, votesForChange,
    };
  };
  const seedCandidates = [current, game.policies[0]!, game.policies.at(-1)!, game.policies[Math.floor(game.policies.length / 2)]!];
  const seeds = seedCandidates.filter((policy, index) => seedCandidates.findIndex(other => other.id === policy.id) === index).slice(0, starts);
  for (const seed of seeds) {
    startsTried++;
    let us = seed, foreign = foreignCurrent;
    const visitedPairs = new Set<string>();
    for (let round = 0; round < rounds; round++) {
      iterations++;
      const roundKey = profileKey(us, foreign);
      if (visitedPairs.has(roundKey)) { hasMajorityCycle = true; break; }
      visitedPairs.add(roundKey);
      const visitedUS = new Set<string>();
      let check: USCheck | undefined;
      for (let amendment = 0; amendment < amendments; amendment++) {
        check = inspectUS(us, foreign);
        if (check.profile.usAdmissible ? !hasMajority(check.votes) : !check.challenger) break;
        if (visitedUS.has(us.id)) { hasMajorityCycle = true; break; }
        visitedUS.add(us.id);
        us = check.challenger!.usPolicy;
      }
      // The final amendment can exhaust the walk. Recheck that resulting policy;
      // do not certify the previously examined incumbent by accident.
      check = inspectUS(us, foreign);
      const response = bestForeign(us);
      if (!response) break;
      const gain = strategic ? Math.max(0, response.score - check.profile.foreignScore!) : 0;
      if (check.profile.usAdmissible && (!strategic || check.profile.foreignAdmissible)
        && !hasMajority(check.votes) && gain <= EQUILIBRIUM_TOLERANCE) return finish({ check, foreign: response }, true);
      foreign = response.policy;
      const responseCheck = inspectUS(us, foreign);
      remember(responseCheck, response);
      if (responseCheck.profile.usAdmissible && (!strategic || responseCheck.profile.foreignAdmissible)
        && !hasMajority(responseCheck.votes)) return finish({ check: responseCheck, foreign: response }, true);
    }
  }
  if (!fallback) throw new Error(strategic
    ? 'No fiscally admissible international candidate found in bounded search.'
    : 'The bounded search did not evaluate a candidate.');
  return finish(fallback, false);
}

export function solveVoting(model: SolveResult, options: SearchOptions = {}): VotingResult {
  return solveWeightedGame({
    policies: model.policies, foreignPolicies: model.foreignPolicies, weights: model.weights,
    currentPolicy: model.currentPolicy, foreignCurrentPolicy: model.currentPolicy,
    evaluateLight: model.evaluateLight, evaluateForeign: model.evaluateForeign, evaluate: model.evaluate,
  }, options);
}
