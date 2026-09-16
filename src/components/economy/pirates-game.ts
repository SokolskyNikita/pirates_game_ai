import { countVotes } from '../../lib/economy/pirates-voting';
import {
  DEFAULT_INPUTS, INPUT_SPECS, MODEL_NOTES,
  normalizeInputs, POLICIES, evaluateProfile, CALIBRATION,
  type ModelInputs, type ModelMode, type Objective, type Policy, type ProfileOutcome, type RegionYear,
} from '../../lib/economy/pirates-model';
import { US_COHORTS, US_ELECTORATE } from '../../lib/economy/us-electorate';
import { loadPrecomputedScenario } from '../../lib/economy/precomputed';
import type { ScenarioSnapshot, ScenarioResponse, ScenarioRequest } from '../../lib/economy/simulation';

const el = <T extends HTMLElement = HTMLElement>(id: string) => {
  const element = document.getElementById(id);
  if (!element) throw new Error('Missing simulator element: ' + id);
  return element as T;
};
const pct = (n: number) => Number((n * 100).toFixed(1)) + '%';
const num = (n: number) => n.toFixed(1);
const change = (index: number) => (index >= 100 ? '+' : '−') + Math.abs(index - 100).toFixed(1) + '%';
const last = (profile: ProfileOutcome) => profile.us[profile.us.length - 1]!;
const foreignKeys = new Set<string>(['foreignGdpGrowth', 'capitalMobility', 'foreignStrength', 'tradeIntensity', 'foreignTradeIntensity', 'foreignMarketSize', 'foreignPopulationRatio']);
const visibleInputSpecs = INPUT_SPECS.filter(spec => spec.key !== 'foreignPopulationRatio');
const sliderValues = new Map<keyof ModelInputs, number[]>();
const structuralKeys = new Set<string>(['investmentResponse']);
const objectiveLabels: Record<Objective, string> = { workers: 'Workers’ incomes', prosperity: 'Overall prosperity', output: 'Total economic output' };
const objectiveHelp: Record<Objective, string> = {
  workers: 'Maximize average after-tax income in households whose main source is work, over ten years. Includes benefits and investment income.',
  prosperity: 'Maximize average income utility across all adults, including retirees and benefit recipients. Log utility gives more weight to losses when income is low.',
  output: 'Maximize its total production over ten years, before installation and adjustment costs. This objective does not value how income is divided.',
};
let inputs = { ...DEFAULT_INPUTS };
let mode: ModelMode = 'us-only';
let foreignObjective: Objective = 'prosperity';
let pauseUnavailable = false;
let snapshot: ScenarioSnapshot | undefined;
let manual: ProfileOutcome | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let computation: Worker | undefined;
let preload: AbortController | undefined;
let revision = 0;
let pending = true;

function formatInput(key: keyof ModelInputs, value: number) {
  if (key === 'usGdpGrowth' || key === 'foreignGdpGrowth') return pct(value) + '/year';
  if (key === 'foreignMarketSize') return Number(value.toFixed(2)) + '× US';
  if (key === 'foreignStrength') return pct(value) + ' of US';
  return pct(value);
}

function readURL() {
  const query = new URLSearchParams(location.search);
  const values: Partial<ModelInputs> = {};
  for (const spec of INPUT_SPECS) {
    const raw = query.get(spec.key);
    if (raw !== null && raw.trim() && Number.isFinite(Number(raw))) values[spec.key] = Number(raw);
  }
  inputs = normalizeInputs(values);
  mode = query.get('world') === 'strategic' ? 'strategic' : 'us-only';
  pauseUnavailable = query.get('pauseUnavailable') === '1';
  const foreign = query.get('foreignObjective');
  foreignObjective = foreign === 'workers' || foreign === 'output' ? foreign : 'prosperity';
}

function scenarioURL() {
  const url = new URL(location.href);
  url.search = '';
  url.hash = 'simulator';
  url.searchParams.set('v', '10');
  url.searchParams.set('world', mode);
  url.searchParams.set('pauseUnavailable', pauseUnavailable ? '1' : '0');
  if (mode === 'strategic') url.searchParams.set('foreignObjective', foreignObjective);
  // Include the numerical inputs so a shared scenario survives future default revisions.
  for (const spec of INPUT_SPECS) url.searchParams.set(spec.key, String(inputs[spec.key]));
  return url;
}

function buildInputs() {
  for (const spec of visibleInputSpecs) {
    const target = foreignKeys.has(spec.key) ? 'international-inputs' : structuralKeys.has(spec.key) ? 'structural-inputs' : 'domestic-inputs';
    const node = document.createElement('div');
    node.className = 'input-control';
    node.innerHTML = '<label class="input-label" for="input-' + spec.key + '"><span>' + spec.label + '</span><output id="value-' + spec.key + '" for="input-' + spec.key + '"></output></label><input id="input-' + spec.key + '" name="' + spec.key + '" type="range" min="0" max="1" step="1" aria-describedby="help-' + spec.key + '" /><p id="help-' + spec.key + '">' + spec.description + '</p>';
    el(target).append(node);
    el<HTMLInputElement>('input-' + spec.key).addEventListener('input', event => {
      inputs[spec.key] = sliderValues.get(spec.key)![Number((event.target as HTMLInputElement).value)]!;
      updateInputLabel(spec.key);
      updateElectorate();
      updateCalibration();
      clearPreset();
      scheduleSolve();
    });
  }
  for (const axis of policyAxes) {
    const values = [...new Set(POLICIES.map(policy => policy[axis]))];
    const node = document.createElement('div');
    node.className = 'manual-control';
    node.innerHTML = '<label for="manual-' + axis + '">' + axisLabels[axis] + '</label><select id="manual-' + axis + '">' + values.map(value => {
      const policy = { ...POLICIES[0]!, [axis]: value };
      return '<option value="' + value + '">' + axisValue(axis, policy) + '</option>';
    }).join('') + '</select>';
    el('manual-inputs').append(node);
  }
}

