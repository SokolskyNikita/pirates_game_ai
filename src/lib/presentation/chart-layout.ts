/** Chart geometry only. Income and population values are supplied by Python. */
import type { RegionYear } from '../api/types';

export type ChartYear = Pick<RegionYear,
  'year' | 'unemployment' | 'displacedIncomeIndex' | 'employedIncomeIndex' | 'allIncomeIndex'>;
export interface ChartPoint { year: number; value: number }
export interface IncomeSeries {
  kind: 'worker' | 'owner' | 'output';
  label: string;
  segments: ChartPoint[][];
}
export const hasAffectedWorkers = (point: ChartYear) => point.unemployment > 1e-9;
export const hasProductiveWorkers = (point: ChartYear) => point.unemployment < 1 - 1e-9;

export function incomeSeries(years: readonly ChartYear[]): IncomeSeries[] {
  const definitions = [
    { kind: 'worker' as const, label: 'Affected workers', key: 'displacedIncomeIndex' as const, present: hasAffectedWorkers },
    { kind: 'owner' as const, label: 'Productive workers', key: 'employedIncomeIndex' as const, present: hasProductiveWorkers },
    { kind: 'output' as const, label: 'All adult citizens', key: 'allIncomeIndex' as const, present: (_: ChartYear) => true },
  ];
  return definitions.map(({ kind, label, key, present }) => {
    const segments: ChartPoint[][] = [];
    let segment: ChartPoint[] | undefined;
    for (const point of years) {
      if (!present(point) || !Number.isFinite(point[key]) || !Number.isFinite(point.year)) {
        segment = undefined;
        continue;
      }
      if (!segment) {
        segment = [];
        segments.push(segment);
      }
      segment.push({ year: point.year, value: point[key] });
    }
    return { kind, label, segments };
  });
}

/** A small, readable number of ticks, including for unusually large incomes. */
export function incomeScale(values: readonly number[]) {
  const finite = values.filter(Number.isFinite);
  const low = Math.min(100, ...finite);
  const high = Math.max(100, ...finite);
  const span = Math.max(20, high - low);
  const padding = (span - (high - low)) / 2 + span * 0.06;
  const target = (span + span * 0.12) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const step = [1, 2, 2.5, 5, 10].find((factor) => factor * magnitude >= target)! * magnitude;
  const min = low >= 0 ? Math.max(0, Math.floor((low - padding) / step) * step) : Math.floor((low - padding) / step) * step;
  const max = Math.ceil((high + padding) / step) * step;
  const ticks = Array.from({ length: Math.round((max - min) / step) + 1 }, (_, index) =>
    Number((min + index * step).toPrecision(12)),
  );
  return { min, max, ticks };
}

export function yearTicks(width: number) {
  return width < 480 ? [0, 5, 10] : [0, 2, 4, 6, 8, 10];
}
