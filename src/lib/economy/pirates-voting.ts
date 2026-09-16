import {
  DISCOUNT_RATE, EQUILIBRIUM_TOLERANCE, UTILITY_OFFSET,
  type Policy, type ProfileOutcome, type RegionYear, type SolveResult,
} from './pirates-model';

export const VOTER_COUNT = 1000;
/** Default only: the actual electorate uses inputs.workerShare. */
export const WORKER_VOTERS = 900;
export const VOTES_REQUIRED = 501;
export const POLICY_AXES = ['replacement', 'safetyNet', 'workerTax', 'tax', 'pace'] as const;
export type PolicyAxis = typeof POLICY_AXES[number];
export type BallotMode = 'separate' | 'package';

function policyValue(policy: Policy, axis: PolicyAxis): number {
  return (policy as Policy & { workerTax?: number })[axis] ?? 0;
}

export function changedPolicyAxes(first: Policy, second: Policy): PolicyAxis[] {
  return POLICY_AXES.filter(axis => policyValue(first, axis) !== policyValue(second, axis));
}

export function workerVoterCount(workerShare = .9): number {
  const count = Math.round(VOTER_COUNT * workerShare);
  if (!Number.isFinite(workerShare) || count < 1 || count >= VOTER_COUNT) {
    throw new RangeError('The electorate must contain at least one worker and one owner.');
  }
  return count;
}

export const VOTING_NOTES = [
  'There are 1,000 representative voters. The worker-to-owner ratio is adjustable; its default is 900 workers and 100 owners. A change requires at least 501 voters to strictly prefer it; indifferent voters retain the incumbent. These are expected preferences under the model, not a prediction of an actual election.',
  'Worker ranks are fixed across policies. As cumulative initial displacement rises, workers are exposed in rank order. A rank cell crossing a displacement boundary is split fractionally. Previously displaced workers return with the specified annual probability; returning workers are not exposed a second time. This ordering and the expected-utility treatment are assumptions.',
  'Displacement tracks lost productive work. An obsolete role can still receive employer-funded retention wages. Voters choose a retention-pay rule; this does not model employers voluntarily retaining workers to maximize profits. Preferences use actual private pay, public top-ups and dividends after funding limits.',
  'Each voter compares ten years of discounted expected utility, using the same logarithm and 1% income offset as the model. The expected utility of employed, newly displaced and longer-term displaced states is computed separately. The offset creates no income. Owners have identical preferences in this model.',
  'Separate ballots change one decision at a time: employer-funded retention, the government income floor, worker tax, owner tax, and deployment pace when it is not fixed. Stability means that no single-decision change attracts 501 votes while every other decision and the other country’s policy stay fixed. A joint package can still defeat a separately stable policy; that comparison is reported separately.',
  'A strict Condorcet winner obtains 501 votes against every other policy. A majority-unbeaten policy merely has no challenger with 501 votes; indifference and 500–500 votes can leave several such policies. Identical voter utilities are retained as separate policies and do not count as strict wins.',
  'If no domestic policy is stable, a finite amendment agenda is solved backward. The separate-ballot agenda considers each available value of each decision in the displayed order, then ends. Each amendment changes only that decision in the current policy. Voters compare eventual outcomes, including all later votes. The result depends on the agenda and may lose a fresh vote. There is no additional final ratification vote.',
  'International stability means that neither country can obtain 501 votes for a permitted unilateral change while the other country keeps its policy. This is majority stability, not a utility-maximizing Nash equilibrium. If none exists, the displayed pair minimizes the largest number of votes for a permitted unilateral deviation and is explicitly unstable.',
  'Selection favors the zero-retention, zero-government-floor, zero-worker-tax, zero-owner-tax status quo when it qualifies; otherwise it follows the displayed policy order. With a fixed adoption pace the status quo uses that pace. It is distinct from the model’s no-AI baseline.',
] as const;

/** One utility per representative voter. Worker cells have equal population
 * mass 1/workerCount within the worker group. The same cell boundaries are used for all
 * alternatives, so a voter keeps their identity when policies are compared.
 */
