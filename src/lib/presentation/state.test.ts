import { describe, expect, it } from 'vitest';
import { DEFAULT_INPUTS, INPUT_SPECS, STATIC_CHOICES } from './config';
import { formatInput, inputRangeValue } from './format';
import { defaultState, inputSliderChoices, normalizeInputConstraints, readScenarioURL, scenarioRequest, scenarioURL, unsupportedURLValues } from './state';

describe('finite static scenario grid', () => {
  it('round-trips every selectable axis without introducing unsupported values', () => {
    for (const spec of INPUT_SPECS) for (const value of STATIC_CHOICES[spec.key]) {
      const state = { ...defaultState(), inputs: normalizeInputConstraints({ ...DEFAULT_INPUTS, [spec.key]: value }) };
      const url = scenarioURL(state, 'https://ai-pirates-game.com/');
      expect(url.searchParams.get('v')).toBe('16');
      expect(readScenarioURL(url.search)).toEqual(state);
      expect(unsupportedURLValues(url.search)).toBe(false);
    }
  });
  it('discloses off-grid legacy links and restores fixed reference assumptions', () => {
    const query = '?world=strategic&jobChange=-.735&jobsAffected=.8&investmentResponse=1&foreignObjective=output';
    const state = readScenarioURL(query);
    expect(unsupportedURLValues(query)).toBe(true);
    expect(state.inputs).toMatchObject({ jobChange: -.9, jobsAffected: 1, investmentResponse: .35 });
    expect(state.foreignObjective).toBe('output');
  });
  it('discloses a physically inconsistent link even if each value exists on the grid', () => {
    expect(unsupportedURLValues('?jobsAffected=0&jobChange=-1')).toBe(true);
    expect(readScenarioURL('?jobsAffected=0&jobChange=-1').inputs.jobsAffected).toBe(1);
  });
  it('preserves both checkbox rules independently', () => {
    const state = readScenarioURL('?pauseUnavailable=1&statusQuoUnavailable=1');
    expect(scenarioRequest(state, 7)).toMatchObject({ id: 7, pauseUnavailable: true, statusQuoUnavailable: true });
  });
  it('offers only affected-job choices that cover net job losses', () => {
    const spec = INPUT_SPECS.find(s => s.key === 'jobsAffected')!;
    for (const jobChange of STATIC_CHOICES.jobChange) {
      const inputs = normalizeInputConstraints({ ...DEFAULT_INPUTS, jobChange, jobsAffected: 0 });
      const choices = inputSliderChoices(spec, inputs);
      expect(choices.every(value => value >= Math.max(0, -jobChange))).toBe(true);
      expect(choices).toContain(inputs.jobsAffected);
    }
    expect(inputSliderChoices(spec, { ...DEFAULT_INPUTS, jobChange: 1 })).toEqual([0, 1]);
  });
  it('never mutates the outgoing request when controls change', () => {
    const state = defaultState(); const request = scenarioRequest(state, 1);
    state.inputs.jobSearch = 0;
    expect(request.inputs.jobSearch).toBe(.85);
  });
  it('migrates old growth and displacement before snapping, without reusing reemployment', () => {
    const state = readScenarioURL('?usGdpGrowth=.05&displacement=.7&reemployment=0');
    expect(state.inputs).toMatchObject({ usAiGrowth:.05, jobChange:-.9, jobsAffected:1, jobSearch:.85 });
    expect(unsupportedURLValues('?usGdpGrowth=.05')).toBe(true);
  });
  it('formats the displayed units', () => {
    expect(inputRangeValue('jobChange', -.9)).toBe(-90);
    expect(formatInput('usAiGrowth', .05)).toBe('+5 pp/year');
    expect(formatInput('jobChange', -.9)).toBe('−90%');
  });
});
