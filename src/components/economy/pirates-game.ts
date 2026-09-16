import { solveVoting, voterUtilities, countVotes, type VotingResult, VOTING_NOTES, VOTER_COUNT, VOTES_REQUIRED } from '../../lib/economy/pirates-voting';
import {
  DEFAULT_INPUTS, INPUT_SPECS, POLICIES, MODEL_NOTES, EQUILIBRIUM_TOLERANCE,
  normalizeInputs, solveModel, simulateProfile,
  type ModelInputs, type ModelMode, type Objective, type Policy,
  type ProfileOutcome, type SolveResult, type RegionYear,
} from '../../lib/economy/pirates-model';

const el = <T extends HTMLElement = HTMLElement>(id: string) => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing simulator element: ${id}`);
  return element as T;
};
const pct = (n: number) => `${Number((n * 100).toFixed(1))}%`;
const num = (n: number) => n.toFixed(1);
const change = (index: number) => `${index >= 100 ? '+' : '−'}${Math.abs(index - 100).toFixed(1)}%`;
const last = (profile: ProfileOutcome) => profile.us[profile.us.length - 1]!;
const foreignKeys = new Set<keyof ModelInputs>(['capitalMobility', 'foreignStrength', 'tradeIntensity', 'foreignMarketSize']);
const structuralKeys = new Set<keyof ModelInputs>(['workerOwnership', 'investmentResponse']);
let inputs = { ...DEFAULT_INPUTS };
let mode: ModelMode = 'us-only';
let objective: Objective = 'workers';
let pace = 1;
let result: SolveResult;
let voting: VotingResult;
let active: ProfileOutcome;
let view: 'selected' | 'coordinated' | 'manual' = 'selected';
let equilibriumIndex = 0;
let manual: ProfileOutcome | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;

function formatInput(key: keyof ModelInputs, value: number) {
  if (key === 'workerShare') return `${Math.round(value * 1000)} workers · ${pct(value)}`;
  if (key === 'foreignMarketSize') return `${Number(value.toFixed(2))}× US`;
  if (key === 'foreignStrength') return `${pct(value)} of US`;
  return pct(value);
}

function readURL() {
  const query = new URLSearchParams(location.search);
  const values: Partial<ModelInputs> = {};
  for (const spec of INPUT_SPECS) {
    const value = query.get(spec.key);
    if (value !== null && value.trim() !== '' && Number.isFinite(Number(value))) values[spec.key] = Number(value);
  }
  inputs = normalizeInputs(values);
  mode = query.get('world') === 'strategic' ? 'strategic' : 'us-only';
  objective = 'workers';
  const rollout = query.get('rollout');
  pace = ['0', '0.33', '0.67', '1'].includes(rollout ?? '') ? Number(rollout) : 1;
}

function scenarioURL() {
  const url = new URL(location.href);
  url.search = '';
  url.hash = 'simulator';
  url.searchParams.set('world', mode);
  url.searchParams.set('objective', objective);
  url.searchParams.set('rollout', String(pace));
  for (const spec of INPUT_SPECS) url.searchParams.set(spec.key, String(inputs[spec.key]));
  return url;
}

function buildInputs() {
  for (const spec of INPUT_SPECS) {
    const target = spec.key === 'workerShare' ? 'electorate-inputs' : foreignKeys.has(spec.key) ? 'international-inputs' : structuralKeys.has(spec.key) ? 'structural-inputs' : 'domestic-inputs';
    const node = document.createElement('div');
    node.className = 'input-control';
    node.innerHTML = `<label class="input-label" for="input-${spec.key}"><span>${spec.label}</span><output id="value-${spec.key}" for="input-${spec.key}"></output></label><input id="input-${spec.key}" name="${spec.key}" type="range" min="${spec.min}" max="${spec.max}" step="${spec.step}" aria-describedby="help-${spec.key}" /><div class="range-ends"><span>${formatInput(spec.key, spec.min)}</span><span>${formatInput(spec.key, spec.max)}</span></div><p id="help-${spec.key}">${spec.description}</p>`;
    el(target).append(node);
    el<HTMLInputElement>(`input-${spec.key}`).addEventListener('input', (event) => {
      inputs[spec.key] = Number((event.target as HTMLInputElement).value);
      if (spec.key === 'workerShare') updateElectorate();
      updateInputLabel(spec.key);
      clearPreset();
      scheduleSolve();
    });
  }
  const policyInputs = [
    { key: 'replacement', label: 'Employer salary · 0% means layoff', options: [0, .5, 1, 1.25], value: 2 },
    { key: 'safetyNet', label: 'Government income floor', options: [0, .5, 1], value: 1 },
    { key: 'workerTax', label: 'Worker household tax', options: [0, .5, 1], value: 1 },
    { key: 'tax', label: 'Owner household tax', options: [0, .5, 1], value: 1 },
  ] as const;
  for (const spec of policyInputs) {
    const node = document.createElement('div');
    node.className = 'input-control';
    node.innerHTML = `<label class="input-label" for="manual-${spec.key}">${spec.label}<output id="manual-value-${spec.key}" for="manual-${spec.key}">${pct(spec.options[spec.value]!)}</output></label><input id="manual-${spec.key}" type="range" min="0" max="${spec.options.length - 1}" step="1" value="${spec.value}" />`;
    el('manual-inputs').append(node);
    el<HTMLInputElement>(`manual-${spec.key}`).addEventListener('input', (event) => {
      el(`manual-value-${spec.key}`).textContent = pct(spec.options[Number((event.target as HTMLInputElement).value)]!);
    });
  }
}

function updateInputLabel(key: keyof ModelInputs) {
  el(`value-${key}`).textContent = formatInput(key, inputs[key]);
  el<HTMLInputElement>(`input-${key}`).setAttribute('aria-valuetext', formatInput(key, inputs[key]));
}

function updateElectorate() {
  const workers = Math.round(inputs.workerShare * VOTER_COUNT);
  el('electorate-description').textContent = `${workers} workers with different exposure times. ${VOTER_COUNT - workers} capital owners. Every voter considers ten years of their own income.`;
}

function syncInputs() {
  updateElectorate();
  for (const spec of INPUT_SPECS) {
    el<HTMLInputElement>(`input-${spec.key}`).value = String(inputs[spec.key]);
    updateInputLabel(spec.key);
  }
  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="world"]')) radio.checked = radio.value === mode;
  el<HTMLSelectElement>('rollout').value = String(pace);
  el('foreign-inputs').hidden = mode !== 'strategic';
}

function clearPreset() {
  document.querySelectorAll('[data-preset]').forEach(button => button.setAttribute('aria-pressed', 'false'));
}

function scheduleSolve() {
  if (timer) clearTimeout(timer);
  el('results').setAttribute('aria-busy', 'true');
  el('solve-status').textContent = 'Comparing policies…';
  timer = setTimeout(run, 90);
}

function run() {
  try {
    // Release the previous international grid before allocating the next one.
    if (result) { result.outcomes.length = 0; result.equilibria.length = 0; }
    if (voting) {
      voting.outcomes.length = 0; voting.majorityStable.length = 0;
      voting.condorcetWinners.length = 0; voting.majorityUnbeaten.length = 0;
    }
    result = solveModel(inputs, { mode, objective, pace });
    voting = solveVoting(result);
    view = 'selected';
    manual = undefined;
    equilibriumIndex = Math.max(0, voting.majorityStable.findIndex(item => item.id === voting.selected.id));
    active = voting.selected;
    el('manual-result').textContent = '';
    el('action-status').textContent = '';
    render();
    const url = scenarioURL();
    url.hash = location.hash;
    history.replaceState(null, '', url);
  } catch (error) {
    el('solve-status').textContent = 'Unable to calculate';
    el('recommendation-copy').textContent = 'The calculation could not finish. Reset the assumptions and try again.';
    console.error(error);
  } finally {
    el('results').setAttribute('aria-busy', 'false');
  }
}

function selectedProfile() { return voting.majorityStable[equilibriumIndex] ?? voting.selected; }

const replacementName = (r: number) => r === 0 ? 'Allow layoffs' : `Retain at ${pct(r)} salary`;
const benefit = (score: number) => (Math.exp(score) * 1.01 - .01 - 1) * 100;
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}`;
const policyAxes = ['replacement', 'safetyNet', 'workerTax', 'tax', 'pace'] as const;
type PolicyAxis = typeof policyAxes[number];
const axisLabels: Record<PolicyAxis, string> = { replacement: 'Worker protections', safetyNet: 'Government income floor', workerTax: 'Worker household tax', tax: 'Owner household tax', pace: 'AI deployment' };
function axisValue(axis: PolicyAxis, policy: Policy) {
  return axis === 'replacement' ? replacementName(policy.replacement) : pct(policy[axis]);
}
function policyDescription(policy: Policy) {
  return `${replacementName(policy.replacement)} · ${pct(policy.safetyNet)} government floor · workers taxed ${pct(policy.workerTax)}, owners ${pct(policy.tax)} · ${pct(policy.pace)} deployment`;
}
function paymentRange(profile: ProfileOutcome, channel: 'employer' | 'government' | 'total' = 'total') {
  const affected = profile.us.filter(y => y.year > 0 && y.unemployment > 1e-9);
  if (!affected.length) return 'N/A';
  const payments = affected.map(y => {
    const employer = y.employerPayRatio * (1 - profile.usPolicy.workerTax);
    return channel === 'employer' ? employer : channel === 'government' ? y.publicSupportRatio : employer + y.publicSupportRatio;
  });
  const low = Math.min(...payments), high = Math.max(...payments);
  return Math.abs(high - low) < .00001 ? pct(low) : `${pct(low)}–${pct(high)}`;
}
function countryAlternatives(profile: ProfileOutcome, region: 'us' | 'foreign' = 'us') {
  return result.outcomes.filter(p => region === 'us' ? p.foreignPolicy?.id === profile.foreignPolicy?.id : p.usPolicy.id === profile.usPolicy.id);
}
function axisAlternatives(profile: ProfileOutcome, axis: PolicyAxis, region: 'us' | 'foreign' = 'us') {
  const policy = region === 'us' ? profile.usPolicy : profile.foreignPolicy!;
  return countryAlternatives(profile, region).filter(p => {
    const candidate = region === 'us' ? p.usPolicy : p.foreignPolicy!;
    return candidate[axis] !== policy[axis] && policyAxes.every(key => key === axis || candidate[key] === policy[key]);
  });
}
function strongestChallenge(profile: ProfileOutcome, candidates: ProfileOutcome[], region: 'us' | 'foreign' = 'us') {
  let best: ProfileOutcome | undefined;
  let votes = 0;
  for (const candidate of candidates) {
    const count = voting.votesForChange(candidate, profile, region);
    if (!best || count > votes || count === votes && candidate.feasible && !best.feasible) { best = candidate; votes = count; }
  }
  return { profile: best, votes };
}
function coordinateVotes(profile: ProfileOutcome, region: 'us' | 'foreign' = 'us') {
  return Math.max(0, ...policyAxes.map(axis => strongestChallenge(profile, axisAlternatives(profile, axis, region), region).votes));
}
function render() {
  const strategic = result.effectiveMode === 'strategic';
  const p = active.usPolicy;
  const endpoint = last(active);
  el('result-label').textContent = view === 'manual' ? 'Your rule for displaced workers' : view === 'coordinated' ? 'Worker-welfare benchmark · not the vote' : strategic ? (voting.selection === 'separate-ballot-stable' ? 'Stable under separate ballots in each country' : 'No stable international pair') : 'Separate majority ballots · 501 votes required';
  el('solve-status').textContent = `${result.outcomes.length.toLocaleString()} ${strategic ? 'policy pairs' : 'policies'} tested`;
  const hasDisplacement = active.us.some(y => y.unemployment > 1e-9);
  el('recommendation').textContent = p.replacement === 0 ? 'Allow employers to lay off affected workers.' : `Require employers to retain workers at ${pct(p.replacement)} of their starting salary.`;
  el('safety-net-recommendation').textContent = p.safetyNet === 0 ? 'No targeted government income floor.' : `Top up affected workers to ${pct(p.safetyNet)} of their starting wage after tax.`;
  let explanation = `Worker households pay ${pct(p.workerTax)} tax on their wages and capital income; owner households pay ${pct(p.tax)} on their capital income. These receipts fund benefits. Any remainder is divided equally among all 1,000 voters.`;
  if (!hasDisplacement) explanation += ' No roles become obsolete under these assumptions, so the job-protection rule is unused.';
  if (view === 'manual') explanation += ' This is your chosen policy. Votes below compare it with the selected outcome.';
  if (view === 'coordinated') explanation += ' This benchmark maximizes combined worker welfare; it can lose individual ballots.';
  if (mode === 'strategic' && !strategic) explanation += ' With zero foreign frontier capability, the foreign bloc is inactive.';
  el('recommendation-copy').textContent = explanation;
  const dividends = active.us.filter(y => y.year > 0).map(y => y.workerDividend / 60);
  const dividendLow = Math.min(...dividends), dividendHigh = Math.max(...dividends);
  const dividendRange = Math.abs(dividendHigh - dividendLow) < .00001 ? pct(dividendLow) : `${pct(dividendLow)}–${pct(dividendHigh)}`;
  el('safety-net-recommendation').textContent = p.safetyNet === 0
    ? dividendHigh > 1e-9 ? 'Pay a universal dividend, with no targeted wage-income floor.' : 'Provide no government income support.'
    : `Set a ${pct(p.safetyNet)} wage-income floor after tax${dividendHigh > 1e-9 ? ', plus a universal dividend' : ''}.`;
  el('policy-strip').innerHTML = [[paymentRange(active, 'employer'), 'Employer salary after worker tax'], [paymentRange(active, 'government'), 'Government top-up for affected workers'], [dividendRange, 'Universal dividend · share of a worker’s wage']].map(([value,label]) => `<div class="policy-item"><strong>${value}</strong><span>${label}</span></div>`).join('');
  el('policy-meaning').textContent = `Actual payments as a share of the starting wage, across affected groups and years. Capital income is additional; the universal dividend is shown separately. Deployment target: ${pct(p.pace)}; actual adoption by year ten: ${pct(endpoint.adoption)} after the investment response. Productive labor effort: ${pct(endpoint.laborEffort)} of its untaxed level.`;
  const verdict = el('funding-verdict');
  verdict.classList.toggle('shortfall', !active.feasible);
  const employerGap = active.us.reduce((sum, y) => sum + y.employerFundingGap, 0);
  const publicGap = active.us.reduce((sum, y) => sum + y.safetyNetFundingGap, 0);
  verdict.textContent = active.feasible ? 'Employers can fund the required salaries and tax receipts can fund the public floor in every simulated year.' : `Some payments fall short. Employer salary shortfall: ${num(employerGap)}; government top-up shortfall: ${num(publicGap)} resource units across ten years. These are separate obligations. Voters compare actual income after the shortfalls.`;
  const switcher = el('view-switch');
  switcher.hidden = !strategic && !manual;
  switcher.innerHTML = `<button type="button" data-view="selected" aria-pressed="${view === 'selected'}">${strategic ? (voting.selection === 'separate-ballot-stable' ? 'Independent majorities' : 'Fewest votes to deviate') : 'Majority choice'}</button>${strategic ? `<button type="button" data-view="coordinated" aria-pressed="${view === 'coordinated'}">Worker-welfare benchmark</button>` : ''}${manual ? `<button type="button" data-view="manual" aria-pressed="${view === 'manual'}">Your rule</button>` : ''}`;
  switcher.querySelectorAll<HTMLButtonElement>('button').forEach(button => button.addEventListener('click', () => {
    view = button.dataset.view as typeof view;
    active = view === 'manual' ? manual! : view === 'coordinated' ? result.coordinated : selectedProfile();
    render();
  }));
  renderBallot();
  renderSalaryOptions();
  renderDecisionVotes();
  renderEquilibriumPicker();
  renderChart(active.us);
  renderInternational(strategic);
  renderComparison(strategic);
  renderAccounting();
  el('cohort-table').innerHTML = active.us.filter(y => [1,3,5,7,10].includes(y.year)).map(y => `<tr><th scope="row">${y.year === 1 ? 'First year' : `Year ${y.year}`}</th><td>${pct(y.unemployment)}</td><td>${y.unemployment > 1e-9 ? pct(y.employerPayRatio * (1 - p.workerTax)) : '—'}</td><td>${y.unemployment > 1e-9 ? pct(y.publicSupportRatio) : '—'}</td><td>${y.unemployment > 1e-9 ? pct(y.employerPayRatio * (1 - p.workerTax) + y.publicSupportRatio) : '—'}</td></tr>`).join('');
}
function incumbentFor(profile: ProfileOutcome) {
  return result.outcomes.find(p => p.usPolicy.id === voting.statusQuo.usPolicy.id && p.foreignPolicy?.id === profile.foreignPolicy?.id) ?? voting.statusQuo;
}
function renderDecisionVotes() {
  const rows = policyAxes.filter(axis => axis !== 'pace').map(axis => {
    const challenger = strongestChallenge(active, axisAlternatives(active, axis));
    return `<tr><th scope="row">${axisLabels[axis]}<br /><span class="small-copy">Selected: ${axisValue(axis, active.usPolicy)}</span></th><td>${challenger.profile ? axisValue(axis, challenger.profile.usPolicy) : 'No alternative'}</td><td>${challenger.votes} / 1,000</td></tr>`;
  });
  el('decision-votes').innerHTML = rows.join('');
  const maximum = coordinateVotes(active);
  const packageChallenge = strongestChallenge(active, countryAlternatives(active));
  el('decision-votes-note').textContent = `${maximum < VOTES_REQUIRED ? 'No separate US ballot has 501 votes to change this outcome.' : 'At least one separate US ballot would change this outcome.'} Each row holds all other decisions fixed. A proposal changing several decisions together can attract up to ${packageChallenge.votes} votes. Deployment is fixed at the chosen scenario setting.`;
}
function renderBallot() {
  const incumbent = incumbentFor(active);
  const before = voterUtilities(incumbent.us, inputs.reemployment, inputs.workerShare);
  const after = voterUtilities(active.us, inputs.reemployment, inputs.workerShare);
  const votes = countVotes(after, before);
  const workerCount = Math.round(inputs.workerShare * VOTER_COUNT);
  el('vote-verdict').innerHTML = `<strong>${votes}<span> / 1,000 on the whole package</span></strong><p>${active.id === incumbent.id ? 'This is the comparison policy: layoffs, no government floor and no household taxes.' : `A separate comparison against layoffs, no government floor and no household taxes at the same ${pct(incumbent.usPolicy.pace)} deployment target. ${votes >= VOTES_REQUIRED ? 'This package wins that comparison.' : 'This package does not win that comparison.'}`} The individual ballots above determine stability.</p>`;
  el('ballot-grid').innerHTML = Array.from(after, (value, i) => {
    const support = value > before[i]! + EQUILIBRIUM_TOLERANCE;
    return `<span class="ballot ${support ? 'yes' : 'no'} ${i >= workerCount ? 'capital-voter' : ''}" title="${i < workerCount ? `Worker ${i+1}, in order of exposure` : `Capital owner ${i-workerCount+1}`}: ${support ? 'supports this package' : 'keeps the comparison policy'}"></span>`;
  }).join('');
  el('ballot-grid').setAttribute('aria-label', `${votes} of 1,000 voters prefer the displayed package to layoffs with no taxes or government support. 501 votes are required.`);
  el('ballot-caption').textContent = `Green supports the package. Grey keeps the comparison policy, including indifference. First ${workerCount}: workers in order of exposure; outlined final ${VOTER_COUNT-workerCount}: owners. Every voter considers only their own expected income.`;
  el('selection-explanation').textContent = `${voting.majorityStable.length} outcome${voting.majorityStable.length === 1 ? ' is' : 's are'} stable under separate ballots. ${voting.hasMajorityCycle ? 'Some sequences of majority-supported changes form a cycle.' : 'No cycle of separate majority changes was found.'} Ties keep the incumbent. Among stable outcomes the solver keeps the comparison policy if possible, then follows the listed policy order. Policy is committed for ten years; these are not annual elections.`;
  const label = (id: string) => policyDescription(result.policies.find(policy => policy.id === id)!);
  el('agenda-order').innerHTML = `<p>Policy order used to resolve multiple stable outcomes:</p><ol>${result.policies.map(policy => `<li>${policyDescription(policy)}</li>`).join('')}</ol>${voting.selection === 'coordinate-agenda' ? `<p>No stable outcome exists. Each motion changes one decision; voters consider the final outcome after later motions. This finite agenda determines the fallback:</p><ol>${voting.agendaSteps.map(step => `<li>${step.votesForChange} votes for the motion to ${label(step.challengerId)}: ${step.accepted ? 'accepted' : 'rejected'}. Final outcome if accepted: ${label(step.continuationIfAcceptedId)}; if rejected: ${label(step.continuationIfRejectedId)}.</li>`).join('')}</ol>` : ''}`;
}
function renderSalaryOptions() {
  const row = (axis: 'replacement' | 'safetyNet', value: number) => {
    const candidates = axisAlternatives(active, axis).filter(p => p.usPolicy[axis] === value);
    const best = value === active.usPolicy[axis] ? active : strongestChallenge(active, candidates).profile!;
    const votes = voting.votesForChange(best, active);
    return `<tr class="${best.id === active.id ? 'selected' : ''}"><th scope="row">${axisValue(axis, best.usPolicy)}</th><td>${paymentRange(best, axis === 'replacement' ? 'employer' : 'government')}${best.feasible ? '' : ' †'}</td><td>${axis === 'replacement' ? pct(best.usPolicy.safetyNet) : replacementName(best.usPolicy.replacement)}</td><td>${pct(best.usPolicy.workerTax)} / ${pct(best.usPolicy.tax)}</td><td>${best.id === active.id ? 'Displayed' : `${votes} / 1,000`}</td></tr>`;
  };
  el('salary-options').innerHTML = [0,.5,1,1.25].map(value => row('replacement', value)).join('');
  el('safety-options').innerHTML = [0,.5,1].map(value => row('safetyNet', value)).join('');
  const note = 'Each row changes only the employer obligation. A switch needs 501 votes. Employer pay is after worker tax, as a share of the starting wage; ranges cover all affected years. †At least one obligation is underfunded. Government support, both tax rates and the foreign policy stay fixed.';
  el('salary-options-note').textContent = note;
  el('safety-options-note').textContent = 'The government fills the gap between the chosen floor and the employer salary after worker tax. The floor excludes capital income and general dividends. Each row changes only the government floor. Employer obligations and both tax rates stay fixed. The universal dividend can fall when more tax revenue is spent on targeted top-ups.';
}

