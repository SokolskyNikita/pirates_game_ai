/** Presentation coordinator: collect inputs, request Python results, render them. */
import type { ProfileOutcome, ScenarioSnapshot } from '../../lib/api/types';
import { CalculationError, comparePolicy, simulateScenario } from '../../lib/api/calculator';
import { US_ELECTORATE } from '../../lib/presentation/config';
import { ScenarioControls } from '../../lib/presentation/controls';
import { el } from '../../lib/presentation/dom';
import { renderChart } from '../../lib/presentation/charts';
import { renderMethod, renderPopulation } from '../../lib/presentation/population';
import { ResultsView } from '../../lib/presentation/results';
import { readScenarioURL, scenarioRequest, scenarioURL } from '../../lib/presentation/state';

const state = readScenarioURL(location.search);
const view = new ResultsView();
let snapshot: ScenarioSnapshot | undefined;
let manual: ProfileOutcome | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let calculation: AbortController | undefined;
let comparison: AbortController | undefined;
let revision = 0;
let comparisonRevision = 0;
let pending = true;
const controls = new ScenarioControls(state, scheduleSolve);
renderPopulation();
renderMethod();

function setBusy(busy: boolean) {
  pending = busy;
  el('computation-message').classList.remove('error');
  el('results').setAttribute('aria-busy', String(busy));
  el('results').classList.toggle('is-stale', busy && Boolean(snapshot));
  for (const id of ['apply-manual', 'download', 'share'])
    el<HTMLButtonElement>(id).disabled = busy || !snapshot;
}

function failCalculation(error: unknown, displayFailure = false) {
  setBusy(false);
  pending = true;
  el('computation-message').classList.add('error');
  if (error instanceof CalculationError && error.status === 422) {
    snapshot = undefined;
    manual = undefined;
    el('results').hidden = true;
    el('computation-message').textContent = error.message;
    for (const id of ['apply-manual', 'download', 'share']) el<HTMLButtonElement>(id).disabled = true;
    return;
  }
  el('results').classList.add('is-stale');
  el('solve-status').textContent = 'Calculation unavailable';
  el('computation-message').textContent = displayFailure
    ? 'The result could not be displayed completely. Change an input or Reset to try again; the figures below may be incomplete.'
    : snapshot
      ? 'The calculation service could not finish. The result below uses the previous assumptions. Change an input or Reset to try again.'
      : 'The calculation service is unavailable. Check your connection, then reload the page or Reset to try again.';
  for (const id of ['apply-manual', 'download', 'share']) el<HTMLButtonElement>(id).disabled = true;
  console.error(error);
}

function scheduleSolve() {
  const id = ++revision;
  if (timer) clearTimeout(timer);
  calculation?.abort();
  comparison?.abort();
  comparisonRevision++;
  setBusy(true);
  el('solve-status').textContent = 'Calculating…';
  el('computation-message').textContent = snapshot
    ? 'Recalculating. The previous result stays visible until the new one is ready.'
    : state.mode === 'strategic'
      ? 'Comparing funded packages and checking both sides’ choices…'
      : 'Comparing fully funded packages and counting one vote per citizen…';
  timer = setTimeout(() => run(id), 350);
}

async function run(id: number) {
  const controller = new AbortController();
  calculation = controller;
  try {
    const response = await simulateScenario(scenarioRequest(state, id), controller.signal);
    if (id !== revision || controller.signal.aborted) return;
    snapshot = response.snapshot;
    manual = undefined;
    setBusy(false);
    el('computation-message').textContent = '';
    el('manual-result').textContent = '';
    el('action-status').textContent = '';
    try {
      el('results').hidden = false;
      view.show(snapshot);
      el('solve-status').title =
        response.source === 'precomputed'
          ? 'Precomputed for these exact assumptions.'
          : 'Calculated by the Python model for these assumptions.';
      const url = scenarioURL(state);
      url.hash = location.hash;
      history.replaceState(null, '', url);
    } catch (error) {
      failCalculation(error, true);
    }
  } catch (error) {
    if (id !== revision || controller.signal.aborted) return;
    failCalculation(error);
  } finally {
    if (calculation === controller) calculation = undefined;
  }
}

el('apply-manual').addEventListener('click', async () => {
  if (pending || !snapshot) return;
  const policyId = controls.selectedManualPolicyId();
  if (!policyId) return;
  comparison?.abort();
  const controller = new AbortController();
  comparison = controller;
  const scenarioRevision = revision;
  const id = ++comparisonRevision;
  const current = snapshot;
  el<HTMLButtonElement>('apply-manual').disabled = true;
  el('manual-result').textContent = 'Comparing this package with the selected outcome…';
  try {
    const response = await comparePolicy(
      {
        scenario: {
          inputs: current.inputs,
          mode: current.mode,
          foreignObjective: current.foreignObjective,
          pauseUnavailable: current.pauseUnavailable,
          statusQuoUnavailable: current.statusQuoUnavailable,
        },
        policyId,
        selectedPolicyId: current.selected.usPolicy.id,
        foreignPolicyId: current.selected.foreignPolicy?.id,
      },
      controller.signal,
    );
    if (scenarioRevision !== revision || id !== comparisonRevision || controller.signal.aborted) return;
    manual = response.profile;
    view.showComparison(manual, response.voteShare);
  } catch (error) {
    if (scenarioRevision !== revision || id !== comparisonRevision || controller.signal.aborted) return;
    el('manual-result').textContent = 'The comparison could not finish. Check your connection and try again.';
    console.error(error);
  } finally {
    if (comparison === controller) comparison = undefined;
    if (scenarioRevision === revision && id === comparisonRevision)
      el<HTMLButtonElement>('apply-manual').disabled = pending;
  }
});

el('share').addEventListener('click', async () => {
  if (pending) return;
  try {
    await navigator.clipboard.writeText(scenarioURL(state).href);
    el('action-status').textContent = 'Scenario link copied, including AI pause availability and the voting rule.';
  } catch {
    el('action-status').textContent = 'Copy this page’s address to share the scenario.';
  }
});
el('download').addEventListener('click', () => {
  if (pending || !snapshot) return;
  const payload = {
    model: 'pirates-single-ballot-v13',
    interpretation: 'Finite policy model with illustrative economic responses; not a forecast.',
    scenario: {
      inputs: snapshot.inputs,
      mode: snapshot.mode,
      foreignObjective: snapshot.foreignObjective,
      pauseUnavailable: snapshot.pauseUnavailable,
      statusQuoUnavailable: snapshot.statusQuoUnavailable,
    },
    selection: snapshot.selection,
    selected: snapshot.selected,
    ballot: snapshot.ballot,
    search: snapshot.search,
    comparison: { noAI: snapshot.baseline, currentPolicy: snapshot.statusQuo, manual },
    electorate: US_ELECTORATE,
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'ai-pirates-game-scenario.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  el('action-status').textContent = 'Scenario and annual results downloaded.';
});
window.addEventListener('popstate', () => {
  controls.replaceState(readScenarioURL(location.search));
  scheduleSolve();
});

let chartWidth = 0;
let chartFrame = 0;
new ResizeObserver((entries) => {
  const width = entries[0]?.contentRect.width ?? 0;
  if (Math.abs(width - chartWidth) < 1) return;
  chartWidth = width;
  cancelAnimationFrame(chartFrame);
  chartFrame = requestAnimationFrame(() => {
    if (snapshot) renderChart(snapshot.selected.us);
  });
}).observe(el('income-chart'));
scheduleSolve();
