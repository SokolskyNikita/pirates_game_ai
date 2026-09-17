import type { InputSpec, ModelInputs, ModelMode, Objective, ScenarioRequest } from '../api/types';
import { DEFAULT_INPUTS, INPUT_SPECS, STATIC_CHOICES } from './config';

export interface ScenarioState {
  inputs: ModelInputs;
  mode: ModelMode;
  foreignObjective: Objective;
  pauseUnavailable: boolean;
  statusQuoUnavailable: boolean;
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
    statusQuoUnavailable: false,
  };
}
/** Select an explicitly supported grid point; no interpolation of results. */
export function normalizeInputConstraints(inputs: ModelInputs): ModelInputs {
  const result = { ...inputs };
  for (const spec of INPUT_SPECS) {
    const choices = STATIC_CHOICES[spec.key];
    result[spec.key] = choices.reduce((best, value) =>
      Math.abs(value - inputs[spec.key]) < Math.abs(best - inputs[spec.key]) ? value : best, choices[0]!);
  }
  const allowed = STATIC_CHOICES.jobsAffected.filter(value => value >= Math.max(0, -result.jobChange));
  if (!allowed.includes(result.jobsAffected)) result.jobsAffected = allowed[0]!;
  return result;
}

export function inputSliderChoices(spec: InputSpec, inputs: ModelInputs): number[] {
  return STATIC_CHOICES[spec.key].filter(value => spec.key !== 'jobsAffected' || value >= Math.max(0, -inputs.jobChange));
}

export function scenarioRequest(state: ScenarioState, id: number): ScenarioRequest {
  return { id, ...state, statusQuoUnavailable: false, inputs: normalizeInputConstraints(state.inputs) };
}