function renderChart(years: RegionYear[]) {
  const width = 740, height = 290, left = 42, right = 20, top = 22, bottom = 36;
  const values = years.flatMap(y => [...(y.unemployment > 1e-9 ? [y.displacedIncomeIndex] : []), ...(y.unemployment < 1 - 1e-9 ? [y.employedIncomeIndex] : []), y.workerIncomeIndex]);
  const rawMin = Math.min(100, ...values), rawMax = Math.max(100, ...values);
  const step = rawMax - rawMin > 120 ? 50 : rawMax - rawMin > 50 ? 25 : 10;
  const min = Math.max(0, Math.floor((rawMin - 5) / step) * step);
  const max = Math.max(min + step * 3, Math.ceil((rawMax + 5) / step) * step);
  const x = (year: number) => left + year / 10 * (width - left - right);
  const y = (value: number) => top + (max - value) / (max - min) * (height - top - bottom);
  const ticks: number[] = [];
  for (let value = min; value <= max; value += step) ticks.push(value);
  const paths = [
    { key: 'displacedIncomeIndex' as const, color: '#28594e', present: (point: RegionYear) => point.unemployment > 1e-9 },
    { key: 'employedIncomeIndex' as const, color: '#af4a30', present: (point: RegionYear) => point.unemployment < 1 - 1e-9 },
    { key: 'workerIncomeIndex' as const, color: '#85734c', present: (_point: RegionYear) => true },
  ];
  const end = years[years.length - 1]!;
  const summary = `Year ten: affected-role worker income ${end.unemployment > 0 ? num(end.displacedIncomeIndex) : "no affected roles"}, productive-role worker income ${end.unemployment < 1 - 1e-9 ? num(end.employedIncomeIndex) : "no productive roles"}, average worker income ${num(end.workerIncomeIndex)}. Pre-AI income equals 100.`;
  el('income-chart').setAttribute('aria-label', summary);
  el('income-chart').innerHTML = `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true">${ticks.map(tick => `<line x1="${left}" x2="${width - right}" y1="${y(tick)}" y2="${y(tick)}" stroke="${tick === 100 ? '#acb5a5' : '#deded3'}" stroke-width="1" ${tick === 100 ? '' : 'stroke-dasharray="2 4"'} /><text x="${left - 10}" y="${y(tick) + 4}" text-anchor="end">${tick}</text>`).join('')}${[0, 2, 4, 6, 8, 10].map(year => `<text x="${x(year)}" y="${height - 13}" text-anchor="middle">${year === 0 ? 'Today' : `Year ${year}`}</text>`).join('')}${paths.map(series => {
    let connected = false;
    const path = years.map(point => {
      if (!series.present(point)) { connected = false; return ''; }
      const command = connected ? 'L' : 'M';
      connected = true;
      return `${command}${x(point.year).toFixed(1)},${y(point[series.key]).toFixed(1)}`;
    }).join(' ');
    return `<path d="${path}" fill="none" stroke="${series.color}" stroke-width="${series.key === 'workerIncomeIndex' ? 2 : 3}" ${series.key === 'workerIncomeIndex' ? 'stroke-dasharray="6 5"' : ''} stroke-linejoin="round" stroke-linecap="round"/>${series.present(end) ? `<circle cx="${x(10)}" cy="${y(end[series.key])}" r="4" fill="${series.color}" />` : ''}`;
  }).join('')}</svg>`;
  el('endpoints').innerHTML = [
    ['worker', 'Affected roles', end.displacedIncomeIndex],
    ['owner', 'Productive roles', end.employedIncomeIndex],
    ['output', 'All worker households', end.workerIncomeIndex],
  ].map(([kind, label, value]) => `<div class="endpoint ${kind}"><strong>${(kind === 'worker' && end.unemployment < 1e-9 || kind === 'owner' && end.unemployment > 1 - 1e-9) ? 'N/A' : change(Number(value))}</strong>${label}<br />in year ten</div>`).join('');
  el('year-table').innerHTML = years.map(point => `<tr><th scope="row">${point.year === 0 ? 'Today' : `Year ${point.year}`}</th><td>${point.unemployment > 1e-9 ? num(point.displacedIncomeIndex) : '—'}</td><td>${point.unemployment < 1 - 1e-9 ? num(point.employedIncomeIndex) : '—'}</td><td>${num(point.workerIncomeIndex)}</td></tr>`).join('');
}