function updateInputLabel(key: keyof ModelInputs) {
  const text = formatInput(key, inputs[key]);
  el('value-' + key).textContent = text;
  el<HTMLInputElement>('input-' + key).setAttribute('aria-valuetext', text);
}

function updateElectorate() {
  el('electorate-description').textContent = 'Every adult US citizen casts one vote for their preferred complete package. More than 50% must choose the same package for it to pass; otherwise current policy remains.';
}

function updateCalibration() {
  const custom = (['foreignMarketSize', 'tradeIntensity', 'foreignTradeIntensity'] as const)
    .some(key => Math.abs(inputs[key] - DEFAULT_INPUTS[key]) > 1e-8);
  el('calibration-summary').textContent = '2025 reference: rest-of-world GDP 2.85× US. Imports across this border: 14.2% of US GDP and 3.9% of rest-of-world GDP.' + (custom ? ' This scenario changes at least one reference value; Reset restores the defaults.' : '');
}

function syncPauseControl() {
  el<HTMLInputElement>('pause-unavailable').checked = pauseUnavailable;
  el('pause-unavailable-help').textContent = mode === 'strategic'
    ? 'Remove Pause AI from both the US ballot and the rest of the world’s choices.'
    : 'Remove Pause AI from the US ballot. Current pace and acceleration remain available.';
  const pace = el<HTMLSelectElement>('manual-pace');
  const previous = pace.value;
  pace.innerHTML = [0, 1, 2].filter(value => !pauseUnavailable || value !== 0)
    .map(value => '<option value="' + value + '">' + paceName(value) + '</option>').join('');
  pace.value = pauseUnavailable && previous === '0' ? '1' : previous || '1';
}

function syncInputs() {
  updateElectorate();
  syncPauseControl();
  for (const spec of visibleInputSpecs) {
    const step = spec.key === 'foreignMarketSize' ? .25 : .05;
    const values = [spec.min, spec.max, DEFAULT_INPUTS[spec.key], inputs[spec.key]];
    for (let value = Math.ceil(spec.min / step) * step; value <= spec.max + 1e-9; value += step) values.push(Number(value.toFixed(8)));
    const choices = [...new Set(values)].sort((a, b) => a - b);
    sliderValues.set(spec.key, choices);
    const slider = el<HTMLInputElement>('input-' + spec.key);
    slider.max = String(choices.length - 1);
    slider.value = String(choices.indexOf(inputs[spec.key]));
    updateInputLabel(spec.key);
  }
  document.querySelectorAll<HTMLInputElement>('input[name="world"]').forEach(radio => { radio.checked = radio.value === mode; });
  el<HTMLSelectElement>('foreign-objective').value = foreignObjective;
  el('foreign-objective-help').textContent = objectiveHelp[foreignObjective];
  el('foreign-inputs').hidden = mode !== 'strategic';
  updateCalibration();
}

function clearPreset() {
  document.querySelectorAll('[data-preset]').forEach(button => button.setAttribute('aria-pressed', 'false'));
}

function setBusy(busy: boolean) {
  pending = busy;
  el('computation-message').classList.remove('error');
  el('results').setAttribute('aria-busy', String(busy));
  el('results').classList.toggle('is-stale', busy && Boolean(snapshot));
  el<HTMLButtonElement>('apply-manual').disabled = busy || !snapshot;
  el<HTMLButtonElement>('download').disabled = busy || !snapshot;
  el<HTMLButtonElement>('share').disabled = busy || !snapshot;
}

function failCalculation(message: string, displayFailure = false) {
  setBusy(false);
  el('computation-message').classList.add('error');
  pending = true;
  el('results').classList.add('is-stale');
  el('solve-status').textContent = 'Calculation failed';
  el('computation-message').textContent = displayFailure
    ? 'The result could not be displayed completely. Change an input or Reset to try again; the figures below may be incomplete.'
    : snapshot
    ? 'The new calculation failed. The result below uses the previous assumptions. Change an input or Reset to try again.'
    : 'The calculation could not start. Reload the page or Reset to try again.';
  for (const id of ['apply-manual', 'download', 'share']) el<HTMLButtonElement>(id).disabled = true;
  console.error(message);
}

function scheduleSolve() {
  revision++;
  if (timer) clearTimeout(timer);
  // Cancelling work also prevents an old, slower request from replacing a newer result.
  preload?.abort();
  computation?.terminate();
  computation = undefined;
  setBusy(true);
  el('solve-status').textContent = 'Calculating…';
  el('computation-message').textContent = snapshot
    ? 'Recalculating. The previous result stays visible until the new one is ready.'
    : mode === 'strategic' ? 'Comparing funded packages and checking both sides’ choices…' : 'Comparing fully funded packages and counting one vote per citizen…';
  const id = revision;
  timer = setTimeout(() => run(id), 180);
}

