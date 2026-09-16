import {describe,it,expect} from 'vitest';
import {BASELINE_POLICY,CALIBRATION,DEFAULT_INPUTS,POLICIES,YEARS,currentPolicy,evaluateProfile,makePolicy,normalizeInputs,solveModel,type Policy} from './pirates-model';
import {US_COHORTS} from './us-electorate';
const policy=(changes:Partial<Policy>={})=>makePolicy({...currentPolicy(1),...changes});
const final=(p:ReturnType<typeof evaluateProfile>)=>p.us.at(-1)!;
const closed=(p:ReturnType<typeof evaluateProfile>)=>{
  for(const y of [...p.us,...(p.foreign??[])]) {
    expect(y.resourceResidual).toBeCloseTo(0,6);
    expect(y.benefitsPaid).toBeGreaterThanOrEqual(0);
    expect(y.benefitsPaid).toBeLessThanOrEqual(y.benefitsRequired+1e-7);
    expect(y.benefitsPaid+y.nonTransferSpending).toBeCloseTo(y.taxRevenue,7);
  }
};
describe('current adult-citizen calibration',()=>{
 it('keeps fixed normalized population weights rather than rounding voters',()=>{
  expect(CALIBRATION.weights.length).toBe(US_COHORTS.length);
  expect(CALIBRATION.weights.reduce((a,b)=>a+b,0)).toBeCloseTo(1,12);
  expect(CALIBRATION.weights.some(w=>Math.abs(w*1000-Math.round(w*1000))>.001)).toBe(true);
 });
 it('reproduces every observed baseline income, including losses and net refunds',()=>{
  const result=evaluateProfile(DEFAULT_INPUTS,BASELINE_POLICY,undefined,'us-only');
  for(const y of result.us){
   y.cohortIncome.forEach((income,i)=>expect(income).toBeCloseTo(US_COHORTS[i]!.disposableIncome,5));
   expect(y.allIncomeIndex).toBeCloseTo(100,9);expect(y.capacityFactor).toBe(1);expect(y.laborEffort).toBe(1);
   expect(y.governmentFundingGap).toBeCloseTo(0,6);
  }
  closed(result);expect(result.usAdmissible).toBe(true);
 });
 it('puts the current policy in each fixed-pace menu',()=>{
  for(const pace of [0,.33,.67,1])expect(POLICIES.some(p=>p.id===currentPolicy(pace).id)).toBe(true);
 });
 it('does not change survey weights when old ratio URL fields are supplied',()=>{
  expect(normalizeInputs({...DEFAULT_INPUTS,workerShare:.2} as never)).toEqual(DEFAULT_INPUTS);
 });
});
describe('separate policy decisions and accounting',()=>{
 it('retention is employer-funded and has its own gross wage target',()=>{
  const values={...DEFAULT_INPUTS,investmentResponse:0,displacement:.4};
  const off=evaluateProfile(values,policy({replacement:0}),undefined,'us-only');
  const retained=evaluateProfile(values,policy({replacement:.5}),undefined,'us-only');
  expect(final(retained).employerPay).toBeGreaterThan(0);
  expect(final(retained).capitalAfterRetention).toBeLessThan(final(off).capitalAfterRetention);
  expect(final(retained).employerPayRatio).toBeLessThanOrEqual(.5+1e-9);
  expect(final(retained).benefitsRequired).toBeCloseTo(final(off).benefitsRequired,9);closed(retained);
 });
 it('compares flat and prior-income allocations at the same funded budget',()=>{
  const base={pace:0,laborTax:.5,capitalTax:.5,welfareScale:1};
  const flat=final(evaluateProfile({...DEFAULT_INPUTS,investmentResponse:0},policy({...base,benefitFormula:'flat'}),undefined,'us-only'));
  const prior=final(evaluateProfile({...DEFAULT_INPUTS,investmentResponse:0},policy({...base,benefitFormula:'prior-income'}),undefined,'us-only'));
  const none=final(evaluateProfile({...DEFAULT_INPUTS,investmentResponse:0},policy({...base,welfareScale:0}),undefined,'us-only'));
  expect(flat.benefitsPaid).toBeCloseTo(prior.benefitsPaid,9);
  for(let i=0;i<US_COHORTS.length;i++)expect(flat.cohortIncome[i]!-none.cohortIncome[i]!).toBeCloseTo(flat.benefitsPaid,6);
  const low=US_COHORTS.findIndex(c=>c.disposableIncome<5000),high=US_COHORTS.findIndex(c=>c.disposableIncome>150000);
  expect(flat.cohortIncome[low]).toBeGreaterThan(prior.cohortIncome[low]!);
  expect(prior.cohortIncome[high]).toBeGreaterThan(flat.cohortIncome[high]!);
 });
 it('has actual0%and100%tax endpoints in all cohorts',()=>{
  for(const tax of [0,1]){
    const y=final(evaluateProfile({...DEFAULT_INPUTS,investmentResponse:0},policy({pace:0,laborTax:tax,capitalTax:tax}),undefined,'us-only'));
    expect(y.effectiveLaborTax).toBeCloseTo(tax,10);expect(y.effectiveCapitalTax).toBeCloseTo(tax,10);
  }
 });
 it('does not let zero tax finance unchanged public services',()=>{
  const result=evaluateProfile(DEFAULT_INPUTS,policy({laborTax:0,capitalTax:0}),undefined,'us-only');
  expect(result.usAdmissible).toBe(false);expect(final(result).governmentFundingGap).toBeGreaterThan(0);
  expect(final(result).benefitsPaid).toBe(0);closed(result);
 });
 it('caps welfare promises and spends surplus outside household benefits',()=>{
  const rich=evaluateProfile({...DEFAULT_INPUTS,investmentResponse:0},policy({pace:0,laborTax:1,capitalTax:1,welfareScale:.5}),undefined,'us-only');
  const y=final(rich);expect(y.benefitsScalePaid).toBeCloseTo(.5,9);expect(y.nonTransferSpending).toBeGreaterThan(CALIBRATION.nonTransferSpending);
  expect(y.consumption+y.nonTransferSpending).toBeCloseTo(CALIBRATION.marketIncome,6);closed(rich);
 });
 it('measures policy responses relative to current taxes',()=>{
  const at=evaluateProfile(DEFAULT_INPUTS,policy({pace:0}),undefined,'us-only');
  const high=evaluateProfile(DEFAULT_INPUTS,policy({pace:0,capitalTax:1,laborTax:1}),undefined,'us-only');
  const low=evaluateProfile(DEFAULT_INPUTS,policy({pace:0,capitalTax:0,laborTax:0}),undefined,'us-only');
  expect(final(at).output).toBeCloseTo(100,10);expect(final(high).output).toBeLessThan(100);expect(final(low).output).toBeGreaterThan(100);
 });
 it('disables incentive effects when the response parameter is zero',()=>{
  const low=final(evaluateProfile({...DEFAULT_INPUTS,investmentResponse:0},policy({capitalTax:0,laborTax:0}),undefined,'us-only'));
  const high=final(evaluateProfile({...DEFAULT_INPUTS,investmentResponse:0},policy({capitalTax:1,laborTax:1}),undefined,'us-only'));
  expect(low.output).toBeCloseTo(high.output,10);expect(low.adoption).toBeCloseTo(high.adoption,10);
 });
 it('preserves private and government budgets across extreme policies',()=>{
  const values={...DEFAULT_INPUTS,displacement:1,reemployment:0,investmentResponse:.8};
  for(const p of [policy({laborTax:1,capitalTax:1,replacement:1.25,welfareScale:2}),policy({laborTax:0,capitalTax:0,welfareScale:0}),policy({benefitFormula:'flat'})])closed(evaluateProfile(values,p,undefined,'us-only'));
 });
});
describe('international policies and objectives',()=>{
 it('uses independent deployment and GDP-conserving rent transfers',()=>{
  const p=evaluateProfile(DEFAULT_INPUTS,policy({pace:0}),policy({pace:1,capitalTax:.2}),'strategic');
  for(let i=1;i<=YEARS;i++)expect(p.us[i]!.netRentFlow+DEFAULT_INPUTS.foreignMarketSize*p.foreign![i]!.netRentFlow).toBeCloseTo(0,7);
  expect(final(p).adoption).toBe(0);expect(p.foreign!.at(-1)!.adoption).toBeGreaterThan(0);expect(final(p).exposure).toBeGreaterThan(0);closed(p);
 });
 it('keeps the foreign economy when frontier capability is zero',()=>{
  const p=evaluateProfile({...DEFAULT_INPUTS,foreignStrength:0},policy(),policy(),'strategic');
  expect(p.foreign).toHaveLength(YEARS+1);expect(p.foreign!.at(-1)!.adoption).toBe(0);expect(p.foreign!.at(-1)!.exposure).toBeGreaterThan(0);closed(p);
 });
 it.each(['workers','prosperity','output'] as const)('agrees between light, foreign-only and materialized scoring: %s',objective=>{
  const model=solveModel(DEFAULT_INPUTS,{mode:'strategic',objective:'workers',foreignObjective:objective});
  const a=policy({laborTax:.4,capitalTax:.5}),b=policy({pace:.67,laborTax:.4,capitalTax:.5,benefitFormula:'flat'});
  const full=model.evaluate(a,b),light=model.evaluateLight(a,b);
  expect(light.foreignScore).toBeCloseTo(full.foreignScore!,11);expect(light.usUtilities).toEqual(full.usUtilities);
  expect(model.evaluateForeign(a,b)).toBeCloseTo(full.foreignScore!,11);
 });
});