function renderEquilibriumPicker() {
  const picker = el<HTMLSelectElement>('equilibrium-picker');
  el('equilibrium-picker-label').hidden = voting.majorityStable.length < 2;
  picker.innerHTML = voting.majorityStable.map((pair, index) => `<option value="${index}" ${index === equilibriumIndex ? 'selected' : ''}>${index + 1}. US: ${policyDescription(pair.usPolicy)}${pair.foreignPolicy ? ` / Foreign: ${policyDescription(pair.foreignPolicy)}` : ''}</option>`).join('');
}

function renderInternational(strategic: boolean) {
  el('international-result').hidden = !strategic;
  if (!strategic) return;
  el('country-policies').innerHTML = `<div class="country-policy"><h4>United States</h4><p>${policyDescription(active.usPolicy)}</p></div><div class="country-policy"><h4>Foreign frontier bloc</h4><p>${policyDescription(active.foreignPolicy!)}</p></div>`;
  el('equilibrium-explanation').textContent = voting.majorityStable.length
    ? `There ${voting.majorityStable.length === 1 ? 'is 1 policy pair' : `are ${voting.majorityStable.length} policy pairs`} stable under separate ballots. Neither electorate has 501 votes to change any one decision while all the others hold still.`
    : 'No policy pair is stable under separate ballots on this grid. The default minimizes the largest coalition for changing a single decision. It remains an unstable fallback.';
  const usVotes = coordinateVotes(active);
  const foreignVotes = coordinateVotes(active, 'foreign');
  el('deviation').textContent = `Largest coalition to change one decision: US ${usVotes} / 1,000; foreign bloc ${foreignVotes} / 1,000. Each needs 501. ${Math.max(usVotes,foreignVotes) >= VOTES_REQUIRED ? 'At least one separate ballot would change this pair.' : 'Neither country can pass a change on a separate ballot.'}`;
}