function acceptSnapshot(result: ScenarioSnapshot, precomputed: boolean) {
  snapshot = result;
  manual = undefined;
  setBusy(false);
  el('computation-message').textContent = '';
  el('manual-result').textContent = '';
  el('action-status').textContent = '';
  try {
    render();
    el('solve-status').title = precomputed ? 'Precomputed for these exact assumptions.' : 'Calculated in your browser for these assumptions.';
    const url = scenarioURL();
    url.hash = location.hash;
    history.replaceState(null, '', url);
  } catch (error) { failCalculation(String(error), true); }
}

async function run(id: number) {
  const request: ScenarioRequest = { id, inputs: { ...inputs }, mode, foreignObjective, pauseUnavailable };
  const controller = new AbortController();
  preload = controller;
  try {
    const precomputed = await loadPrecomputedScenario(request, controller.signal);
    if (id !== revision || controller.signal.aborted) return;
    preload = undefined;
    if (precomputed) { acceptSnapshot(precomputed, true); return; }
  } catch {
    if (id !== revision || controller.signal.aborted) return;
    preload = undefined;
    // A missing or unavailable static result never prevents a fresh calculation.
  }
  try {
    const worker = new Worker(new URL('../../lib/economy/simulation.worker.ts', import.meta.url), { type: 'module' });
    computation = worker;
    worker.onmessage = (event: MessageEvent<ScenarioResponse>) => {
      if (id !== revision || event.data.id !== id) return;
      worker.terminate();
      computation = undefined;
      if (event.data.error) { failCalculation(event.data.error); return; }
      if (!event.data.snapshot) { failCalculation('Missing calculation result.'); return; }
      acceptSnapshot(event.data.snapshot, false);
    };
    worker.onerror = event => {
      if (id !== revision) return;
      worker.terminate();
      computation = undefined;
      failCalculation(event.message);
    };
    worker.postMessage(request);
  } catch (error) { failCalculation(String(error)); }
}

const replacementName = (r: number) => r === 0 ? 'Allow layoffs' : 'Retain at ' + pct(r) + ' of prior wages';
const dollars = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
const voteShare = (value: number) => value.toFixed(2) + '%';
const paceName = (value: number) => value === 0 ? 'Pause AI' : value === 2 ? 'Accelerate AI' : 'Allow current AI pace';
const policyAxes = ['pace', 'replacement', 'welfareScale', 'benefitFormula', 'laborTax', 'capitalTax'] as const;
type PolicyAxis = typeof policyAxes[number];
const axisLabels: Record<PolicyAxis, string> = { pace: 'AI pace', replacement: 'Employer retention', welfareScale: 'Government redistribution', benefitFormula: 'Who receives the benefits', laborTax: 'Tax on work and pension income', capitalTax: 'Tax on investment income' };
const formulaNames: Record<Policy['benefitFormula'], string> = { current: 'Keep the current recipient mix', flat: 'Equal payment to every adult', 'prior-income': 'Payments proportional to prior income' };
function changeFromReference(rate: number, reference: number) {
  const difference = (rate - reference) * 100;
  return Math.abs(difference) < 1e-7 ? 'unchanged from the 2025 reference' : Math.abs(difference).toFixed(1) + ' percentage points ' + (difference < 0 ? 'below' : 'above') + ' the 2025 reference';
}
function welfareName(scale: number) {
  return scale === 1 ? 'Keep the current total budget' : scale === 0 ? 'End the modeled benefit payments' : (scale < 1 ? 'Reduce' : 'Increase') + ' the total budget by ' + pct(Math.abs(scale - 1));
}
function axisValue(axis: PolicyAxis, policy: Policy) {
  if (axis === 'pace') return paceName(policy.pace);
  if (axis === 'replacement') return replacementName(policy.replacement);
  if (axis === 'welfareScale') return welfareName(policy.welfareScale);
  if (axis === 'benefitFormula') return formulaNames[policy.benefitFormula];
  const reference = axis === 'laborTax' ? CALIBRATION.laborTaxRate : CALIBRATION.capitalTaxRate;
  return pct(policy[axis]) + ' benchmark (' + changeFromReference(policy[axis], reference) + ')';
}
function policyDescription(policy: Policy) {
  return paceName(policy.pace) + '; ' + replacementName(policy.replacement) + '; benefit budget target ' + pct(policy.welfareScale) + ' of the reference budget; ' + formulaNames[policy.benefitFormula].toLowerCase() + '; work/pension tax benchmark ' + pct(policy.laborTax) + ', investment tax ' + pct(policy.capitalTax) + '.';
}
function paymentRange(profile: ProfileOutcome) {
  const affected = profile.us.filter(y => y.year > 0 && y.unemployment > 1e-9);
  if (!affected.length) return 'not applicable';
  const values = affected.map(y => y.employerNetPayRatio);
  const low = Math.min(...values), high = Math.max(...values);
  return Math.abs(high - low) < .00001 ? pct(low) : pct(low) + '–' + pct(high);
}
function votesFor(challenger: ProfileOutcome, incumbent: ProfileOutcome) {
  return countVotes(challenger.usUtilities, incumbent.usUtilities);
}
function activeProfile(): ProfileOutcome { return snapshot!.selected; }

