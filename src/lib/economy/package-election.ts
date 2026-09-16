import { EQUILIBRIUM_TOLERANCE, type LightProfile, type ModelMode, type Policy } from './pirates-model';
import { tallyPackageBallot, type PackageBallotCandidate, type PackageBallotResult } from './package-ballot';

/** A complete, finite ballot conditional on the foreign actor's policy. */
export interface PackageElectionModel {
  mode: ModelMode;
  policies: readonly Policy[];
  foreignPolicies: readonly Policy[];
  currentPolicy: Policy;
  weights: ArrayLike<number>;
  evaluateLight: (us: Policy, foreign?: Policy) => LightProfile;
  /** Returns -Infinity for a foreign package that cannot fund its promises. */
  evaluateForeign: (us: Policy, foreign: Policy) => number;
}
export interface ElectionSearch {
  startsTried: number;
  iterations: number;
  ballotsEvaluated: number;
  foreignResponsesEvaluated: number;
  consistentPairsFound: number;
  cycleCount: number;
  exhaustedStarts: number;
  reason: string;
}
export interface PackageElectionResult {
  usPolicy: Policy;
  foreignPolicy?: Policy;
  ballot: PackageBallotResult;
  selection: 'domestic-ballot' | 'verified-consistent' | 'search-incomplete';
  evaluations: number;
  search: ElectionSearch;
  foreignBestPolicy?: Policy;
  foreignBestResponseGain?: number;
}
export interface ElectionSearchOptions {
  /** Deterministic initial foreign choices; production uses current, pause, accelerate. */
  foreignSeeds?: readonly Policy[];
  maxRounds?: number;
}
interface Response { policy?: Policy; score: number }
interface CandidatePair {
  usPolicy: Policy; foreignPolicy: Policy; ballot: PackageBallotResult;
  best: Response; gain: number;
}
const canonical = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/**
 * Every voter chooses their personal utility maximum among funded full packages.
 * This is the specified favorite-package voting rule, not an assertion that
 * perfect rationality uniquely selects sincere rather than tactical voting.
 * Internationally, a reported pair is certified by a complete US ballot at
 * that foreign choice and a complete foreign best-response menu at the policy
 * actually enacted by that ballot (including its automatic current-policy fallback).
 */
