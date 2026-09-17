/** Load exact saved Python results; no economic calculations run here. */
import manifestData from '../../generated/static-library.json';
import { STATIC_CHOICES, STATIC_VARIABLE_KEYS } from '../presentation/config';
import type { ComparisonRequest, ComparisonResponse, ProfileOutcome, ScenarioRequest, ScenarioSnapshot } from './types';

const manifest = manifestData as { fingerprint: string; paths: Record<string, string>; inline: boolean };
type Scenario = ComparisonRequest['scenario'];
type PackedSnapshot = Omit<ScenarioSnapshot, 'selected' | 'statusQuo' | 'baseline' | 'leading' | 'alternatives'> & {
  selected: number; statusQuo: number; baseline: number; leading?: number; alternatives: number[];
};
export interface SavedResult {
  schema: number; fingerprint: string; key: string;
  snapshot: PackedSnapshot; profiles: ProfileOutcome[]; comparisonVotes: Record<string, number>;
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
  if (request.inputs.jobsAffected < Math.max(0, -request.inputs.jobChange))
    throw new CalculationError('Affected jobs must cover the job reduction.', 400);
  return [request.mode, request.mode === 'strategic' ? request.foreignObjective : '-',
    Number(Boolean(request.pauseUnavailable)), Number(Boolean(request.statusQuoUnavailable)),
    ...STATIC_VARIABLE_KEYS.map(key => STATIC_CHOICES[key].indexOf(request.inputs[key]))].join('|');
}
export function unpack(saved: SavedResult): ScenarioSnapshot {
  const profile = (index: number) => {
    if (!Number.isInteger(index) || !saved.profiles[index]) throw new Error('Invalid saved policy reference.');
    return saved.profiles[index]!;
  };
  return { ...saved.snapshot, selected: profile(saved.snapshot.selected),
    statusQuo: profile(saved.snapshot.statusQuo), baseline: profile(saved.snapshot.baseline),
    leading: saved.snapshot.leading === undefined ? undefined : profile(saved.snapshot.leading),
    alternatives: saved.snapshot.alternatives.map(profile) };
}
const cache = new Map<string, SavedResult>();
let inline: Record<string, SavedResult> | undefined;
async function load(request: Scenario, signal: AbortSignal): Promise<SavedResult> {
  signal.throwIfAborted();
  const key = staticScenarioKey(request);
  const existing = cache.get(key);
  if (existing) return existing;
  let saved: SavedResult;
  if (manifest.inline) {
    inline ??= JSON.parse(document.getElementById('static-library')?.textContent || '{}');
    saved = inline![key]!;
  } else {
    const path = manifest.paths[key];
    if (!path) throw new CalculationError('This scenario is missing from the static library.', 404);
    const response = await fetch(path, { signal });
    if (!response.ok) throw new CalculationError('The saved result could not be loaded. Please retry.', response.status);
    const bytes = new Uint8Array(await response.arrayBuffer());
    // Some static hosts advertise Content-Encoding: gzip, which fetch decodes
    // automatically. Others serve the gzip file as bytes. Accept both.
    const json = bytes[0] === 0x1f && bytes[1] === 0x8b
      ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
      : new TextDecoder().decode(bytes);
    signal.throwIfAborted();
    saved = JSON.parse(json);
  }
  if (!saved || saved.schema !== 1 || saved.fingerprint !== manifest.fingerprint || staticScenarioKey(saved.snapshot) !== key)
    throw new Error('The saved result does not match this scenario or model version.');
  unpack(saved); // Validate references before caching.
  if (cache.size >= 12) cache.delete(cache.keys().next().value!);
  cache.set(key, saved);
  return saved;
}
export async function simulateScenario(request: ScenarioRequest, signal: AbortSignal) {
  return { id: request.id, snapshot: unpack(await load(request, signal)), source: 'precomputed' as const };
}
export async function comparePolicy(request: ComparisonRequest, signal: AbortSignal): Promise<ComparisonResponse> {
  const saved = await load(request.scenario, signal);
  const snapshot = unpack(saved);
  if (snapshot.selected.usPolicy.id !== request.selectedPolicyId || snapshot.selected.foreignPolicy?.id !== request.foreignPolicyId)
    throw new CalculationError('The comparison belongs to a different outcome.', 400);
  const profile = [snapshot.selected, snapshot.statusQuo, ...snapshot.alternatives].find(p => p.usPolicy.id === request.policyId);
  const voteShare = saved.comparisonVotes[request.policyId];
  if (!profile || !Number.isFinite(voteShare)) throw new CalculationError('Choose one of the saved candidate packages.', 400);
  return { profile, voteShare: voteShare! };
}