function renderComparison(strategic: boolean) {
  const fullUntaxed = POLICIES.find(policy => policy.pace === pace && policy.tax === 0 && policy.replacement === 0 && policy.safetyNet === 0 && policy.workerTax === 0)!;
  const untaxed = simulateProfile(inputs, fullUntaxed, selectedProfile().foreignPolicy, result.effectiveMode, objective, pace);
  const rows: [string, ProfileOutcome][] = [
    [strategic ? 'No AI in either bloc' : 'No AI deployment', result.baseline],
    ['Majority choice', selectedProfile()],
    ['Layoffs, no benefits or taxes', untaxed],
  ];
  rows.push(['Worker-welfare benchmark', strategic ? result.coordinated : result.selected]);
  if (manual) rows.push(['Your US policy', manual]);
  el('comparison-table').innerHTML = rows.map(([label, profile]) => {
    const end = last(profile);
    const gain = benefit(profile.usScore);
    return `<tr class="${profile.id === active.id ? 'selected' : ''}"><td>${label}</td><td>${num(end.workerIncomeIndex)}</td><td>${num(end.ownerIncomeIndex)}</td><td>${num(end.output)}</td><td>${signed(gain)}%</td></tr>`;
  }).join('');
  el('score-help').textContent = 'Ten-year benefit is the equivalent steady income gain for worker households, accounting for low-income years and discounting later income. It is a separate welfare benchmark; each voter considers their own income.';
}

