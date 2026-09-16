import type { ModelInputs, Policy, ProfileOutcome, PolicyAxis, BenefitFormula } from '../api/types';
import { CALIBRATION } from './config';
const pct = (n: number) => Number((n * 100).toFixed(1)) + '%';
const num = (n: number) => n.toFixed(1);
const change = (index: number) => (index >= 100 ? '+' : '−') + Math.abs(index - 100).toFixed(1) + '%';
const last = (profile: ProfileOutcome) => profile.us[profile.us.length - 1]!;
function formatInput(key: keyof ModelInputs, value: number) {
  if (key === 'usGdpGrowth' || key === 'foreignGdpGrowth') return pct(value) + '/year';
  if (key === 'foreignMarketSize') return Number(value.toFixed(2)) + '× US';
  if (key === 'foreignStrength') return pct(value) + ' of US';
  return pct(value);
}

const replacementName = (r: number) =>
  r === 0 ? 'Allow layoffs' : 'Retain at ' + pct(r) + ' of prior wages';
const dollars = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(
    value,
  );
const voteShare = (value: number) => value.toFixed(2) + '%';
const paceName = (value: number) =>
  value === 0 ? 'Pause AI' : value === 2 ? 'Accelerate AI' : 'Allow current AI pace';
const policyAxes = [
  'pace',
  'replacement',
  'welfareScale',
  'benefitFormula',
  'laborTax',
  'capitalTax',
] as const;
const axisLabels: Record<PolicyAxis, string> = {
  pace: 'AI pace',
  replacement: 'Employer retention',
  welfareScale: 'Government redistribution',
  benefitFormula: 'Who receives the benefits',
  laborTax: 'Tax on work and pension income',
  capitalTax: 'Tax on investment income',
};
const formulaNames: Record<Policy['benefitFormula'], string> = {
  current: 'Keep the current recipient mix',
  flat: 'Equal payment to every adult',
  'prior-income': 'Payments proportional to prior income',
};
function changeFromReference(rate: number, reference: number) {
  const difference = (rate - reference) * 100;
  return Math.abs(difference) < 1e-7
    ? 'unchanged from the 2025 reference'
    : Math.abs(difference).toFixed(1) +
        ' percentage points ' +
        (difference < 0 ? 'below' : 'above') +
        ' the 2025 reference';
}
function welfareName(scale: number) {
  return scale === 1
    ? 'Keep the current total budget'
    : scale === 0
      ? 'End the modeled benefit payments'
      : (scale < 1 ? 'Reduce' : 'Increase') + ' the total budget by ' + pct(Math.abs(scale - 1));
}
function axisOptionValue(axis: PolicyAxis, value: number | BenefitFormula) {
  if (axis === 'benefitFormula') return formulaNames[value as BenefitFormula];
  const number = value as number;
  if (axis === 'pace') return paceName(number);
  if (axis === 'replacement') return replacementName(number);
  if (axis === 'welfareScale') return welfareName(number);
  const reference = axis === 'laborTax' ? CALIBRATION.laborTaxRate : CALIBRATION.capitalTaxRate;
  return pct(number) + ' benchmark (' + changeFromReference(number, reference) + ')';
}
function axisValue(axis: PolicyAxis, policy: Policy) {
  return axisOptionValue(axis, policy[axis]);
}
function policyDescription(policy: Policy) {
  return (
    paceName(policy.pace) +
    '; ' +
    replacementName(policy.replacement) +
    '; benefit budget target ' +
    pct(policy.welfareScale) +
    ' of the reference budget; ' +
    formulaNames[policy.benefitFormula].toLowerCase() +
    '; work/pension tax benchmark ' +
    pct(policy.laborTax) +
    ', investment tax ' +
    pct(policy.capitalTax) +
    '.'
  );
}
function paymentRange(profile: ProfileOutcome) {
  const range = profile.employerPaymentRange;
  if (!range) return 'not applicable';
  return Math.abs(range.high - range.low) < 0.00001 ? pct(range.low) : pct(range.low) + '–' + pct(range.high);
}

export {
  pct,
  num,
  change,
  last,
  formatInput,
  replacementName,
  dollars,
  voteShare,
  paceName,
  policyAxes,
  axisLabels,
  formulaNames,
  changeFromReference,
  welfareName,
  axisValue,
  axisOptionValue,
  policyDescription,
  paymentRange,
};
export type { PolicyAxis };
