/** Format labor-market results supplied by Python; no economic calculation here. */
import type { RegionYear } from '../api/types';
import { el } from './dom';
import { pct } from './format';

export function renderLaborMarket(years: RegionYear[], prefix = '') {
  const end = years.at(-1);
  if (!end) return;
  el(prefix + 'labor-market-summary').textContent =
    'Year-ten productive job slots: ' + pct(end.jobSlots) + ' of the initial count. ' +
    pct(end.jobsAffected) + ' of original roles have been affected. ' +
    'The number of jobs can stay constant even when every original role changes.';
  const yearLabel = (point: RegionYear) => point.year === 0 ? 'Today' : 'Year ' + point.year;
  el(prefix + 'labor-market-table').innerHTML = years.map((point) =>
    '<tr><th scope="row">' + yearLabel(point) + '</th>' +
    [point.jobSlots, point.productiveEmployment, point.retainedWorkers, point.jobSeekers, point.exitedWorkers]
      .map((value) => '<td>' + pct(value) + '</td>').join('') + '</tr>',
  ).join('');
  el(prefix + 'wage-table').innerHTML = years.map((point) =>
    '<tr><th scope="row">' + yearLabel(point) + '</th><td>' +
    (point.jobSlots > 1e-9 ? pct(point.marketWageFactor) : '—') + '</td><td>' +
    (point.productiveEmployment > 1e-9 ? pct(point.averageWageFactor) : '—') + '</td><td>' +
    pct(point.competitionDisplaced) + '</td></tr>',
  ).join('');
}
