import { countVotes, VOTING_NOTES } from '../../lib/economy/pirates-voting';
import {
  DEFAULT_INPUTS, INPUT_SPECS, MODEL_NOTES, EQUILIBRIUM_TOLERANCE,
  normalizeInputs, POLICIES, evaluateProfile, CALIBRATION,
  type ModelInputs, type ModelMode, type Objective, type Policy, type ProfileOutcome, type RegionYear,
} from '../../lib/economy/pirates-model';
import { US_COHORTS, US_ELECTORATE } from '../../lib/economy/us-electorate';
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
const foreignKeys = new Set<string>(['capitalMobility', 'foreignStrength', 'tradeIntensity', 'foreignTradeIntensity', 'foreignMarketSize', 'foreignPopulationRatio']);
const visibleInputSpecs = INPUT_SPECS.filter(spec => spec.key !== 'foreignPopulationRatio');
const calibratedKeys = new Set<string>(['foreignMarketSize', 'tradeIntensity', 'foreignTradeIntensity']);
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
let pace = 1;
let snapshot: ScenarioSnapshot | undefined;
let manual: ProfileOutcome | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let computation: Worker | undefined;
let revision = 0;
let pending = true;

function formatInput(key: keyof ModelInputs, value: number) {
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
  const foreign = query.get('foreignObjective');
  foreignObjective = foreign === 'workers' || foreign === 'output' ? foreign : 'prosperity';
  const rollout = query.get('rollout');
  pace = ['0', '0.33', '0.67', '1'].includes(rollout ?? '') ? Number(rollout) : 1;
}

function scenarioURL() {
  const url = new URL(location.href);
  url.search = '';
  url.hash = 'simulator';
  url.searchParams.set('v', '6');
  url.searchParams.set('world', mode);
  if (mode === 'strategic') url.searchParams.set('foreignObjective', foreignObjective);
  url.searchParams.set('rollout', String(pace));
  // Include the numerical inputs so a shared scenario survives future default revisions.
  for (const spec of INPUT_SPECS) url.searchParams.set(spec.key, String(inputs[spec.key]));
  return url;
}

