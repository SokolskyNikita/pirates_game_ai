import { solveModel, type ModelInputs, type ModelMode, type Objective, type Policy, type ProfileOutcome } from './pirates-model';
import { solveVoting, type VotingAgendaStep, type VotingOutcome, type VotingResult } from './pirates-voting';

export interface ScenarioRequest {
  id: number;
  inputs: ModelInputs;
  mode: ModelMode;
  foreignObjective: Objective;
  pace: number;
}

export interface ScenarioSnapshot {
  inputs: ModelInputs;
  mode: ModelMode;
  foreignObjective: Objective;
  pace: number;
  selected: VotingOutcome;
  statusQuo: ProfileOutcome;
  baseline: ProfileOutcome;
  workerBenchmark: ProfileOutcome;
  alternatives: ProfileOutcome[];
  stableCount: number;
  selection: VotingResult['selection'];
  policyCount: number;
  pairCount: number;
  hasMajorityCycle: boolean;
  agendaSteps: VotingAgendaStep[];
  foreignBestPolicy?: Policy;
}

export type ScenarioResponse = { id: number; snapshot: ScenarioSnapshot; error?: never }
  | { id: number; error: string; snapshot?: never };

// Only the selected pair and its 108 US alternatives cross the worker boundary.
// The full international grid, its caches and solver functions stay off the UI thread.
function materialize<T extends ProfileOutcome>(profile: T): T {
  const { us, foreign, ...metadata } = profile;
  return { ...metadata, us, foreign } as T;
}

export function solveScenario(request: ScenarioRequest): ScenarioSnapshot {
  const model = solveModel(request.inputs, {
    mode: request.mode, objective: 'workers', foreignObjective: request.foreignObjective, pace: request.pace,
  });
  const votes = solveVoting(model);
  const selected = materialize(votes.selected);
  const alternatives = model.outcomes
    .filter(profile => profile.foreignPolicy?.id === selected.foreignPolicy?.id)
    .map(materialize);
  const statusQuo = alternatives.find(({ usPolicy: p }) => p.replacement === 0 && p.safetyNet === 0 && p.workerTax === 0 && p.tax === 0)!;
  let workerBenchmark = alternatives[0]!;
  for (const profile of alternatives) if (profile.usScore > workerBenchmark.usScore + 1e-10) workerBenchmark = profile;
  return {
    inputs: model.inputs, mode: model.effectiveMode, foreignObjective: model.foreignObjective,
    pace: request.pace, selected, statusQuo, baseline: materialize(model.baseline), workerBenchmark,
    alternatives, stableCount: votes.majorityStable.length, selection: votes.selection,
    policyCount: model.policies.length, pairCount: model.outcomes.length,
    hasMajorityCycle: votes.hasMajorityCycle, agendaSteps: votes.agendaSteps,
    foreignBestPolicy: model.foreignPolicies.find(policy => policy.id === selected.foreignBestResponsePolicyId),
  };
}