function renderAccounting() {
  const end = last(active);
  const lines: [string, number][] = [
    ['Gross US production', end.output], ['Installation and adjustment costs', -end.investmentCost - end.adjustmentCost],
    ['Net international rent income', end.netRentFlow],
    ['Total household income available', end.consumption], [`Received by worker households (${pct(inputs.workerShare)})`, end.workerIncome],
    [`Received by owner households (${pct(1-inputs.workerShare)})`, end.ownerIncome], ['Employer salaries for retained roles, before tax', end.employerPay], ['Worker household tax collected', end.workerTaxRevenue], ['Owner household tax collected', end.ownerTaxRevenue],
    ['Public top-ups within worker income', end.publicSupport], ['Universal dividends paid to workers', end.workerDividend], ['Universal dividends paid to owners', end.ownerDividend],
  ];
  el('accounting-table').innerHTML = lines.map(([label, value]) => `<tr><th scope="row">${label}</th><td>${num(value)}</td></tr>`).join('');
  el('ownership-note').textContent = `Worker households own ${pct(inputs.workerOwnership)} of capital income. Owner households own the remaining ${pct(1 - inputs.workerOwnership)}. Budget residual: ${Math.abs(end.resourceResidual).toFixed(8)} units (rounding only).`;
}

function renderMethod() {
  el('model-method').innerHTML = '<h4>Voters and majority selection</h4>' + VOTING_NOTES.map(note => `<p>${note}</p>`).join('') + MODEL_NOTES.filter(note => note.title !== 'Equilibrium and coordination').map(note => `<h4>${note.title}</h4><p>${note.detail}</p>${note.equation ? `<p class="equation">${note.equation}</p>` : ''}`).join('');
}

