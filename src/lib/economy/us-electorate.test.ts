import { describe, expect, it } from 'vitest';
import { US_COHORTS, US_ELECTORATE, BASELINE_LABOR_TAX_RATE, BASELINE_CAPITAL_TAX_RATE } from './us-electorate';

const weighted = (key: keyof typeof US_ELECTORATE.perAdultMeans) =>
  US_COHORTS.reduce((sum, row) => sum + row.weight * row[key], 0);

describe('Census electorate dataset', () => {
  it('represents adult citizens with normalized survey weights, not an arbitrary voter count', () => {
    expect(US_ELECTORATE.surveyYear).toBe(2026);
    expect(US_ELECTORATE.incomeYear).toBe(2025);
    expect(US_ELECTORATE.sampleAdultCitizens).toBe(94612);
    expect(US_ELECTORATE.population).toBeCloseTo(243872507.36, 2);
    expect(US_COHORTS.length).toBe(US_ELECTORATE.cohortCount);
    expect(US_COHORTS.reduce((sum, row) => sum + row.weight, 0)).toBeCloseTo(1, 10);
    expect(new Set(US_COHORTS.map(row => row.id)).size).toBe(US_COHORTS.length);
    expect(US_COHORTS.every(row => row.weight > 0)).toBe(true);
  });

  it('preserves weighted income, benefit and tax totals after cohort compression', () => {
    for (const key of Object.keys(US_ELECTORATE.perAdultMeans) as (keyof typeof US_ELECTORATE.perAdultMeans)[]) {
      expect(weighted(key)).toBeCloseTo(US_ELECTORATE.perAdultMeans[key], 5);
    }
    for (const row of US_COHORTS) {
      expect(row.cashBenefits + row.noncashBenefits).toBeCloseTo(row.benefits, 6);
      expect(row.incomeTax + row.payrollTax).toBeCloseTo(row.tax, 6);
      expect(row.laborTaxBaseline + row.capitalTaxBaseline).toBeCloseTo(row.tax, 6);
      expect(row.laborIncome + row.capitalIncome + row.pensionIncome + row.otherIncome + row.benefits).toBeCloseTo(row.grossIncome, 6);
      expect(row.grossIncome - row.tax).toBeCloseTo(row.disposableIncome, 6);
    }
  });

  it('keeps source shares separate from overlapping benefit receipt and employment', () => {
    for (const distribution of [US_ELECTORATE.personalPrimaryIncomeShares, US_ELECTORATE.householdPrimaryIncomeShares, US_ELECTORATE.employmentShares]) {
      expect(Object.values(distribution).reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 10);
    }
    for (const [group, share] of Object.entries(US_ELECTORATE.householdPrimaryIncomeShares)) {
      expect(US_COHORTS.filter(row => row.group === group).reduce((sum, row) => sum + row.weight, 0)).toBeCloseTo(share, 10);
    }
    for (const [employment, share] of Object.entries(US_ELECTORATE.employmentShares)) {
      expect(US_COHORTS.filter(row => row.employment === employment).reduce((sum, row) => sum + row.weight, 0)).toBeCloseTo(share, 10);
    }
    const receipt = US_ELECTORATE.receiptShares;
    expect(receipt.anyMeasuredPublicBenefit).toBeGreaterThan(receipt.publicCash);
    expect(receipt.anyMeasuredPublicBenefit).toBeLessThan(receipt.publicCash + receipt.medicare + receipt.medicaid + receipt.householdNoncashBenefits);
  });

  it('preserves losses and refundable credits instead of silently erasing them', () => {
    expect(US_COHORTS.some(row => row.capitalIncome < 0)).toBe(true);
    expect(US_COHORTS.some(row => row.laborIncome < 0)).toBe(true);
    expect(US_COHORTS.some(row => row.tax < 0)).toBe(true);
    expect(BASELINE_LABOR_TAX_RATE).toBeCloseTo(weighted('laborTaxBaseline') / weighted('noncapitalTaxBase'), 10);
    expect(BASELINE_CAPITAL_TAX_RATE).toBeCloseTo(weighted('capitalTaxBaseline') / weighted('capitalTaxBase'), 10);
  });
});
