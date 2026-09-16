import { describe, expect, it } from 'vitest';
import { DEFAULT_INPUTS } from './config';
import { defaultState, readScenarioURL, scenarioRequest, scenarioURL } from './state';

describe('scenario URL presentation state', () => {
  it('preserves older shared assumptions without treating rollout as the ballot choice', () => {
    const state = readScenarioURL(
      '?v=5&world=strategic&rollout=0&foreignObjective=output&productivityGain=.5&displacement=1&reemployment=0',
    );
    expect(state).toEqual({
      inputs: { ...DEFAULT_INPUTS, productivityGain: 0.5, displacement: 1, reemployment: 0 },
      mode: 'strategic',
      foreignObjective: 'output',
      pauseUnavailable: false,
    });
    expect(scenarioRequest(state, 7)).not.toHaveProperty('pace');
  });
  it('round-trips all assumptions and pause availability in a version 11 shared link', () => {
    const state = readScenarioURL(
      '?world=strategic&foreignObjective=workers&pauseUnavailable=1&usGdpGrowth=.025&foreignMarketSize=3.5',
    );
    const url = scenarioURL(state, 'https://ai-pirates-game.com/?obsolete=value');
    expect(url.searchParams.get('v')).toBe('11');
    expect(url.searchParams.has('obsolete')).toBe(false);
    expect(readScenarioURL(url.search)).toEqual(state);
  });
  it('rejects non-finite inputs and bounds URL values before displaying controls', () => {
    const state = readScenarioURL(
      '?displacement=NaN&reemployment=-3&foreignStrength=Infinity&capitalMobility=9&world=unknown',
    );
    expect(state.inputs.displacement).toBe(DEFAULT_INPUTS.displacement);
    expect(state.inputs.foreignStrength).toBe(DEFAULT_INPUTS.foreignStrength);
    expect(state.inputs.reemployment).toBe(0);
    expect(state.inputs.capitalMobility).toBe(1);
    expect(state.mode).toBe('us-only');
  });
  it('copies inputs into each outgoing request so later form edits cannot change it', () => {
    const state = defaultState();
    const request = scenarioRequest(state, 8);
    state.inputs.displacement = 1;
    expect(request.inputs.displacement).toBe(DEFAULT_INPUTS.displacement);
  });
});
