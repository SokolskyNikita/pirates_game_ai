import type { ModelInputs, ModelMode, Objective } from '../api/types';
import { DEFAULT_INPUTS, INPUT_SPECS, STATIC_CHOICES } from './config';
import { el } from './dom';
import { formatInput, inputRangeValue } from './format';
import {
  inputSliderChoices,
  normalizeInputConstraints,
  objectiveHelp,
  type ScenarioState,
} from './state';

const foreignKeys = new Set<string>([
  'foreignAiGrowth',
  'capitalMobility',
  'foreignStrength',
  'tradeIntensity',
  'foreignTradeIntensity',
  'foreignMarketSize',
  'foreignPopulationRatio',
  'tradableShare',
  'tradeElasticity',
]);
const structuralKeys = new Set<string>(['investmentResponse']);
const visibleInputSpecs = INPUT_SPECS.filter((spec) => spec.key !== 'foreignPopulationRatio');

export class ScenarioControls {
  private sliderValues = new Map<keyof ModelInputs, number[]>();
  constructor(
    private state: ScenarioState,
    private changed: () => void,
  ) {
    this.buildInputs();
    this.bindEvents();
    this.syncInputs();
  }
  replaceState(next: ScenarioState) {
    Object.assign(this.state, next);
    this.clearPreset();
    this.syncInputs();
  }
  selectedManualPolicyId(): string | undefined {
    return el<HTMLSelectElement>('manual-package').value || undefined;
  }
  private buildInputs() {
    for (const spec of visibleInputSpecs) {
      if (STATIC_CHOICES[spec.key].length === 1) {
        const note = document.createElement('p');
        note.textContent = spec.label + ': ' + formatInput(spec.key, STATIC_CHOICES[spec.key][0]!) + '. ' + spec.description;
        el(foreignKeys.has(spec.key) ? 'international-inputs' : 'structural-inputs').append(note);
        continue;
      }
      const target = foreignKeys.has(spec.key)
        ? 'international-inputs'
        : structuralKeys.has(spec.key)
          ? 'structural-inputs'
          : 'domestic-inputs';
      const node = document.createElement('div');
      node.className = 'input-control';
      node.innerHTML =
        '<label class="input-label" for="input-' +
        spec.key +
        '"><span>' +
        spec.label +
        '</span><output id="value-' +
        spec.key +
        '" for="input-' +
        spec.key +
        '"></output></label><input id="input-' +
        spec.key +
        '" name="' +
        spec.key +
        '" type="range" min="0" max="1" step="1" aria-describedby="help-' +
        spec.key +
        '" /><p id="help-' +
        spec.key +
        '">' +
        spec.description +
        '</p>' +
        (spec.key === 'jobSearch'
          ? '<p><a href="#job-search-source">BLS participation reference</a></p>'
          : '');
      el(target).append(node);
      el<HTMLInputElement>('input-' + spec.key).addEventListener('input', (event) => {
        this.state.inputs[spec.key] = this.sliderValues.get(spec.key)![
          Number((event.target as HTMLInputElement).value)
        ]!;
        this.state.inputs = normalizeInputConstraints(this.state.inputs);
        this.updateInputLabel(spec.key);
        if (spec.key === 'jobChange') this.syncInput('jobsAffected');
        this.updateElectorate();
        this.updateCalibration();
        this.clearPreset();
        this.changed();
      });
    }
    el('manual-inputs').innerHTML = '<label for="manual-package">Saved policy package</label><select id="manual-package"></select>';
  }

  private updateInputLabel(key: keyof ModelInputs) {
    const text = formatInput(key, this.state.inputs[key]);
    el('value-' + key).textContent = text;
    const slider = el<HTMLInputElement>('input-' + key);
    slider.setAttribute('aria-valuetext', text);
    slider.setAttribute('aria-valuenow', String(inputRangeValue(key, this.state.inputs[key])));
  }

  private updateElectorate() {
    el('voting-rule-heading').textContent = this.state.statusQuoUnavailable
      ? 'One vote. The most votes wins.'
      : 'One vote. More than 50% to pass.';
    el('electorate-description').textContent =
      'Every adult US citizen casts one vote for their preferred complete funded package. ' +
      (this.state.statusQuoUnavailable
        ? 'The current-policy package is excluded. The alternative with the most votes passes at any share, and all players know this rule.'
        : 'More than 50% must choose the same package for it to pass; otherwise current policy remains.');
    el<HTMLInputElement>('status-quo-unavailable').checked = this.state.statusQuoUnavailable;
  }

