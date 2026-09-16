import {BASELINE_POLICY,currentPolicy,solveModel,type ModelInputs,type ModelMode,type Objective,type Policy,type ProfileOutcome} from './pirates-model';
import {coordinateAlternatives,solveVoting,type VotingOutcome,type VotingResult} from './pirates-voting';
import {solveTreaty,type TreatyOutcome} from './pirates-treaty';
export interface ScenarioRequest {id:number;inputs:ModelInputs;mode:ModelMode;foreignObjective:Objective;pace:number}
export interface ScenarioSnapshot {
 inputs:ModelInputs;mode:ModelMode;foreignObjective:Objective;pace:number;
 selected:VotingOutcome;statusQuo:ProfileOutcome;baseline:ProfileOutcome;alternatives:ProfileOutcome[];
 stableCount:number;selection:VotingResult['selection'];policyCount:number;foreignPolicyCount:number;
 searchedPairs:number;startsTried:number;iterations:number;searchReason:string;foreignBestPolicy?:Policy;
 treaty?:TreatyOutcome;
}
export type ScenarioResponse={id:number;snapshot:ScenarioSnapshot;error?:never}|{id:number;error:string;snapshot?:never};
/** Only the selected policy and its direct amendments cross the worker boundary. */
export function solveScenario(request:ScenarioRequest):ScenarioSnapshot {
 const model=solveModel(request.inputs,{mode:request.mode,objective:'workers',foreignObjective:request.foreignObjective,pace:request.pace});
 const votes=solveVoting(model),selected=votes.selected;
 const alternatives=coordinateAlternatives(model.policies,selected.usPolicy).map(p=>model.evaluate(p,selected.foreignPolicy));
 return {
  inputs:model.inputs,mode:model.mode,foreignObjective:model.foreignObjective,pace:model.pace,selected,
  statusQuo:model.evaluate(currentPolicy(model.pace),selected.foreignPolicy),
  baseline:model.evaluate(BASELINE_POLICY,model.mode==='strategic'?BASELINE_POLICY:undefined),
  alternatives,stableCount:votes.majorityStable.length,selection:votes.selection,policyCount:model.policies.length,
  foreignPolicyCount:model.foreignPolicies.length,searchedPairs:votes.evaluations,startsTried:votes.startsTried,iterations:votes.iterations,
  searchReason:votes.selection==='verified-stable'?'Every admissible US single-decision change and every foreign package was checked. Other stable policies may exist.':'The bounded search did not verify a stable policy. This does not prove that none exists.',
  foreignBestPolicy:model.foreignPolicies.find(p=>p.id===selected.foreignBestResponsePolicyId),
  treaty:model.mode==='strategic'?solveTreaty(model,selected,votes.selection==='verified-stable'):undefined,
 };
}
