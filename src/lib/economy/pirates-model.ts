/**
 * Illustrative production and household-income engine; not a US forecast.
 * Workers and owners are editable shares of 1,000 representative households.
 * Baseline output100 = productive labor60 + capital40. Retaining an obsolete
 * role pays private wages without adding production; reemployment moves the
 * worker back into a productive role. The fixed pre-AI wage is60/workerShare.
 *
 * Before behavioral responses, forecast affected employment from both chosen
 * domestic/foreign deployment paths and the annual reemployment rate. Let
 * c=min(1,60*forecastAffected*retentionTarget/40), and
 * q=workerOwnership*workerTax+(1-workerOwnership)*ownerTax.
 * investmentBurden =1-(1-c)*(1-q).
 * adoption=pace*(t/10)*frontier*(1-response*investmentBurden).
 * exposure=adoption+.25*trade*foreignAdoption*(1-adoption).
 * u=(1-reemployment)*previousU+displacement*change(exposure).
 * laborEffort=1-response*workerTax.
 * Y=40+60*(1-u)*laborEffort+100*productivityGain*exposure.
 * L=60*(1-u)*laborEffort*(1+.35*productivityGain*exposure).
 * I=12*change(adoption)+40*change(adoption)^2; J=30*newlyAffected.
 * K=Y-L-I-J. International rents F sum to zero after population weights;
 * attraction depends on adoption and the combined retention/tax burden.
 *
 * Employer pay E=min(60*u*retentionTarget,max(0,K+F)); C=K+F-E.
 * Worker tax Tw=workerTax*(L+E+workerOwnership*C).
 * Owner tax To=ownerTax*(1-workerOwnership)*C; receipts T=Tw+To.
 * Employer net pay En=E*(1-workerTax).
 * Public top-up G=min(T,max(0,60*u*publicFloor-En)). Transfers are not taxed.
 * Residual D=T-G is rebated equally PER VOTER: workers get workerShare*D,
 * owners get(1-workerShare)*D. Worker-owned capital is taxed at workerTax.
 * Total household income therefore equals Y-I-J+F exactly.
 *
 * The public floor concerns NET employer wages + public support, excluding
 * capital income and the universal rebate. Employer targets concern GROSS pay.
 * Unfunded obligations remain valid strategies with actual funded incomes;
 * shortfalls are reported and are not represented as fully paid promises.
 * No demand, price, debt, capital-stock accumulation or depreciation is solved.
 * Behavioral responses affect new AI deployment and labor effort only. The
 * baseline capital contribution 40 is maintained. Response coefficients are
 * declared assumptions, not calibrated elasticities or empirical forecasts.
 */

export type ModelMode = 'us-only' | 'strategic';
export type Objective = 'prosperity' | 'output' | 'workers';

export interface ModelInputs {
  productivityGain: number;
  displacement: number;
  reemployment: number;
  workerOwnership: number;
  workerShare: number;
  capitalMobility: number;
  investmentResponse: number;
  foreignStrength: number;
  tradeIntensity: number;
  foreignMarketSize: number;
}

export interface InputSpec {
  key: keyof ModelInputs;
  label: string;
  min: number;
  max: number;
  step: number;
  description: string;
}

export const DEFAULT_INPUTS: ModelInputs = {
  productivityGain: .4,
  displacement: .35,
  reemployment: .2,
  workerOwnership: .1,
  workerShare: .9,
  capitalMobility: .5,
  investmentResponse: .35,
  foreignStrength: 1,
  tradeIntensity: .3,
  foreignMarketSize: 1,
};

export const INPUT_SPECS: readonly InputSpec[] = [
  { key: 'productivityGain', label: 'Potential productivity gain', min: 0, max: 1, step: .05, description: 'Extra annual output at full exposure before displacement and resource costs; a hypothetical assumption.' },
  { key: 'displacement', label: 'Roles made obsolete', min: 0, max: 1, step: .05, description: 'Share of productive roles made obsolete at full exposure, before workers move into new productive roles. At 100%, every worker can eventually be affected.' },
  { key: 'reemployment', label: 'Return to productive work', min: 0, max: 1, step: .05, description: 'Share of workers in obsolete roles who return to productive work each year, whether previously retained or laid off.' },
  { key: 'workerOwnership', label: 'Workers’ share of capital', min: 0, max: .5, step: .025, description: 'Fraction of all capital income belonging to the worker-household group, including employee or pension ownership.' },
  { key: 'workerShare', label: 'Worker households in the electorate', min: .01, max: .99, step: .001, description: 'Worker share of 1,000 voters; the remainder are owner households. Aggregate labor income 60 and capital income 40 stay fixed, so income per household adjusts with this ratio.' },
  { key: 'capitalMobility', label: 'Mobile AI rents', min: 0, max: 1, step: .05, description: 'Strength of international rent relocation and its response to different tax rates; inactive in US-only mode.' },
  { key: 'investmentResponse', label: 'Response to policy burdens', min: 0, max: 1, step: .05, description: 'How strongly employer retention and income levies reduce new AI investment, and worker levies reduce productive labor effort. Zero holds these behavioral responses fixed.' },
  { key: 'foreignStrength', label: 'Foreign frontier capability', min: 0, max: 1, step: .05, description: 'Foreign adoption capacity and ability to attract mobile rents. Zero removes the strategic rival.' },
  { key: 'tradeIntensity', label: 'Cross-border exposure', min: 0, max: 1, step: .05, description: 'Imported AI and knowledge add up to one quarter of the other bloc’s adoption to domestic exposure.' },
  { key: 'foreignMarketSize', label: 'Foreign market / population', min: .25, max: 4, step: .25, description: 'Foreign population and baseline output relative to the US; both blocs begin with the same output per person.' },
];

