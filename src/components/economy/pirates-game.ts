import { voterUtilities, countVotes, VOTING_NOTES, VOTER_COUNT, VOTES_REQUIRED } from '../../lib/economy/pirates-voting';
import {
  DEFAULT_INPUTS, INPUT_SPECS, MODEL_NOTES, EQUILIBRIUM_TOLERANCE,
  normalizeInputs,
  type ModelInputs, type ModelMode, type Objective, type Policy, type ProfileOutcome, type RegionYear,
} from '../../lib/economy/pirates-model';
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
const foreignKeys = new Set<keyof ModelInputs>(['capitalMobility', 'foreignStrength', 'tradeIntensity', 'foreignTradeIntensity', 'foreignMarketSize', 'foreignPopulationRatio']);
const visibleInputSpecs = INPUT_SPECS.filter(spec => spec.key !== 'foreignPopulationRatio');
const calibratedKeys = new Set<keyof ModelInputs>(['foreignMarketSize', 'tradeIntensity', 'foreignTradeIntensity']);
const structuralKeys = new Set<keyof ModelInputs>(['workerOwnership', 'investmentResponse']);
const objectiveLabels: Record<Objective, string> = { workers: 'Workers’ incomes', prosperity: 'Overall prosperity', output: 'Total economic output' };
const objectiveHelp: Record<Objective, string> = {
  workers: 'Maximize average after-tax income received by its worker households over ten years, including benefits and capital income.',
  prosperity: 'Maximize average income utility across its workers and owners. Log utility gives more weight to losses when a household is already poor.',
  output: 'Maximize its total production over ten years, before installation and adjustment costs. This objective does not value how income is divided.',
};
let inputs = { ...DEFAULT_INPUTS };
let mode: ModelMode = 'us-only';
let foreignObjective: Objective = 'prosperity';
let pace = 1;
let snapshot: ScenarioSnapshot | undefined;
let manual: ProfileOutcome | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let computation: Worker | undefined;
let revision = 0;
let pending = true;
let utilities = new WeakMap<ProfileOutcome, Float64Array>();

function formatInput(key: keyof ModelInputs, value: number) {
  if (key === 'workerShare') return Math.round(value * VOTER_COUNT) + ' workers · ' + pct(value);
  if (key === 'foreignMarketSize' || key === 'foreignPopulationRatio') return Number(value.toFixed(2)) + '× US';
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
  const foreign = query.get('foreignObjective');
  foreignObjective = foreign === 'workers' || foreign === 'output' ? foreign : 'prosperity';
  const rollout = query.get('rollout');
  pace = ['0', '0.33', '0.67', '1'].includes(rollout ?? '') ? Number(rollout) : 1;
}

function scenarioURL() {
  const url = new URL(location.href);
  url.search = '';
  url.hash = 'simulator';
  url.searchParams.set('v', '4');
  url.searchParams.set('world', mode);
  if (mode === 'strategic') url.searchParams.set('foreignObjective', foreignObjective);
  url.searchParams.set('rollout', String(pace));
  // Include the numerical inputs so a shared scenario survives future default revisions.
  for (const spec of INPUT_SPECS) url.searchParams.set(spec.key, String(inputs[spec.key]));
  return url;
}

function buildInputs() {
  for (const spec of visibleInputSpecs) {
    const target = spec.key === 'workerShare' ? 'electorate-inputs' : foreignKeys.has(spec.key) ? 'international-inputs' : structuralKeys.has(spec.key) ? 'structural-inputs' : 'domestic-inputs';
    const node = document.createElement('div');
    node.className = 'input-control';
    node.innerHTML = '<label class="input-label" for="input-' + spec.key + '"><span>' + spec.label + '</span><output id="value-' + spec.key + '" for="input-' + spec.key + '"></output></label><input id="input-' + spec.key + '" name="' + spec.key + '" type="range" min="' + spec.min + '" max="' + spec.max + '" step="' + (calibratedKeys.has(spec.key) ? 'any' : spec.step) + '" aria-describedby="help-' + spec.key + '" /><p id="help-' + spec.key + '">' + spec.description + '</p>';
    el(target).append(node);
    el<HTMLInputElement>('input-' + spec.key).addEventListener('input', event => {
      inputs[spec.key] = Number((event.target as HTMLInputElement).value);
      updateInputLabel(spec.key);
      updateElectorate();
      updateCalibration();
      clearPreset();
      scheduleSolve();
    });
  }
  const choices = [
    { key: 'replacement', label: 'Employer decision', values: [0, .5, 1, 1.25] },
    { key: 'safetyNet', label: 'Government wage-income floor', values: [0, .5, 1] },
    { key: 'workerTax', label: 'Worker household tax', values: [0, .5, 1] },
    { key: 'tax', label: 'Owner household tax', values: [0, .5, 1] },
  ];
  for (const choice of choices) {
    const node = document.createElement('div');
    node.className = 'manual-control';
    node.innerHTML = '<label for="manual-' + choice.key + '">' + choice.label + '</label><select id="manual-' + choice.key + '">' + choice.values.map(value => '<option value="' + value + '">' + (choice.key === 'replacement' ? replacementName(value) : pct(value)) + '</option>').join('') + '</select>';
    el('manual-inputs').append(node);
  }
}