readURL();
buildInputs();
syncInputs();
renderMethod();
document.querySelectorAll<HTMLInputElement>('input[name="world"]').forEach(radio => radio.addEventListener('change', () => {
  mode = radio.value as ModelMode;
  syncInputs();
  scheduleSolve();
}));
el('reset').addEventListener('click', () => {
  inputs = { ...DEFAULT_INPUTS };
  mode = 'us-only';
  objective = 'workers';
  pace = 1;
  clearPreset();
  syncInputs();
  scheduleSolve();
});
document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(button => button.addEventListener('click', () => {
  inputs = { ...DEFAULT_INPUTS };
  if (button.dataset.preset === 'shared') Object.assign(inputs, { productivityGain: .6, displacement: .3, reemployment: .5, workerOwnership: .4, investmentResponse: .1 });
  if (button.dataset.preset === 'displacement') Object.assign(inputs, { productivityGain: .25, displacement: .7, reemployment: .05, workerOwnership: .05 });
  if (button.dataset.preset === 'tax-response') {
    mode = 'us-only'; pace = 1;
    Object.assign(inputs, { workerShare: .55, workerOwnership: .5, investmentResponse: 1, productivityGain: 1, displacement: .35 });
  }
  if (button.dataset.preset === 'rivalry') {
    mode = 'strategic';
    Object.assign(inputs, { capitalMobility: 1, investmentResponse: .7, foreignStrength: 1, foreignMarketSize: 2, tradeIntensity: .6 });
  }
  clearPreset();
  button.setAttribute('aria-pressed', 'true');
  syncInputs();
  scheduleSolve();
}));
el<HTMLSelectElement>('equilibrium-picker').addEventListener('change', (event) => {
  equilibriumIndex = Number((event.target as HTMLSelectElement).value);
  view = 'selected';
  active = selectedProfile();
  manual = undefined;
  el('manual-result').textContent = '';
  render();
});
el<HTMLSelectElement>('rollout').addEventListener('change', (event) => {
  const value = (event.target as HTMLSelectElement).value;
  pace = Number(value);
  scheduleSolve();
});
el('apply-manual').addEventListener('click', () => {
  const replacement = [0, .5, 1, 1.25][Number(el<HTMLInputElement>('manual-replacement').value)]!;
  const safetyNet = [0, .5, 1][Number(el<HTMLInputElement>('manual-safetyNet').value)]!;
  const workerTax = [0, .5, 1][Number(el<HTMLInputElement>('manual-workerTax').value)]!;
  const tax = [0, .5, 1][Number(el<HTMLInputElement>('manual-tax').value)]!;
  const policy = POLICIES.find(p => p.pace === pace && p.tax === tax && p.workerTax === workerTax && p.replacement === replacement && p.safetyNet === safetyNet)!;
  manual = simulateProfile(inputs, policy, active.foreignPolicy, result.effectiveMode, objective, pace);
  active = manual;
  view = 'manual';
  render();
  el('manual-result').textContent = `Employer salary after tax: ${paymentRange(manual, 'employer')}; government top-up: ${paymentRange(manual, 'government')} of the starting wage. ${voting.votesForChange(manual, selectedProfile())} of 1,000 US voters prefer this whole package to the selected outcome.`;
});
el('share').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(scenarioURL().href);
    el('action-status').textContent = 'Assumptions link copied. Opens the default solution.';
  } catch {
    el('action-status').textContent = 'Copy this page’s address to share the assumptions.';
  }
});
el('download').addEventListener('click', () => {
  const payload = {
    model: 'pirates-worker-economy-v3', interpretation: 'Illustrative finite-policy model; not a forecast or an empirical optimum.',
    inputs, mode, objective, pace, selection: voting.selection, majorityStable: voting.majorityStable.map(pair => ({ us: pair.usPolicy, foreign: pair.foreignPolicy })),
    displayed: active, selected: voting.selected, agendaOrder: voting.agendaOrder, agendaSteps: voting.agendaSteps, coordinated: result.coordinated, baseline: result.baseline,
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'pirates-economy-scenario.json';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  el('action-status').textContent = 'Scenario and annual results downloaded.';
});
window.addEventListener('popstate', () => { readURL(); syncInputs(); scheduleSolve(); });
run();