export interface Policy {
  id: string;
  label: string;
  /** Target adoption by year 10, before frontier and tax-investment effects. */
  pace: number;
  /** Employer retention pay: zero lays off; positive values retain obsolete roles at a pre-AI wage target. */
  replacement: number;
  /** Net wage-income floor for affected workers, counting employer wages after worker tax toward it. */
  safetyNet: number;
  /** Owner-household levy on their remaining capital income. */
  tax: number;
  /** Worker-household levy on productive wages, retained wages and their capital income. */
  workerTax: number;
  /** Compatibility field, always zero; no training policy in this version. */
  training: number;
}

const PACE_CHOICES = [
  { pace: 0, label: 'Pause' },
  { pace: .33, label: 'Cautious' },
  { pace: .67, label: 'Steady' },
  { pace: 1, label: 'Full' },
];

export const POLICIES: readonly Policy[] = PACE_CHOICES.flatMap(({ pace, label }, p) =>
  [0, .5, 1, 1.25].flatMap((replacement, r) => [0, .5, 1].flatMap((safetyNet, g) =>
    [0, .5, 1].flatMap((workerTax, w) => [0, .5, 1].map((tax, q) => ({
      id: `p${p}-r${r}-g${g}-w${w}-t${q}`,
      label: `${replacement === 0 ? 'Lay off' : `Retain at ${Math.round(replacement * 100)}% wage`} · ${Math.round(safetyNet * 100)}% public floor · workers ${Math.round(workerTax * 100)}% / owners ${Math.round(tax * 100)}% tax · ${label} adoption`,
      pace, replacement, safetyNet, workerTax, tax, training: 0,
    }))))),
);

export const BASELINE_POLICY: Policy = POLICIES[0]!;
export const YEARS = 10;
export const DISCOUNT_RATE = .03;
export const EQUILIBRIUM_TOLERANCE = 1e-10;
/** Offset affects utility only; it never creates household income. */
export const UTILITY_OFFSET = .01;

export const MODEL_NOTES: readonly { title: string; detail: string; equation?: string }[] = [
  { title: 'Two separate choices', detail: 'Private policy either lays off workers in obsolete roles or requires employers to retain them at 50%, 100% or 125% of their fixed pre-AI wage, before household taxes. Retained roles add no production. Public policy separately offers no targeted floor, a 50% floor or a 100% floor, measured after tax on employer wages. This is a mandated retention rule, not a claim that profit-maximizing firms voluntarily keep obsolete jobs.' },
  { title: 'Household taxes and public payments', detail: 'Workers and owners have separate 0%, 50% or 100% household levies. The worker base includes productive wages, retained wages and worker-owned capital income. The owner base is their share of capital left after retained payroll. Government payments are exempt from these taxes. The public floor tops up net retained wages; it is not added on top of a full floor already paid by employers.', equation: 'public support=min(tax receipts,max(0,60×affected workers×public floor−employer pay×(1−worker tax)))' },
  { title: 'The residual rebate', detail: 'After targeted public support, every voter receives an equal share of remaining receipts, including owners. Thus a zero targeted floor does not necessarily mean zero government income. The worker and owner dividends are their household-population shares of the residual pool. This universal rebate is a specified budget rule, not a description of the current US system.' },
  { title: 'Money must come from somewhere', detail: 'Employer retention wages are paid from capital income before household levies. Both wages and public support are capped by their available funding. Private payroll, taxes and transfers change who receives output; none creates additional output. Private gross-pay shortfalls and net public-floor shortfalls are shown separately, without adding overlapping missing income twice.', equation: 'total household income = gross output − installation cost − adjustment cost + net foreign rent inflow' },
  { title: 'Worker and owner populations', detail: 'The electorate has 1,000 voters. The worker share is editable in one-voter steps, with both groups present. Workers are tracked by productive, newly obsolete and longer-term obsolete roles. Obsolete workers may be retained employees or laid off. Baseline aggregate productive wages 60 and capital income 40 remain fixed when population shares change, so baseline income per household changes.' },
  { title: 'Investment and labor incentives', detail: 'Anticipated retention payroll and ownership-weighted household levies jointly reduce the return to new AI deployment. The retention forecast includes imported exposure even during a domestic deployment pause. Worker taxes also reduce productive labor effort through the same adjustable response parameter. At zero response these behavioral effects are held fixed. These are transparent illustrative response rules, not estimated elasticities.', equation: 'capital levy=ownership×worker tax+(1−ownership)×owner tax; combined burden=1−(1−capital levy)×(1−anticipated payroll share); adoption=planned adoption×(1−response×burden); labor effort=1−response×worker tax' },
  { title: 'International competition', detail: 'Up to 60% of new AI rents can relocate, depending on mobility and foreign capability. Larger markets, greater adoption and smaller combined retention/tax burdens attract more. Net US flow plus foreign population times foreign flow is zero. Relocation changes national income without creating world production. Zero foreign capability explicitly removes the rival and reduces the calculation to US-only mode.' },
  { title: 'Scores and rational voters', detail: 'The economic comparison scores use ten annual outcomes and a 3% discount rate. Income utility is log((income/baseline+0.01)/1.01). The 1% offset affects utility only, never actual income. Separate voting code evaluates each voter’s own expected future utility and majority challenges. Population-weighted worker/owner utility optima are comparison benchmarks, not democratic winners.' },
  { title: 'The policy menu', detail: 'At a fixed deployment pace, 4 retention choices×3 public floors×3 worker levies×3 owner levies give 108 policies and 11,664 international pairs. Every choice is enumerated. The four deployment scenarios are 0%, 33%,67% and 100%. The browser does not claim to have solved all four paces simultaneously.' },
  { title: 'Limits of the economic response', detail: 'There is no full general-equilibrium, price, demand, debt, capital-stock accumulation or depreciation model. Behavioral penalties concern new AI investment and labor effort; the baseline capital contribution 40 remains. The model does not assign real professions to risk ranks, estimate current US income distribution or predict an inevitable collapse under a particular tax.' },
];