function updateInputLabel(key: keyof ModelInputs) {
  const text = formatInput(key, inputs[key]);
  el('value-' + key).textContent = text;
  el<HTMLInputElement>('input-' + key).setAttribute('aria-valuetext', text);
}

function updateElectorate() {
  const workers = Math.round(inputs.workerShare * VOTER_COUNT);
  el('electorate-description').textContent = workers + ' worker households and ' + (VOTER_COUNT - workers) + ' owner households. Each voter considers only their own income over ten years.';
}

function updateCalibration() {
  const custom = (['foreignMarketSize', 'tradeIntensity', 'foreignTradeIntensity'] as const)
    .some(key => Math.abs(inputs[key] - DEFAULT_INPUTS[key]) > 1e-8);
  el('calibration-summary').textContent = '2025 reference: rest-of-world GDP 2.85× US. Imports across this border: 14.2% of US GDP and 3.9% of rest-of-world GDP.' + (custom ? ' This scenario changes at least one reference value; Reset restores the defaults.' : '');
}

function syncInputs() {
  updateElectorate();
  for (const spec of visibleInputSpecs) {
    el<HTMLInputElement>('input-' + spec.key).value = String(inputs[spec.key]);
    updateInputLabel(spec.key);
  }
  document.querySelectorAll<HTMLInputElement>('input[name="world"]').forEach(radio => { radio.checked = radio.value === mode; });
  el<HTMLSelectElement>('rollout').value = String(pace);
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
  computation?.terminate();
  computation = undefined;
  setBusy(true);
  el('solve-status').textContent = 'Calculating…';
  el('computation-message').textContent = snapshot
    ? 'Recalculating. The previous result stays visible until the new one is ready.'
    : 'Comparing policy choices…';
  const id = revision;
  timer = setTimeout(() => run(id), 180);
}

function run(id: number) {
  try {
    const worker = new Worker(new URL('../../lib/economy/simulation.worker.ts', import.meta.url), { type: 'module' });
    computation = worker;
    worker.onmessage = (event: MessageEvent<ScenarioResponse>) => {
      if (id !== revision || event.data.id !== id) return;
      worker.terminate();
      computation = undefined;
      if (event.data.error) { failCalculation(event.data.error); return; }
      if (!event.data.snapshot) { failCalculation('Missing calculation result.'); return; }
      snapshot = event.data.snapshot;
      manual = undefined;
      utilities = new WeakMap();
      setBusy(false);
      el('computation-message').textContent = '';
      el('manual-result').textContent = '';
      el('action-status').textContent = '';
      try {
        render();
        const url = scenarioURL();
        url.hash = location.hash;
        history.replaceState(null, '', url);
      } catch (error) { failCalculation(String(error), true); }
    };
    worker.onerror = event => {
      if (id !== revision) return;
      worker.terminate();
      computation = undefined;
      failCalculation(event.message);
    };
    const request: ScenarioRequest = { id, inputs: { ...inputs }, mode, foreignObjective, pace };
    worker.postMessage(request);
  } catch (error) { failCalculation(String(error)); }
}