export function voterUtilities(trajectory: readonly RegionYear[], reemployment: number, workerShare = .9): Float64Array {
  const workerCount = workerVoterCount(workerShare);
  const utilities = new Float64Array(VOTER_COUNT);
  const priorUnemployment = new Float64Array(workerCount);
  let cumulativeDisplacement = 0;
  let discountWeight = 0;
  const utility = (index: number) => Math.log((index / 100 + UTILITY_OFFSET) / (1 + UTILITY_OFFSET));
  for (const point of trajectory) {
    if (point.year === 0) continue;
    const weight = (1 + DISCOUNT_RATE) ** -point.year;
    discountWeight += weight;
    const previousBoundary = cumulativeDisplacement;
    cumulativeDisplacement += point.newlyDisplaced;
    const employedUtility = utility(point.employedIncomeIndex);
    const newUtility = utility(point.newlyDisplacedIncomeIndex);
    const longTermUtility = utility(point.longTermDisplacedIncomeIndex);
    for (let voter = 0; voter < workerCount; voter++) {
      // Scaled boundaries keep a fully covered cell exactly 1. This also
      // preserves identical utilities within a displacement cohort.
      const newlyDisplaced = Math.min(1, Math.max(0, cumulativeDisplacement * workerCount - voter))
        - Math.min(1, Math.max(0, previousBoundary * workerCount - voter));
      const longTerm = (1 - reemployment) * priorUnemployment[voter]!;
      const unemployed = Math.min(1, Math.max(0, newlyDisplaced + longTerm));
      const employed = 1 - unemployed;
      utilities[voter] = utilities[voter]! + weight * (
        employed * employedUtility + newlyDisplaced * newUtility + longTerm * longTermUtility);
      priorUnemployment[voter] = unemployed;
    }
    const ownerUtility = weight * utility(point.ownerIncomeIndex);
    for (let voter = workerCount; voter < VOTER_COUNT; voter++) {
      utilities[voter] = utilities[voter]! + ownerUtility;
    }
  }
  if (discountWeight) {
    for (let voter = 0; voter < VOTER_COUNT; voter++) utilities[voter] = utilities[voter]! / discountWeight;
  }
  return utilities;
}

/** Indifference, including numerical equality, does not vote for a change. */
export function countVotes(challenger: ArrayLike<number>, incumbent: ArrayLike<number>): number {
  if (challenger.length !== VOTER_COUNT || incumbent.length !== VOTER_COUNT) {
    throw new RangeError('A policy comparison requires 1,000 representative voter utilities.');
  }
  let votes = 0;
  for (let voter = 0; voter < VOTER_COUNT; voter++) {
    if (challenger[voter]! > incumbent[voter]! + EQUILIBRIUM_TOLERANCE) votes++;
  }
  return votes;
}

interface UtilityRun { end: number; utility: number }

/** Exact consecutive runs preserve each voter's identity and comparison.
 * Fully exposed cohorts and owners generally make the 1,000-person vector
 * much shorter. No approximate utilities or population weights are rounded.
 */
function compressUtilities(utilities: ArrayLike<number>): UtilityRun[] {
  const runs: UtilityRun[] = [];
  for (let voter = 0; voter < utilities.length; voter++) {
    const last = runs.at(-1);
    if (last && last.utility === utilities[voter]) last.end = voter + 1;
    else runs.push({ end: voter + 1, utility: utilities[voter]! });
  }
  return runs;
}

function countCompressedVotes(challenger: readonly UtilityRun[], incumbent: readonly UtilityRun[]): number {
  let a = 0, b = 0, position = 0, votes = 0;
  while (a < challenger.length && b < incumbent.length) {
    const first = challenger[a]!, second = incumbent[b]!;
    const end = Math.min(first.end, second.end);
    if (first.utility > second.utility + EQUILIBRIUM_TOLERANCE) votes += end - position;
    position = end;
    if (first.end === end) a++;
    if (second.end === end) b++;
  }
  return votes;
}