export interface RegionYear {
  year: number;
  workerShare: number;
  adoption: number;
  exposure: number;
  output: number;
  /** Production less investment, adjustment and training; excludes rent flows. */
  netOutput: number;
  workerIncome: number;
  ownerIncome: number;
  workerIncomeIndex: number;
  ownerIncomeIndex: number;
  /** Per-household indices against a worker household's pre-AI income. */
  employedIncomeIndex: number;
  displacedIncomeIndex: number;
  newlyDisplacedIncomeIndex: number;
  longTermDisplacedIncomeIndex: number;
  /** Income totals of the employed and displaced subgroups, respectively. */
  employedIncome: number;
  displacedIncome: number;
  newlyDisplaced: number;
  longTermDisplaced: number;
  safetyNetRequired: number;
  safetyNetPaid: number;
  ongoingSupportPaid: number;
  newReplacementPaid: number;
  longTermReplacementPaid: number;
  /** Pre-AI wage per worker household, in model output-index units, not dollars. */
  priorWage: number;
  /** Combined net employer wages and public support as a fraction of pre-AI wages. */
  replacementPaid: number;
  employerPay: number;
  employerPayRatio: number;
  employerNetPayRatio: number;
  employerFundingGap: number;
  publicSupport: number;
  publicSupportRatio: number;
  netWageIncomeRatio: number;
  safetyNetFundingGap: number;
  productiveWorkers: number;
  retainedWorkers: number;
  laidOffWorkers: number;
  employedWorkers: number;
  /** Government spending only; private employer retention pay is separate. */
  supportCost: number;
  unfundedSupport: number;
  /** True iff all requested support, including the temporary safety net, is funded. */
  feasible: boolean;
  unemployment: number;
  reemployed: number;
  laborIncome: number;
  totalLaborIncome: number;
  laborEffort: number;
  investmentBurden: number;
  /** Capital income after investment/adjustment and relocation, before retained payroll and household taxes. */
  capitalIncome: number;
  capitalAfterRetention: number;
  taxRevenue: number;
  baselineTaxRevenue: number;
  additionalTaxRevenue: number;
  workerTaxRevenue: number;
  ownerTaxRevenue: number;
  workerTaxBase: number;
  ownerTaxBase: number;
  taxBase: number;
  transfers: number;
  workerDividend: number;
  ownerDividend: number;
  totalDividend: number;
  trainingSpend: number;
  investmentCost: number;
  adjustmentCost: number;
  netRentFlow: number;
  /** Taxable incremental AI rents after relocation. */
  aiRents: number;
  consumption: number;
  /** Budget identity residual; should be roundoff near zero. */
  resourceResidual: number;
}

export interface ProfileOutcome {
  id: string;
  usPolicy: Policy;
  foreignPolicy?: Policy;
  us: RegionYear[];
  foreign?: RegionYear[];
  usScore: number;
  foreignScore?: number;
  globalScore: number;
  /** Largest available unilateral improvement in the selected objective. */
  usRegret: number;
  foreignRegret: number;
  maxRegret: number;
  /** US target funded in every year; this does not exclude other strategies. */
  feasible: boolean;
  foreignFeasible?: boolean;
  /** Sum of the US annual unfunded support requirements, in index units. */
  fundingGap: number;
  foreignFundingGap?: number;
}

export interface SolveOptions { mode: ModelMode; objective: Objective; pace?: number }