  private updateCalibration() {
    const custom = (['foreignMarketSize', 'tradeIntensity', 'foreignTradeIntensity'] as const).some(
      (key) => Math.abs(this.state.inputs[key] - DEFAULT_INPUTS[key]) > 1e-8,
    );
    el('calibration-summary').textContent =
      '2025 reference: rest-of-world GDP 2.85× US. US imports: 14.2% of US GDP; foreign imports from the US: 3.9% of foreign GDP. The model balances these flows before calculating trade; see the trade assumptions below.' +
      (custom ? ' This scenario changes at least one reference value; Reset restores the defaults.' : '');
  }

  private syncPauseControl() {
    el<HTMLInputElement>('pause-unavailable').checked = this.state.pauseUnavailable;
    el('pause-unavailable-help').textContent =
      this.state.mode === 'strategic'
        ? 'Remove Pause AI from both the US ballot and the rest of the world’s choices.'
        : 'Remove Pause AI from the US ballot. Current pace and acceleration remain available.';
  }

  private syncInput(key: keyof ModelInputs) {
    const spec = INPUT_SPECS.find((input) => input.key === key)!;
    const choices = inputSliderChoices(spec, this.state.inputs);
    this.sliderValues.set(key, choices);
    const slider = el<HTMLInputElement>('input-' + key);
    slider.min = '0';
    slider.max = String(choices.length - 1);
    slider.value = String(choices.indexOf(this.state.inputs[key]));
    slider.disabled = choices.length === 1;
    // The native value is an index into discrete stops; expose the displayed units to assistive tech.
    slider.setAttribute('aria-valuemin', String(inputRangeValue(key, choices[0]!)));
    slider.setAttribute('aria-valuemax', String(inputRangeValue(key, choices[choices.length - 1]!)));
    this.updateInputLabel(key);
    if (key === 'jobsAffected') {
      const minimum = Math.max(0, -this.state.inputs.jobChange);
      el('help-' + key).textContent =
        spec.description +
        (minimum > 0
          ? ' With the selected job reduction, at least ' +
            formatInput(key, minimum) +
            ' of current jobs must be affected.'
          : '');
    }
  }

  private syncInputs() {
    this.state.inputs = normalizeInputConstraints(this.state.inputs);
    this.updateElectorate();
    this.syncPauseControl();
    for (const spec of visibleInputSpecs) if (STATIC_CHOICES[spec.key].length > 1) this.syncInput(spec.key);
    document.querySelectorAll<HTMLInputElement>('input[name="world"]').forEach((radio) => {
      radio.checked = radio.value === this.state.mode;
    });
    el<HTMLSelectElement>('foreign-objective').value = this.state.foreignObjective;
    el('foreign-objective-help').textContent = objectiveHelp[this.state.foreignObjective];
    el('foreign-inputs').hidden = this.state.mode !== 'strategic';
    this.updateCalibration();
  }

  private clearPreset() {
    document
      .querySelectorAll('[data-preset]')
      .forEach((button) => button.setAttribute('aria-pressed', 'false'));
  }

  private bindEvents() {
    document.querySelectorAll<HTMLInputElement>('input[name="world"]').forEach((radio) =>
      radio.addEventListener('change', () => {
        this.state.mode = radio.value as ModelMode;
        this.syncInputs();
        this.changed();
      }),
    );
    el<HTMLInputElement>('status-quo-unavailable').addEventListener('change', (event) => {
      this.state.statusQuoUnavailable = (event.target as HTMLInputElement).checked;
      this.updateElectorate();
      this.clearPreset();
      this.changed();
    });
    el<HTMLInputElement>('pause-unavailable').addEventListener('change', (event) => {
      this.state.pauseUnavailable = (event.target as HTMLInputElement).checked;
      this.syncPauseControl();
      this.clearPreset();
      this.changed();
    });
    el<HTMLSelectElement>('foreign-objective').addEventListener('change', (event) => {
      this.state.foreignObjective = (event.target as HTMLSelectElement).value as Objective;
      el('foreign-objective-help').textContent = objectiveHelp[this.state.foreignObjective];
      this.changed();
    });
    el('reset').addEventListener('click', () => {
      this.state.inputs = { ...DEFAULT_INPUTS };
      this.state.mode = 'us-only';
      this.state.foreignObjective = 'prosperity';
      this.state.pauseUnavailable = false;
      this.state.statusQuoUnavailable = false;
      this.clearPreset();
      this.syncInputs();
      this.changed();
    });
  }
}
