import { describe, expect, it } from 'vitest';
import { DEFAULT_INPUTS, INPUT_SPECS, STATIC_CHOICES } from './config';
import { formatInput, inputRangeValue } from './format';
import { defaultState, inputSliderChoices, normalizeInputConstraints, scenarioRequest } from './state';

describe('finite static scenario grid', () => {
  it('keeps selectable assumptions on the supported grid', () => {
    for (const spec of INPUT_SPECS) for (const value of STATIC_CHOICES[spec.key]) {
      const state = { ...defaultState(), inputs: normalizeInputConstraints({ ...DEFAULT_INPUTS, [spec.key]: value }) };
      expect(scenarioRequest(state, 1).inputs).toEqual(state.inputs);
      expect(scenarioRequest(state, 1).statusQuoUnavailable).toBe(false);
    }
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
  it('links the foreign AI growth increment to the US setting', () => {
    for (const growth of [0, .05]) {
      const state = defaultState();
      state.inputs.usAiGrowth = growth;
      expect(scenarioRequest(state, 1).inputs.foreignAiGrowth).toBe(growth);
    }
  });
  it('formats the displayed units', () => {
    expect(inputRangeValue('jobChange', -.9)).toBe(-90);
    expect(formatInput('usAiGrowth', .05)).toBe('+5 pp/year');
    expect(formatInput('jobChange', -.9)).toBe('−90%');
  });
});
