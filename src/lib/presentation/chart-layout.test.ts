import { describe, expect, it } from 'vitest';
import { incomeScale, incomeSeries, yearTicks, type ChartYear } from './chart-layout';

function point(year: number, unemployment: number, income = 100): ChartYear {
  return { year, productiveEmployment: 1 - unemployment, displacedIncomeIndex: income, employedIncomeIndex: income, allIncomeIndex: 100 };
}

describe('income chart presentation', () => {
  it('ends the productive line when its population disappears, excluding hypothetical income from the scale', () => {
    const lines = incomeSeries([point(0, 0), point(9, 0.9, 200), point(10, 1, 100000)]);
    expect(lines[1]!.segments).toEqual([[{ year: 0, value: 100 }, { year: 9, value: 200 }]]);
    const values = lines[1]!.segments.flat().map((p) => p.value);
    expect(incomeScale(values).max).toBeLessThan(100000);
    expect(lines[0]!.segments[0]![0]!.year).toBe(9);
  });
  it('preserves an isolated point and separates groups that disappear and return', () => {
    const lines = incomeSeries([point(0, 0), point(1, 1), point(2, 1), point(3, 0)]);
    expect(lines[1]!.segments).toEqual([[{ year: 0, value: 100 }], [{ year: 3, value: 100 }]]);
    expect(lines[0]!.segments).toEqual([[{ year: 1, value: 100 }, { year: 2, value: 100 }]]);
  });
  it('does not draw through missing or non-finite income values', () => {
    const lines = incomeSeries([point(0, 0), { ...point(1, 0), allIncomeIndex: NaN }, point(2, 0)]);
    expect(lines[2]!.segments).toHaveLength(2);
    expect(lines[2]!.segments.flat().every((p) => Number.isFinite(p.value))).toBe(true);
  });
  it.each([[100, 100], [0, 200.33], [0, 50000], [-50, 150], [93, 104]])('keeps ticks readable and includes the data and baseline: %j', (...values) => {
    const scale = incomeScale(values);
    expect(scale.ticks.length).toBeLessThanOrEqual(7);
    expect(scale.ticks.length).toBeGreaterThanOrEqual(3);
    expect(scale.min).toBeLessThanOrEqual(Math.min(100, ...values));
    expect(scale.max).toBeGreaterThanOrEqual(Math.max(100, ...values));
    if (values.every((value) => value >= 0)) expect(scale.min).toBeGreaterThanOrEqual(0);
  });
  it('uses fewer year labels on narrow charts while keeping both endpoints', () => {
    expect(yearTicks(288)).toEqual([0, 5, 10]);
    expect(yearTicks(700)).toEqual([0, 2, 4, 6, 8, 10]);
  });
});
