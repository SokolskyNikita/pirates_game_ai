import index from './precomputed-index.json';
import { normalizeInputs } from './pirates-model';
import type { ScenarioRequest, ScenarioSnapshot } from './simulation';

export const PRECOMPUTED_SCHEMA_VERSION = 1;
/** The legacy rollout setting is deliberately absent: all three paces are on the ballot. */
export function scenarioKey(request: Pick<ScenarioRequest, 'inputs' | 'mode' | 'foreignObjective'>): string {
  const inputs = normalizeInputs(request.inputs);
  return JSON.stringify([request.mode, request.mode === 'us-only' ? 'workers' : request.foreignObjective,
    Object.keys(inputs).sort().map(key => [key, inputs[key as keyof typeof inputs]])]);
}
interface StoredScenario { schemaVersion: number; fingerprint: string; key: string; snapshot: ScenarioSnapshot }
/** Exact matches only. Missing or stale data falls back to a fresh worker calculation. */
export async function loadPrecomputedScenario(request: ScenarioRequest, signal?: AbortSignal): Promise<ScenarioSnapshot | null> {
  const key = scenarioKey(request);
  const path = (index.scenarios as Record<string, string>)[key];
  if (!path || index.schemaVersion !== PRECOMPUTED_SCHEMA_VERSION) return null;
  try {
    const response = await fetch(path, { signal });
    if (!response.ok) return null;
    const stored = JSON.parse(await response.text(), (name, value) =>
      name === 'usUtilities' && Array.isArray(value) ? Float64Array.from(value) : value) as StoredScenario;
    if (stored.schemaVersion !== PRECOMPUTED_SCHEMA_VERSION || stored.fingerprint !== index.fingerprint || stored.key !== key
      || scenarioKey(stored.snapshot) !== key) return null;
    return { ...stored.snapshot, foreignObjective: request.foreignObjective };
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
}
