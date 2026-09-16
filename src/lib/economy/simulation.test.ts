import {describe,it,expect} from 'vitest';
import {solveScenario} from './simulation';
import {DEFAULT_INPUTS,solveModel,EQUILIBRIUM_TOLERANCE} from './pirates-model';
import {countVotes,changedPolicyAxes,hasMajority} from './pirates-voting';
describe('weighted scenario snapshots',()=>{
 it('sends cloneable selected outcomes and only one-axis alternatives',()=>{
  const s=solveScenario({id:1,inputs:DEFAULT_INPUTS,mode:'us-only',foreignObjective:'prosperity',pace:1});
  const clone=structuredClone(s);expect(clone.selected.usUtilities).toEqual(s.selected.usUtilities);
  expect(s.policyCount).toBeGreaterThan(1000);expect(s.alternatives.length).toBeLessThan(30);
  for(const a of s.alternatives)expect(changedPolicyAxes(a.usPolicy,s.selected.usPolicy)).toHaveLength(1);
  expect(s.statusQuo.usPolicy.welfareScale).toBe(1);expect(s.statusQuo.usPolicy.benefitFormula).toBe('current');
  expect(s.baseline.us.at(-1)!.allIncomeIndex).toBeCloseTo(100,8);
  if(s.selection==='verified-stable')expect(hasMajority(s.selected.usDeviationVotes)).toBe(false);
 });
 it.each(['workers','prosperity','output'] as const)('independently verifies all foreign responses and US amendments for %s',objective=>{
  const s=solveScenario({id:2,inputs:DEFAULT_INPUTS,mode:'strategic',foreignObjective:objective,pace:1});
  expect(s.selected.usAdmissible).toBe(true);expect(s.selected.foreignAdmissible).toBe(true);
  expect(s.foreignPolicyCount).toBe(4*s.policyCount);
  expect(s.statusQuo.foreignPolicy?.id).toBe(s.selected.foreignPolicy?.id);
  const model=solveModel(DEFAULT_INPUTS,{mode:'strategic',objective:'workers',foreignObjective:objective,pace:1});
  let best=-Infinity;
  for(const policy of model.foreignPolicies)best=Math.max(best,model.evaluateForeign(s.selected.usPolicy,policy));
  expect(Math.max(0,best-s.selected.foreignScore!)).toBeCloseTo(s.selected.foreignBestResponseGain,10);
  let strongest=0;
  for(const alternative of s.alternatives)if(alternative.usAdmissible)strongest=Math.max(strongest,countVotes(alternative.usUtilities,s.selected.usUtilities));
  expect(strongest).toBeCloseTo(s.selected.usDeviationVotes,10);
  if(s.selection==='verified-stable') {expect(strongest).toBeLessThanOrEqual(50+1e-10);expect(best-s.selected.foreignScore!).toBeLessThanOrEqual(EQUILIBRIUM_TOLERANCE);}
  for(const y of [...s.selected.us,...s.selected.foreign!])expect(y.resourceResidual).toBeCloseTo(0,6);
 },15000);
 it('lets the foreign actor deploy when the US scenario is paused',()=>{
  const s=solveScenario({id:3,inputs:{...DEFAULT_INPUTS,displacement:0,investmentResponse:0},mode:'strategic',foreignObjective:'output',pace:0});
  expect(s.selected.usPolicy.pace).toBe(0);expect(s.selected.foreignPolicy!.pace).toBe(1);
  expect(s.selected.us.at(-1)!.exposure).toBeGreaterThan(0);
 },15000);
});
