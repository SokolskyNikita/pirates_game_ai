/** Static display data exported by the Python model at build time. */
import data from '../../generated/calculator-config.json';
import type { CalculatorConfig } from '../api/types';
const config = data as CalculatorConfig;
export const DEFAULT_INPUTS = config.defaults;
export const INPUT_SPECS = config.inputSpecs;
export const POLICY_OPTIONS = config.policyOptions;
export const CALIBRATION = config.calibration;
export const US_ELECTORATE = config.electorate;
export const MODEL_NOTES = config.modelNotes;
