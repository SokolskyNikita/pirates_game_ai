import { describe, expect, it } from 'vitest';
import { DEFAULT_INPUTS, INPUT_SPECS } from './config';
import { formatInput, inputRangeValue } from './format';
import {
  defaultState,
  inputSliderChoices,
  normalizeInputConstraints,
  readScenarioURL,
  scenarioRequest,
  scenarioURL,
} from './state';

describe('scenario URL presentation state', () => {
  it('migrates old displacement without equating successful reemployment with job search', () => {
    const state = readScenarioURL(
      '?v=5&world=strategic&rollout=0&foreignObjective=output&productivityGain=.5&displacement=.7&reemployment=0',
    );
    expect(state).toEqual({
      inputs: { ...DEFAULT_INPUTS, productivityGain: 0.5, jobsAffected: 0.7, jobChange: -0.7 },
      mode: 'strategic',
      foreignObjective: 'output',
      pauseUnavailable: false,
      statusQuoUnavailable: false,
    });
    expect(state.inputs.jobSearch).toBe(DEFAULT_INPUTS.jobSearch);
    expect(scenarioRequest(state, 7)).not.toHaveProperty('pace');
  });
  it('converts old total GDP growth to additional AI growth using each region’s baseline', () => {
    const state = readScenarioURL('?v=13&usGdpGrowth=.05&foreignGdpGrowth=.05');
    expect(state.inputs.usAiGrowth).toBeCloseTo(0.03);
    expect(state.inputs.foreignAiGrowth).toBeCloseTo(0.02);
    const belowBaseline = readScenarioURL('?usGdpGrowth=.01&foreignGdpGrowth=0');
    expect(belowBaseline.inputs.usAiGrowth).toBe(0);
    expect(belowBaseline.inputs.foreignAiGrowth).toBe(0);
  });
  it('lets explicit new assumptions override legacy keys', () => {
    const state = readScenarioURL(
      '?jobsAffected=.6&jobChange=.2&displacement=1&jobSearch=.9&reemployment=0&usAiGrowth=.1&usGdpGrowth=.05&foreignAiGrowth=.15&foreignGdpGrowth=.05',
    );
    expect(state.inputs).toMatchObject({
      jobsAffected: 0.6, jobChange: 0.2, jobSearch: 0.9, usAiGrowth: 0.1, foreignAiGrowth: 0.15,
    });
  });
  it('round-trips exact assumptions, pause availability and the voting rule in a version 14 link', () => {
    const state = readScenarioURL(
      '?world=strategic&foreignObjective=workers&pauseUnavailable=1&statusQuoUnavailable=1&usAiGrowth=.025&jobChange=-.735&jobsAffected=.8&jobSearch=.87&foreignMarketSize=3.5&tradableShare=.55&tradeElasticity=6',
    );
    const url = scenarioURL(state, 'https://ai-pirates-game.com/?obsolete=value');
    expect(url.searchParams.get('v')).toBe('14');
    expect(url.searchParams.has('obsolete')).toBe(false);
    expect(url.searchParams.has('reemployment')).toBe(false);
    expect(state.statusQuoUnavailable).toBe(true);
    expect(scenarioRequest(state, 9).statusQuoUnavailable).toBe(true);
    expect(readScenarioURL(url.search)).toEqual(state);
  });
  it('rejects non-finite inputs and bounds URL values before displaying controls', () => {
    const state = readScenarioURL(
      '?jobsAffected=NaN&jobSearch=-3&jobChange=-9&foreignStrength=Infinity&capitalMobility=9&world=unknown',
    );
    expect(state.inputs.jobsAffected).toBe(1);
    expect(state.inputs.jobChange).toBe(-1);
    expect(state.inputs.foreignStrength).toBe(DEFAULT_INPUTS.foreignStrength);
    expect(state.inputs.jobSearch).toBe(0);
    expect(state.inputs.capitalMobility).toBe(1);
    expect(state.mode).toBe('us-only');
  });
  it('raises affected jobs to the reduction, including in shared links and API requests', () => {
    const state = readScenarioURL('?jobsAffected=0&jobChange=-.9');
    expect(state.inputs.jobsAffected).toBe(0.9);
    state.inputs.jobsAffected = 0.1;
    expect(scenarioRequest(state, 7).inputs.jobsAffected).toBe(0.9);
    expect(scenarioURL(state, 'https://ai-pirates-game.com/').searchParams.get('jobsAffected')).toBe('0.9');
  });
  it('copies inputs into each outgoing request so later form edits cannot change it', () => {
    const state = defaultState();
    const request = scenarioRequest(state, 8);
    state.inputs.jobSearch = 0;
    expect(request.inputs.jobSearch).toBe(DEFAULT_INPUTS.jobSearch);
  });
});

describe('constrained job-input sliders', () => {
  const affectedSpec = INPUT_SPECS.find((spec) => spec.key === 'jobsAffected')!;
  it('never offers an affected share below the selected job reduction', () => {
    for (const reduction of [0, 0.2, 0.9, 1]) {
      const inputs = normalizeInputConstraints({ ...DEFAULT_INPUTS, jobChange: -reduction, jobsAffected: 0 });
      const choices = inputSliderChoices(affectedSpec, inputs);
      expect(choices[0]).toBe(reduction);
      expect(choices[choices.length - 1]).toBe(1);
      expect(choices).toContain(inputs.jobsAffected);
      expect(choices.every((value) => value >= reduction)).toBe(true);
    }
  });
  it('preserves an exact off-grid constraint from a shared link', () => {
    const inputs = readScenarioURL('?jobChange=-.735&jobsAffected=.1').inputs;
    const choices = inputSliderChoices(affectedSpec, inputs);
    expect(choices[0]).toBe(0.735);
    expect(choices).toContain(0.75);
    expect(choices).not.toContain(0.7);
  });
  it('allows zero affected current jobs when the total number of jobs grows', () => {
    const inputs = normalizeInputConstraints({ ...DEFAULT_INPUTS, jobChange: 1, jobsAffected: 0 });
    expect(inputs.jobsAffected).toBe(0);
    expect(inputSliderChoices(affectedSpec, inputs)[0]).toBe(0);
  });
  it('exposes slider bounds in displayed units instead of internal choice indices', () => {
    expect(inputRangeValue('jobsAffected', 0.9)).toBe(90);
    expect(inputRangeValue('usAiGrowth', 0.05)).toBe(5);
    expect(inputRangeValue('jobChange', -0.9)).toBe(-90);
    expect(inputRangeValue('foreignMarketSize', 2.85)).toBe(2.85);
  });
  it('formats additional growth as percentage points and job changes with a sign', () => {
    expect(formatInput('usAiGrowth', 0.05)).toBe('+5 pp/year');
    expect(formatInput('jobChange', -0.9)).toBe('−90%');
    expect(formatInput('jobChange', 0.2)).toBe('+20%');
    expect(formatInput('jobChange', 0)).toBe('0%');
  });
});
