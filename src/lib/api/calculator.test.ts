import { afterEach, describe, expect, it, vi } from 'vitest';
import { comparePolicy, simulateScenario } from './calculator';
import { defaultState, scenarioRequest } from '../presentation/state';

afterEach(() => vi.unstubAllGlobals());

describe('Python calculation API boundary', () => {
  it('sends a cancellable JSON request to the same-origin simulation endpoint', async () => {
    const request = scenarioRequest(defaultState(), 4);
    const signal = new AbortController().signal;
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ id: 4, snapshot: { selection: 'domestic-ballot' }, source: 'precomputed' }),
        ),
      );
    vi.stubGlobal('fetch', fetch);
    const result = await simulateScenario(request, signal);
    expect(fetch).toHaveBeenCalledWith(
      '/api/simulate',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(request), signal }),
    );
    expect(result.source).toBe('precomputed');
  });
  it('does not accept a response for a different scenario revision', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 3, snapshot: {} }))));
    await expect(
      simulateScenario(scenarioRequest(defaultState(), 4), new AbortController().signal),
    ).rejects.toThrow('unexpected scenario');
  });
  it('surfaces structured service failures and unreadable gateway responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Unknown policy.' }), { status: 400 }))
        .mockResolvedValueOnce(new Response('<html>Unavailable</html>', { status: 502 })),
    );
    const request = scenarioRequest(defaultState(), 1);
    await expect(simulateScenario(request, new AbortController().signal)).rejects.toThrow('Unknown policy.');
    await expect(simulateScenario(request, new AbortController().signal)).rejects.toThrow(
      'unreadable response',
    );
  });
  it('sends manual comparison to Python rather than deriving votes locally', async () => {
    const response = { profile: { id: 'alternative' }, voteShare: 61.25 };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(response))));
    const result = await comparePolicy(
      {
        scenario: defaultState(),
        policyId: 'alternative',
        selectedPolicyId: 'current',
        foreignPolicyId: 'foreign',
      },
      new AbortController().signal,
    );
    expect(result).toEqual(response);
  });
});