export interface SolveResult {
  inputs: ModelInputs;
  mode: ModelMode;
  objective: Objective;
  pace?: number;
  effectiveMode: ModelMode;
  policies: readonly Policy[];
  outcomes: ProfileOutcome[];
  selected: ProfileOutcome;
  equilibria: ProfileOutcome[];
  selection: 'us-optimum' | 'pure-nash' | 'min-regret';
  coordinated: ProfileOutcome;
  usBestResponse: ProfileOutcome;
  baseline: ProfileOutcome;
}

export function normalizeInputs(values: Partial<ModelInputs> = {}): ModelInputs {
  const result = { ...DEFAULT_INPUTS };
  for (const spec of INPUT_SPECS) {
    const value = values[spec.key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      result[spec.key] = Math.max(spec.min, Math.min(spec.max, value));
    }
  }
  // Keep the economic population and the 1,000 representative voters identical,
  // including inputs supplied through a URL rather than the stepped slider.
  result.workerShare = Math.round(result.workerShare * 1000) / 1000;
  return result;
}

function checkedPolicy(policy: Policy): Policy {
  if (![policy.pace, policy.tax, policy.workerTax, policy.training, policy.replacement, policy.safetyNet].every(Number.isFinite)
    || policy.pace < 0 || policy.pace > 1 || policy.tax < 0 || policy.tax > 1 || policy.workerTax < 0 || policy.workerTax > 1
    || policy.training !== 0 || policy.replacement < 0 || policy.replacement > 1.25
    || policy.safetyNet < 0 || policy.safetyNet > 1) {
    throw new RangeError('Policy must have pace 0–1, worker and owner tax rates 0–1, retention 0–1.25, public floor 0–1 and no training share.');
  }
  return policy;
}

function initialYear(inputs: ModelInputs): RegionYear {
  const workerIncome = 60 + 40 * inputs.workerOwnership;
  const ownerIncome = 40 * (1 - inputs.workerOwnership);
  return {
    year: 0, workerShare: inputs.workerShare, adoption: 0, exposure: 0, output: 100, netOutput: 100,
    workerIncome, ownerIncome, workerIncomeIndex: 100, ownerIncomeIndex: 100,
    employedIncomeIndex: 100, displacedIncomeIndex: 100,
    newlyDisplacedIncomeIndex: 100, longTermDisplacedIncomeIndex: 100,
    newlyDisplaced: 0, longTermDisplaced: 0, safetyNetRequired: 0, safetyNetPaid: 0,
    ongoingSupportPaid: 0, newReplacementPaid: 0, longTermReplacementPaid: 0,
    employedIncome: workerIncome, displacedIncome: 0, priorWage: 60 / inputs.workerShare,
    replacementPaid: 0, supportCost: 0, unfundedSupport: 0, feasible: true,
    employerPay: 0, employerPayRatio: 0, employerNetPayRatio: 0, employerFundingGap: 0,
    publicSupport: 0, publicSupportRatio: 0, netWageIncomeRatio: 0, safetyNetFundingGap: 0,
    productiveWorkers: 1, retainedWorkers: 0, laidOffWorkers: 0, employedWorkers: 1,
    unemployment: 0, reemployed: 0, laborIncome: 60, totalLaborIncome: 60, capitalIncome: 40, capitalAfterRetention: 40,
    laborEffort: 1, investmentBurden: 0,
    taxRevenue: 0, baselineTaxRevenue: 0, additionalTaxRevenue: 0,
    workerTaxRevenue: 0, ownerTaxRevenue: 0, workerTaxBase: workerIncome, ownerTaxBase: ownerIncome,
    taxBase: 100, transfers: 0, workerDividend: 0, ownerDividend: 0, totalDividend: 0, trainingSpend: 0,
    investmentCost: 0, adjustmentCost: 0, netRentFlow: 0, aiRents: 0,
    consumption: 100, resourceResidual: 0,
  };
}

interface Production {
  adoption: number;
  exposure: number;
  unemployment: number;
  newlyDisplaced: number;
  reemployed: number;
  output: number;
  labor: number;
  capital: number;
  rents: number;
  investment: number;
  adjustment: number;
  laborEffort: number;
  investmentBurden: number;
}

/** Anticipated year-ten obsolete payroll as a share of baseline capital income,
 * evaluated before tax/retention deter adoption. Reemployment limits that bill.
 * It is a declared response approximation, not an investor's solved equilibrium.
 */
function investmentBurden(inputs: ModelInputs, policy: Policy, strength: number, otherPotential: number): number {
  let expectedAffected = 0;
  let priorExposure = 0;
  for (let t = 1; t <= YEARS; t++) {
    const own = policy.pace * strength * t / YEARS;
    const foreign = otherPotential * t / YEARS;
    const exposure = own + .25 * inputs.tradeIntensity * foreign * (1 - own);
    expectedAffected = (1 - inputs.reemployment) * expectedAffected + inputs.displacement * (exposure - priorExposure);
    priorExposure = exposure;
  }
  const retentionBurden = Math.min(1, 60 * expectedAffected * policy.replacement / 40);
  const capitalTax = inputs.workerOwnership * policy.workerTax + (1 - inputs.workerOwnership) * policy.tax;
  return 1 - (1 - capitalTax) * (1 - retentionBurden);
}

