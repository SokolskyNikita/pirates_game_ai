import type { ModelInputs, ModelMode, Objective } from '../api/types';
import { DEFAULT_INPUTS, INPUT_SPECS, POLICY_OPTIONS } from './config';
import { el } from './dom';
import { formatInput, policyAxes, axisLabels, axisOptionValue, paceName } from './format';
import { objectiveHelp, type ScenarioState } from './state';

const foreignKeys = new Set<string>([
  'foreignGdpGrowth',
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
    // ID parts are opaque canonical tokens supplied by Python, not recalculated in JavaScript.
    const selected = policyAxes
      .filter((axis) => this.state.mode === 'strategic' || axis !== 'allowFreeTrade')
      .map((axis) => {
        const idPart = el<HTMLSelectElement>('manual-' + axis).value;
        return POLICY_OPTIONS[axis].find((option) => option.idPart === idPart);
      });
    if (selected.some((option) => !option) || (this.state.pauseUnavailable && selected[0]?.value === 0))
      return;
    return selected
      .map((option) => option!.idPart)
      .filter(Boolean)
      .join('|');
  }
  private buildInputs() {
    for (const spec of visibleInputSpecs) {
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
        '</p>';
      el(target).append(node);
      el<HTMLInputElement>('input-' + spec.key).addEventListener('input', (event) => {
        this.state.inputs[spec.key] = this.sliderValues.get(spec.key)![
          Number((event.target as HTMLInputElement).value)
        ]!;
        this.updateInputLabel(spec.key);
        this.updateElectorate();
        this.updateCalibration();
        this.clearPreset();
        this.changed();
      });
    }
    for (const axis of policyAxes) {
      const options = POLICY_OPTIONS[axis];
      const node = document.createElement('div');
      node.className = 'manual-control';
      node.id = 'manual-control-' + axis;
      node.innerHTML =
        '<label for="manual-' +
        axis +
        '">' +
        axisLabels[axis] +
        '</label><select id="manual-' +
        axis +
        '">' +
        options
          .map(
            (option) =>
              '<option value="' + option.idPart + '">' + axisOptionValue(axis, option.value) + '</option>',
          )
          .join('') +
        '</select>';
      el('manual-inputs').append(node);
    }
  }

  private updateInputLabel(key: keyof ModelInputs) {
    const text = formatInput(key, this.state.inputs[key]);
    el('value-' + key).textContent = text;
    el<HTMLInputElement>('input-' + key).setAttribute('aria-valuetext', text);
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
    const pace = el<HTMLSelectElement>('manual-pace');
    const previous = pace.value;
    pace.innerHTML = POLICY_OPTIONS.pace
      .filter((option) => !this.state.pauseUnavailable || option.value !== 0)
      .map(
        (option) => '<option value="' + option.idPart + '">' + paceName(option.value as number) + '</option>',
      )
      .join('');
    pace.value = this.state.pauseUnavailable && previous === '0' ? '1' : previous || '1';
  }

  private syncInputs() {
    this.updateElectorate();
    this.syncPauseControl();
    for (const spec of visibleInputSpecs) {
      const step = spec.step;
      const values = [spec.min, spec.max, DEFAULT_INPUTS[spec.key], this.state.inputs[spec.key]];
      for (let value = Math.ceil(spec.min / step) * step; value <= spec.max + 1e-9; value += step)
        values.push(Number(value.toFixed(8)));
      const choices = [...new Set(values)].sort((a, b) => a - b);
      this.sliderValues.set(spec.key, choices);
      const slider = el<HTMLInputElement>('input-' + spec.key);
      slider.max = String(choices.length - 1);
      slider.value = String(choices.indexOf(this.state.inputs[spec.key]));
      this.updateInputLabel(spec.key);
    }
    document.querySelectorAll<HTMLInputElement>('input[name="world"]').forEach((radio) => {
      radio.checked = radio.value === this.state.mode;
    });
    el<HTMLSelectElement>('foreign-objective').value = this.state.foreignObjective;
    el('foreign-objective-help').textContent = objectiveHelp[this.state.foreignObjective];
    el('foreign-inputs').hidden = this.state.mode !== 'strategic';
    el('manual-control-allowFreeTrade').hidden = this.state.mode !== 'strategic';
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
    document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((button) =>
      button.addEventListener('click', () => {
        this.state.inputs = { ...DEFAULT_INPUTS };
        if (button.dataset.preset === 'shared')
          Object.assign(this.state.inputs, {
            usGdpGrowth: 0.06,
            foreignGdpGrowth: 0.06,
            productivityGain: 0.1,
            displacement: 0.3,
            reemployment: 0.5,
            investmentResponse: 0.1,
          });
        if (button.dataset.preset === 'displacement')
          Object.assign(this.state.inputs, {
            usGdpGrowth: 0.025,
            foreignGdpGrowth: 0.025,
            productivityGain: 0.25,
            displacement: 0.7,
            reemployment: 0.05,
          });
        if (button.dataset.preset === 'tax-response') {
          this.state.mode = 'us-only';
          Object.assign(this.state.inputs, {
            investmentResponse: 1,
            usGdpGrowth: 0.1,
            foreignGdpGrowth: 0.1,
            productivityGain: 0.4,
            displacement: 0.35,
          });
        }
        if (button.dataset.preset === 'rivalry') {
          this.state.mode = 'strategic';
          Object.assign(this.state.inputs, {
            capitalMobility: 1,
            investmentResponse: 0.7,
            foreignStrength: 1,
          });
        }
        this.clearPreset();
        button.setAttribute('aria-pressed', 'true');
        this.syncInputs();
        this.changed();
      }),
    );
  }
}
