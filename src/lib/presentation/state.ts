import type { ModelInputs, ModelMode, Objective, ScenarioRequest } from '../api/types';
import { DEFAULT_INPUTS, INPUT_SPECS } from './config';

export interface ScenarioState {
  inputs: ModelInputs;
  mode: ModelMode;
  foreignObjective: Objective;
  pauseUnavailable: boolean;
}
export const objectiveLabels: Record<Objective, string> = {
  workers: 'Workers’ incomes',
  prosperity: 'Overall prosperity',
  output: 'Total economic output',
};
export const objectiveHelp: Record<Objective, string> = {
  workers:
    'Maximize average after-tax income in households whose main source is work, over ten years. Includes benefits and investment income, adjusted for consumer prices.',
  prosperity:
    'Maximize average income utility across all adults, including retirees and benefit recipients. Income is adjusted for consumer prices. Log utility gives more weight to losses when income is low.',
  output:
    'Maximize its total production over ten years, before installation and adjustment costs. This objective does not value cheaper imports or how income is divided.',
};
export function defaultState(): ScenarioState {
  return {
    inputs: { ...DEFAULT_INPUTS },
    mode: 'us-only',
    foreignObjective: 'prosperity',
    pauseUnavailable: false,
  };
}
/** Parse and validate form state only. Economic normalization happens in Python. */
export function readScenarioURL(search: string): ScenarioState {
  const query = new URLSearchParams(search);
  const state = defaultState();
  for (const spec of INPUT_SPECS) {
    const raw = query.get(spec.key);
    if (raw !== null && raw.trim() && Number.isFinite(Number(raw))) {
      state.inputs[spec.key] = Math.max(spec.min, Math.min(spec.max, Number(raw)));
    }
  }
  state.mode = query.get('world') === 'strategic' ? 'strategic' : 'us-only';
  state.pauseUnavailable = query.get('pauseUnavailable') === '1';
  const foreign = query.get('foreignObjective');
  state.foreignObjective = foreign === 'workers' || foreign === 'output' ? foreign : 'prosperity';
  return state;
}
export function scenarioURL(state: ScenarioState, href = location.href): URL {
  const url = new URL(href);
  url.search = '';
  url.hash = 'simulator';
  url.searchParams.set('v', '12');
  url.searchParams.set('world', state.mode);
  url.searchParams.set('pauseUnavailable', state.pauseUnavailable ? '1' : '0');
  if (state.mode === 'strategic') url.searchParams.set('foreignObjective', state.foreignObjective);
  for (const spec of INPUT_SPECS) url.searchParams.set(spec.key, String(state.inputs[spec.key]));
  return url;
}
export function scenarioRequest(state: ScenarioState, id: number): ScenarioRequest {
  return { id, ...state, inputs: { ...state.inputs } };
}
