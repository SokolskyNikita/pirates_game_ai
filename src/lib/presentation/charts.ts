import type { RegionYear } from '../api/types';
import { el } from './dom';
import { pct, num, change } from './format';
import { hasNonproductiveWorkers, hasProductiveWorkers, incomeScale, incomeSeries, yearTicks } from './chart-layout';

export function renderChart(years: RegionYear[]) {
  const chart = el('income-chart');
  const end = years.at(-1);
  if (!end) {
    chart.innerHTML = '<p class="chart-empty">No annual income data available.</p>';
    chart.setAttribute('aria-label', 'No annual income data available.');
    for (const id of ['workforce-summary', 'chart-note', 'endpoints', 'year-table']) el(id).textContent = '';
    return;
  }
  const width = Math.max(240, Math.round(chart.clientWidth || 640));
  const height = width < 480 ? 280 : 310;
  const series = incomeSeries(years);
  const { min, max, ticks } = incomeScale(series.flatMap((line) => line.segments.flatMap((segment) => segment.map((point) => point.value))));
  const tickLabel = (value: number) => new Intl.NumberFormat('en-US', {
    notation: Math.abs(value) >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1,
  }).format(value);
  const left = Math.max(42, ...ticks.map((tick) => tickLabel(tick).length * 7 + 12));
  const right = 16, top = 36, bottom = 36;
  const x = (year: number) => left + (year / 10) * (width - left - right);
  const y = (value: number) => top + ((max - value) / (max - min)) * (height - top - bottom);
  const nonproductive = hasNonproductiveWorkers(end), productive = hasProductiveWorkers(end);
  const workforceSummary = `Year ten: ${pct(end.productiveEmployment)} of the original workforce has productive work; ${pct(end.unemployment)} is outside productive jobs, including ${pct(end.retainedWorkers)} retained on payroll.`;
  el('workforce-summary').textContent = workforceSummary;
  const notes = series.slice(0, 2).flatMap((line) => {
    const last = line.segments.at(-1)?.at(-1);
    if (!last) return [`${line.label}: no workers in this group during the scenario.`];
    if (last.year < end.year) return [`${line.label}: last shown ${last.year === 0 ? 'today' : `in year ${last.year}`}; none remain in year ${end.year}.`];
    return [];
  });
  const note = 'Worker lines appear only while that group has members. ' + notes.join(' ');
  el('chart-note').textContent = note.trim();
  chart.setAttribute('aria-label', `${workforceSummary} Year-ten income index outside productive jobs: ${nonproductive ? num(end.displacedIncomeIndex) : 'no workers in this group'}; in productive jobs: ${productive ? num(end.employedIncomeIndex) : 'no workers in this group'}; all adult citizens: ${num(end.allIncomeIndex)}. Pre-AI income equals 100. ${notes.join(' ')}`);

  const grid = ticks.map((tick) => `<line class="chart-grid${tick === 100 ? ' chart-grid-baseline' : ''}" x1="${left}" x2="${width - right}" y1="${y(tick)}" y2="${y(tick)}"/><text class="chart-axis-label" x="${left - 10}" y="${y(tick)}" dy="0.35em" text-anchor="end">${tickLabel(tick)}</text>`).join('');
  const baseline = ticks.includes(100) ? '' : `<line class="chart-grid chart-grid-baseline" x1="${left}" x2="${width - right}" y1="${y(100)}" y2="${y(100)}"/>`;
  const labels = yearTicks(width).map((year) => `<text class="chart-axis-label" x="${x(year)}" y="${height - 10}" text-anchor="${year === 0 ? 'start' : year === 10 ? 'end' : 'middle'}">${year === 0 ? 'Today' : `Year ${year}`}</text>`).join('');
  const lines = series.map((line) => {
    const path = line.segments.map((segment) => segment.map((point, index) => `${index ? 'L' : 'M'}${x(point.year).toFixed(2)},${y(point.value).toFixed(2)}`).join(' ')).join(' ');
    return `<path class="chart-series ${line.kind}" d="${path}" stroke-linejoin="round" stroke-linecap="round"/>`;
  }).join('');
  // Draw markers after every line. Nested rings keep near-identical endpoints visible.
  const markers = series.map((line) => line.segments.map((segment) => {
    const points = segment.length === 1 ? segment : [segment[0]!, segment.at(-1)!];
    return points.map((point) => `<circle class="chart-marker ${line.kind}${line.kind === 'output' ? ' solid' : ''}" cx="${x(point.year).toFixed(2)}" cy="${y(point.value).toFixed(2)}" r="${line.kind === 'worker' ? 5.5 : line.kind === 'owner' ? 4.5 : 2.7}"><title>${line.label}, ${point.year === 0 ? 'today' : `year ${point.year}`}: ${num(point.value)}</title></circle>`).join('');
  }).join('')).join('');
  chart.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true"><text class="chart-axis-title" x="${left}" y="15">Income index · before AI = 100</text>${grid}${baseline}${labels}${lines}${markers}</svg>`;

  el('endpoints').innerHTML = [
    ['worker', 'Outside productive jobs', nonproductive ? change(end.displacedIncomeIndex) : null, nonproductive ? pct(end.unemployment) + ' of the original workforce' : 'No workers in this group in year ten'],
    ['owner', 'In productive jobs', productive ? change(end.employedIncomeIndex) : null, productive ? pct(end.productiveEmployment) + ' of the original workforce' : 'No productive workers in year ten'],
    ['output', 'All adult citizens', change(end.allIncomeIndex), 'Including people without work income'],
  ].map(([kind, label, value, detail]) => `<div class="endpoint ${kind}"><span class="endpoint-label">${label}</span><strong${value === null ? ' class="empty"' : ''}>${value ?? 'No workers'}</strong><span class="endpoint-detail">${value === null ? detail : 'Year-ten income change · ' + detail}</span></div>`).join('');
  el('year-table').innerHTML = years.map((point) => `<tr><th scope="row">${point.year === 0 ? 'Today' : `Year ${point.year}`}</th><td>${pct(point.unemployment)}</td><td>${hasNonproductiveWorkers(point) ? num(point.displacedIncomeIndex) : '—'}</td><td>${hasProductiveWorkers(point) ? num(point.employedIncomeIndex) : '—'}</td><td>${num(point.allIncomeIndex)}</td></tr>`).join('');
}
