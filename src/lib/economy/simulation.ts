import { BASELINE_POLICY, POLICIES, currentPolicy, solveModel, type ModelInputs, type ModelMode, type Objective, type Policy, type ProfileOutcome } from './pirates-model';
import { solvePackageElection, type ElectionSearch, type PackageElectionResult } from './package-election';
import type { PackageBallotResult } from './package-ballot';
export interface ScenarioRequest { id: number; inputs: ModelInputs; mode: ModelMode; foreignObjective: Objective; /** Exclude a pause from both actors’ policy menus. */ pauseUnavailable?: boolean; /** Legacy callers may supply this; deployment is now on the ballot. */ pace?: number }
export interface ScenarioSnapshot {
  inputs: ModelInputs; mode: ModelMode; foreignObjective: Objective; pauseUnavailable: boolean;
  selected: ProfileOutcome; statusQuo: ProfileOutcome; baseline: ProfileOutcome;
  /** At most eight highest-support funded packages, including the selected policy when it ranks. */
  alternatives: ProfileOutcome[]; leading?: ProfileOutcome;
  ballot: PackageBallotResult; selection: PackageElectionResult['selection'];
  policyCount: number; foreignPolicyCount: number; evaluations: number; search: ElectionSearch;
  foreignBestPolicy?: Policy; foreignBestResponseGain?: number;
}
export type ScenarioResponse = { id: number; snapshot: ScenarioSnapshot; error?: never } | { id: number; error: string; snapshot?: never };
/** Only selected, reference, and leading profiles cross the worker boundary. */
export function solveScenario(request: ScenarioRequest): ScenarioSnapshot {
  const model = solveModel(request.inputs, { mode: request.mode, objective: 'workers', foreignObjective: request.foreignObjective, pace: 1 });
  const pauseUnavailable = request.pauseUnavailable ?? false;
  const policies = pauseUnavailable ? POLICIES.filter(policy => policy.pace !== 0) : POLICIES;
  const foreignPolicies = pauseUnavailable ? model.foreignPolicies.filter(policy => policy.pace !== 0) : model.foreignPolicies;
  const election = solvePackageElection({ ...model, policies, foreignPolicies, currentPolicy: currentPolicy(1) });
  const cache = new Map<string, ProfileOutcome>();
  const materialize = (policy: Policy, foreign = election.foreignPolicy): ProfileOutcome => {
    const key = policy.id + '::' + (foreign?.id ?? 'none');
    let profile = cache.get(key);
    if (!profile) { profile = model.evaluate(policy, foreign); cache.set(key, profile); }
    return profile;
  };
  const byId = new Map(policies.map(policy => [policy.id, policy]));
  const ranked = [...election.ballot.tallies].sort((a, b) => b.supportPercent - a.supportPercent || (a.policyId < b.policyId ? -1 : a.policyId > b.policyId ? 1 : 0));
  const selected = materialize(election.usPolicy);
  const alternatives = ranked.slice(0, 8).map(tally => materialize(byId.get(tally.policyId)!));
  return {
    inputs: model.inputs, mode: model.mode, foreignObjective: model.foreignObjective, pauseUnavailable, selected,
    statusQuo: materialize(currentPolicy(1)),
    baseline: model.evaluate(BASELINE_POLICY, model.mode === 'strategic' ? BASELINE_POLICY : undefined),
    alternatives, leading: alternatives[0], ballot: election.ballot, selection: election.selection,
    policyCount: policies.length, foreignPolicyCount: foreignPolicies.length, evaluations: election.evaluations,
    search: election.search, foreignBestPolicy: election.foreignBestPolicy, foreignBestResponseGain: election.foreignBestResponseGain,
  };
}