export interface AgendaStep {
  incumbent: number;
  challenger: number;
  /** Terminal policy if this amendment is rejected, with later votes anticipated. */
  continuationIfRejected: number;
  /** Terminal policy if this amendment is accepted, with later votes anticipated. */
  continuationIfAccepted: number;
  votesForChange: number;
  accepted: boolean;
}

export interface MajorityAnalysis {
  /** Row = challenger; column = incumbent. */
  pairwiseVotes: number[][];
  condorcetWinners: number[];
  unbeaten: number[];
  selected: number;
  selection: 'condorcet' | 'majority-unbeaten' | 'agenda-majority';
  agendaOrder: number[];
  agendaSteps: AgendaStep[];
  agendaWinner: number;
  hasMajorityCycle: boolean;
  /** Unordered comparisons where neither alternative attracts 501 votes. */
  tiedPairCount: number;
  /** Equivalent voter utilities, not necessarily identical physical outcomes. */
  equivalentGroups: number[][];
}

function containsCycle(edges: readonly (readonly number[])[]): boolean {
  const indegrees = new Uint32Array(edges.length);
  for (const outgoing of edges) for (const next of outgoing) indegrees[next] = indegrees[next]! + 1;
  const queue: number[] = [];
  for (let node = 0; node < edges.length; node++) if (!indegrees[node]) queue.push(node);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    for (const next of edges[queue[cursor]!]!) {
      indegrees[next] = indegrees[next]! - 1;
      if (!indegrees[next]) queue.push(next);
    }
  }
  return queue.length < edges.length;
}

/** Analyze an absolute-majority election independently of the economic model.
 * Agenda entries are each policy exactly once; the status quo is moved first.
 * Sophisticated voting compares the two continuation winners by backward
 * induction, rather than assuming sincere votes in a known multi-vote agenda.
 */
