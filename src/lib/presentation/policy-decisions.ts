import type { ModelMode, Policy, PolicyAxis, RegionYear } from '../api/types';
import { CALIBRATION } from './config';
import { pct, dollars, policyAxes, axisLabels, axisValue, changeFromReference } from './format';

/** Shared presentation for each actor’s independently chosen policy. */
export function policyDecisions(
  p: Policy,
  end: RegionYear,
  { region, mode, employerPayment = '' }: {
    region: 'us' | 'foreign';
    mode: ModelMode;
    employerPayment?: string;
  },
) {
  const headingTag = region === 'foreign' ? 'h3' : 'h2';
  const baselineBenefits = end.baselineBenefits;
  const details: Record<PolicyAxis, string> = {
    pace:
      p.pace === 0
        ? 'No domestic or imported AI use for ten years.' +
          (mode === 'strategic'
            ? ' Open trade can still displace workers if foreign firms become more competitive.'
            : ' No AI job replacement occurs.')
        : p.pace === 2
          ? 'AI replacement runs twice as fast. Full domestic deployment and its full annual growth potential arrive by year five.'
          : 'AI replacement proceeds over ten years. Full domestic deployment and its full annual growth potential arrive by year ten.',
    replacement: p.replacement
      ? 'Employers fund the retained wages. This is a gross wage target; the modeled take-home payment is ' +
        employerPayment +
        ' of prior wages after tax.'
      : 'Employers may dismiss affected workers. Government benefits are shown below.',
    welfareScale:
      'Reference: ' +
      dollars(baselineBenefits) +
      ' per adult per year, averaged across the population. Target: ' +
      dollars(end.benefitsRequired) +
      '. Funded in year ten: ' +
      dollars(end.benefitsPaid) +
      ' (' +
      pct(end.benefitsScalePaid) +
      ' of the reference). The same total budget does not preserve each person’s payment.' +
      (p.welfareScale === 2 ? ' This is the highest budget tested.' : ''),
    benefitFormula:
      p.benefitFormula === 'current'
        ? 'Keep the survey’s relative allocation of cash benefits and consumption support. Recipients’ shares stay fixed as jobs change; this does not simulate future eligibility under every US program.'
        : p.benefitFormula === 'flat'
          ? 'Divide the funded budget equally among all adults, including workers, retirees and investors. This replaces the modeled Social Security and assistance payment pattern.'
          : 'Divide the same budget in proportion to each adult’s pre-AI disposable household income. Higher prior income means a larger payment. This uses prior-year income, not lifetime earnings.',
    laborTax:
      'Selected benchmark: ' +
      pct(p.laborTax) +
      ', ' +
      changeFromReference(p.laborTax, CALIBRATION.laborTaxRate) +
      ' of ' +
      pct(CALIBRATION.laborTaxRate) +
      '. Actual year-ten average: ' +
      pct(end.effectiveLaborTax) +
      '. Covers earnings, pensions and other non-investment income; it preserves income differences in the reference tax profile.',
    allowFreeTrade: p.allowFreeTrade
      ? 'The US permits trade. Goods, services and imported AI can cross this border only if the foreign actor also permits it.'
      : 'The US closes this border even if the foreign actor permits trade. The ban also stops imported AI and the model’s cross-border AI profit payments.',
    capitalTax:
      'Selected benchmark: ' +
      pct(p.capitalTax) +
      ', ' +
      changeFromReference(p.capitalTax, CALIBRATION.capitalTaxRate) +
      ' of ' +
      pct(CALIBRATION.capitalTaxRate) +
      '. Actual year-ten average: ' +
      pct(end.effectiveCapitalTax) +
      '. Applies to investment income even when its recipient also works.',
  };

  if (region === 'foreign') {
    details.replacement = p.replacement
      ? 'Employers fund retained wages at the gross target above. ' +
        (end.unemployment > 1e-9
          ? 'In year ten, employer pay after tax averages ' + pct(end.employerNetPayRatio) + ' of affected workers’ prior wages.'
          : 'No workers are affected in year ten, so no retention pay is needed then.')
      : 'Employers may dismiss affected workers. Government benefits are shown below.';
    details.welfareScale = 'Target: ' + pct(p.welfareScale) +
      ' of the model’s reference benefit budget. Funded in year ten: ' + pct(end.benefitsScalePaid) +
      '. The same total budget does not preserve each person’s payment.' +
      (p.welfareScale === 2 ? ' This is the highest budget tested.' : '');
    details.benefitFormula = p.benefitFormula === 'current'
      ? 'Keep the reference shares of cash benefits and consumption support. Those shares use the US household distribution as a proxy; they are not a survey of foreign welfare systems.'
      : p.benefitFormula === 'flat'
        ? 'Divide the funded budget equally among all adults in the foreign economy, including workers, retirees and investors. This replaces the reference allocation.'
        : 'Divide the funded budget in proportion to each adult’s pre-AI disposable household income. Higher prior income means a larger payment.';
    for (const axis of ['laborTax', 'capitalTax'] as const) {
      details[axis] = details[axis].replace('the 2025 reference', 'the US-based model reference');
    }
    details.allowFreeTrade = p.allowFreeTrade
      ? 'The rest of the world permits trade with the US. Goods, services and imported AI cross this border only if the US also permits it. Trade within the foreign bloc continues.'
      : 'The rest of the world closes its border with the US, including imported AI and cross-border AI profit payments. Trade within the foreign bloc continues.';
    details.pace = p.pace === 0
      ? 'No domestic or imported AI use for ten years. Open trade can still displace workers if US firms become more competitive.'
      : p.pace === 2
        ? 'AI replacement runs twice as fast. The foreign economy reaches its assumed deployment limit by year five, bringing its growth gains forward.'
        : 'AI replacement proceeds over ten years. The foreign economy reaches its assumed deployment limit by year ten.';
  }
  return policyAxes
    .filter((axis) => mode === 'strategic' || axis !== 'allowFreeTrade')
    .map((axis, index) => {
      let headline = axisValue(axis, p);
      if (region === 'foreign' && (axis === 'welfareScale' || axis === 'benefitFormula')) {
        headline = headline.replace('current', 'reference');
      }
      if (axis === 'laborTax' || axis === 'capitalTax') {
        const reference = axis === 'laborTax' ? CALIBRATION.laborTaxRate : CALIBRATION.capitalTaxRate;
        headline =
          (Math.abs(p[axis] - reference) < 1e-7
            ? 'Keep the tax benchmark at '
            : (p[axis] < reference ? 'Reduce' : 'Increase') + ' the tax benchmark to ') +
          pct(p[axis]) +
          '.';
      }
      const kind =
        axis === 'replacement' || axis === 'pace'
          ? 'employment-decision'
          : axis.endsWith('Tax')
            ? 'tax-decision'
            : 'government-decision';
      return (
        '<section class="policy-decision ' +
        kind +
        '"><p class="eyebrow">' +
        (index + 1) +
        ' · ' +
        axisLabels[axis] +
        '</p><div class="decision-answer"><' + headingTag + ' class="decision-title">' +
        headline +
        '</' + headingTag + '><p>' +
        details[axis] +
        '</p></div></section>'
      );
    })
    .join('');
}
