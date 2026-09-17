/** Presentation coordinator: collect inputs, request Python results, render them. */
import type { ScenarioSnapshot } from '../../lib/api/types';
import { CalculationError, simulateScenario } from '../../lib/api/calculator';
import { US_ELECTORATE } from '../../lib/presentation/config';
import { ScenarioControls } from '../../lib/presentation/controls';
import { el } from '../../lib/presentation/dom';
import { renderChart } from '../../lib/presentation/charts';
import { renderMethod, renderPopulation } from '../../lib/presentation/population';
import { ResultsView } from '../../lib/presentation/results';
import { defaultState, scenarioRequest } from '../../lib/presentation/state';

const state = defaultState();
const view = new ResultsView();
let snapshot: ScenarioSnapshot | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let calculation: AbortController | undefined;
let revision = 0;
let pending = true;
new ScenarioControls(state, scheduleSolve);
renderPopulation();
renderMethod();

function setBusy(busy: boolean) {
  pending = busy;
  el('computation-message').classList.remove('error');
  el('results').setAttribute('aria-busy', String(busy));
  el('results').classList.toggle('is-stale', busy && Boolean(snapshot));
  el<HTMLButtonElement>('download').disabled = busy || !snapshot;
}

function failCalculation(error: unknown, displayFailure = false) {
  setBusy(false);
  pending = true;
  el('computation-message').classList.add('error');
  if (error instanceof CalculationError && error.status === 422) {
    snapshot = undefined;
    el('results').hidden = true;
    el('computation-message').textContent = error.message;
    el<HTMLButtonElement>('download').disabled = true;
    return;
  }
  el('results').classList.add('is-stale');
  el('solve-status').textContent = 'Calculation unavailable';
  el('computation-message').textContent = displayFailure
    ? 'The result could not be displayed completely. Change an input or Reset to try again; the figures below may be incomplete.'
    : snapshot
      ? 'The saved result could not be loaded. The result below uses the previous assumptions. Change an input or Reset to try again.'
      : 'The saved result is unavailable. Check your connection, then reload the page or Reset to try again.';
  el<HTMLButtonElement>('download').disabled = true;
  console.error(error);
}

function scheduleSolve() {
  const id = ++revision;
  if (timer) clearTimeout(timer);
  calculation?.abort();
  setBusy(true);
  el('solve-status').textContent = 'Loading…';
  el('computation-message').textContent = 'Loading the saved result for these exact assumptions…';
  timer = setTimeout(() => run(id), 100);

}

async function run(id: number) {
  const controller = new AbortController();
  calculation = controller;
  try {
    const response = await simulateScenario(scenarioRequest(state, id), controller.signal);
    if (id !== revision || controller.signal.aborted) return;
    if (!response.snapshot) throw new Error('Missing saved scenario');
    snapshot = response.snapshot;
    setBusy(false);
    el('computation-message').textContent = '';
    el('action-status').textContent = '';
    try {
      el('results').hidden = false;
      view.show(snapshot);
      el('solve-status').title =
        response.source === 'precomputed'
          ? 'Precomputed for these exact assumptions.'
          : 'Calculated by the Python model for these assumptions.';
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

el('download').addEventListener('click', () => {
  if (pending || !snapshot) return;
  const payload = {
    model: 'pirates-ai-profit-tax-v18',
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