const replacementName = (r: number) => r === 0 ? 'Allow layoffs' : 'Retain at ' + pct(r) + ' salary';
const benefit = (score: number) => (Math.exp(score) * 1.01 - .01 - 1) * 100;
const signed = (n: number) => (n >= 0 ? '+' : '−') + Math.abs(n).toFixed(1);
const policyAxes = ['replacement', 'safetyNet', 'workerTax', 'tax'] as const;
type PolicyAxis = typeof policyAxes[number];
const axisLabels: Record<PolicyAxis, string> = { replacement: 'Worker protections', safetyNet: 'Government floor', workerTax: 'Worker household tax', tax: 'Owner household tax' };
function axisValue(axis: PolicyAxis, policy: Policy) {
  return axis === 'replacement' ? replacementName(policy.replacement) : pct(policy[axis]);
}
function policyDescription(policy: Policy) {
  return replacementName(policy.replacement) + '; ' + pct(policy.safetyNet) + ' government floor; workers taxed ' + pct(policy.workerTax) + ', owners ' + pct(policy.tax) + '; ' + pct(policy.pace) + ' AI deployment target.';
}
function paymentRange(profile: ProfileOutcome, channel: 'employer' | 'government' = 'employer') {
  const affected = profile.us.filter(y => y.year > 0 && y.unemployment > 1e-9);
  if (!affected.length) return 'Not applicable';
  const values = affected.map(y => channel === 'employer' ? y.employerNetPayRatio : y.publicSupportRatio);
  const low = Math.min(...values), high = Math.max(...values);
  return Math.abs(high - low) < .00001 ? pct(low) : pct(low) + '–' + pct(high);
}
function votesFor(challenger: ProfileOutcome, incumbent: ProfileOutcome) {
  const get = (profile: ProfileOutcome) => {
    let scores = utilities.get(profile);
    if (!scores) {
      scores = voterUtilities(profile.us, snapshot!.inputs.reemployment, snapshot!.inputs.workerShare);
      utilities.set(profile, scores);
    }
    return scores;
  };
  return countVotes(get(challenger), get(incumbent));
}
function axisAlternatives(axis: PolicyAxis) {
  const current = snapshot!.selected.usPolicy;
  return snapshot!.alternatives.filter(({ usPolicy: candidate }) => candidate[axis] !== current[axis]
    && policyAxes.every(key => key === axis || candidate[key] === current[key]));
}
function strongestChallenge(candidates: ProfileOutcome[]) {
  let profile: ProfileOutcome | undefined, votes = 0;
  for (const candidate of candidates) {
    const count = votesFor(candidate, snapshot!.selected);
    if (!profile || count > votes) { profile = candidate; votes = count; }
  }
  return { profile, votes };
}

function render() {
  const current = snapshot!;
  const active = current.selected;
  const p = active.usPolicy;
  const endpoint = last(active);
  const strategic = current.mode === 'strategic';
  el('result-label').textContent = current.stableCount ? 'A stable policy in this model' : 'No stable policy found';
  el('solve-status').textContent = current.pairCount.toLocaleString() + (strategic ? ' policy pairs compared' : ' policies compared');
  el('recommendation').textContent = p.replacement === 0 ? 'Allow layoffs.' : 'Require retention at ' + pct(p.replacement) + ' of starting salary.';
  const dividends = active.us.slice(1).map(y => y.workerDividend / 60);
  const low = Math.min(...dividends), high = Math.max(...dividends);
  const range = Math.abs(high - low) < .00001 ? pct(low) : pct(low) + '–' + pct(high);
  el('safety-net-recommendation').textContent = p.safetyNet
    ? 'Set a ' + pct(p.safetyNet) + ' wage-income floor after tax.'
    : high > 1e-9 ? 'Pay a dividend, without a targeted wage floor.' : 'Provide no government income support.';
  el('recommendation-copy').textContent = 'Worker households pay ' + pct(p.workerTax) + ' tax on their wages and capital income. Owner households pay ' + pct(p.tax) + ' on their capital income. Receipts fund the wage floor first; any remainder is shared equally by all voters.'
    + (active.us.some(y => y.unemployment > 1e-9) ? '' : ' No roles become obsolete in this scenario.');
  el('policy-strip').innerHTML = [
    [paymentRange(active, 'employer'), 'Employer pay after tax'],
    [paymentRange(active, 'government'), 'Government top-up'],
    [range, 'Dividend paid to every voter'],
  ].map(([value, label]) => '<div class="policy-item"><strong>' + value + '</strong><span>' + label + '</span></div>').join('');
  el('policy-meaning').textContent = 'Payment ranges as a share of a worker’s starting wage. Employer pay and top-ups cover affected years; dividends cover all ten years. Capital income is additional. By year ten, US AI adoption reaches ' + pct(endpoint.adoption) + ' and productive capacity is ' + pct(endpoint.capacityFactor) + ' of its starting level.';
  const verdict = el('funding-verdict');
  verdict.hidden = active.feasible;
  verdict.classList.toggle('shortfall', !active.feasible);
  verdict.textContent = active.feasible ? '' : 'Some promised payments cannot be funded. Over ten years, employer pay falls short by ' + num(active.us.reduce((sum, y) => sum + y.employerFundingGap, 0)) + ' output-index units and public top-ups by ' + num(active.us.reduce((sum, y) => sum + y.safetyNetFundingGap, 0)) + '. The incomes and votes shown use actual payments.';
  renderDecisionVotes();
  renderSalaryOptions();
  renderChart(active.us);
  renderInternational();
  renderComparison();
  renderAccounting();
  renderVotingDetails();
  for (const axis of policyAxes) el<HTMLSelectElement>('manual-' + axis).value = String(p[axis]);
}