function render() {
  const current = snapshot!;
  const active = activeProfile();
  const p = active.usPolicy;
  const end = last(active);
  const ballot = current.ballot;
  const verified = current.selection !== 'search-incomplete';
  el('result-label').textContent = verified ? 'The simulated one-ballot outcome' : 'Unverified international outcome';
  el('solve-status').textContent = ballot.eligibleCandidateCount.toLocaleString() + ' funded packages';
  const passed = ballot.winnerId !== null;
  el('ballot-verdict').textContent = !ballot.leadingPolicyId ? 'No funded package. Current policy remains.'
    : passed ? ballot.statusQuoReason === 'status-quo-majority' ? 'A majority chooses current policy.' : 'A majority chooses one complete package.'
    : 'No package wins a majority. Current policy remains.';
  el('ballot-support').textContent = ballot.leadingPolicyId
    ? 'The leading package receives ' + voteShare(ballot.topSupportPercent) + ' of all votes. ' + (passed ? 'It passes the required majority.' : 'It needs more than 50% to pass; there is no second vote.')
    : 'No package can fund every promise in every year under these assumptions.';
  el('ballot-leading').hidden = passed || !current.leading;
  el('ballot-leading').textContent = current.leading && !passed ? 'Leading package: ' + policyDescription(current.leading.usPolicy) : '';
  el('decision-votes-note').textContent = (verified ? '' : 'The two sides’ choices are not yet verified as mutually consistent. ') + 'These six terms belong to ' + (passed ? 'the winning package' : 'the current-policy fallback') + ' and remain in place for ten years. Each voter chooses one fully funded package that maximizes their own expected income utility.';
  const baselineBenefits = end.baselineBenefits;
  const referenceIncome = US_COHORTS.reduce((sum, cohort) => sum + cohort.weight * cohort.disposableIncome, 0);
  const details: Record<PolicyAxis, string> = {
    pace: p.pace === 0 ? 'No new AI deployment or AI job replacement for ten years. Existing jobs remain productive, including when the other economy deploys AI.' : p.pace === 2 ? 'AI replacement runs twice as fast. Full domestic deployment and its full annual growth potential arrive by year five.' : 'AI replacement proceeds over ten years. Full domestic deployment and its full annual growth potential arrive by year ten.',
    replacement: p.replacement ? 'Employers fund the retained wages. This is a gross wage target; the modeled take-home payment is ' + paymentRange(active) + ' of prior wages after tax.' : 'Employers may dismiss workers whose roles become obsolete. Government benefits are shown below.',
    welfareScale: 'Reference: ' + dollars(baselineBenefits) + ' per adult per year, averaged across the population. Target: ' + dollars(end.benefitsRequired) + '. Funded in year ten: ' + dollars(end.benefitsPaid) + ' (' + pct(end.benefitsScalePaid) + ' of the reference). The same total budget does not preserve each person’s payment.' + (p.welfareScale === 2 ? ' This is the highest budget tested.' : ''),
    benefitFormula: p.benefitFormula === 'current' ? 'Keep the survey’s relative allocation of cash benefits and consumption support. Recipients’ shares stay fixed as jobs change; this does not simulate future eligibility under every US program.' : p.benefitFormula === 'flat' ? 'Divide the funded budget equally among all adults, including workers, retirees and investors. This replaces the modeled Social Security and assistance payment pattern.' : 'Divide the same budget in proportion to each adult’s pre-AI disposable household income. Higher prior income means a larger payment. This uses prior-year income, not lifetime earnings.',
    laborTax: 'Selected benchmark: ' + pct(p.laborTax) + ', ' + changeFromReference(p.laborTax, CALIBRATION.laborTaxRate) + ' of ' + pct(CALIBRATION.laborTaxRate) + '. Actual year-ten average: ' + pct(end.effectiveLaborTax) + '. Covers earnings, pensions and other non-investment income; it preserves income differences in the reference tax profile.',
    capitalTax: 'Selected benchmark: ' + pct(p.capitalTax) + ', ' + changeFromReference(p.capitalTax, CALIBRATION.capitalTaxRate) + ' of ' + pct(CALIBRATION.capitalTaxRate) + '. Actual year-ten average: ' + pct(end.effectiveCapitalTax) + '. Applies to investment income even when its recipient also works.',
  };
  el('policy-decisions').innerHTML = policyAxes.map((axis, index) => {
    let headline = axisValue(axis, p);
    if (axis === 'laborTax' || axis === 'capitalTax') {
      const reference = axis === 'laborTax' ? CALIBRATION.laborTaxRate : CALIBRATION.capitalTaxRate;
      headline = (Math.abs(p[axis] - reference) < 1e-7 ? 'Keep the tax benchmark at ' : (p[axis] < reference ? 'Reduce' : 'Increase') + ' the tax benchmark to ') + pct(p[axis]) + '.';
    }
    const kind = axis === 'replacement' || axis === 'pace' ? 'employment-decision' : axis.endsWith('Tax') ? 'tax-decision' : 'government-decision';
    return '<section class="policy-decision ' + kind + '"><p class="eyebrow">' + (index + 1) + ' · ' + axisLabels[axis] + '</p><div class="decision-answer"><h2>' + headline + '</h2><p>' + details[axis] + '</p></div></section>';
  }).join('');
  el('policy-strip').innerHTML = [
    [paymentRange(active), 'Employer pay after tax / prior wages'],
    [pct(end.benefitsScalePaid), 'Funded benefits / current total budget'],
    [change(100 * end.consumption / referenceIncome), 'Average adult take-home income in year ten'],
  ].map(([value, label]) => '<div class="policy-item"><strong>' + value + '</strong><span>' + label + '</span></div>').join('');
  el('manual-help').textContent = 'Compare another complete US package, including its AI pace. The displayed foreign policy stays fixed. This comparison does not add a second vote.';
  el('policy-meaning').textContent = 'Benefits include modeled cash payments and consumption support. Health insurance is not counted as cash. Year-ten US AI adoption: ' + pct(end.adoption) + '; productive capacity: ' + pct(end.capacityFactor) + ' of the starting level.';
  el('growth-summary').textContent = 'Year-ten US GDP growth: ' + pct(end.gdpGrowthRate) + '/year, with ' + pct(end.exposure) + ' AI exposure. The full-AI growth assumption is ' + pct(current.inputs.usGdpGrowth) + '/year; investment and work incentives can change the realized rate.';
  const verdict = el('funding-verdict');
  const shortfall = !active.usAdmissible;
  verdict.hidden = !shortfall;
  verdict.classList.toggle('shortfall', shortfall);
  verdict.textContent = shortfall ? 'The automatic current-policy fallback cannot fund all commitments in this scenario. It could not receive votes, but remains because no eligible package won a majority. Income figures use actual payments; “Follow the money” shows the shortfalls.' : '';
  renderBallot(); renderChart(active.us); renderInternational(); renderComparison(); renderAccounting(); renderVotingDetails();
  for (const axis of policyAxes) el<HTMLSelectElement>('manual-' + axis).value = String(p[axis]);
}

