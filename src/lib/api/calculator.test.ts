import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultState, scenarioRequest } from '../presentation/state';

vi.mock('../../generated/static-library.json', () => ({ default: {
  fingerprint: 'test-version', inline: true,
} }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
async function setup(overrides = {}) {
  const api = await import('./calculator');
  const state = defaultState();
  const saved = { schema: 2, fingerprint: 'test-version', snapshot: state, ...overrides };
  const library = { [api.staticScenarioKey(state)]: saved };
  vi.stubGlobal('document', { getElementById: () => ({ textContent: JSON.stringify(library) }) });
  vi.stubGlobal('fetch', vi.fn());
  return api;
}
describe('embedded result delivery', () => {
  it('reads the complete embedded library without a network request', async () => {
    const { simulateScenario } = await setup();
    const result = await simulateScenario(scenarioRequest(defaultState(), 4), new AbortController().signal);
    expect(result.id).toBe(4);
    expect(result.source).toBe('precomputed');
    expect(result.snapshot.inputs).toEqual(defaultState().inputs);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects an artifact for another model', async () => {
    const { simulateScenario } = await setup({ fingerprint: 'old' });
    await expect(simulateScenario(scenarioRequest(defaultState(), 1), new AbortController().signal)).rejects.toThrow('model version');
  });
  it('does not calculate or interpolate unsupported inputs', async () => {
    const { simulateScenario } = await setup();
    const request = scenarioRequest(defaultState(), 1); request.inputs.jobSearch = .5;
    await expect(simulateScenario(request, new AbortController().signal)).rejects.toThrow('outside');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('honors cancellation', async () => {
    const { simulateScenario } = await setup();
    const controller = new AbortController(); controller.abort();
    await expect(simulateScenario(scenarioRequest(defaultState(), 1), controller.signal)).rejects.toThrow();
  });
  it('rejects missing embedded data', async () => {
    const { simulateScenario } = await setup();
    vi.stubGlobal('document', { getElementById: () => null });
    await expect(simulateScenario(scenarioRequest(defaultState(), 1), new AbortController().signal)).rejects.toMatchObject({ status: 404 });
  });
});