function adoptionAt(inputs: ModelInputs, policy: Policy, year: number, strength: number, burden: number): number {
  return policy.pace * (year / YEARS) * strength * (1 - inputs.investmentResponse * burden);
}

function production(inputs: ModelInputs, previous: RegionYear, adoption: number, otherAdoption: number, policy: Policy, burden: number): Production {
  const exposure = adoption + .25 * inputs.tradeIntensity * otherAdoption * (1 - adoption);
  const deltaExposure = Math.max(0, exposure - previous.exposure);
  const deltaAdoption = Math.max(0, adoption - previous.adoption);
  const reemploymentRate = inputs.reemployment;
  const reemployed = previous.unemployment * reemploymentRate;
  const unemployment = Math.min(1, Math.max(0, previous.unemployment - reemployed + inputs.displacement * deltaExposure));
  const laborEffort = 1 - inputs.investmentResponse * policy.workerTax;
  const output = 40 + 60 * (1 - unemployment) * laborEffort + 100 * inputs.productivityGain * exposure;
  const labor = 60 * (1 - unemployment) * laborEffort * (1 + .35 * inputs.productivityGain * exposure);
  const investment = 12 * deltaAdoption + 40 * deltaAdoption ** 2;
  const adjustment = 30 * inputs.displacement * deltaExposure;
  const capital = output - labor - investment - adjustment;
  return { adoption, exposure, unemployment, newlyDisplaced: inputs.displacement * deltaExposure, reemployed, output, labor, capital, rents: Math.max(0, capital - 40), investment, adjustment, laborEffort, investmentBurden: burden };
}

function settle(inputs: ModelInputs, policy: Policy, p: Production, year: number, flow: number): RegionYear {
  const aiRents = Math.max(0, p.rents + flow);
  const capitalIncome = p.capital + flow;
  const wageBill = 60 * p.unemployment;
  const employerRequired = wageBill * policy.replacement;
  const employerPay = Math.min(employerRequired, Math.max(0, capitalIncome));
  const employerFundingGap = Math.max(0, employerRequired - employerPay);
  const capitalAfterRetention = capitalIncome - employerPay;
  const workerTaxBase = p.labor + employerPay + inputs.workerOwnership * capitalAfterRetention;
  const ownerTaxBase = (1 - inputs.workerOwnership) * capitalAfterRetention;
  const workerTaxRevenue = policy.workerTax * workerTaxBase;
  const ownerTaxRevenue = policy.tax * ownerTaxBase;
  const taxRevenue = workerTaxRevenue + ownerTaxRevenue;
  const taxBase = workerTaxBase + ownerTaxBase;
  const employerNetPay = employerPay * (1 - policy.workerTax);
  const safetyNetRequired = Math.max(0, wageBill * policy.safetyNet - employerNetPay);
  const publicSupport = Math.min(safetyNetRequired, taxRevenue);
  const safetyNetFundingGap = Math.max(0, safetyNetRequired - publicSupport);
  const totalDividend = taxRevenue - publicSupport;
  const workerDividend = inputs.workerShare * totalDividend;
  const ownerDividend = (1 - inputs.workerShare) * totalDividend;
  const workerCapitalAfterTax = inputs.workerOwnership * capitalAfterRetention * (1 - policy.workerTax);
  const sharedWorkerIncome = workerCapitalAfterTax + workerDividend;
  const compensation = employerNetPay + publicSupport;
  const employedIncome = p.labor * (1 - policy.workerTax) + (1 - p.unemployment) * sharedWorkerIncome;
  const displacedIncome = p.unemployment * sharedWorkerIncome + compensation;
  const workerIncome = employedIncome + displacedIncome;
  const ownerIncome = ownerTaxBase - ownerTaxRevenue + ownerDividend;
  const baselineWorkerIncome = (60 + 40 * inputs.workerOwnership) / inputs.workerShare;
  const affectedIncomeIndex = p.unemployment > 0 ? 100 * displacedIncome / (inputs.workerShare * p.unemployment) / baselineWorkerIncome : 100;
  const actualWageRatio = wageBill > 0 ? compensation / wageBill : 0;
  const longTermDisplaced = Math.max(0, p.unemployment - p.newlyDisplaced);
  const consumption = workerIncome + ownerIncome;
  const retainedWorkers = policy.replacement > 0 ? p.unemployment : 0;
  const laidOffWorkers = policy.replacement === 0 ? p.unemployment : 0;
  // Employer and public promises overlap: count the missing income only once.
  const unfundedSupport = Math.max(0, wageBill * Math.max(policy.replacement * (1 - policy.workerTax), policy.safetyNet) - compensation);
  return {
    year, workerShare: inputs.workerShare, adoption: p.adoption, exposure: p.exposure, output: p.output,
    netOutput: p.output - p.investment - p.adjustment,
    workerIncome, ownerIncome, employedIncome, displacedIncome,
    employedIncomeIndex: p.unemployment < 1 ? 100 * employedIncome / (inputs.workerShare * (1 - p.unemployment)) / baselineWorkerIncome : 100,
    displacedIncomeIndex: affectedIncomeIndex,
    newlyDisplacedIncomeIndex: p.newlyDisplaced > 0 ? affectedIncomeIndex : 100,
    longTermDisplacedIncomeIndex: longTermDisplaced > 0 ? affectedIncomeIndex : 100,
    newlyDisplaced: p.newlyDisplaced, longTermDisplaced,
    priorWage: 60 / inputs.workerShare,
    replacementPaid: actualWageRatio,
    newReplacementPaid: p.newlyDisplaced > 0 ? actualWageRatio : 0,
    longTermReplacementPaid: longTermDisplaced > 0 ? actualWageRatio : 0,
    employerPay, employerPayRatio: wageBill > 0 ? employerPay / wageBill : 0,
    employerNetPayRatio: wageBill > 0 ? employerNetPay / wageBill : 0, employerFundingGap,
    publicSupport, publicSupportRatio: wageBill > 0 ? publicSupport / wageBill : 0, netWageIncomeRatio: actualWageRatio, safetyNetFundingGap,
    productiveWorkers: 1 - p.unemployment, retainedWorkers, laidOffWorkers, employedWorkers: 1 - laidOffWorkers,
    supportCost: publicSupport, unfundedSupport,
    feasible: employerFundingGap <= 1e-9 && safetyNetFundingGap <= 1e-9,
    safetyNetRequired, safetyNetPaid: publicSupport, ongoingSupportPaid: publicSupport,
    workerIncomeIndex: 100 * workerIncome / (60 + 40 * inputs.workerOwnership),
    ownerIncomeIndex: 100 * ownerIncome / (40 * (1 - inputs.workerOwnership)),
    unemployment: p.unemployment, reemployed: p.reemployed, laborIncome: p.labor,
    totalLaborIncome: p.labor + employerPay,
    laborEffort: p.laborEffort, investmentBurden: p.investmentBurden,
    capitalIncome, capitalAfterRetention, taxRevenue, baselineTaxRevenue: 0, additionalTaxRevenue: taxRevenue,
    workerTaxRevenue, ownerTaxRevenue, workerTaxBase, ownerTaxBase,
    taxBase, transfers: taxRevenue, workerDividend, ownerDividend, totalDividend, trainingSpend: 0,
    investmentCost: p.investment, adjustmentCost: p.adjustment, netRentFlow: flow, aiRents, consumption,
    resourceResidual: consumption + p.investment + p.adjustment - p.output - flow,
  };
}

