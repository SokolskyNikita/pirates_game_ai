/**
 * One preference ballot over complete policy packages. Each represented citizen
 * casts one vote for their personal utility maximum. This is a specified sincere
 * ballot rule, not a claim that rational strategic voting selects it uniquely.
 */
export const BALLOT_MAJORITY_PERCENT = 50;
/** Percentage-point tolerance for floating population sums, not utility ties. */
export const BALLOT_SUM_TOLERANCE = 1e-10;

export interface PackageBallotCandidate {
  id: string;
  utilities: ArrayLike<number>;
  /** Verified by the economic model after behavior and tax-base responses. */
  fullyFunded: boolean;
}

export interface PackageBallotInput {
  /** A generator can evaluate and discard one utility row at a time. */
  candidates: Iterable<PackageBallotCandidate>;
  weights: ArrayLike<number>;
  /** The exact current-policy package must be included, even if underfunded. */
  statusQuoId: string;
}

export interface PackageBallotTally {
  policyId: string;
  populationWeight: number;
  supportPercent: number;
}

export interface PackageBallotResult {
  /** Eligible packages only, sorted by ID, including those receiving zero votes. */
  tallies: PackageBallotTally[];
  /** Canonical ID breaks an exact tie for this descriptive leading position. */
  leadingPolicyId: string | null;
  topSupportPercent: number;
  /** A winner exists only with strictly more than half the electorate. */
  winnerId: string | null;
  enactedPolicyId: string;
  statusQuoReason: 'no-majority' | 'status-quo-majority' | 'no-eligible-policies' | null;
  /** False means automatic fallback can persist but cannot receive votes. */
  statusQuoFullyFunded: boolean;
  /** One eligible choice per cell; null throughout when no package is eligible. */
  voterChoices: (string | null)[];
  totalPopulationWeight: number;
  /** Entire evaluated menu, including underfunded packages. */
  candidateCount: number;
  eligibleCandidateCount: number;
  unfundedCandidateCount: number;
}

function canonicalOrder(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}

export function packageHasMajority(supportPercent: number): boolean {
  return supportPercent > BALLOT_MAJORITY_PERCENT + BALLOT_SUM_TOLERANCE;
}

/**
 * Stream the entire candidate menu once. Utility comparisons use the exact
 * numeric maximum: applying a pairwise epsilon while scanning would make tied
 * preferences depend on candidate order. Exact utility ties prefer the status
 * quo, then the lowest canonical policy ID. Only packages whose caller-verified
 * fullyFunded flag is true are eligible. The current policy remains the automatic
 * fallback even if it is underfunded, but is then unavailable as a ballot choice.
 */
export function tallyPackageBallot(input: PackageBallotInput): PackageBallotResult {
  const { candidates, weights, statusQuoId } = input;
  if (!weights.length) throw new RangeError('A ballot needs at least one population cell.');
  let totalPopulationWeight = 0;
  for (let cell = 0; cell < weights.length; cell++) {
    const weight = weights[cell]!;
    if (!Number.isFinite(weight) || weight < 0) throw new RangeError('Population weights must be finite and nonnegative.');
    totalPopulationWeight += weight;
  }
  if (!Number.isFinite(totalPopulationWeight) || totalPopulationWeight <= 0) {
    throw new RangeError('The electorate needs a finite positive total population.');
  }
  const maxima = new Float64Array(weights.length).fill(-Infinity);
  const voterChoices = new Array<string | null>(weights.length).fill(null);
  const ids = new Set<string>();
  const eligibleIds = new Set<string>();
  let statusQuoFullyFunded = false;
  for (const candidate of candidates) {
    if (!candidate.id || ids.has(candidate.id)) throw new RangeError('Every candidate needs a unique nonempty policy ID.');
    ids.add(candidate.id);
    if (typeof candidate.fullyFunded !== 'boolean') throw new RangeError('Every candidate needs an explicit fullyFunded boolean.');
    if (candidate.id === statusQuoId) statusQuoFullyFunded = candidate.fullyFunded;
    if (candidate.fullyFunded) eligibleIds.add(candidate.id);
    if (candidate.utilities.length !== weights.length) throw new RangeError('Every candidate must represent the same population cells.');
    for (let cell = 0; cell < weights.length; cell++) {
      const utility = candidate.utilities[cell]!;
      if (!Number.isFinite(utility)) throw new RangeError('Every candidate utility must be finite.');
      if (!candidate.fullyFunded) continue;
      const previous = voterChoices[cell];
      const tiePreferred = utility === maxima[cell] && previous !== statusQuoId
        && (candidate.id === statusQuoId || previous === null || canonicalOrder(candidate.id, previous) < 0);
      if (utility > maxima[cell]! || tiePreferred) {
        maxima[cell] = utility;
        voterChoices[cell] = candidate.id;
      }
    }
  }
  if (!ids.has(statusQuoId)) throw new RangeError('The exact current-policy package must appear on the ballot.');
  const support = new Map([...eligibleIds].map(id => [id, { weight: 0, percent: 0 }]));
  for (let cell = 0; cell < weights.length; cell++) {
    const choice = voterChoices[cell];
    if (choice === null) continue;
    const tally = support.get(choice!)!;
    tally.weight += weights[cell]!;
    tally.percent += weights[cell]! / totalPopulationWeight * 100;
  }
  const tallies = [...support].sort(([a], [b]) => canonicalOrder(a, b)).map(([policyId, tally]) => ({
    policyId, populationWeight: tally.weight, supportPercent: Math.min(100, tally.percent),
  }));
  let leading = tallies[0];
  for (const tally of tallies) if (!leading || tally.supportPercent > leading.supportPercent) leading = tally;
  const winnerId = leading && packageHasMajority(leading.supportPercent) ? leading.policyId : null;
  return {
    tallies, leadingPolicyId: leading?.policyId ?? null, topSupportPercent: leading?.supportPercent ?? 0,
    winnerId, enactedPolicyId: winnerId ?? statusQuoId,
    statusQuoReason: !leading ? 'no-eligible-policies' : winnerId === null ? 'no-majority' : winnerId === statusQuoId ? 'status-quo-majority' : null,
    statusQuoFullyFunded, voterChoices, totalPopulationWeight, candidateCount: ids.size,
    eligibleCandidateCount: eligibleIds.size, unfundedCandidateCount: ids.size - eligibleIds.size,
  };
}