function renderDecisionVotes() {
  const current = snapshot!;
  el('decision-votes').innerHTML = policyAxes.map(axis => {
    const challenger = strongestChallenge(axisAlternatives(axis));
    return '<tr><th scope="row">' + axisLabels[axis] + '<br /><span class="small-copy">Selected: ' + axisValue(axis, current.selected.usPolicy) + '</span></th><td>' + (challenger.profile ? axisValue(axis, challenger.profile.usPolicy) : 'No alternative') + '</td><td>' + challenger.votes + ' / 1,000</td></tr>';
  }).join('');
  const maximum = Math.max(...policyAxes.map(axis => strongestChallenge(axisAlternatives(axis)).votes));
  el('decision-votes-note').textContent = maximum < VOTES_REQUIRED
    ? 'No change to one US decision gets the 501 votes needed to pass. Other decisions' + (current.mode === 'strategic' ? ' and the foreign policy' : '') + ' stay fixed.'
    : 'This outcome is unstable: a change to one US decision gets ' + maximum + ' votes. The displayed policy is a fallback, not an equilibrium.';
}

function renderVotingDetails() {
  const current = snapshot!;
  const packageVotes = strongestChallenge(current.alternatives).votes;
  el('selection-explanation').textContent = current.stableCount + ' stable ' + (current.mode === 'strategic' ? 'policy pairs' : 'policies') + ' on the tested menu. Ties keep the comparison policy when it qualifies; otherwise the solver uses its fixed policy order. A proposal changing several US decisions together can attract up to ' + packageVotes + ' votes. That is a different ballot from the separate decisions above.';
  if (current.selection === 'coordinate-agenda') {
    el('agenda-order').innerHTML = '<p>No separately stable domestic policy exists. A finite sequence of amendments is evaluated backward, with voters anticipating later ballots.</p><ol>' + current.agendaSteps.map(step => '<li>' + (step.axis ? axisLabels[step.axis as PolicyAxis] ?? 'Deployment' : 'Policy amendment') + ': ' + (step.value === undefined ? '' : pct(step.value) + '; ') + step.votesForChange + ' votes; ' + (step.accepted ? 'accepted' : 'rejected') + '.</li>').join('') + '</ol>';
  } else {
    el('agenda-order').textContent = current.mode === 'strategic'
      ? 'The foreign actor compares every own-policy package, including deployment. If no pair is stable, the fallback is a foreign best response with the smallest winning US coalition. The model does not solve a mixed-strategy equilibrium.'
      : 'The model tests layoffs or retention at 50%, 100% or 125% salary, then 0%, 50% or 100% for the government floor and each household tax. The US deployment target is fixed by the scenario.';
  }
}