export function analyzeMajority(
  utilities: readonly ArrayLike<number>[],
  statusQuoIndex = 0,
  requestedAgenda?: readonly number[],
): MajorityAnalysis {
  const size = utilities.length;
  if (!size || !Number.isInteger(statusQuoIndex) || statusQuoIndex < 0 || statusQuoIndex >= size
    || utilities.some(vector => vector.length !== VOTER_COUNT
      || Array.from(vector).some(value => !Number.isFinite(value)))) {
    throw new RangeError('Expected nonempty policies with 1,000 finite voter utilities and a valid status quo.');
  }
  const order = requestedAgenda ? [...requestedAgenda] : utilities.map((_, index) => index);
  if (order.length !== size || new Set(order).size !== size
    || order.some(index => !Number.isInteger(index) || index < 0 || index >= size)) {
    throw new RangeError('The agenda must contain each policy index exactly once.');
  }
  const agendaOrder = [statusQuoIndex, ...order.filter(index => index !== statusQuoIndex)];
  const compressed = utilities.map(compressUtilities);
  const pairwiseVotes = compressed.map(challenger => compressed.map(incumbent => countCompressedVotes(challenger, incumbent)));
  const condorcetWinners = order.filter(candidate => order.every(other => other === candidate
    || pairwiseVotes[candidate]![other]! >= VOTES_REQUIRED));
  const unbeaten = order.filter(candidate => order.every(other => other === candidate
    || pairwiseVotes[other]![candidate]! < VOTES_REQUIRED));
  const edges = pairwiseVotes.map(row => row.flatMap((votes, other) => votes >= VOTES_REQUIRED ? [other] : []));
  let tiedPairCount = 0;
  for (let first = 0; first < size; first++) for (let second = first + 1; second < size; second++) {
    if (pairwiseVotes[first]![second]! < VOTES_REQUIRED && pairwiseVotes[second]![first]! < VOTES_REQUIRED) tiedPairCount++;
  }
  const groups: number[][] = [];
  for (let policy = 0; policy < size; policy++) {
    // Approximate indifference is not transitive. Every pair within a displayed
    // group must agree, rather than joining groups through a chain of ties.
    const group = groups.find(existing => existing.every(member => Array.from(utilities[member]!).every((value, voter) =>
      Math.abs(value - utilities[policy]![voter]!) <= EQUILIBRIUM_TOLERANCE)));
    if (group) group.push(policy); else groups.push([policy]);
  }
  // winners[stage][incumbent] gives the terminal outcome after all later votes.
  const winners: number[][] = Array.from({ length: size + 1 }, () => []);
  winners[size] = order.map((_, index) => index);
  for (let stage = size - 1; stage >= 1; stage--) {
    const challenger = agendaOrder[stage]!;
    winners[stage] = order.map((_, incumbent) => {
      const reject = winners[stage + 1]![incumbent]!;
      const accept = winners[stage + 1]![challenger]!;
      return pairwiseVotes[accept]![reject]! >= VOTES_REQUIRED ? accept : reject;
    });
  }
  let incumbent = statusQuoIndex;
  const agendaSteps: AgendaStep[] = [];
  for (let stage = 1; stage < size; stage++) {
    const challenger = agendaOrder[stage]!;
    const continuationIfRejected = winners[stage + 1]![incumbent]!;
    const continuationIfAccepted = winners[stage + 1]![challenger]!;
    const votesForChange = pairwiseVotes[continuationIfAccepted]![continuationIfRejected]!;
    const accepted = votesForChange >= VOTES_REQUIRED;
    agendaSteps.push({ incumbent, challenger, continuationIfRejected, continuationIfAccepted, votesForChange, accepted });
    if (accepted) incumbent = challenger;
  }
  const agendaWinner = incumbent;
  const preferred = (candidates: readonly number[]) => candidates.includes(statusQuoIndex)
    ? statusQuoIndex : agendaOrder.find(index => candidates.includes(index))!;
  const selection = condorcetWinners.length ? 'condorcet' : unbeaten.length ? 'majority-unbeaten' : 'agenda-majority';
  const selected = condorcetWinners.length ? preferred(condorcetWinners)
    : unbeaten.length ? preferred(unbeaten) : agendaWinner;
  return {
    pairwiseVotes, condorcetWinners, unbeaten, selected, selection,
    agendaOrder, agendaSteps, agendaWinner, hasMajorityCycle: containsCycle(edges),
    tiedPairCount, equivalentGroups: groups.filter(group => group.length > 1),
  };
}

export interface VotingOutcome extends ProfileOutcome {
  /** Maximum number of voters preferring an available unilateral change. */
  usDeviationVotes: number;
  foreignDeviationVotes: number;
  maxDeviationVotes: number;
  usBestChallengerId?: string;
  foreignBestChallengerId?: string;
  /** Full-package diagnostics are populated for the selected profile only. */
  usPackageDeviationVotes?: number;
  foreignPackageDeviationVotes?: number;
  maxPackageDeviationVotes?: number;
  usBestPackageChallengerId?: string;
  foreignBestPackageChallengerId?: string;
}

export interface CoordinateAmendment { axis: PolicyAxis; value: number }

/** A known, finite series of single-decision amendments. The challenger is
 * reconstructed from the current policy at every state, retaining decisions
 * made earlier. Voters anticipate every remaining ballot.
 */
