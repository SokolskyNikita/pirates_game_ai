import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_INPUTS } from './pirates-model';
import { loadPrecomputedScenario, scenarioKey } from './precomputed';
import type { ScenarioRequest } from './simulation';
const manifest = vi.hoisted(() => ({ schemaVersion: 1, fingerprint: 'test-model', scenarios: {} as Record<string,string> }));
vi.mock('./precomputed-index.json', () => ({ default: manifest }));
const request: ScenarioRequest = { id: 1, mode: 'us-only', foreignObjective: 'workers', inputs: {...DEFAULT_INPUTS} };
const stored = () => ({
  schemaVersion: 1, fingerprint: manifest.fingerprint, key: scenarioKey(request),
  snapshot: {...request, selected: {usUtilities: [1,2,3]}},
});
beforeEach(() => {
  manifest.scenarios = {[scenarioKey(request)]: '/precomputed/test.json'};
});
afterEach(() => vi.unstubAllGlobals());
describe('exact precomputed results', () => {
  it('restores typed utilities and treats the unused domestic objective consistently', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(stored()))));
    const result = await loadPrecomputedScenario({...request, foreignObjective: 'output'});
    expect(result?.selected.usUtilities).toBeInstanceOf(Float64Array);
    expect(Array.from(result!.selected.usUtilities)).toEqual([1,2,3]);
    expect(result?.foreignObjective).toBe('output');
  });
  it('does not substitute a nearby scenario or fetch an unknown key', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await loadPrecomputedScenario({...request, inputs: {...request.inputs, displacement: .36}})).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects stale fingerprints and mismatched stored inputs', async () => {
    const data = stored();
    data.fingerprint = 'old-model';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(data))));
    expect(await loadPrecomputedScenario(request)).toBeNull();
    data.fingerprint = manifest.fingerprint;
    data.snapshot.inputs = {...request.inputs, displacement: 1};
    expect(await loadPrecomputedScenario(request)).toBeNull();
  });
  it('ignores legacy rollout because all three choices are on every ballot', () => {
    expect(scenarioKey({...request, pace: 0} as ScenarioRequest)).toBe(scenarioKey({...request, pace: 2} as ScenarioRequest));
    expect(scenarioKey({...request, mode: 'strategic', foreignObjective: 'workers'})).not.toBe(scenarioKey({...request, mode: 'strategic', foreignObjective: 'output'}));
  });
  it('falls back on unavailable data but preserves cancellation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', {status: 404})));
    expect(await loadPrecomputedScenario(request)).toBeNull();
    const abort = new AbortController();
    abort.abort();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('Aborted', 'AbortError'); }));
    await expect(loadPrecomputedScenario(request, abort.signal)).rejects.toThrow('Aborted');
  });
});