function renderSalaryOptions() {
  const active = snapshot!.selected;
  const row = (axis: 'replacement' | 'safetyNet', value: number) => {
    const profile = active.usPolicy[axis] === value ? active : axisAlternatives(axis).find(p => p.usPolicy[axis] === value)!;
    return '<tr class="' + (profile.id === active.id ? 'selected' : '') + '"><th scope="row">' + axisValue(axis, profile.usPolicy) + '</th><td>' + paymentRange(profile, axis === 'replacement' ? 'employer' : 'government') + (profile.feasible ? '' : ' †') + '</td><td>' + (profile.id === active.id ? 'Selected' : votesFor(profile, active) + ' / 1,000') + '</td></tr>';
  };
  el('salary-options').innerHTML = [0, .5, 1, 1.25].map(value => row('replacement', value)).join('');
  el('safety-options').innerHTML = [0, .5, 1].map(value => row('safetyNet', value)).join('');
  el('salary-options-note').textContent = 'Actual employer pay after tax, relative to the starting wage. Other decisions stay fixed. †Some payments cannot be fully funded.';
  el('safety-options-note').textContent = 'Actual public top-ups relative to the starting wage. A higher floor uses revenue that would otherwise fund the universal dividend. Other decisions stay fixed.';
}

function renderInternational() {
  const current = snapshot!;
  const strategic = current.mode === 'strategic';
  el('international-result').hidden = !strategic;
  if (!strategic) return;
  const active = current.selected;
  const foreignEnd = active.foreign!.at(-1)!;
  const objective = current.foreignObjective;
  el('country-policies').innerHTML = '<div class="country-policy"><h4>Rest of the world</h4><p>' + policyDescription(active.foreignPolicy!) + '</p><p>Year ten: worker income ' + change(foreignEnd.workerIncomeIndex) + '; total output ' + change(foreignEnd.output) + ', relative to its own starting economy.</p></div>';
  el('equilibrium-explanation').textContent = (active.foreignFeasible === false ? 'Some promised foreign payments cannot be fully funded; the objective uses actual income. ' : '') + 'Foreign objective: ' + objectiveLabels[objective].toLowerCase() + '. The rest of the world acts as one coordinated decision-maker, with its own taxes, worker protections and AI deployment policy.';
  const gain = active.foreignBestResponseGain;
  el('deviation').classList.toggle('unstable', !current.stableCount || gain > EQUILIBRIUM_TOLERANCE);
  el('deviation').textContent = gain <= EQUILIBRIUM_TOLERANCE
    ? 'No other foreign policy package improves that objective while the US policy stays fixed.' + (current.stableCount ? ' The displayed pair also survives every separate US ballot.' : ' A US majority can still change a decision, so this pair is not stable.')
    : 'The foreign actor can improve its objective by changing policy. This pair is not stable.';
}

function renderComparison() {
  const current = snapshot!;
  const rows: [string, ProfileOutcome][] = [
    [current.mode === 'strategic' ? 'No AI in either region' : 'No AI', current.baseline],
    [current.stableCount ? 'Selected policy' : 'Unstable fallback', current.selected],
    ['Layoffs, no taxes or benefits', current.statusQuo],
    ['US worker-welfare benchmark', current.workerBenchmark],
  ];
  if (manual) rows.push(['Your policy', manual]);
  el('comparison-table').innerHTML = rows.map(([label, profile]) => {
    const end = last(profile);
    return '<tr class="' + (profile.id === current.selected.id ? 'selected' : '') + '"><th scope="row">' + label + '</th><td>' + num(end.workerIncomeIndex) + '</td><td>' + num(end.ownerIncomeIndex) + '</td><td>' + num(end.output) + '</td><td>' + signed(benefit(profile.usScore)) + '%</td></tr>';
  }).join('');
  el('score-help').textContent = 'Year-ten income and output indices start at 100. Ten-year benefit is the equivalent steady gain in US worker income under log utility, which accounts for low-income years. Except for the no-AI reference, these comparisons hold the selected foreign policy fixed; the benchmark is not a vote.';
}