export function analyzeCoordinateAgenda(
  policies: readonly Policy[], pairwiseVotes: readonly (readonly number[])[], statusQuoIndex: number,
): { agenda: CoordinateAmendment[]; steps: (AgendaStep & CoordinateAmendment)[]; winner: number } {
  const key = (policy: Policy) => POLICY_AXES.map(axis => policyValue(policy, axis)).join('|');
  const indices = new Map(policies.map((policy, index) => [key(policy), index]));
  const agenda: CoordinateAmendment[] = POLICY_AXES.flatMap(axis => {
    const values = [...new Set(policies.map(policy => policyValue(policy, axis)))];
    return values.length > 1 ? values.map(value => ({ axis, value })) : [];
  });
  const challengers = agenda.map(({ axis, value }) => policies.map(policy => {
    const challenger = indices.get(key({ ...policy, [axis]: value }));
    if (challenger === undefined) throw new RangeError('Separate ballots require a complete menu of decision combinations.');
    return challenger;
  }));
  const winners: number[][] = Array.from({ length: agenda.length + 1 }, () => []);
  winners[agenda.length] = policies.map((_, index) => index);
  for (let stage = agenda.length - 1; stage >= 0; stage--) {
    winners[stage] = policies.map((_, incumbent) => {
      const reject = winners[stage + 1]![incumbent]!;
      const accept = winners[stage + 1]![challengers[stage]![incumbent]!]!;
      return pairwiseVotes[accept]![reject]! >= VOTES_REQUIRED ? accept : reject;
    });
  }
  let incumbent = statusQuoIndex;
  const steps: (AgendaStep & CoordinateAmendment)[] = [];
  for (let stage = 0; stage < agenda.length; stage++) {
    const challenger = challengers[stage]![incumbent]!;
    const continuationIfRejected = winners[stage + 1]![incumbent]!;
    const continuationIfAccepted = winners[stage + 1]![challenger]!;
    const votesForChange = pairwiseVotes[continuationIfAccepted]![continuationIfRejected]!;
    const accepted = votesForChange >= VOTES_REQUIRED;
    steps.push({ ...agenda[stage]!, incumbent, challenger, continuationIfRejected, continuationIfAccepted, votesForChange, accepted });
    if (accepted) incumbent = challenger;
  }
  return { agenda, steps, winner: incumbent };
}

/** Coordinate-election analysis uses only direct, one-decision challengers for
 * stability. The separate agenda is a fallback, not a proof of stability.
 */
export function analyzeCoordinateVotes(
  policies: readonly Policy[], pairwiseVotes: readonly (readonly number[])[], statusQuoIndex: number,
) {
  const size = policies.length;
  if (!size || !Number.isInteger(statusQuoIndex) || statusQuoIndex < 0 || statusQuoIndex >= size
    || pairwiseVotes.length !== size || pairwiseVotes.some(row => row.length !== size
      || row.some(votes => !Number.isInteger(votes) || votes < 0 || votes > VOTER_COUNT))) {
    throw new RangeError('Expected a square policy vote matrix and a valid status quo.');
  }
  const maxDeviationVotes = policies.map(() => 0);
  const bestChallengers: (number | undefined)[] = policies.map(() => undefined);
  const edges: number[][] = policies.map(() => []);
  let tiedPairCount = 0;
  for (let incumbent = 0; incumbent < size; incumbent++) for (let challenger = 0; challenger < size; challenger++) {
    if (changedPolicyAxes(policies[incumbent]!, policies[challenger]!).length !== 1) continue;
    const votes = pairwiseVotes[challenger]![incumbent]!;
    if (votes > maxDeviationVotes[incumbent]!) {
      maxDeviationVotes[incumbent] = votes;
      bestChallengers[incumbent] = challenger;
    }
    if (votes >= VOTES_REQUIRED) edges[incumbent]!.push(challenger);
    if (incumbent < challenger && votes < VOTES_REQUIRED && pairwiseVotes[incumbent]![challenger]! < VOTES_REQUIRED) tiedPairCount++;
  }
  const stable = policies.flatMap((_, index) => maxDeviationVotes[index]! < VOTES_REQUIRED ? [index] : []);
  const agenda = analyzeCoordinateAgenda(policies, pairwiseVotes, statusQuoIndex);
  const selected = stable.includes(statusQuoIndex) ? statusQuoIndex : stable[0] ?? agenda.winner;
  return { stable, selected, maxDeviationVotes, bestChallengers, agenda, tiedPairCount, hasMajorityCycle: containsCycle(edges) };
}

export interface VotingAgendaStep {
  incumbentId: string;
  challengerId: string;
  continuationIfRejectedId: string;
  continuationIfAcceptedId: string;
  votesForChange: number;
  accepted: boolean;
  axis?: PolicyAxis;
  value?: number;
}