function renderBallot() {
  const current = snapshot!;
  const support = new Map(current.ballot.tallies.map(row => [row.policyId, row.supportPercent]));
  el('ballot-table').innerHTML = current.alternatives.map((profile, index) => {
    const selected = profile.usPolicy.id === current.ballot.enactedPolicyId;
    return '<tr class="' + (selected ? 'selected' : '') + '"><th scope="row">' + (index + 1) + '. ' + policyDescription(profile.usPolicy) + (selected ? '<br /><strong>Enacted</strong>' : '') + '</th><td>' + voteShare(support.get(profile.usPolicy.id) ?? 0) + '</td></tr>';
  }).join('') || '<tr><td colspan="2">No fully funded packages.</td></tr>';
  el('ballot-table-note').textContent = 'Up to eight packages with the most first-choice votes, from ' + current.ballot.eligibleCandidateCount.toLocaleString() + ' eligible packages. ' + current.ballot.unfundedCandidateCount.toLocaleString() + ' cannot fund every promise in every year and are excluded. All combinations in the displayed policy menu are tested.';
}
function renderVotingDetails() {
  const current = snapshot!;
  el('selection-explanation').textContent = 'There is one vote over complete packages. Each citizen chooses the fully funded package giving their household the highest ten-year income utility, taking the foreign choice as known. A package passes only with more than 50% of the population-weighted vote. Otherwise the exact current-tax, current-benefit policy with current AI pace remains.';
  el('agenda-order').textContent = 'Exact personal utility ties prefer current policy when eligible, then the first package in a fixed ordering. This specifies how people cast their votes; perfect rationality alone does not select a unique strategic-voting equilibrium. ' + (current.mode === 'strategic' ? 'The search checks whether the foreign actor’s best choice and the US ballot outcome are mutually consistent. ' + current.search.reason + ' ' : '') + 'Policies are chosen once and held for ten years. There is no runoff or later renegotiation.';
}
function renderInternational() {
  const current = snapshot!;
  const strategic = current.mode === 'strategic';
  el('international-result').hidden = !strategic;
  if (!strategic) return;
  const active = activeProfile();
  const end = active.foreign!.at(-1)!;
  el('country-policies').innerHTML = '<div class="country-policy"><h4>Rest of the world</h4><p>' + policyDescription(active.foreignPolicy!) + '</p><p>Year ten: income in work-primary households ' + change(end.workerIncomeIndex) + '; output index ' + change(end.output) + ', relative to its own starting economy. Benefits funded: ' + pct(end.benefitsScalePaid) + ' of its reference budget.</p></div>';
  el('equilibrium-explanation').textContent = 'Foreign objective: ' + objectiveLabels[current.foreignObjective].toLowerCase() + '. Each side knows the other’s chosen policy. ' + (current.pauseUnavailable ? 'Neither side can pause AI. Both choose current pace or acceleration for the ten-year scenario. ' : 'Both choices stay in place for ten years, so a mutual pause lasts the full decade. ') + 'The foreign actor uses the US household distribution and behavioral rules as a modeling assumption, with separate economic size, trade exposure and frontier capability.';
  const verified = current.selection === 'verified-consistent';
  el('deviation').classList.toggle('unstable', !verified);
  el('international-heading').textContent = 'The foreign choice';
  el('deviation').textContent = verified
    ? 'The choices are mutually consistent: this foreign package maximizes its objective among fully funded options given the enacted US package, and the US ballot gives the displayed result given this foreign package.'
    : 'These choices are unverified. ' + current.search.reason + ' A consistent pair may exist outside the search; this result is not a verified equilibrium.';
}
function renderComparison() {
  const current = snapshot!;
  const rows: [string, ProfileOutcome][] = [
    [current.pauseUnavailable ? '2025 reference; pause unavailable' : '2025 reference; no new AI', current.baseline],
    [current.ballot.winnerId ? 'Enacted majority choice' : 'Enacted current-policy fallback', current.selected],
  ];
  if (current.leading && current.leading.usPolicy.id !== current.selected.usPolicy.id) rows.push(['Leading package; no majority', current.leading]);
  if (current.selected.usPolicy.id !== current.statusQuo.usPolicy.id) rows.push(['Current taxes and benefit mix', current.statusQuo]);
  if (manual) rows.push(['Your policy', manual]);
  const referenceIncome = US_COHORTS.reduce((sum, cohort) => sum + cohort.weight * cohort.disposableIncome, 0);
  el('comparison-table').innerHTML = rows.map(([label, profile]) => {
    const end = last(profile);
    return '<tr class="' + (profile.id === activeProfile().id ? 'selected' : '') + '"><th scope="row">' + label + '</th><td>' + num(100 * end.consumption / referenceIncome) + '</td><td>' + num(end.workerIncomeIndex) + '</td><td>' + num(end.ownerIncomeIndex) + '</td><td>' + num(end.output) + '</td></tr>';
  }).join('');
  el('score-help').textContent = 'Year-ten indices: each group’s 2025 reference is 100. Household source groups stay fixed. Complete packages can change AI pace as well as protections, benefits and taxes. ' + (current.mode === 'strategic' ? 'Comparisons hold the foreign choice fixed, except for the no-AI reference. ' : '') + 'Output is a modeled resource index, not a GDP forecast.';
}
function renderAccounting() {
  const end = last(activeProfile());
  const lines: [string, number][] = [
    ['Household take-home resources', end.consumption],
    ['Employer retention pay before tax', end.employerPay],
    ['Unfunded employer retention pay', end.employerFundingGap],
    ['Work/pension income tax receipts', end.laborTaxRevenue],
    ['Investment income tax receipts', end.capitalTaxRevenue],
    ['Reference benefit budget', end.baselineBenefits],
    ['Requested benefit budget', end.benefitsRequired],
    ['Actual benefit payments', end.benefitsPaid],
    ['Other public spending', end.nonTransferSpending],
    ['Unfunded benefit target', end.welfareFundingGap],
    ['Unfunded required public spending', end.governmentFundingGap],
  ];
  el('accounting-table').innerHTML = lines.map(([label, value]) => '<tr><th scope="row">' + label + '</th><td>' + dollars(value) + '</td></tr>').join('');
  el('ownership-note').textContent = 'Annual 2025 dollars per adult, averaged across the modeled population. Payments are transfers of existing resources. Budget identity residual: ' + dollars(Math.abs(end.resourceResidual)) + '. Foreign dollar conversions are illustrative; relative GDP weights international rent flows.';
}