export function solvePackageElection(model: PackageElectionModel, options: ElectionSearchOptions = {}): PackageElectionResult {
  const policies = new Map(model.policies.map(p => [p.id, p]));
  if (policies.size !== model.policies.length || !policies.has(model.currentPolicy.id)) {
    throw new RangeError('The complete ballot must contain unique policies and the exact status quo.');
  }
  const search: ElectionSearch = { startsTried: 0, iterations: 0, ballotsEvaluated: 0, foreignResponsesEvaluated: 0, consistentPairsFound: 0, cycleCount: 0, exhaustedStarts: 0, reason: '' };
  let evaluations = 0;
  const ballots = new Map<string, PackageBallotResult>();
  const responses = new Map<string, Response>();
  const ballotAt = (foreign?: Policy): PackageBallotResult => {
    const key = foreign?.id ?? 'domestic';
    const cached = ballots.get(key);
    if (cached) return cached;
    function* candidates(): Generator<PackageBallotCandidate> {
      for (const policy of model.policies) {
        const profile = model.evaluateLight(policy, foreign);
        evaluations++;
        yield { id: policy.id, utilities: profile.usUtilities, fullyFunded: profile.usAdmissible };
      }
    }
    const ballot = tallyPackageBallot({ candidates: candidates(), weights: model.weights, statusQuoId: model.currentPolicy.id });
    ballots.set(key, ballot);
    search.ballotsEvaluated++;
    return ballot;
  };
  if (model.mode === 'us-only') {
    const ballot = ballotAt();
    search.reason = 'Every full US package was evaluated. Each citizen casts one vote for their personal favorite funded package; a strict majority is required to change current policy.';
    return { usPolicy: policies.get(ballot.enactedPolicyId)!, ballot, selection: 'domestic-ballot', evaluations, search };
  }
  const foreignPolicies = new Map(model.foreignPolicies.map(p => [p.id, p]));
  if (!foreignPolicies.size || foreignPolicies.size !== model.foreignPolicies.length || !foreignPolicies.has(model.currentPolicy.id)) {
    throw new RangeError('The foreign menu must contain unique policies and the exact status quo.');
  }
  const bestResponseAt = (us: Policy): Response => {
    const cached = responses.get(us.id);
    if (cached) return cached;
    let best: Response = { score: -Infinity };
    for (const foreign of model.foreignPolicies) {
      const score = model.evaluateForeign(us, foreign);
      evaluations++;
      if (score === -Infinity) continue;
      if (!Number.isFinite(score)) throw new RangeError('A foreign utility must be finite or an ineligible -Infinity.');
      const tiePreferred = score === best.score && best.policy?.id !== model.currentPolicy.id
        && (foreign.id === model.currentPolicy.id || !best.policy || canonical(foreign.id, best.policy.id) < 0);
      if (score > best.score || tiePreferred) best = { policy: foreign, score };
    }
    responses.set(us.id, best);
    search.foreignResponsesEvaluated++;
    return best;
  };
  const sameFiscalPolicy = (p: Policy) => p.replacement === model.currentPolicy.replacement
    && p.welfareScale === model.currentPolicy.welfareScale && p.benefitFormula === model.currentPolicy.benefitFormula
    && p.laborTax === model.currentPolicy.laborTax && p.capitalTax === model.currentPolicy.capitalTax;
  const defaultSeeds = [foreignPolicies.get(model.currentPolicy.id)!, ...[0, 2].map(pace => model.foreignPolicies.find(p => p.pace === pace && sameFiscalPolicy(p))).filter((p): p is Policy => !!p)];
  const seeds = [...new Map((options.foreignSeeds ?? defaultSeeds).map(p => [p.id, p])).values()];
  if (!seeds.length || seeds.some(p => !foreignPolicies.has(p.id))) throw new RangeError('Search seeds must belong to the foreign menu.');
  const maxRounds = options.maxRounds ?? 8;
  if (!Number.isInteger(maxRounds) || maxRounds < 1) throw new RangeError('Search rounds must be a positive integer.');
  const consistent = new Map<string, CandidatePair>();
  let diagnostic: CandidatePair | undefined;
  let noFundedResponse = false;
  for (const seed of seeds) {
    search.startsTried++;
    let foreign = foreignPolicies.get(seed.id)!;
    const seen = new Set<string>();
    let stopped = false;
    for (let round = 0; round < maxRounds; round++) {
      if (seen.has(foreign.id)) { search.cycleCount++; stopped = true; break; }
      seen.add(foreign.id);
      search.iterations++;
      const ballot = ballotAt(foreign);
      const us = policies.get(ballot.enactedPolicyId)!;
      const best = bestResponseAt(us);
      const profile = model.evaluateLight(us, foreign);
      evaluations++;
      const gain = best.policy && Number.isFinite(profile.foreignScore) ? Math.max(0, best.score - profile.foreignScore!) : Infinity;
      const pair: CandidatePair = { usPolicy: us, foreignPolicy: foreign, ballot, best, gain };
      diagnostic ??= pair;
      if (!best.policy) { noFundedResponse = true; stopped = true; break; }
      if (profile.foreignAdmissible && gain <= EQUILIBRIUM_TOLERANCE) {
        consistent.set(us.id + '::' + foreign.id, pair);
        stopped = true;
        break;
      }
      foreign = best.policy;
    }
    if (!stopped) search.exhaustedStarts++;
  }
  search.consistentPairsFound = consistent.size;
  const selected = consistent.values().next().value as CandidatePair | undefined ?? diagnostic!;
  const selection = consistent.size ? 'verified-consistent' : 'search-incomplete';
  search.reason = consistent.size
    ? `Verified ${consistent.size} mutually consistent policy pair${consistent.size === 1 ? '' : 's'} from ${search.startsTried} starting choices. The displayed pair passes a complete US ballot and a complete funded foreign best-response check. Other consistent pairs may exist.`
    : `The bounded search did not verify mutually consistent choices${noFundedResponse ? '; at least one enacted US policy had no fully funded foreign response' : ''}. The displayed ballot is conditional on the displayed foreign policy, not an equilibrium. This does not prove that no consistent pair exists.`;
  return { usPolicy: selected.usPolicy, foreignPolicy: selected.foreignPolicy, ballot: selected.ballot, selection, evaluations, search,
    foreignBestPolicy: selected.best.policy, foreignBestResponseGain: Number.isFinite(selected.gain) ? selected.gain : undefined };
}