function buildInputs() {
  for (const spec of visibleInputSpecs) {
    const target = foreignKeys.has(spec.key) ? 'international-inputs' : structuralKeys.has(spec.key) ? 'structural-inputs' : 'domestic-inputs';
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
  el('electorate-description').textContent = 'Every adult US citizen has an equal vote. A change needs more than 50%; income never determines voting weight.';
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
    : mode === 'strategic' ? 'Calculating the outcome without a treaty, then checking treaty offers…' : 'Comparing policy choices…';
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

const replacementName = (r: number) => r === 0 ? 'Allow layoffs' : 'Retain at ' + pct(r) + ' of prior wages';
const dollars = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
const voteShare = (value: number) => value.toFixed(2) + '%';
const policyAxes = ['replacement', 'welfareScale', 'benefitFormula', 'laborTax', 'capitalTax'] as const;
type PolicyAxis = typeof policyAxes[number];
const axisLabels: Record<PolicyAxis, string> = { replacement: 'Employer retention', welfareScale: 'Government redistribution', benefitFormula: 'Who receives the benefits', laborTax: 'Tax on work and pension income', capitalTax: 'Tax on investment income' };
const formulaNames: Record<Policy['benefitFormula'], string> = { current: 'Keep the current recipient mix', flat: 'Equal payment to every adult', 'prior-income': 'Payments proportional to prior income' };
function changeFromReference(rate: number, reference: number) {
  const difference = (rate - reference) * 100;
  return Math.abs(difference) < 1e-7 ? 'unchanged from the 2025 reference' : Math.abs(difference).toFixed(1) + ' percentage points ' + (difference < 0 ? 'below' : 'above') + ' the 2025 reference';
}
function welfareName(scale: number) {
  return scale === 1 ? 'Keep the current total budget' : scale === 0 ? 'End the modeled benefit payments' : (scale < 1 ? 'Reduce' : 'Increase') + ' the total budget by ' + pct(Math.abs(scale - 1));
}
function axisValue(axis: PolicyAxis, policy: Policy) {
  if (axis === 'replacement') return replacementName(policy.replacement);
  if (axis === 'welfareScale') return welfareName(policy.welfareScale);
  if (axis === 'benefitFormula') return formulaNames[policy.benefitFormula];
  const reference = axis === 'laborTax' ? CALIBRATION.laborTaxRate : CALIBRATION.capitalTaxRate;
  return pct(policy[axis]) + ' benchmark (' + changeFromReference(policy[axis], reference) + ')';
}
function policyDescription(policy: Policy) {
  return replacementName(policy.replacement) + '; benefit budget target ' + pct(policy.welfareScale) + ' of the reference budget; ' + formulaNames[policy.benefitFormula].toLowerCase() + '; work/pension tax benchmark ' + pct(policy.laborTax) + ', investment tax ' + pct(policy.capitalTax) + '; ' + pct(policy.pace) + ' AI deployment target.';
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
function axisAlternatives(axis: PolicyAxis) {
  const current = snapshot!.selected.usPolicy;
  return snapshot!.alternatives.filter(({ usPolicy: candidate, usAdmissible }) => usAdmissible && candidate[axis] !== current[axis]
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

function activeProfile(): ProfileOutcome {
  const current = snapshot!;
  return current.treaty?.status === 'signed' ? current.treaty.proposal! : current.selected;
}
function treatySigned() { return snapshot?.treaty?.status === 'signed'; }

function render() {
  const current = snapshot!;
  const active = activeProfile();
  const p = active.usPolicy;
  const end = last(active);
  const stable = current.selection === 'verified-stable';
  el('result-label').textContent = treatySigned() ? 'Simulated outcome: treaty signed' : stable ? 'Simulated outcome: majority-stable policy' : 'No verified stable outcome found';
  el('solve-status').textContent = current.treaty && current.treaty.status !== 'not-evaluated' ? current.treaty.evaluatedOfferCount.toLocaleString() + ' treaty offers checked' : current.policyCount.toLocaleString() + ' US policy choices';
  renderTreaty();
  const baselineBenefits = end.baselineBenefits;
  const referenceIncome = US_COHORTS.reduce((sum, cohort) => sum + cohort.weight * cohort.disposableIncome, 0);
  const details: Record<PolicyAxis, string> = {
    replacement: p.replacement ? 'Employers fund the retained wages. This is a gross wage target; the modeled take-home payment is ' + paymentRange(active) + ' of prior wages after tax.' : 'Employers may dismiss workers whose roles become obsolete. Government benefits are shown below.',
    welfareScale: 'Reference: ' + dollars(baselineBenefits) + ' per adult per year, averaged across the population. Target: ' + dollars(end.benefitsRequired) + '. Actually funded in year ten: ' + dollars(end.benefitsPaid) + ' (' + pct(end.benefitsScalePaid) + ' of the reference). The same total budget does not preserve each person’s payment.' + (p.welfareScale === 2 ? ' This is the highest budget tested.' : ''),
    benefitFormula: p.benefitFormula === 'current' ? 'Keep the survey’s relative allocation of cash benefits and consumption support. Recipients’ shares stay fixed as jobs change; this does not simulate future eligibility under every US program.' : p.benefitFormula === 'flat' ? 'Divide the funded budget equally among all adults, including workers, retirees and investors. This replaces the modeled Social Security and assistance payment pattern.' : 'Divide the same budget in proportion to each adult’s pre-AI disposable household income. Higher prior income means a larger payment. This uses prior-year income, not lifetime earnings.',
    laborTax: 'Selected benchmark: ' + pct(p.laborTax) + ', ' + changeFromReference(p.laborTax, CALIBRATION.laborTaxRate) + ' of ' + pct(CALIBRATION.laborTaxRate) + '. Actual year-ten average: ' + pct(end.effectiveLaborTax) + '. Covers earnings, pensions and other non-investment income; it preserves income differences in the reference tax profile.',
    capitalTax: 'Selected benchmark: ' + pct(p.capitalTax) + ', ' + changeFromReference(p.capitalTax, CALIBRATION.capitalTaxRate) + ' of ' + pct(CALIBRATION.capitalTaxRate) + '. Actual year-ten average: ' + pct(end.effectiveCapitalTax) + '. Applies to investment income even when its recipient also works.',
  };
  el('policy-decisions').innerHTML = policyAxes.map((axis, index) => {
    const challenge = strongestChallenge(axisAlternatives(axis));
    let headline = axisValue(axis, p);
    if (axis === 'laborTax' || axis === 'capitalTax') {
      const reference = axis === 'laborTax' ? CALIBRATION.laborTaxRate : CALIBRATION.capitalTaxRate;
      headline = (Math.abs(p[axis] - reference) < 1e-7 ? 'Keep the tax benchmark at ' : (p[axis] < reference ? 'Reduce' : 'Increase') + ' the tax benchmark to ') + pct(p[axis]) + '.';
    }
    const ballot = 'Strongest eligible alternative: ' + (challenge.profile ? axisValue(axis, challenge.profile.usPolicy) + '. ' + voteShare(challenge.votes) + ' prefer that change' : 'none') + (challenge.votes > 50 + EQUILIBRIUM_TOLERANCE ? ' — enough to pass.' : '; a change needs more than 50%.');
    const kind = axis === 'replacement' ? 'employment-decision' : axis.endsWith('Tax') ? 'tax-decision' : 'government-decision';
    return '<section class="policy-decision ' + kind + '"><p class="eyebrow">' + (index + 1) + ' · ' + axisLabels[axis] + '</p><div class="decision-answer"><h2>' + headline + '</h2><p>' + details[axis] + '</p>' + (treatySigned() ? '' : '<p class="decision-ballot">' + ballot + '</p>') + '</div></section>';
  }).join('');
  el('decision-votes-note').textContent = treatySigned()
    ? voteShare(current.treaty!.support) + ' of US citizens prefer this entire agreement to the outcome without a treaty. These are the US terms of the binding ten-year package. US deployment target: ' + pct(p.pace) + '; without the treaty: ' + pct(current.pace) + '.'
    : stable
    ? 'No change to any one of these five decisions wins more than half the weighted vote while the others' + (current.mode === 'strategic' ? ' and the foreign policy' : '') + ' stay fixed. This does not mean a majority ranks the whole package first.'
    : 'This is an unverified candidate. The search did not settle on a policy that survives every separate ballot and foreign response; it has not proved that no equilibrium exists.';
  el('policy-strip').innerHTML = [
    [paymentRange(active), 'Employer pay after tax / prior wages'],
    [pct(end.benefitsScalePaid), 'Funded benefits / current total budget'],
    [change(100 * end.consumption / referenceIncome), 'Average adult take-home income in year ten'],
  ].map(([value, label]) => '<div class="policy-item"><strong>' + value + '</strong><span>' + label + '</span></div>').join('');
  el('manual-help').textContent = treatySigned() ? 'Explore another US policy while holding the treaty’s deployment target and foreign terms fixed. This is a counterfactual comparison; it does not amend the binding agreement.' : 'Choose job retention, the benefit budget, the benefit formula and both tax rates. US deployment and foreign policy stay fixed.';
  el('policy-meaning').textContent = 'Benefits include modeled cash payments and consumption support. Health insurance is not counted as cash. Year-ten US AI adoption: ' + pct(end.adoption) + '; productive capacity: ' + pct(end.capacityFactor) + ' of the starting level.';
  const verdict = el('funding-verdict');
  const shortfall = active.us.some(point => point.governmentFundingGap > 1e-6 || point.welfareFundingGap > 1e-6 || point.employerFundingGap > 1e-6);
  verdict.hidden = !shortfall;
  verdict.classList.toggle('shortfall', shortfall);
  verdict.textContent = shortfall ? 'Some employer or government payments cannot be fully funded. The income figures and votes use actual payments, not the targets. Expand “Follow the money” for the shortfall.' : '';
  renderDecisionVotes(); renderChart(active.us); renderInternational(); renderComparison(); renderAccounting(); renderVotingDetails();
  for (const axis of policyAxes) el<HTMLSelectElement>('manual-' + axis).value = String(p[axis]);
}

function renderTreaty() {
  const treaty = snapshot!.treaty;
  el('treaty-result').hidden = !treaty;
  if (!treaty) return;
  const signed = treaty.status === 'signed';
  el('treaty-verdict').textContent = signed ? 'Both sides agree. The treaty is signed.' : treaty.status === 'no-agreement' ? 'No treaty in the tested menu.' : 'Treaty decision not verified.';
  el('treaty-vote').textContent = signed
    ? voteShare(treaty.support) + ' of US citizens vote for the agreement. The foreign actor also improves its chosen objective. The policies and income chart below include the treaty.'
    : treaty.status === 'no-agreement'
    ? 'No tested offer both wins more than 50% of US votes and improves the foreign objective. Both sides keep the policies below.'
    : 'The solver did not verify the outcome without a treaty, so it has no verified fallback against which to judge agreement.';
  el('treaty-menu').textContent = treaty.menuDescription + ' Checked ' + treaty.evaluatedOfferCount.toLocaleString() + ' offers; ' + treaty.acceptableOfferCount.toLocaleString() + ' satisfy both acceptance rules.' + (signed ? ' The selected offer maximizes the foreign objective within this menu.' : '') + ' Other bargaining rules or offers can change the outcome.';
  el('treaty-score').textContent = signed
    ? 'Foreign objective score: ' + treaty.noTreaty.foreignScore!.toFixed(5) + ' without an agreement → ' + treaty.proposal!.foreignScore!.toFixed(5) + ' with it. ' + (snapshot!.foreignObjective === 'prosperity' ? 'This is average discounted log-income utility.' : 'This is the discounted average change from starting ' + (snapshot!.foreignObjective === 'workers' ? 'worker-household income' : 'output') + ', expressed as a fraction.') + ' Equal foreign scores favor the offer with more US support, then the first in the fixed menu.'
    : '';
}

function renderDecisionVotes() {
  el('decision-votes-heading').textContent = treatySigned() ? 'Separate US ballots without a treaty' : 'Would US voters change a decision?';
  el('decision-votes-help').textContent = treatySigned() ? 'These votes describe the fallback without an agreement. The treaty itself is accepted as one binding package.' : 'Each row changes one of the five decisions. The others stay fixed. More than 50% of the electorate must prefer the change.';
  el('decision-votes').innerHTML = policyAxes.map(axis => {
    const challenger = strongestChallenge(axisAlternatives(axis));
    return '<tr><th scope="row">' + axisLabels[axis] + '<br /><span class="small-copy">Selected: ' + axisValue(axis, snapshot!.selected.usPolicy) + '</span></th><td>' + (challenger.profile ? axisValue(axis, challenger.profile.usPolicy) : 'No alternative') + '</td><td>' + voteShare(challenger.votes) + '</td></tr>';
  }).join('');
}
function renderVotingDetails() {
  const current = snapshot!;
  el('selection-explanation').textContent = (treatySigned() ? 'For the outcome without a treaty, the solver searches' : 'The solver searches') + ' from several starting policies, then verifies the selected candidate against every available change to one US decision' + (current.mode === 'strategic' ? ' and every foreign policy package, including deployment.' : '.') + ' Votes use Census population weights and personal household-income utility. Income is never a voting weight. Indifference retains the existing choice.';
  el('agenda-order').textContent = (treatySigned() ? 'The treaty uses a separate whole-package vote against that fallback and binds both sides. ' : '') + 'More than half must strictly prefer a change. Search order can choose between stable outcomes; the search does not prove uniqueness or check every international pair. A package that changes several US decisions together may still win. The model does not solve repeated elections or mixed strategies.';
}
function renderInternational() {
  const current = snapshot!;
  const strategic = current.mode === 'strategic';
  el('international-result').hidden = !strategic;
  if (!strategic) return;
  const active = activeProfile();
  const end = active.foreign!.at(-1)!;
  el('country-policies').innerHTML = '<div class="country-policy"><h4>Rest of the world</h4><p>' + policyDescription(active.foreignPolicy!) + '</p><p>Year ten: income in work-primary households ' + change(end.workerIncomeIndex) + '; output index ' + change(end.output) + ', relative to its own starting economy. Benefits actually funded: ' + pct(end.benefitsScalePaid) + ' of its reference budget.</p></div>';
  el('equilibrium-explanation').textContent = 'Foreign objective: ' + objectiveLabels[current.foreignObjective].toLowerCase() + '. The foreign actor uses the same household distribution and behavioral rules as the US as a modeling assumption, with separate economic size, trade exposure and frontier capability.';
  const gain = current.selected.foreignBestResponseGain;
  el('deviation').classList.toggle('unstable', current.selection !== 'verified-stable');
  el('international-heading').textContent = treatySigned() ? 'The foreign treaty terms' : 'The foreign response';
  el('deviation').textContent = treatySigned()
    ? 'The foreign actor chooses this agreement over the outcome without a treaty. It is its highest-scoring ratifiable offer in the tested menu; compliance with the signed terms is assumed.'
    : gain <= EQUILIBRIUM_TOLERANCE
    ? 'No other policy in the full foreign menu improves its objective while the US policy stays fixed.'
    : 'The foreign actor still has a profitable policy change. This candidate is not an equilibrium.';
}
function renderComparison() {
  const current = snapshot!;
  const rows: [string, ProfileOutcome][] = [
    ['2025 reference; no new AI', current.baseline],
    [current.selection === 'verified-stable' ? (current.mode === 'strategic' ? 'Without a treaty' : 'Selected stable policy') : 'Unverified candidate', current.selected],
    ['Current taxes and benefit mix', current.statusQuo],
  ];
  if (treatySigned()) rows.splice(2, 0, ['Signed treaty', activeProfile()]);
  if (manual) rows.push(['Your policy', manual]);
  const referenceIncome = US_COHORTS.reduce((sum, cohort) => sum + cohort.weight * cohort.disposableIncome, 0);
  el('comparison-table').innerHTML = rows.map(([label, profile]) => {
    const end = last(profile);
    return '<tr class="' + (profile.id === activeProfile().id ? 'selected' : '') + '"><th scope="row">' + label + '</th><td>' + num(100 * end.consumption / referenceIncome) + '</td><td>' + num(end.workerIncomeIndex) + '</td><td>' + num(end.ownerIncomeIndex) + '</td><td>' + num(end.output) + '</td></tr>';
  }).join('');
  el('score-help').textContent = 'Year-ten indices: each group’s 2025 reference is 100. Household source groups stay fixed. ' + (current.mode === 'strategic' ? 'The treaty can change both sides’ policies and deployment. The current-tax comparison holds US deployment and foreign policy at their values without a treaty. Your policy holds the displayed outcome’s foreign policy and US deployment fixed. ' : 'Comparisons hold US deployment fixed, except for the no-AI reference. ') + 'Output is a modeled resource index, not a GDP forecast.';
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
  el('model-method').innerHTML = '<h4>Voting and policy selection</h4>' + VOTING_NOTES.map(note => '<p>' + note + '</p>').join('')
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
  if (button.dataset.preset === 'shared') Object.assign(inputs, { productivityGain: .6, displacement: .3, reemployment: .5, investmentResponse: .1 });
  if (button.dataset.preset === 'displacement') Object.assign(inputs, { productivityGain: .25, displacement: .7, reemployment: .05 });
  if (button.dataset.preset === 'tax-response') {
    mode = 'us-only'; pace = 1;
    Object.assign(inputs, { investmentResponse: 1, productivityGain: 1, displacement: .35 });
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
  const policy = POLICIES.find(candidate => candidate.pace === activeProfile().usPolicy.pace && policyAxes.every(axis => String(candidate[axis]) === values[axis]));
  if (!policy) return;
  manual = evaluateProfile(snapshot.inputs, policy, activeProfile().foreignPolicy, snapshot.mode, 'workers', snapshot.foreignObjective);
  const votes = votesFor(manual, activeProfile());
  el('manual-result').textContent = (paymentRange(manual) === 'not applicable' ? 'No roles are displaced in this scenario. ' : 'Employer pay after tax: ' + paymentRange(manual) + ' of prior wages. ') + 'Funded government benefits: ' + pct(last(manual).benefitsScalePaid) + ' of the reference budget. ' + voteShare(votes) + ' of adult citizens prefer this entire package to the selected outcome.' + (manual.usAdmissible ? '' : ' This policy cannot fund required public spending and is excluded from the vote. This preference comparison does not make it an eligible alternative.') + (treatySigned() ? ' The treaty remains binding; this comparison cannot change its terms.' : snapshot.mode === 'strategic' ? ' The foreign policy is held fixed here; it may respond to your change.' : '');
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
    model: 'pirates-treaty-ratification-v6', interpretation: 'Finite policy model with illustrative economic responses; not a forecast.',
    scenario: { inputs: snapshot.inputs, mode: snapshot.mode, foreignObjective: snapshot.foreignObjective, pace: snapshot.pace },
    selection: treatySigned() ? 'signed-treaty' : snapshot.selection, stableCount: snapshot.stableCount, selected: activeProfile(),
    noTreaty: snapshot.selected, treaty: snapshot.treaty,
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
  const summary = `Year ten: household income when work is lost ${end.unemployment > 0 ? num(end.displacedIncomeIndex) : "no affected roles"}, household income when work continues ${end.unemployment < 1 - 1e-9 ? num(end.employedIncomeIndex) : "no productive roles"}, average adult income ${num(end.allIncomeIndex)}. Pre-AI income equals 100.`;
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
    ['worker', 'Households losing work', end.displacedIncomeIndex],
    ['owner', 'Households keeping work', end.employedIncomeIndex],
    ['output', 'All adult citizens', end.allIncomeIndex],
  ].map(([kind, label, value]) => `<div class="endpoint ${kind}"><strong>${(kind === 'worker' && end.unemployment < 1e-9 || kind === 'owner' && end.unemployment > 1 - 1e-9) ? 'N/A' : change(Number(value))}</strong>${label}<br />in year ten</div>`).join('');
  el('year-table').innerHTML = years.map(point => `<tr><th scope="row">${point.year === 0 ? 'Today' : `Year ${point.year}`}</th><td>${point.unemployment > 1e-9 ? num(point.displacedIncomeIndex) : '—'}</td><td>${point.unemployment < 1 - 1e-9 ? num(point.employedIncomeIndex) : '—'}</td><td>${num(point.allIncomeIndex)}</td></tr>`).join('');
}