export interface VotingResult {
  mode: SolveResult['effectiveMode'];
  effectiveMode: SolveResult['effectiveMode'];
  ballots: BallotMode;
  policies: readonly Policy[];
  outcomes: VotingOutcome[];
  selected: VotingOutcome;
  statusQuo: VotingOutcome;
  selection: MajorityAnalysis['selection'] | 'majority-stable' | 'min-deviation-votes'
    | 'separate-ballot-stable' | 'coordinate-agenda' | 'min-coordinate-deviation-votes';
  condorcetWinners: VotingOutcome[];
  majorityUnbeaten: VotingOutcome[];
  majorityStable: VotingOutcome[];
  /** Policy IDs, with the voting status quo first. */
  agendaOrder: string[];
  agendaSteps: VotingAgendaStep[];
  coordinateAgenda?: CoordinateAmendment[];
  hasMajorityCycle: boolean;
  tiedPairCount: number;
  /** US-only policy groups with equivalent voter utilities. */
  equivalentPolicyGroups: string[][];
  /** Available only in US-only mode: challenger row, incumbent column. */
  pairwiseVotes?: number[][];
  votesForChange: (challenger: ProfileOutcome, incumbent: ProfileOutcome, region?: 'us' | 'foreign') => number;
}

/** Vote on the model's full chosen menu. The model's scalar objective is not
 * consulted: every preference is rebuilt from individual household outcomes.
 * Model outcomes remain cached, and no policy is excluded for underfunding.
 */