function renderAccounting() {
  const current = snapshot!;
  const end = last(current.selected);
  const lines: [string, number][] = [
    ['Gross US production', end.output],
    ['Installation and adjustment costs', -end.investmentCost - end.adjustmentCost],
    ['Net international rent income', end.netRentFlow],
    ['Total household income available', end.consumption],
    ['Received by worker households', end.workerIncome],
    ['Received by owner households', end.ownerIncome],
    ['Employer retention pay, before tax', end.employerPay],
    ['Worker household tax collected', end.workerTaxRevenue],
    ['Owner household tax collected', end.ownerTaxRevenue],
    ['Public top-ups within worker income', end.publicSupport],
    ['Universal dividends to workers', end.workerDividend],
    ['Universal dividends to owners', end.ownerDividend],
  ];
  el('accounting-table').innerHTML = lines.map(([label, value]) => '<tr><th scope="row">' + label + '</th><td>' + num(value) + '</td></tr>').join('');
  el('ownership-note').textContent = 'Workers own ' + pct(current.inputs.workerOwnership) + ' of capital income. The budget balances to within ' + Math.abs(end.resourceResidual).toFixed(8) + ' units. US and foreign rent flows cancel after weighting by their baseline GDP.';
}

function renderMethod() {
  el('model-method').innerHTML = '<h4>Voting and policy selection</h4>' + VOTING_NOTES.map(note => '<p>' + note + '</p>').join('')
    + MODEL_NOTES.map(note => '<h4>' + note.title + '</h4><p>' + note.detail + '</p>' + (note.equation ? '<p class="equation">' + note.equation + '</p>' : '')).join('');
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
el<HTMLSelectElement>('foreign-objective').addEventListener('change', event => {
  foreignObjective = (event.target as HTMLSelectElement).value as Objective;
  el('foreign-objective-help').textContent = objectiveHelp[foreignObjective];
  scheduleSolve();
});
el<HTMLSelectElement>('rollout').addEventListener('change', event => {
  pace = Number((event.target as HTMLSelectElement).value);
  scheduleSolve();
});
el('reset').addEventListener('click', () => {
  inputs = { ...DEFAULT_INPUTS };
  mode = 'us-only'; foreignObjective = 'prosperity'; pace = 1;
  clearPreset(); syncInputs(); scheduleSolve();
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
    Object.assign(inputs, { capitalMobility: 1, investmentResponse: .7, foreignStrength: 1 });
  }
  clearPreset();
  button.setAttribute('aria-pressed', 'true');
  syncInputs(); scheduleSolve();
}));
el('apply-manual').addEventListener('click', () => {
  if (pending || !snapshot) return;
  const values = Object.fromEntries(policyAxes.map(axis => [axis, Number(el<HTMLSelectElement>('manual-' + axis).value)]));
  manual = snapshot.alternatives.find(({ usPolicy: policy }) => policyAxes.every(axis => policy[axis] === values[axis]))!;
  const end = last(manual);
  const votes = votesFor(manual, snapshot.selected);
  let text = 'Your policy: employer pay after tax ' + paymentRange(manual, 'employer') + '; government top-up ' + paymentRange(manual, 'government') + ' of the starting wage. Year-ten average worker income: ' + change(end.workerIncomeIndex) + '. ' + votes + ' of 1,000 US voters prefer this whole package to the selected outcome.';
  if (snapshot.mode === 'strategic') {
    text += ' The foreign policy is held fixed for this comparison; it may respond to your change.';
  }
  el('manual-result').textContent = text;
  renderComparison();
});
el('share').addEventListener('click', async () => {
  if (pending) return;
  try {
    await navigator.clipboard.writeText(scenarioURL().href);
    el('action-status').textContent = 'Scenario link copied, including the foreign objective.';
  } catch { el('action-status').textContent = 'Copy this page’s address to share the scenario.'; }
});
el('download').addEventListener('click', () => {
  if (pending || !snapshot) return;
  const payload = {
    model: 'pirates-worker-economy-v4', interpretation: 'Finite policy model with illustrative economic responses; not a forecast.',
    scenario: { inputs: snapshot.inputs, mode: snapshot.mode, foreignObjective: snapshot.foreignObjective, pace: snapshot.pace },
    selection: snapshot.selection, stableCount: snapshot.stableCount, selected: snapshot.selected,
    comparison: { noAI: snapshot.baseline, noTaxes: snapshot.statusQuo, workerBenchmark: snapshot.workerBenchmark, manual },
    agenda: snapshot.agendaSteps,
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
  if (snapshot) renderChart(snapshot.selected.us);
}).observe(el('income-chart'));

function renderChart(years: RegionYear[]) {
  const width = Math.max(320, Math.min(740, el('income-chart').clientWidth)), height = 290, left = 42, right = 20, top = 22, bottom = 36;
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