function renderPopulation() {
  const data = US_ELECTORATE;
  const sourceLabels: Record<string, string> = { work: 'Work / self-employment', benefits: 'Public cash benefits', pension: 'Pensions / retirement accounts', capital: 'Investments / capital gains', other: 'Other personal income', none: 'No positive personal income' };
  const shares = data.personalPrimaryIncomeShares;
  el('population-summary').textContent = (data.population / 1e6).toFixed(1) + ' million adult citizens represented. ' + pct(shares.work) + ' derive their largest personal income from work, ' + pct(shares.benefits) + ' from public cash benefits, and ' + pct(shares.capital) + ' from investments.';
  el('population-table-head').innerHTML = '<tr><th scope="col">Largest personal income source</th><th scope="col">Share of adults</th></tr>';
  el('population-table').innerHTML = Object.entries(shares).map(([source, share]) => '<tr><th scope="row">' + sourceLabels[source] + '</th><td>' + pct(share) + '</td></tr>').join('');
  const employment = data.employmentShares;
  el('population-note').textContent = 'Employment in the 2026 survey: ' + pct(employment.employed) + ' employed, ' + pct(employment.unemployed) + ' unemployed, ' + pct(employment.retired) + ' retired and ' + pct(employment.inactive) + ' otherwise outside the labor force. These are shares of all adult citizens, not the official unemployment rate. For voting, household income is shared among its adults; each citizen still has one vote. ' + data.cohortCount + ' weighted income/status groups approximate the survey, without rounding the electorate into a fixed voter count.';
  el('income-distribution-head').innerHTML = '<tr><th scope="col">Income group</th><th scope="col">Before tax</th><th scope="col">After tax</th><th scope="col">Public support</th></tr>';
  el('income-distribution').innerHTML = data.incomeQuintiles.map(row => '<tr><th scope="row">' + (row.quintile === 1 ? 'Lowest fifth' : row.quintile === 5 ? 'Highest fifth' : 'Fifth ' + row.quintile) + '</th><td>' + dollars(row.grossIncome) + '</td><td>' + dollars(row.disposableIncome) + '</td><td>' + dollars(row.benefits) + '</td></tr>').join('');
  const receipt = data.receiptShares;
  el('benefit-receipts').textContent = 'Overlapping receipt: ' + pct(receipt.socialSecurity) + ' receive Social Security, ' + pct(receipt.medicare) + ' have Medicare and ' + pct(receipt.medicaid) + ' have Medicaid; ' + pct(receipt.householdSnap) + ' live in a household receiving SNAP. ' + pct(receipt.anyMeasuredPublicBenefit) + ' receive at least one measured public benefit or live in a household with measured noncash support. These categories overlap and must not be added. Medicare and Medicaid coverage affect these descriptive counts, but are not converted into cash in the voting model.';
}