export function solveVoting(model: SolveResult, options: { ballots?: BallotMode } = {}): VotingResult {
  const ballots = options.ballots ?? 'separate';
  const policies = model.policies;
  const outcomes: VotingOutcome[] = model.outcomes.map(outcome => ({
    ...outcome, usDeviationVotes: 0, foreignDeviationVotes: 0, maxDeviationVotes: 0,
  }));
  interface VoterScores { utilities?: Float64Array; runs: UtilityRun[] }
  const cache = new WeakMap<ProfileOutcome, { us: VoterScores; foreign?: VoterScores }>();
  const scoreRegion = (trajectory: readonly RegionYear[]): VoterScores => {
    const utilities = voterUtilities(trajectory, model.inputs.reemployment, model.inputs.workerShare);
    // A large international grid needs only the exact runs after construction;
    // retaining every 1,000-entry vector would consume hundreds of megabytes.
    return { utilities: model.effectiveMode === 'us-only' ? utilities : undefined, runs: compressUtilities(utilities) };
  };
  const getUtilities = (profile: ProfileOutcome) => {
    let value = cache.get(profile);
    if (!value) {
      value = { us: scoreRegion(profile.us), foreign: profile.foreign ? scoreRegion(profile.foreign) : undefined };
      cache.set(profile, value);
    }
    return value;
  };
  const votesForChange: VotingResult['votesForChange'] = (challenger, incumbent, region = 'us') => {
    const a = getUtilities(challenger)[region];
    const b = getUtilities(incumbent)[region];
    if (!a || !b) throw new RangeError('Foreign voting requires two foreign trajectories.');
    return countCompressedVotes(a.runs, b.runs);
  };
  const statusQuoPolicy = policies.find(policy => policy.replacement === 0 && policy.safetyNet === 0
    && policyValue(policy, 'workerTax') === 0 && policy.tax === 0)!;
  if (!statusQuoPolicy) throw new RangeError('The policy menu needs a zero-retention, zero-government-floor, zero-worker-tax, zero-owner-tax voting status quo.');
  const statusQuo = outcomes.find(outcome => outcome.usPolicy.id === statusQuoPolicy.id
    && (!outcome.foreignPolicy || outcome.foreignPolicy.id === statusQuoPolicy.id))!;
  if (!statusQuo) throw new RangeError('The voting status quo must be included in the profile grid.');
  const common = {
    mode: model.effectiveMode, effectiveMode: model.effectiveMode, ballots, policies, outcomes, statusQuo, votesForChange,
  };
  const attachPackageChallenges = (selected: VotingOutcome) => {
    selected.usPackageDeviationVotes = 0;
    selected.foreignPackageDeviationVotes = 0;
    for (const challenger of outcomes) {
      if (challenger.foreignPolicy?.id === selected.foreignPolicy?.id) {
        const votes = votesForChange(challenger, selected, 'us');
        if (votes > selected.usPackageDeviationVotes) {
          selected.usPackageDeviationVotes = votes;
          selected.usBestPackageChallengerId = challenger.usPolicy.id;
        }
      }
      if (selected.foreignPolicy && challenger.usPolicy.id === selected.usPolicy.id) {
        const votes = votesForChange(challenger, selected, 'foreign');
        if (votes > selected.foreignPackageDeviationVotes) {
          selected.foreignPackageDeviationVotes = votes;
          selected.foreignBestPackageChallengerId = challenger.foreignPolicy!.id;
        }
      }
    }
    selected.maxPackageDeviationVotes = Math.max(selected.usPackageDeviationVotes, selected.foreignPackageDeviationVotes);
  };
  if (model.effectiveMode === 'us-only') {
    const analysis = analyzeMajority(outcomes.map(outcome => getUtilities(outcome).us.utilities!), outcomes.indexOf(statusQuo));
    for (let incumbent = 0; incumbent < outcomes.length; incumbent++) {
      const outcome = outcomes[incumbent]!;
      for (let challenger = 0; challenger < outcomes.length; challenger++) {
        if (ballots === 'separate' && changedPolicyAxes(outcome.usPolicy, outcomes[challenger]!.usPolicy).length !== 1) continue;
        const votes = analysis.pairwiseVotes[challenger]![incumbent]!;
        if (votes > outcome.usDeviationVotes) {
          outcome.usDeviationVotes = votes;
          outcome.usBestChallengerId = outcomes[challenger]!.usPolicy.id;
        }
      }
      outcome.maxDeviationVotes = outcome.usDeviationVotes;
    }
    const policyId = (index: number) => outcomes[index]!.usPolicy.id;
    if (ballots === 'separate') {
      const coordinate = analyzeCoordinateVotes(policies, analysis.pairwiseVotes, outcomes.indexOf(statusQuo));
      const majorityStable = coordinate.stable.map(index => outcomes[index]!);
      const agenda = coordinate.agenda;
      const selected = outcomes[coordinate.selected]!;
      attachPackageChallenges(selected);
      return {
        ...common, selected, selection: majorityStable.length ? 'separate-ballot-stable' : 'coordinate-agenda',
        condorcetWinners: analysis.condorcetWinners.map(index => outcomes[index]!),
        majorityUnbeaten: majorityStable, majorityStable,
        agendaOrder: [statusQuoPolicy.id, ...agenda.steps.map(step => policyId(step.challenger))],
        coordinateAgenda: agenda.agenda,
        agendaSteps: agenda.steps.map(step => ({
          axis: step.axis, value: step.value,
          incumbentId: policyId(step.incumbent), challengerId: policyId(step.challenger),
          continuationIfRejectedId: policyId(step.continuationIfRejected),
          continuationIfAcceptedId: policyId(step.continuationIfAccepted),
          votesForChange: step.votesForChange, accepted: step.accepted,
        })),
        hasMajorityCycle: coordinate.hasMajorityCycle, tiedPairCount: coordinate.tiedPairCount,
        equivalentPolicyGroups: analysis.equivalentGroups.map(group => group.map(policyId)),
        pairwiseVotes: analysis.pairwiseVotes,
      };
    }
    attachPackageChallenges(outcomes[analysis.selected]!);
    return {
      ...common, selected: outcomes[analysis.selected]!, selection: analysis.selection,
      condorcetWinners: analysis.condorcetWinners.map(index => outcomes[index]!),
      majorityUnbeaten: analysis.unbeaten.map(index => outcomes[index]!), majorityStable: [],
      agendaOrder: analysis.agendaOrder.map(policyId),
      agendaSteps: analysis.agendaSteps.map(step => ({
        incumbentId: policyId(step.incumbent), challengerId: policyId(step.challenger),
        continuationIfRejectedId: policyId(step.continuationIfRejected),
        continuationIfAcceptedId: policyId(step.continuationIfAccepted),
        votesForChange: step.votesForChange, accepted: step.accepted,
      })),
      hasMajorityCycle: analysis.hasMajorityCycle, tiedPairCount: analysis.tiedPairCount,
      equivalentPolicyGroups: analysis.equivalentGroups.map(group => group.map(policyId)),
      pairwiseVotes: analysis.pairwiseVotes,
    };
  }
  const size = policies.length;
  if (outcomes.length !== size * size) throw new RangeError('International voting requires the full square policy grid.');
  const edges: number[][] = outcomes.map(() => []);
  let tiedPairCount = 0;
  const record = (incumbentIndex: number, challengerIndex: number, region: 'us' | 'foreign', votes: number) => {
    const incumbent = outcomes[incumbentIndex]!;
    const challenger = outcomes[challengerIndex]!;
    if (region === 'us' && votes > incumbent.usDeviationVotes) {
      incumbent.usDeviationVotes = votes;
      incumbent.usBestChallengerId = challenger.usPolicy.id;
    } else if (region === 'foreign' && votes > incumbent.foreignDeviationVotes) {
      incumbent.foreignDeviationVotes = votes;
      incumbent.foreignBestChallengerId = challenger.foreignPolicy!.id;
    }
    if (votes >= VOTES_REQUIRED) edges[incumbentIndex]!.push(challengerIndex);
  };
  const comparisonPairs: [number, number][] = [];
  for (let first = 0; first < size; first++) for (let second = first + 1; second < size; second++) {
    if (ballots === 'package' || changedPolicyAxes(policies[first]!, policies[second]!).length === 1) comparisonPairs.push([first, second]);
  }
  for (let fixed = 0; fixed < size; fixed++) {
    for (const [first, second] of comparisonPairs) {
      for (const region of ['us', 'foreign'] as const) {
        const firstIndex = region === 'us' ? first * size + fixed : fixed * size + first;
        const secondIndex = region === 'us' ? second * size + fixed : fixed * size + second;
        const forward = votesForChange(outcomes[secondIndex]!, outcomes[firstIndex]!, region);
        const backward = votesForChange(outcomes[firstIndex]!, outcomes[secondIndex]!, region);
        record(firstIndex, secondIndex, region, forward);
        record(secondIndex, firstIndex, region, backward);
        if (forward < VOTES_REQUIRED && backward < VOTES_REQUIRED) tiedPairCount++;
      }
    }
  }
  for (const outcome of outcomes) outcome.maxDeviationVotes = Math.max(outcome.usDeviationVotes, outcome.foreignDeviationVotes);
  const majorityStable = outcomes.filter(outcome => outcome.maxDeviationVotes < VOTES_REQUIRED);
  const minimumDeviationVotes = Math.min(...outcomes.map(outcome => outcome.maxDeviationVotes));
  const candidates = majorityStable.length ? majorityStable
    : outcomes.filter(outcome => outcome.maxDeviationVotes === minimumDeviationVotes);
  const selected = candidates.includes(statusQuo) ? statusQuo : candidates[0]!;
  attachPackageChallenges(selected);
  return {
    ...common, selected,
    selection: majorityStable.length ? (ballots === 'separate' ? 'separate-ballot-stable' : 'majority-stable')
      : (ballots === 'separate' ? 'min-coordinate-deviation-votes' : 'min-deviation-votes'),
    condorcetWinners: [], majorityUnbeaten: [], majorityStable,
    agendaOrder: [statusQuoPolicy.id, ...policies.filter(policy => policy.id !== statusQuoPolicy.id).map(policy => policy.id)],
    agendaSteps: [], hasMajorityCycle: containsCycle(edges), tiedPairCount, equivalentPolicyGroups: [],
  };
}
