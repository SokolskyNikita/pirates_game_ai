/** Load exact saved Python results; no economic calculations run here. */
import manifestData from '../../generated/static-library.json';
import { STATIC_CHOICES, STATIC_VARIABLE_KEYS } from '../presentation/config';
import type { ScenarioRequest, ScenarioSnapshot } from './types';

const manifest = manifestData as { fingerprint: string; inline: boolean };
type Scenario = Pick<ScenarioRequest, 'inputs' | 'mode' | 'foreignObjective' | 'pauseUnavailable' | 'statusQuoUnavailable'>;
export interface SavedResult {
  schema: number; fingerprint: string; snapshot: ScenarioSnapshot;
}
export class CalculationError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'CalculationError';
  }
}
export function staticScenarioKey(request: Scenario): string {
  for (const key of Object.keys(STATIC_CHOICES) as (keyof typeof STATIC_CHOICES)[])
    if (!STATIC_CHOICES[key].includes(request.inputs[key]))
      throw new CalculationError('These assumptions are outside the saved scenario grid. Reset to supported choices.', 400);
  if (request.inputs.foreignAiGrowth !== request.inputs.usAiGrowth)
    throw new CalculationError('Both economies must use the same AI growth increment.', 400);
  if (request.inputs.jobsAffected < Math.max(0, -request.inputs.jobChange))
    throw new CalculationError('Affected jobs must cover the job reduction.', 400);
  return [request.mode, request.mode === 'strategic' ? request.foreignObjective : '-',
    Number(Boolean(request.pauseUnavailable)), Number(Boolean(request.statusQuoUnavailable)),
    ...STATIC_VARIABLE_KEYS.map(key => STATIC_CHOICES[key].indexOf(request.inputs[key]))].join('|');
}
let inline: Record<string, SavedResult> | undefined;
function load(request: Scenario, signal: AbortSignal): SavedResult {
  signal.throwIfAborted();
  const key = staticScenarioKey(request);
  inline ??= JSON.parse(document.getElementById('static-library')?.textContent || '{}');
  const saved = inline![key];
  if (!saved) throw new CalculationError('This scenario is missing from the embedded results.', 404);
  if (saved.schema !== 2 || saved.fingerprint !== manifest.fingerprint || staticScenarioKey(saved.snapshot) !== key)
    throw new Error('The saved result does not match this scenario or model version.');
  return saved;
}
export async function simulateScenario(request: ScenarioRequest, signal: AbortSignal) {
  return { id: request.id, snapshot: load(request, signal).snapshot, source: 'precomputed' as const };
}
