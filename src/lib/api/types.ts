/** JSON contracts shared by the presentation layer and the Python calculation API. */
export type ModelMode = 'us-only' | 'strategic';
export type Objective = 'prosperity' | 'output' | 'workers';
export type BenefitFormula = 'current' | 'flat' | 'prior-income';
export interface ModelInputs {
  usGdpGrowth: number;
  foreignGdpGrowth: number;
  productivityGain: number;
  displacement: number;
  reemployment: number;
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
  exposure: number;
  output: number;
  netOutput: number;
  potentialOutput: number;
  potentialGrowthRate: number;
  gdpGrowthRate: number;
  workerIncome: number;
  ownerIncome: number;
  allIncome: number;
  workerIncomeIndex: number;
  ownerIncomeIndex: number;
  allIncomeIndex: number;
  employedIncomeIndex: number;
  displacedIncomeIndex: number;
  newlyDisplacedIncomeIndex: number;
  longTermDisplacedIncomeIndex: number;
  cohortIncome: number[];
  unemployment: number;
  aiUnemployment: number;
  tradeUnemployment: number;
  consumerPriceIndex: number;
  tradeOpen: boolean;
  importShare: number;
  exportShare: number;
  relativeProducerPrice: number;
  newlyDisplaced: number;
  longTermDisplaced: number;
  reemployed: number;
  employerPay: number;
  employerPayRatio: number;
  employerNetPayRatio: number;
  employerFundingGap: number;
  benefitsRequired: number;
  benefitsPaid: number;
  benefitsScalePaid: number;
  baselineBenefits: number;
  nonTransferSpending: number;
  governmentFundingGap: number;
  welfareFundingGap: number;
  taxRevenue: number;
  laborTaxRevenue: number;
  capitalTaxRevenue: number;
  laborTaxBase: number;
  capitalTaxBase: number;
  effectiveLaborTax: number;
  effectiveCapitalTax: number;
  laborIncome: number;
  capitalIncome: number;
  capitalAfterRetention: number;
  investmentBurden: number;
  laborEffort: number;
  capacityFactor: number;
  investmentCost: number;
  adjustmentCost: number;
  netRentFlow: number;
  consumption: number;
  resourceResidual: number;
  feasible: boolean;
}
export interface LightProfile {
  id: string;
  usPolicy: Policy;
  foreignPolicy?: Policy;
  usUtilities: number[];
  usScore: number;
  foreignScore?: number;
  usAdmissible: boolean;
  foreignAdmissible?: boolean;
}
export interface ProfileOutcome extends LightProfile {
  us: RegionYear[];
  foreign?: RegionYear[];
  feasible: boolean;
  foreignFeasible?: boolean;
  fundingGap: number;
  foreignFundingGap?: number;
  employerPaymentRange: { low: number; high: number } | null;
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
export interface ScenarioRequest {
  id: number;
  inputs: ModelInputs;
  mode: ModelMode;
  foreignObjective: Objective;
  /** Exclude a pause from both actors’ policy menus. */ pauseUnavailable?: boolean;
  /** Legacy callers may supply this; deployment is now on the ballot. */ pace?: number;
}
export interface ScenarioSnapshot {
  inputs: ModelInputs;
  mode: ModelMode;
  foreignObjective: Objective;
  pauseUnavailable: boolean;
  selected: ProfileOutcome;
  statusQuo: ProfileOutcome;
  baseline: ProfileOutcome;
  /** At most eight highest-support funded packages, including the selected policy when it ranks. */
  alternatives: ProfileOutcome[];
  leading?: ProfileOutcome;
  ballot: PackageBallotResult;
  selection: 'domestic-ballot' | 'verified-consistent' | 'search-incomplete';
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
  scenario: Pick<ScenarioRequest, 'inputs' | 'mode' | 'foreignObjective' | 'pauseUnavailable'>;
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
  defaults: ModelInputs;
  inputSpecs: InputSpec[];
  policyOptions: PolicyOptions;
  calibration: Calibration;
  electorate: ElectorateMetadata;
  modelNotes: { title: string; detail: string; equation?: string }[];
  referenceIncome: number;
}