/** Scores are discounted mean changes from the no-AI baseline, not forecasts.
 * Worker welfare separately weights employed, newly displaced and longer-term
 * displaced households by their current population shares. Each uses
 * log((income/baseline + .01)/1.01). The offset keeps zero incomes finite in the
 * objective but creates no income in the budget. Prosperity weights worker and
 * owner welfare by their editable household shares. Output = output/100-1 (gross output,
 * not national welfare or consumption). Relative population weights the global
 * objective, so a foreign bloc twice as large receives twice the global weight.
 */
export function scoreTrajectory(trajectory: readonly RegionYear[], objective: Objective): number {
  let score = 0;
  let weights = 0;
  for (const point of trajectory) {
    if (point.year === 0) continue;
    const weight = (1 + DISCOUNT_RATE) ** -point.year;
    const utility = (index: number) => Math.log((index / 100 + UTILITY_OFFSET) / (1 + UTILITY_OFFSET));
    const worker = (1 - point.unemployment) * utility(point.employedIncomeIndex)
      + point.newlyDisplaced * utility(point.newlyDisplacedIncomeIndex)
      + point.longTermDisplaced * utility(point.longTermDisplacedIncomeIndex);
    const owner = utility(point.ownerIncomeIndex);
    const value = objective === 'output' ? point.output / 100 - 1
      : objective === 'workers' ? worker : point.workerShare * worker + (1 - point.workerShare) * owner;
    score += weight * value;
    weights += weight;
  }
  return weights ? score / weights : 0;
}