function renderMethod() {
  el('model-method').innerHTML = '<h4>Voting and policy selection</h4>' + '<p>Each citizen chooses one fully funded complete package maximizing their personal ten-year income utility. Strictly more than half must choose the same package; otherwise current policy remains. Exact ties prefer eligible current policy, then a fixed policy ordering. In international mode, each side’s choice must be consistent with the other’s known choice.</p>'
    + MODEL_NOTES.map(note => '<h4>' + note.title + '</h4><p>' + note.detail + '</p>' + (note.equation ? '<p class="equation">' + note.equation + '</p>' : '')).join('');
}

readURL();
buildInputs();
syncInputs();
renderPopulation();
renderMethod();
document.querySelectorAll<HTMLInputElement>('input[name="world"]').forEach(radio => radio.addEventListener('change', () => {
  mode = radio.value as ModelMode;
  syncInputs();
  scheduleSolve();
}));
el<HTMLInputElement>('pause-unavailable').addEventListener('change', event => {
  pauseUnavailable = (event.target as HTMLInputElement).checked;
  syncPauseControl();
  clearPreset();
  scheduleSolve();
});
el<HTMLSelectElement>('foreign-objective').addEventListener('change', event => {
  foreignObjective = (event.target as HTMLSelectElement).value as Objective;
  el('foreign-objective-help').textContent = objectiveHelp[foreignObjective];
  scheduleSolve();
});
el('reset').addEventListener('click', () => {
  inputs = { ...DEFAULT_INPUTS };
  mode = 'us-only'; foreignObjective = 'prosperity'; pauseUnavailable = false;
  clearPreset(); syncInputs(); scheduleSolve();
});
document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(button => button.addEventListener('click', () => {
  inputs = { ...DEFAULT_INPUTS };
  if (button.dataset.preset === 'shared') Object.assign(inputs, { usGdpGrowth: .06, foreignGdpGrowth: .06, productivityGain: .1, displacement: .3, reemployment: .5, investmentResponse: .1 });
  if (button.dataset.preset === 'displacement') Object.assign(inputs, { usGdpGrowth: .025, foreignGdpGrowth: .025, productivityGain: .25, displacement: .7, reemployment: .05 });
  if (button.dataset.preset === 'tax-response') {
    mode = 'us-only';
    Object.assign(inputs, { investmentResponse: 1, usGdpGrowth: .1, foreignGdpGrowth: .1, productivityGain: .4, displacement: .35 });
  }
  if (button.dataset.preset === 'rivalry') {
    mode = 'strategic';
    Object.assign(inputs, { capitalMobility: 1, investmentResponse: .7, foreignStrength: 1 });
  }
  clearPreset();
  button.setAttribute('aria-pressed', 'true');
  syncInputs(); scheduleSolve();
}));
el('apply-manual').addEventListener('click', () => {
  if (pending || !snapshot) return;
  const values = Object.fromEntries(policyAxes.map(axis => [axis, el<HTMLSelectElement>('manual-' + axis).value]));
  const policy = POLICIES.find(candidate => policyAxes.every(axis => String(candidate[axis]) === values[axis]));
  if (!policy || (snapshot.pauseUnavailable && policy.pace === 0)) return;
  manual = evaluateProfile(snapshot.inputs, policy, activeProfile().foreignPolicy, snapshot.mode, 'workers', snapshot.foreignObjective);
  const votes = votesFor(manual, activeProfile());
  el('manual-result').textContent = (paymentRange(manual) === 'not applicable' ? 'No roles are displaced in this scenario. ' : 'Employer pay after tax: ' + paymentRange(manual) + ' of prior wages. ') + 'Funded government benefits: ' + pct(last(manual).benefitsScalePaid) + ' of the reference budget. ' + voteShare(votes) + ' of adult citizens prefer this entire package to the selected outcome.' + (manual.usAdmissible ? '' : ' This package cannot fully fund retained wages, benefits and other required public spending in every year, so it is ineligible for the ballot.') + ' This pairwise preference is not its first-choice ballot share.' + (snapshot.mode === 'strategic' ? ' The foreign policy is held fixed for this comparison.' : '');
  renderComparison();
});
el('share').addEventListener('click', async () => {
  if (pending) return;
  try {
    await navigator.clipboard.writeText(scenarioURL().href);
    el('action-status').textContent = 'Scenario link copied, including whether AI can be paused.';
  } catch { el('action-status').textContent = 'Copy this page’s address to share the scenario.'; }
});
el('download').addEventListener('click', () => {
  if (pending || !snapshot) return;
  const payload = {
    model: 'pirates-single-ballot-v10', interpretation: 'Finite policy model with illustrative economic responses; not a forecast.',
    scenario: { inputs: snapshot.inputs, mode: snapshot.mode, foreignObjective: snapshot.foreignObjective, pauseUnavailable: snapshot.pauseUnavailable },
    selection: snapshot.selection, selected: activeProfile(), ballot: snapshot.ballot, search: snapshot.search,
    comparison: { noAI: snapshot.baseline, currentPolicy: snapshot.statusQuo, manual },
    electorate: US_ELECTORATE,
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = 'ai-pirates-game-scenario.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  el('action-status').textContent = 'Scenario and annual results downloaded.';
});
window.addEventListener('popstate', () => { readURL(); syncInputs(); scheduleSolve(); });
scheduleSolve();

let chartWidth = 0;
new ResizeObserver(entries => {
  const width = entries[0]?.contentRect.width ?? 0;
  if (Math.abs(width - chartWidth) < 1) return;
  chartWidth = width;
  if (snapshot) renderChart(activeProfile().us);
}).observe(el('income-chart'));

function renderChart(years: RegionYear[]) {
  const width = Math.max(320, Math.min(740, el('income-chart').clientWidth)), height = 290, left = 42, right = 20, top = 22, bottom = 36;
  const values = years.flatMap(y => [...(y.unemployment > 1e-9 ? [y.displacedIncomeIndex] : []), ...(y.unemployment < 1 - 1e-9 ? [y.employedIncomeIndex] : []), y.allIncomeIndex]);
  const rawMin = Math.min(100, ...values), rawMax = Math.max(100, ...values);
  const step = rawMax - rawMin > 120 ? 50 : rawMax - rawMin > 50 ? 25 : 10;
  const min = Math.floor((rawMin - 5) / step) * step;
  const max = Math.max(min + step * 3, Math.ceil((rawMax + 5) / step) * step);
  const x = (year: number) => left + year / 10 * (width - left - right);
  const y = (value: number) => top + (max - value) / (max - min) * (height - top - bottom);
  const ticks: number[] = [];
  for (let value = min; value <= max; value += step) ticks.push(value);
  const paths = [
    { key: 'displacedIncomeIndex' as const, color: '#28594e', present: (point: RegionYear) => point.unemployment > 1e-9 },
    { key: 'employedIncomeIndex' as const, color: '#af4a30', present: (point: RegionYear) => point.unemployment < 1 - 1e-9 },
    { key: 'allIncomeIndex' as const, color: '#85734c', present: (_point: RegionYear) => true },
  ];
  const end = years[years.length - 1]!;
  const obsolete = end.unemployment > 1e-9, productive = end.unemployment < 1 - 1e-9;
  const workforceSummary = `Year ten: ${pct(end.unemployment)} of workers are in obsolete roles; ${pct(1 - end.unemployment)} have productive work. Workers retained on employers’ payrolls still count as affected.`;
  el('workforce-summary').textContent = workforceSummary;
  const summary = `${workforceSummary} Income in obsolete roles: ${obsolete ? num(end.displacedIncomeIndex) : "no affected workers"}; income in productive roles: ${productive ? num(end.employedIncomeIndex) : "no productive roles remain"}; average adult income: ${num(end.allIncomeIndex)}. Pre-AI income equals 100.`;
  el('income-chart').setAttribute('aria-label', summary);
  el('income-chart').innerHTML = `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true">${ticks.map(tick => `<line x1="${left}" x2="${width - right}" y1="${y(tick)}" y2="${y(tick)}" stroke="${tick === 100 ? '#acb5a5' : '#deded3'}" stroke-width="1" ${tick === 100 ? '' : 'stroke-dasharray="2 4"'} /><text x="${left - 10}" y="${y(tick) + 4}" text-anchor="end">${tick}</text>`).join('')}${[0, 2, 4, 6, 8, 10].map(year => `<text x="${x(year)}" y="${height - 13}" text-anchor="middle">${year === 0 ? 'Today' : `Year ${year}`}</text>`).join('')}${paths.map(series => {
    let connected = false;
    const path = years.map(point => {
      if (!series.present(point)) { connected = false; return ''; }
      const command = connected ? 'L' : 'M';
      connected = true;
      return `${command}${x(point.year).toFixed(1)},${y(point[series.key]).toFixed(1)}`;
    }).join(' ');
    return `<path d="${path}" fill="none" stroke="${series.color}" stroke-width="${series.key === 'allIncomeIndex' ? 2 : 3}" ${series.key === 'allIncomeIndex' ? 'stroke-dasharray="6 5"' : ''} stroke-linejoin="round" stroke-linecap="round"/>${series.present(end) ? `<circle cx="${x(10)}" cy="${y(end[series.key])}" r="4" fill="${series.color}" />` : ''}`;
  }).join('')}</svg>`;
  el('endpoints').innerHTML = [
    ['worker', 'Workers in obsolete roles', obsolete ? change(end.displacedIncomeIndex) : '—', obsolete ? pct(end.unemployment) + ' of workers in year ten' : 'No workers affected'],
    ['owner', 'Workers in productive roles', productive ? change(end.employedIncomeIndex) : '—', productive ? pct(1 - end.unemployment) + ' of workers in year ten' : 'No productive roles remain'],
    ['output', 'All adult citizens', change(end.allIncomeIndex), 'Including people without work income'],
  ].map(([kind, label, value, detail]) => `<div class="endpoint ${kind}"><strong>${value}</strong>${label}<br />${detail}</div>`).join('');
  el('year-table').innerHTML = years.map(point => `<tr><th scope="row">${point.year === 0 ? 'Today' : `Year ${point.year}`}</th><td>${pct(point.unemployment)}</td><td>${point.unemployment > 1e-9 ? num(point.displacedIncomeIndex) : '—'}</td><td>${point.unemployment < 1 - 1e-9 ? num(point.employedIncomeIndex) : '—'}</td><td>${num(point.allIncomeIndex)}</td></tr>`).join('');
}
