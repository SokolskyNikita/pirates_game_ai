import type { InputSpec, ModelInputs, ModelMode, Objective, ScenarioRequest } from '../api/types';
import { DEFAULT_INPUTS, GROWTH_BASELINE, INPUT_SPECS } from './config';

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
/** Enforce the input constraint; the Python model independently validates it. */
export function normalizeInputConstraints(inputs: ModelInputs): ModelInputs {
  return { ...inputs, jobsAffected: Math.max(inputs.jobsAffected, Math.max(0, -inputs.jobChange)) };
}

/** Discrete slider stops, retaining exact values from shared links and metadata. */
export function inputSliderChoices(spec: InputSpec, inputs: ModelInputs): number[] {
  const minimum = spec.key === 'jobsAffected' ? Math.max(spec.min, -inputs.jobChange) : spec.min;
  const values = [minimum, spec.max, DEFAULT_INPUTS[spec.key], inputs[spec.key]];
  for (let value = Math.ceil(minimum / spec.step) * spec.step; value <= spec.max + 1e-9; value += spec.step)
    values.push(Number(value.toFixed(8)));
  return [...new Set(values)]
    .filter((value) => value >= minimum && value <= spec.max)
    .sort((a, b) => a - b);
}

/** Parse and migrate form state. Economic calculations happen in Python. */
export function readScenarioURL(search: string): ScenarioState {
  const query = new URLSearchParams(search);
  const state = defaultState();
  for (const spec of INPUT_SPECS) {
    const raw = query.get(spec.key);
    if (raw !== null && raw.trim() && Number.isFinite(Number(raw))) {
      state.inputs[spec.key] = Math.max(spec.min, Math.min(spec.max, Number(raw)));
    }
  }
  const legacyNumber = (key: string): number | undefined => {
    const raw = query.get(key);
    return raw !== null && raw.trim() && Number.isFinite(Number(raw)) ? Number(raw) : undefined;
  };
  const displacement = legacyNumber('displacement');
  if (displacement !== undefined) {
    const affected = Math.max(0, Math.min(1, displacement));
    if (!query.has('jobsAffected')) state.inputs.jobsAffected = affected;
    if (!query.has('jobChange')) state.inputs.jobChange = -affected;
  }
  for (const [key, legacyKey, baseline] of [
    ['usAiGrowth', 'usGdpGrowth', GROWTH_BASELINE.us],
    ['foreignAiGrowth', 'foreignGdpGrowth', GROWTH_BASELINE.foreign],
  ] as const) {
    const legacy = legacyNumber(legacyKey);
    if (!query.has(key) && legacy !== undefined) {
      const spec = INPUT_SPECS.find((input) => input.key === key)!;
      state.inputs[key] = Math.max(
        spec.min,
        Math.min(spec.max, Number((legacy - baseline).toPrecision(12))),
      );
    }
  }
  // A previous success rate is not a job-search rate: legacy reemployment is intentionally ignored.
  state.inputs = normalizeInputConstraints(state.inputs);
  state.mode = query.get('world') === 'strategic' ? 'strategic' : 'us-only';
  state.pauseUnavailable = query.get('pauseUnavailable') === '1';
  state.statusQuoUnavailable = query.get('statusQuoUnavailable') === '1';
  const foreign = query.get('foreignObjective');
  state.foreignObjective = foreign === 'workers' || foreign === 'output' ? foreign : 'prosperity';
  return state;
}
export function scenarioURL(state: ScenarioState, href = location.href): URL {
  const url = new URL(href);
  url.search = '';
  url.hash = 'simulator';
  url.searchParams.set('v', '14');
  url.searchParams.set('world', state.mode);
  url.searchParams.set('pauseUnavailable', state.pauseUnavailable ? '1' : '0');
  url.searchParams.set('statusQuoUnavailable', state.statusQuoUnavailable ? '1' : '0');
  if (state.mode === 'strategic') url.searchParams.set('foreignObjective', state.foreignObjective);
  const inputs = normalizeInputConstraints(state.inputs);
  for (const spec of INPUT_SPECS) url.searchParams.set(spec.key, String(inputs[spec.key]));
  return url;
}
export function scenarioRequest(state: ScenarioState, id: number): ScenarioRequest {
  return { id, ...state, inputs: normalizeInputConstraints(state.inputs) };
}
