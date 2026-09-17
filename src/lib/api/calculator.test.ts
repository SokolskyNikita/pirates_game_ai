import { afterEach, describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import type { ProfileOutcome } from './types';
import { defaultState, scenarioRequest } from '../presentation/state';

vi.mock('../../generated/static-library.json', () => ({ default: {
  fingerprint: 'test-version', inline: false,
  paths: { 'us-only|-|0|0|1|1|1|1|1': '/static-library/test.json.gz', 'us-only|-|1|0|1|1|1|1|1': '/static-library/pause.json.gz' },
} }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
function saved() {
  const state = defaultState();
  const profile = { usPolicy: { id: 'current' }, usUtilities: [] } as unknown as ProfileOutcome;
  return { schema:1, fingerprint:'test-version', key:'canonical', profiles:[profile], comparisonVotes:{current:0},
    snapshot:{...state, selected:0, statusQuo:0, baseline:0, alternatives:[0], selection:'domestic-ballot'} };
}
describe('static result delivery', () => {
  it('loads gzip via GET, preserves request revision and uses saved comparison values', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(gzipSync(JSON.stringify(saved()))));
    vi.stubGlobal('fetch', fetch);
    const {simulateScenario, comparePolicy} = await import('./calculator');
    const request = scenarioRequest(defaultState(), 4), signal = new AbortController().signal;
    const result = await simulateScenario(request, signal);
    expect(result.id).toBe(4); expect(result.source).toBe('precomputed');
    expect(fetch).toHaveBeenCalledWith('/static-library/test.json.gz', {signal});
    expect(await comparePolicy({scenario:defaultState(), policyId:'current', selectedPolicyId:'current'}, signal)).toMatchObject({voteShare:0});
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(comparePolicy({scenario:defaultState(), policyId:'unsaved', selectedPolicyId:'current'}, signal)).rejects.toThrow('saved candidate');
  });
  it('accepts JSON already decompressed by the HTTP stack', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(saved()))));
    const {simulateScenario} = await import('./calculator');
    expect((await simulateScenario(scenarioRequest(defaultState(),1),new AbortController().signal)).source).toBe('precomputed');
  });
  it('rejects an artifact for another model or scenario', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(gzipSync(JSON.stringify({...saved(),fingerprint:'old'})))));
    const {simulateScenario} = await import('./calculator');
    await expect(simulateScenario(scenarioRequest(defaultState(),1),new AbortController().signal)).rejects.toThrow('model version');
  });
  it('does not calculate or interpolate unsupported inputs', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch',fetch);
    const {simulateScenario} = await import('./calculator');
    const request = scenarioRequest(defaultState(),1); request.inputs.jobSearch=.5;
    await expect(simulateScenario(request,new AbortController().signal)).rejects.toThrow('outside');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('honors cancellation and reports missing assets', async () => {
    const {simulateScenario} = await import('./calculator');
    const controller = new AbortController();controller.abort();
    await expect(simulateScenario(scenarioRequest(defaultState(),1),controller.signal)).rejects.toThrow();
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('missing',{status:404})));
    await expect(simulateScenario(scenarioRequest(defaultState(),1),new AbortController().signal)).rejects.toMatchObject({status:404});
  });
});
