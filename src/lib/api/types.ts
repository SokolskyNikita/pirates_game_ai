/** JSON contracts shared by the presentation layer and the Python calculation API. */
export type ModelMode = 'us-only' | 'strategic';
export type Objective = 'prosperity' | 'output' | 'workers';
export type BenefitFormula = 'current' | 'flat' | 'prior-income';
export interface ModelInputs {
  usAiGrowth: number;
  foreignAiGrowth: number;
  productivityGain: number;
  jobsAffected: number;
  jobChange: number;
  jobSearch: number;
  capitalMobility: number;
  investmentResponse: number;
  foreignStrength: number;
  tradeIntensity: number;
  foreignMarketSize: number;
  foreignPopulationRatio: number;
  foreignTradeIntensity: number;
  tradableShare: number;
  tradeElasticity: number;
}
export interface InputSpec {
  key: keyof ModelInputs;
  label: string;
  min: number;
  max: number;
  step: number;
  description: string;
}
export interface Policy {
  id: string;
  label: string;
  pace: number;
  replacement: number;
  welfareScale: number;
  benefitFormula: BenefitFormula;
  laborTax: number;
  capitalTax: number;
  allowFreeTrade: boolean;
}
export interface Calibration {
  marketIncome: number;
  laborIncome: number;
  capitalIncome: number;
  passiveIncome: number;
  benefits: number;
  cashAndInKindBenefits: number;
  refundableCredits: number;
  tax: number;
  nonTransferSpending: number;
  laborTaxRate: number;
  capitalTaxRate: number;
  laborTaxBase: number;
  capitalTaxBase: number;
  weights: number[];
  workerShare: number;
}
export interface RegionYear {
  year: number;
  adoption: number;
  output: number;
  gdpGrowthRate: number;
  workerIncomeIndex: number;
  allIncomeIndex: number;
  employedIncomeIndex: number;
  displacedIncomeIndex: number;
  unemployment: number;
  productiveEmployment: number;
  retainedWorkers: number;
  consumerPriceIndex: number;
  tradeOpen: boolean;
  employerNetPayRatio: number;
  benefitsRequired: number;
  benefitsPaid: number;
  benefitsScalePaid: number;
  baselineBenefits: number;
  effectiveLaborTax: number;
  effectiveCapitalTax: number;
  capacityFactor: number;
}
export interface ProfileOutcome {
  usPolicy: Policy;
  foreignPolicy?: Policy;
  usAdmissible: boolean;
  us: RegionYear[];
  foreign?: RegionYear[];
  employerPaymentRange: { low: number; high: number } | null;
}
export interface PackageBallotTally {
  policyId: string;
  populationWeight: number;
  supportPercent: number;
}

export interface PackageBallotResult {
  votingRule: 'majority' | 'plurality';
  coordination: {
    method: 'strictly-improving-coalitions';
    stable: boolean;
    reason: 'stable' | 'cycle' | 'step-limit';
    steps: number;
    resolution: 'coalition-stable' | 'least-vulnerable-recorded-ballot';
    sincereEnactedPolicyId: string;
    sincereTopSupportPercent: number;
    changedOutcome: boolean;
    strategicVoterPercent: number;
    abstentionPercent?: number;
    maxChallengerSupportPercent?: number;
    withdrawals?: number;
  };
  /** Eligible packages only, sorted by ID, including those receiving zero votes. */
  /** Canonical ID breaks an exact tie for this descriptive leading position. */
  leadingPolicyId: string | null;
  topSupportPercent: number;
  /** Funded leading package; majority required unless statusQuoUnavailable is set. */
  winnerId: string | null;
  enactedPolicyId: string;
  statusQuoReason: 'no-majority' | 'status-quo-majority' | 'no-eligible-policies' | null;
  /** False means automatic fallback can persist but cannot receive votes. */
  statusQuoFullyFunded: boolean;
  statusQuoExcluded: boolean;
  /** One eligible choice per cell; null throughout when no package is eligible. */
  totalPopulationWeight: number;
  /** Entire evaluated menu, including underfunded packages. */
  candidateCount: number;
  eligibleCandidateCount: number;
  unfundedCandidateCount: number;
  /** Packages removed by the voting rule, separate from funding failures. */
  excludedCandidateCount: number;
}

export interface ElectionSearch {
  startsTried: number;
  iterations: number;
  ballotsEvaluated: number;
  foreignResponsesEvaluated: number;
  consistentPairsFound: number;
  cycleCount: number;
  exhaustedStarts: number;
  ineligibleBallots: number;
  reason: string;
}
export interface ScenarioRequest {
  id: number;
  inputs: ModelInputs;
  mode: ModelMode;
  foreignObjective: Objective;
  /** Exclude a pause from both actors’ policy menus. */ pauseUnavailable?: boolean;
  /** Exclude current US policy and enact the funded alternative with the most votes. */ statusQuoUnavailable?: boolean;
  /** Legacy callers may supply this; deployment is now on the ballot. */ pace?: number;
}
export interface ScenarioSnapshot {
  inputs: ModelInputs;
  mode: ModelMode;
  foreignObjective: Objective;
  pauseUnavailable: boolean;
  statusQuoUnavailable: boolean;
  selected: ProfileOutcome;
  leading?: { usPolicy: Policy };
  ballot: PackageBallotResult;
  selection: 'domestic-ballot' | 'verified-consistent' | 'selected-by-rule';
  policyCount: number;
  foreignPolicyCount: number;
  evaluations: number;
  search: ElectionSearch;
  foreignBestPolicy?: Policy;
  foreignBestResponseGain?: number;
}
export type ScenarioResponse =
  | { id: number; snapshot: ScenarioSnapshot; source?: 'precomputed' | 'calculated'; error?: never }
  | { id: number; error: string; snapshot?: never };

export interface ComparisonRequest {
  scenario: Pick<ScenarioRequest, 'inputs' | 'mode' | 'foreignObjective' | 'pauseUnavailable' | 'statusQuoUnavailable'>;
  policyId: string;
  selectedPolicyId: string;
  foreignPolicyId?: string;
}
export interface ComparisonResponse {
  profile: ProfileOutcome;
  voteShare: number;
}
export interface ElectorateMetadata {
  population: number;
  cohortCount: number;
  personalPrimaryIncomeShares: Record<string, number>;
  employmentShares: Record<string, number>;
  receiptShares: Record<string, number>;
  incomeQuintiles: { quintile: number; grossIncome: number; disposableIncome: number; benefits: number }[];
}
export type PolicyAxis =
  'pace' | 'replacement' | 'welfareScale' | 'benefitFormula' | 'laborTax' | 'capitalTax' | 'allowFreeTrade';
export type PolicyOptions = Record<PolicyAxis, { value: number | BenefitFormula | boolean; idPart: string }[]>;

export interface CalculatorConfig {
  growthBaseline: { us: number; foreign: number };
  defaults: ModelInputs;
  inputSpecs: InputSpec[];
  policyOptions: PolicyOptions;
  calibration: Calibration;
  electorate: ElectorateMetadata;
  modelNotes: { title: string; detail: string; equation?: string }[];
  referenceIncome: number;
}
