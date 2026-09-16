/** Census ASEC 2026 adult-citizen cohorts; annual income refers to 2025.
 * Dollar values are pooled household amounts divided by all household adults.
 * Weights represent citizens age 18+, without turnout weighting. */
import data from './us-electorate-data.json';

export type IncomeSourceGroup = 'work' | 'benefits' | 'pension' | 'capital' | 'other';
export type EmploymentGroup = 'employed' | 'unemployed' | 'retired' | 'inactive';
export interface USIncomeCohort {
  id: string;
  weight: number;
  group: IncomeSourceGroup;
  incomeBand: string;
  incomeQuintile: number;
  employment: EmploymentGroup;
  laborIncome: number;
  capitalIncome: number;
  pensionIncome: number;
  otherIncome: number;
  benefits: number;
  cashBenefits: number;
  noncashBenefits: number;
  tax: number;
  payrollTax: number;
  incomeTax: number;
  laborTaxBaseline: number;
  capitalTaxBaseline: number;
  noncapitalTaxBase: number;
  capitalTaxBase: number;
  /** Household labor income per adult; the engine's pre-displacement pay base. */
  priorIncome: number;
  /** Citizen's own annual earnings, retained separately from pooled resources. */
  ownLaborIncome: number;
  capitalGains: number;
  grossIncome: number;
  disposableIncome: number;
}

export const US_COHORTS = data.cohorts as readonly USIncomeCohort[];
export const US_ELECTORATE = data.metadata;
export const BASELINE_LABOR_TAX_RATE = data.metadata.baselineLaborTaxRate;
export const BASELINE_CAPITAL_TAX_RATE = data.metadata.baselineCapitalTaxRate;
