import type { RegionYear } from '../api/types';
import { el } from './dom';
import { pct, num, change } from './format';

export function renderChart(years: RegionYear[]) {
  const width = Math.max(320, Math.min(740, el('income-chart').clientWidth)),
    height = 290,
    left = 42,
    right = 20,
    top = 22,
    bottom = 36;
  const values = years.flatMap((y) => [
    ...(y.unemployment > 1e-9 ? [y.displacedIncomeIndex] : []),
    ...(y.unemployment < 1 - 1e-9 ? [y.employedIncomeIndex] : []),
    y.allIncomeIndex,
  ]);
  const rawMin = Math.min(100, ...values),
    rawMax = Math.max(100, ...values);
  const step = rawMax - rawMin > 120 ? 50 : rawMax - rawMin > 50 ? 25 : 10;
  const min = Math.floor((rawMin - 5) / step) * step;
  const max = Math.max(min + step * 3, Math.ceil((rawMax + 5) / step) * step);
  const x = (year: number) => left + (year / 10) * (width - left - right);
  const y = (value: number) => top + ((max - value) / (max - min)) * (height - top - bottom);
  const ticks: number[] = [];
  for (let value = min; value <= max; value += step) ticks.push(value);
  const paths = [
    {
      key: 'displacedIncomeIndex' as const,
      color: '#28594e',
      present: (point: RegionYear) => point.unemployment > 1e-9,
    },
    {
      key: 'employedIncomeIndex' as const,
      color: '#af4a30',
      present: (point: RegionYear) => point.unemployment < 1 - 1e-9,
    },
    { key: 'allIncomeIndex' as const, color: '#85734c', present: (_point: RegionYear) => true },
  ];
  const end = years[years.length - 1]!;
  const obsolete = end.unemployment > 1e-9,
    productive = end.unemployment < 1 - 1e-9;
  const workforceSummary = `Year ten: ${pct(end.unemployment)} of workers are in obsolete roles; ${pct(1 - end.unemployment)} have productive work. Workers retained on employers’ payrolls still count as affected.`;
  el('workforce-summary').textContent = workforceSummary;
  const summary = `${workforceSummary} Income in obsolete roles: ${obsolete ? num(end.displacedIncomeIndex) : 'no affected workers'}; income in productive roles: ${productive ? num(end.employedIncomeIndex) : 'no productive roles remain'}; average adult income: ${num(end.allIncomeIndex)}. Pre-AI income equals 100.`;
  el('income-chart').setAttribute('aria-label', summary);
  el('income-chart').innerHTML =
    `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true">${ticks.map((tick) => `<line x1="${left}" x2="${width - right}" y1="${y(tick)}" y2="${y(tick)}" stroke="${tick === 100 ? '#acb5a5' : '#deded3'}" stroke-width="1" ${tick === 100 ? '' : 'stroke-dasharray="2 4"'} /><text x="${left - 10}" y="${y(tick) + 4}" text-anchor="end">${tick}</text>`).join('')}${[0, 2, 4, 6, 8, 10].map((year) => `<text x="${x(year)}" y="${height - 13}" text-anchor="middle">${year === 0 ? 'Today' : `Year ${year}`}</text>`).join('')}${paths
      .map((series) => {
        let connected = false;
        const path = years
          .map((point) => {
            if (!series.present(point)) {
              connected = false;
              return '';
            }
            const command = connected ? 'L' : 'M';
            connected = true;
            return `${command}${x(point.year).toFixed(1)},${y(point[series.key]).toFixed(1)}`;
          })
          .join(' ');
        return `<path d="${path}" fill="none" stroke="${series.color}" stroke-width="${series.key === 'allIncomeIndex' ? 2 : 3}" ${series.key === 'allIncomeIndex' ? 'stroke-dasharray="6 5"' : ''} stroke-linejoin="round" stroke-linecap="round"/>${series.present(end) ? `<circle cx="${x(10)}" cy="${y(end[series.key])}" r="4" fill="${series.color}" />` : ''}`;
      })
      .join('')}</svg>`;
  el('endpoints').innerHTML = [
    [
      'worker',
      'Workers in obsolete roles',
      obsolete ? change(end.displacedIncomeIndex) : '—',
      obsolete ? pct(end.unemployment) + ' of workers in year ten' : 'No workers affected',
    ],
    [
      'owner',
      'Workers in productive roles',
      productive ? change(end.employedIncomeIndex) : '—',
      productive ? pct(1 - end.unemployment) + ' of workers in year ten' : 'No productive roles remain',
    ],
    ['output', 'All adult citizens', change(end.allIncomeIndex), 'Including people without work income'],
  ]
    .map(
      ([kind, label, value, detail]) =>
        `<div class="endpoint ${kind}"><strong>${value}</strong>${label}<br />${detail}</div>`,
    )
    .join('');
  el('year-table').innerHTML = years
    .map(
      (point) =>
        `<tr><th scope="row">${point.year === 0 ? 'Today' : `Year ${point.year}`}</th><td>${pct(point.unemployment)}</td><td>${point.unemployment > 1e-9 ? num(point.displacedIncomeIndex) : '—'}</td><td>${point.unemployment < 1 - 1e-9 ? num(point.employedIncomeIndex) : '—'}</td><td>${num(point.allIncomeIndex)}</td></tr>`,
    )
    .join('');
}