function simulateRaw(inputs: ModelInputs, usPolicy: Policy, foreignPolicy: Policy | undefined, objective: Objective): ProfileOutcome {
  const us = [initialYear(inputs)];
  const foreign = foreignPolicy ? [initialYear(inputs)] : undefined;
  const usBurden = investmentBurden(inputs, usPolicy, 1, foreignPolicy ? foreignPolicy.pace * inputs.foreignStrength : 0);
  const foreignBurden = foreignPolicy ? investmentBurden(inputs, foreignPolicy, inputs.foreignStrength, usPolicy.pace) : 0;
  for (let year = 1; year <= YEARS; year++) {
    const usAdoption = adoptionAt(inputs, usPolicy, year, 1, usBurden);
    const foreignAdoption = foreignPolicy ? adoptionAt(inputs, foreignPolicy, year, inputs.foreignStrength, foreignBurden) : 0;
    const pUS = production(inputs, us[year - 1]!, usAdoption, foreignAdoption, usPolicy, usBurden);
    const pForeign = foreign && foreignPolicy ? production(inputs, foreign[year - 1]!, foreignAdoption, usAdoption, foreignPolicy, foreignBurden) : undefined;
    let usFlow = 0;
    if (pForeign && foreignPolicy) {
      const mobile = .6 * inputs.capitalMobility * inputs.foreignStrength;
      const mobileTotal = mobile * (pUS.rents + inputs.foreignMarketSize * pForeign.rents);
      const usWeight = (.15 + usAdoption) * Math.exp(-4 * inputs.capitalMobility * pUS.investmentBurden);
      const foreignWeight = inputs.foreignMarketSize * inputs.foreignStrength * (.15 + foreignAdoption)
        * Math.exp(-4 * inputs.capitalMobility * pForeign.investmentBurden);
      usFlow = mobileTotal * usWeight / (usWeight + foreignWeight) - mobile * pUS.rents;
    }
    us.push(settle(inputs, usPolicy, pUS, year, usFlow));
    if (pForeign && foreign && foreignPolicy) {
      foreign.push(settle(inputs, foreignPolicy, pForeign, year, -usFlow / inputs.foreignMarketSize));
    }
  }
  const usScore = scoreTrajectory(us, objective);
  const foreignScore = foreign ? scoreTrajectory(foreign, objective) : undefined;
  return {
    id: `${usPolicy.id}|${foreignPolicy?.id ?? 'none'}`,
    usPolicy, foreignPolicy, us, foreign, usScore, foreignScore,
    globalScore: foreignScore === undefined ? usScore : (usScore + inputs.foreignMarketSize * foreignScore) / (1 + inputs.foreignMarketSize),
    usRegret: 0, foreignRegret: 0, maxRegret: 0,
    feasible: us.every(point => point.feasible),
    foreignFeasible: foreign?.every(point => point.feasible),
    fundingGap: us.reduce((sum, point) => sum + point.unfundedSupport, 0),
    foreignFundingGap: foreign?.reduce((sum, point) => sum + point.unfundedSupport, 0),
  };
}

function assignRegrets(outcome: ProfileOutcome, bestUS: number, bestForeign = outcome.foreignScore ?? 0): void {
  outcome.usRegret = Math.max(0, bestUS - outcome.usScore);
  outcome.foreignRegret = Math.max(0, bestForeign - (outcome.foreignScore ?? 0));
  outcome.maxRegret = Math.max(outcome.usRegret, outcome.foreignRegret);
}

function policiesAtPace(pace: number = 1): readonly Policy[] {
  const policies = POLICIES.filter(policy => Math.abs(policy.pace - pace) < EQUILIBRIUM_TOLERANCE);
  if (!policies.length) throw new RangeError('Fixed pace must be 0, .33, .67 or 1.');
  return policies;
}

/** Simulate actual funded payments and check deviations on the chosen menu. */
export function simulateProfile(
  values: Partial<ModelInputs>,
  usPolicy: Policy,
  foreignPolicy?: Policy,
  mode: ModelMode = 'strategic',
  objective: Objective = 'prosperity',
  pace?: number,
): ProfileOutcome {
  const inputs = normalizeInputs(values);
  const opponent = mode === 'strategic' && inputs.foreignStrength > 0 ? foreignPolicy ?? BASELINE_POLICY : undefined;
  checkedPolicy(usPolicy);
  if (opponent) checkedPolicy(opponent);
  const result = simulateRaw(inputs, usPolicy, opponent, objective);
  let bestUS = result.usScore;
  let bestForeign = result.foreignScore ?? 0;
  for (const policy of policiesAtPace(pace)) {
    bestUS = Math.max(bestUS, simulateRaw(inputs, policy, opponent, objective).usScore);
    if (opponent) bestForeign = Math.max(bestForeign, simulateRaw(inputs, usPolicy, policy, objective).foreignScore!);
  }
  assignRegrets(result, bestUS, bestForeign);
  return result;
}

function bestBy(outcomes: readonly ProfileOutcome[], score: (p: ProfileOutcome) => number): ProfileOutcome {
  let best = outcomes[0]!;
  const tieRank = (p: ProfileOutcome) => [p.feasible && p.foreignFeasible !== false ? 0 : 1, p.usPolicy.replacement + p.usPolicy.safetyNet + (p.foreignPolicy?.replacement ?? 0) + (p.foreignPolicy?.safetyNet ?? 0), p.usPolicy.replacement, p.usPolicy.safetyNet];
  for (const outcome of outcomes) {
    const difference = score(outcome) - score(best);
    if (difference > EQUILIBRIUM_TOLERANCE) best = outcome;
    else if (Math.abs(difference) <= EQUILIBRIUM_TOLERANCE) {
      const a = tieRank(outcome), b = tieRank(best);
      for (let i = 0; i < a.length; i++) {
        if (a[i]! < b[i]!) { best = outcome; break; }
        if (a[i]! > b[i]!) break;
      }
    }
  }
  return best;
}

export interface PayoffCell { us: number; foreign: number }
export interface RegretCell {
  row: number;
  column: number;
  usRegret: number;
  foreignRegret: number;
  maxRegret: number;
}
export interface FiniteGameAnalysis {
  cells: RegretCell[];
  equilibria: RegretCell[];
  selected: RegretCell;
  selection: 'pure-nash' | 'min-regret';
}

