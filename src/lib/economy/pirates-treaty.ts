import {
  EQUILIBRIUM_TOLERANCE, POLICIES,
  type LightProfile, type Policy, type ProfileOutcome, type SolveResult,
} from './pirates-model';
import { coordinateAlternatives, countVotes, hasMajority } from './pirates-voting';

export const TREATY_MENU = 'package-and-reciprocal-v1' as const;
export const TREATY_MENU_DESCRIPTION = 'The same full policy on both sides; any US package with foreign policy unchanged; any foreign package with US policy unchanged; and every pair of single-decision changes, one on each side. Deployment is negotiable. Other asymmetric packages are not searched.';

export interface TreatyOutcome {
  status: 'signed' | 'no-agreement' | 'not-evaluated';
  /** Present only for a ratified treaty; never silently substitutes a rejected offer. */
  proposal?: ProfileOutcome;
  support: number;
  foreignGain: number;
  evaluatedOfferCount: number;
  admissibleOfferCount: number;
  acceptableOfferCount: number;
  menu: typeof TREATY_MENU;
  menuDescription: string;
  noTreaty: ProfileOutcome;
}

export interface TreatyGame {
  /** The full common menu, including every deployment pace. */
  policies: readonly Policy[];
  weights: ArrayLike<number>;
  disagreement: ProfileOutcome;
  disagreementVerified: boolean;
  evaluateLight: (us: Policy, foreign: Policy) => LightProfile;
  evaluate: (us: Policy, foreign: Policy) => ProfileOutcome;
}

/**
 * A one-off, binding offer game. The foreign bloc proposes its favorite offer
 * that a US majority would ratify against the fixed no-treaty outcome. A tie
 * with no agreement keeps no agreement. There are no cross-border transfers.
 *
 * The search is exhaustive for the stated agenda, not for the Cartesian
 * product of both full policy menus. Perfect rationality alone does not select
 * a bargaining protocol; foreign proposal rights and enforcement are assumed.
 */
export function solveTreatyGame(game: TreatyGame): TreatyOutcome {
  const disagreement = game.disagreement;
  const result: TreatyOutcome = {
    status: 'not-evaluated', support: 0, foreignGain: 0,
    evaluatedOfferCount: 0, admissibleOfferCount: 0, acceptableOfferCount: 0,
    menu: TREATY_MENU, menuDescription: TREATY_MENU_DESCRIPTION, noTreaty: disagreement,
  };
  if (!game.disagreementVerified) return result;
  if (!disagreement.foreignPolicy || !Number.isFinite(disagreement.foreignScore)
    || !disagreement.usAdmissible || !disagreement.foreignAdmissible) {
    throw new RangeError('Treaty negotiations need an admissible, verified international disagreement outcome.');
  }
  if (!game.policies.length || new Set(game.policies.map(policy => policy.id)).size !== game.policies.length) {
    throw new RangeError('The treaty menu needs unique policy IDs and at least one policy.');
  }
  if (![disagreement.usPolicy, disagreement.foreignPolicy].every(policy => game.policies.some(candidate => candidate.id === policy.id))) {
    throw new RangeError('Both disagreement policies must be in the treaty menu.');
  }
  // Validate the fixed electorate even if the menu contains no changed offer.
  countVotes(disagreement.usUtilities, disagreement.usUtilities, game.weights);
  result.status = 'no-agreement';
  const key = (us: Policy, foreign: Policy) => JSON.stringify([us.id, foreign.id]);
  const seen = new Set([key(disagreement.usPolicy, disagreement.foreignPolicy)]);
  let best: LightProfile | undefined;
  let bestSupport = 0;
  const consider = (us: Policy, foreign: Policy) => {
    const pair = key(us, foreign);
    if (seen.has(pair)) return;
    seen.add(pair);
    const candidate = game.evaluateLight(us, foreign);
    result.evaluatedOfferCount++;
    if (!Number.isFinite(candidate.foreignScore)) throw new RangeError('Every treaty offer needs a finite foreign payoff.');
    if (!candidate.usAdmissible || !candidate.foreignAdmissible) return;
    result.admissibleOfferCount++;
    // A foreign actor cannot strictly benefit, so no voter calculation is needed.
    if (candidate.foreignScore! <= disagreement.foreignScore! + EQUILIBRIUM_TOLERANCE) return;
    const support = countVotes(candidate.usUtilities, disagreement.usUtilities, game.weights);
    if (!hasMajority(support)) return;
    result.acceptableOfferCount++;
    // Keep the true numeric maximum. Tolerance is only for willingness to change,
    // not an order-dependent approximation to the proposer's maximum payoff.
    if (!best || candidate.foreignScore! > best.foreignScore!
      || (candidate.foreignScore === best.foreignScore && support > bestSupport)) {
      best = candidate;
      bestSupport = support;
    }
  };
  // Fixed family and grid order breaks any remaining exact ties reproducibly.
  for (const policy of game.policies) consider(policy, policy);
  for (const policy of game.policies) consider(policy, disagreement.foreignPolicy);
  for (const policy of game.policies) consider(disagreement.usPolicy, policy);
  const usAmendments = coordinateAlternatives(game.policies, disagreement.usPolicy);
  const foreignAmendments = coordinateAlternatives(game.policies, disagreement.foreignPolicy);
  for (const us of usAmendments) for (const foreign of foreignAmendments) consider(us, foreign);
  if (!best) return result;
  const proposal = game.evaluate(best.usPolicy, best.foreignPolicy!);
  const support = countVotes(proposal.usUtilities, disagreement.usUtilities, game.weights);
  const gain = proposal.foreignScore! - disagreement.foreignScore!;
  if (!proposal.usAdmissible || !proposal.foreignAdmissible || !hasMajority(support)
    || !Number.isFinite(gain) || gain <= EQUILIBRIUM_TOLERANCE
    || Math.abs(gain - (best.foreignScore! - disagreement.foreignScore!)) > EQUILIBRIUM_TOLERANCE) {
    throw new Error('The selected treaty failed its ratification certificate.');
  }
  return { ...result, status: 'signed', proposal, support, foreignGain: gain };
}

export function solveTreaty(model: SolveResult, disagreement: ProfileOutcome, disagreementVerified: boolean): TreatyOutcome {
  if (model.mode !== 'strategic') throw new RangeError('Treaties require the international scenario.');
  return solveTreatyGame({
    policies: POLICIES, weights: model.weights, disagreement, disagreementVerified,
    evaluateLight: model.evaluateLight, evaluate: model.evaluate,
  });
}
