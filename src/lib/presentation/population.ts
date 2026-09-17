import { US_ELECTORATE, MODEL_NOTES } from './config';
import { el } from './dom';
import { pct, dollars } from './format';

export function renderPopulation() {
  const data = US_ELECTORATE;
  const sourceLabels: Record<string, string> = {
    work: 'Work / self-employment',
    benefits: 'Public cash benefits',
    pension: 'Pensions / retirement accounts',
    capital: 'Investments / capital gains',
    other: 'Other personal income',
    none: 'No positive personal income',
  };
  const shares = data.personalPrimaryIncomeShares;
  el('population-summary').textContent =
    (data.population / 1e6).toFixed(1) +
    ' million adult citizens represented. ' +
    pct(shares.work) +
    ' derive their largest personal income from work, ' +
    pct(shares.benefits) +
    ' from public cash benefits, and ' +
    pct(shares.capital) +
    ' from investments.';
  el('population-table-head').innerHTML =
    '<tr><th scope="col">Largest personal income source</th><th scope="col">Share of adults</th></tr>';
  el('population-table').innerHTML = Object.entries(shares)
    .map(
      ([source, share]) =>
        '<tr><th scope="row">' + sourceLabels[source] + '</th><td>' + pct(share) + '</td></tr>',
    )
    .join('');
  const employment = data.employmentShares;
  el('population-note').textContent =
    'Employment in the 2026 survey: ' +
    pct(employment.employed) +
    ' employed, ' +
    pct(employment.unemployed) +
    ' unemployed, ' +
    pct(employment.retired) +
    ' retired and ' +
    pct(employment.inactive) +
    ' otherwise outside the labor force. These are shares of all adult citizens, not the official unemployment rate. For voting, household income is shared among its adults; each citizen still has one vote. ' +
    data.cohortCount +
    ' weighted income/status groups approximate the survey, without rounding the electorate into a fixed voter count.';
  el('income-distribution-head').innerHTML =
    '<tr><th scope="col">Income group</th><th scope="col">Before tax</th><th scope="col">After tax</th><th scope="col">Public support</th></tr>';
  el('income-distribution').innerHTML = data.incomeQuintiles
    .map(
      (row) =>
        '<tr><th scope="row">' +
        (row.quintile === 1
          ? 'Lowest fifth'
          : row.quintile === 5
            ? 'Highest fifth'
            : 'Fifth ' + row.quintile) +
        '</th><td>' +
        dollars(row.grossIncome) +
        '</td><td>' +
        dollars(row.disposableIncome) +
        '</td><td>' +
        dollars(row.benefits) +
        '</td></tr>',
    )
    .join('');
  const receipt = data.receiptShares;
  el('benefit-receipts').textContent =
    'Overlapping receipt: ' +
    pct(receipt.socialSecurity) +
    ' receive Social Security, ' +
    pct(receipt.medicare) +
    ' have Medicare and ' +
    pct(receipt.medicaid) +
    ' have Medicaid; ' +
    pct(receipt.householdSnap) +
    ' live in a household receiving SNAP. ' +
    pct(receipt.anyMeasuredPublicBenefit) +
    ' receive at least one measured public benefit or live in a household with measured noncash support. These categories overlap and must not be added. Medicare and Medicaid coverage affect these descriptive counts, but are not converted into cash in the voting model.';
}

export function renderMethod() {
  el('model-method').innerHTML =
    '<h4>Voting and policy selection</h4>' +
    '<p>Citizens can consolidate behind a fully funded compromise they strictly prefer to the anticipated outcome. The disclosed coordination rule settles intended votes before a single final ballot. By default, strictly more than half must choose the same package; otherwise current policy remains. Personal utility ties prefer eligible current policy, then a fixed policy-ID ordering; tied vote totals use that ordering. Everyone knows the rule. In international mode, each side’s choice must be consistent with the other’s known choice. The foreign actor can still choose its own current policy if fully funded.</p>' +
    MODEL_NOTES.map(
      (note) =>
        '<h4>' +
        note.title +
        '</h4><p>' +
        note.detail +
        '</p>' +
        (note.equation ? '<p class="equation">' + note.equation + '</p>' : ''),
    ).join('');
}