/** Generic finite-game check, independently testable on games such as matching
 * pennies where no pure equilibrium exists. Rows are US strategies; columns
 * are foreign strategies. Never substitute a coordinated maximum for Nash.
 */
export function analyzePayoffs(matrix: readonly (readonly PayoffCell[])[]): FiniteGameAnalysis {
  const columns = matrix[0]?.length ?? 0;
  if (!matrix.length || !columns || matrix.some(row => row.length !== columns
    || row.some(cell => !Number.isFinite(cell.us) || !Number.isFinite(cell.foreign)))) {
    throw new RangeError('Expected a nonempty rectangular matrix of finite payoffs.');
  }
  const bestUS = Array.from({ length: columns }, (_, column) => Math.max(...matrix.map(row => row[column]!.us)));
  const bestForeign = matrix.map(row => Math.max(...row.map(cell => cell.foreign)));
  const cells = matrix.flatMap((row, i) => row.map((cell, j) => {
    const usRegret = Math.max(0, bestUS[j]! - cell.us);
    const foreignRegret = Math.max(0, bestForeign[i]! - cell.foreign);
    return { row: i, column: j, usRegret, foreignRegret, maxRegret: Math.max(usRegret, foreignRegret) };
  }));
  const equilibria = cells.filter(cell => cell.maxRegret <= EQUILIBRIUM_TOLERANCE);
  const minimum = Math.min(...cells.map(cell => cell.maxRegret));
  const candidates = equilibria.length ? equilibria : cells.filter(cell => cell.maxRegret <= minimum + EQUILIBRIUM_TOLERANCE);
  let selected = candidates[0]!;
  for (const candidate of candidates) {
    if (matrix[candidate.row]![candidate.column]!.us > matrix[selected.row]![selected.column]!.us + EQUILIBRIUM_TOLERANCE) selected = candidate;
  }
  return { cells, equilibria, selected, selection: equilibria.length ? 'pure-nash' : 'min-regret' };
}

/** Exhaustively solve the finite normal-form game. A pure Nash profile has no
 * profitable unilateral deviation in the tested grid. Targets that cannot be
 * funded remain valid strategies, but receive only their ACTUAL funded payoff.
 * This preserves a normal-form game instead of imposing joint fiscal-feasibility
 * constraints. Underfunding is reported, not passed off as full replacement.
 * Return every pure equilibrium;
 * profile; select the one with highest US objective (stable grid order for ties).
 * If none exists, select the minimum maximum-regret profile and label it an
 * approximation, not an equilibrium. No mixed-equilibrium claim is made.
 */
export function solveModel(
  values: Partial<ModelInputs> = DEFAULT_INPUTS,
  options: SolveOptions = { mode: 'strategic', objective: 'prosperity' },
): SolveResult {
  const inputs = normalizeInputs(values);
  const { mode, objective, pace = 1 } = options;
  const policies = policiesAtPace(pace);
  const effectiveMode: ModelMode = mode === 'strategic' && inputs.foreignStrength > 0 ? 'strategic' : 'us-only';
  const outcomes: ProfileOutcome[] = [];
  const foreignPolicies: readonly (Policy | undefined)[] = effectiveMode === 'strategic' ? policies : [undefined];
  for (const usPolicy of policies) {
    for (const foreignPolicy of foreignPolicies) {
      const outcome = simulateRaw(inputs, usPolicy, foreignPolicy, objective);
      outcomes.push(outcome);
    }
  }
  const analysis = analyzePayoffs(policies.map((_, row) => foreignPolicies.map((_, column) => {
    const p = outcomes[row * foreignPolicies.length + column]!;
    return { us: p.usScore, foreign: p.foreignScore ?? 0 };
  })));
  for (const cell of analysis.cells) {
    const p = outcomes[cell.row * foreignPolicies.length + cell.column]!;
    p.usRegret = cell.usRegret;
    p.foreignRegret = cell.foreignRegret;
    p.maxRegret = cell.maxRegret;
  }
  const equilibria = effectiveMode === 'strategic' ? outcomes.filter(outcome => outcome.maxRegret <= EQUILIBRIUM_TOLERANCE) : [];
  let selected: ProfileOutcome;
  let selection: SolveResult['selection'];
  if (effectiveMode === 'us-only') {
    selected = bestBy(outcomes, p => p.usScore);
    selection = 'us-optimum';
  } else {
    const minimum = analysis.selected.maxRegret;
    selected = bestBy(equilibria.length ? equilibria : outcomes.filter(p => p.maxRegret <= minimum + EQUILIBRIUM_TOLERANCE), p => p.usScore);
    selection = analysis.selection;
  }
  return {
    inputs, mode, objective, pace, effectiveMode, policies, outcomes, selected, equilibria, selection,
    coordinated: bestBy(outcomes, p => p.globalScore),
    usBestResponse: bestBy(outcomes.filter(p => p.foreignPolicy?.id === selected.foreignPolicy?.id), p => p.usScore),
    baseline: simulateProfile(inputs, BASELINE_POLICY, effectiveMode === 'strategic' ? BASELINE_POLICY : undefined, effectiveMode, objective, pace),
  };
}
