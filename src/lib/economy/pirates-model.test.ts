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

describe('independent annual GDP growth',()=>{
 it('defaults both potential annual growth rates to 5%',()=>{
  expect(DEFAULT_INPUTS.usGdpGrowth).toBe(.05);expect(DEFAULT_INPUTS.foreignGdpGrowth).toBe(.05);
  expect(normalizeInputs({usGdpGrowth:9,foreignGdpGrowth:-1})).toMatchObject({usGdpGrowth:.2,foreignGdpGrowth:0});
 });
 it('compounds each year at that year’s exposure, reaching 5% growth at full AI',()=>{
  const result=evaluateProfile({...DEFAULT_INPUTS,investmentResponse:0},policy(),undefined,'us-only');
  let expected=100;
  for(let year=1;year<=YEARS;year++){
   const point=result.us[year]!;expected*=1+.05*year/YEARS;
   expect(point.output).toBeCloseTo(expected,10);
   expect(point.potentialOutput).toBeCloseTo(expected,10);
   expect(point.potentialGrowthRate).toBeCloseTo(.05*year/YEARS,12);
   expect(point.gdpGrowthRate).toBeCloseTo(.05*year/YEARS,12);
  }
  expect(final(result).gdpGrowthRate).toBeCloseTo(.05,12);
  expect(final(result).output).toBeLessThan(100*1.05**YEARS);
  closed(result);
 });
 it('keeps the no-AI reference unchanged even at a high full-AI growth assumption',()=>{
  const result=evaluateProfile({...DEFAULT_INPUTS,usGdpGrowth:.2},BASELINE_POLICY,undefined,'us-only');
  for(const point of result.us){expect(point.output).toBe(100);expect(point.potentialOutput).toBe(100);expect(point.gdpGrowthRate).toBe(0);}
  closed(result);
 });
 it('does not subtract the production replaced by AI when every role becomes obsolete',()=>{
  const result=evaluateProfile({...DEFAULT_INPUTS,usGdpGrowth:0,investmentResponse:0,displacement:1,reemployment:0},policy(),undefined,'us-only');
  expect(final(result).unemployment).toBeCloseTo(1,12);
  expect(final(result).output).toBeCloseTo(100,12);
  expect(final(result).laborIncome).toBeCloseTo(0,8);
  closed(result);
 });
 it('does not use the firm productivity assumption to set gross GDP',()=>{
  const low=evaluateProfile({...DEFAULT_INPUTS,productivityGain:0},policy({replacement:.5}),undefined,'us-only');
  const high=evaluateProfile({...DEFAULT_INPUTS,productivityGain:1},policy({replacement:.5}),undefined,'us-only');
  low.us.forEach((point,i)=>{
   expect(point.output).toBeCloseTo(high.us[i]!.output,12);
   expect(point.potentialOutput).toBeCloseTo(high.us[i]!.potentialOutput,12);
  });
 });
 it('keeps each region’s potential growth independent while conserving rent transfers',()=>{
  const assumptions={...DEFAULT_INPUTS,investmentResponse:0,usGdpGrowth:.02,foreignGdpGrowth:.1};
  const result=evaluateProfile(assumptions,policy(),policy(),'strategic');
  const fasterUS=evaluateProfile({...assumptions,usGdpGrowth:.15},policy(),policy(),'strategic');
  for(let year=1;year<=YEARS;year++){
   const us=result.us[year]!,foreign=result.foreign![year]!;
   expect(us.potentialGrowthRate).toBeCloseTo(.02*us.exposure,12);
   expect(foreign.potentialGrowthRate).toBeCloseTo(.1*foreign.exposure,12);
   expect(foreign.output).toBeCloseTo(fasterUS.foreign![year]!.output,12);
   expect(us.netRentFlow+assumptions.foreignMarketSize*foreign.netRentFlow).toBeCloseTo(0,7);
  }
  expect(final(fasterUS).output).toBeGreaterThan(final(result).output);
  closed(result);closed(fasterUS);
 });
 it('lets imported AI contribute to growth without domestic frontier deployment',()=>{
  const result=evaluateProfile({...DEFAULT_INPUTS,investmentResponse:0},policy({pace:0}),policy(),'strategic');
  expect(final(result).adoption).toBe(0);expect(final(result).exposure).toBeGreaterThan(0);
  expect(final(result).potentialOutput).toBeGreaterThan(100);closed(result);
 });
});

describe('firm returns within independently specified GDP',()=>{
 it('allocates more income to investment at higher employer gains, without extra GDP',()=>{
  const assumptions={...DEFAULT_INPUTS,investmentResponse:0,displacement:.7,reemployment:0};
  const low=evaluateProfile({...assumptions,productivityGain:0},policy(),undefined,'us-only');
  const high=evaluateProfile({...assumptions,productivityGain:1},policy(),undefined,'us-only');
  expect(final(high).capitalIncome).toBeGreaterThan(final(low).capitalIncome);
  expect(final(high).laborIncome).toBeLessThan(final(low).laborIncome);
  low.us.forEach((point,i)=>expect(point.output).toBeCloseTo(high.us[i]!.output,12));
  closed(low);closed(high);
 });
 it('leaves incomes unchanged when there are no obsolete roles to automate',()=>{
  const assumptions={...DEFAULT_INPUTS,displacement:0};
  const low=evaluateProfile({...assumptions,productivityGain:0},policy(),undefined,'us-only');
  const high=evaluateProfile({...assumptions,productivityGain:1},policy(),undefined,'us-only');
  low.us.forEach((point,i)=>{
   expect(point.cohortIncome).toEqual(high.us[i]!.cohortIncome);
   expect(point.capitalIncome).toBeCloseTo(high.us[i]!.capitalIncome,12);
  });
 });
 it('deducts exactly the funded retained salary from employer returns',()=>{
  const assumptions={...DEFAULT_INPUTS,investmentResponse:0,displacement:.4,reemployment:0,productivityGain:.5};
  const laidOff=evaluateProfile(assumptions,policy({replacement:0}),undefined,'us-only');
  const retained=evaluateProfile(assumptions,policy({replacement:1}),undefined,'us-only');
  for(let year=1;year<=YEARS;year++){
   const off=laidOff.us[year]!,keep=retained.us[year]!;
   expect(keep.output).toBeCloseTo(off.output,12);
   expect(keep.capitalIncome).toBeCloseTo(off.capitalIncome,8);
   expect(off.capitalAfterRetention-keep.capitalAfterRetention).toBeCloseTo(keep.employerPay,8);
  }
  expect(final(retained).employerPay).toBeGreaterThan(0);
  closed(laidOff);closed(retained);
 });
});


describe('deployment endpoints and obsolete work',()=>{
 it('makes every role obsolete by year ten at full deployment, even under high policy burdens',()=>{
  for(const investmentResponse of [0,.35,1])for(const replacement of [0,1.25]){
   const assumptions={...DEFAULT_INPUTS,displacement:1,reemployment:0,investmentResponse};
   const high=policy({capitalTax:1,laborTax:1,replacement});
   const result=evaluateProfile(assumptions,high,high,'strategic');
   for(const region of [result.us,result.foreign!]){
    const end=region.at(-1)!;
    expect(end.adoption).toBe(1);expect(end.exposure).toBe(1);
    expect(end.unemployment).toBeCloseTo(1,12);
    expect(end.laborIncome).toBeCloseTo(0,8);
    for(let i=1;i<region.length;i++){
     expect(region[i]!.adoption).toBeGreaterThanOrEqual(region[i-1]!.adoption);
     expect(region[i]!.unemployment).toBeCloseTo(region[i]!.exposure,12);
    }
   }
   closed(result);
  }
 });
 it('preserves partial and zero deployment targets without imports',()=>{
  for(const pace of [0,.33,.67])for(const capitalTax of [0,1]){
   const result=evaluateProfile({...DEFAULT_INPUTS,displacement:1,reemployment:0,investmentResponse:1},policy({pace,capitalTax}),undefined,'us-only');
   expect(final(result).adoption).toBe(pace);
   expect(final(result).unemployment).toBeCloseTo(pace,12);
   for(const point of result.us)expect(point.adoption).toBeLessThanOrEqual(pace);
   closed(result);
  }
 });
 it('delays rollout under tax burdens and advances it under relief without changing the endpoint',()=>{
  const assumptions={...DEFAULT_INPUTS,displacement:1,reemployment:0,investmentResponse:1};
  const reference=evaluateProfile(assumptions,policy(),undefined,'us-only');
  const delayed=evaluateProfile(assumptions,policy({capitalTax:1,replacement:1.25}),undefined,'us-only');
  const earlier=evaluateProfile(assumptions,policy({capitalTax:0}),undefined,'us-only');
  for(let year=1;year<YEARS;year++){
   expect(reference.us[year]!.adoption).toBeCloseTo(year/YEARS,12);
   expect(delayed.us[year]!.adoption).toBeLessThan(reference.us[year]!.adoption);
   expect(earlier.us[year]!.adoption).toBeGreaterThan(reference.us[year]!.adoption);
   expect(earlier.us[year]!.adoption).toBeLessThan(1);
  }
  for(const result of [reference,delayed,earlier])expect(final(result).adoption).toBe(1);
  expect(final(delayed).capacityFactor).toBeLessThan(final(reference).capacityFactor);
  expect(final(delayed).output).toBeLessThan(final(reference).output);
  expect(delayed.us[1]!.investmentCost).toBeLessThan(reference.us[1]!.investmentCost);
  expect(final(delayed).investmentCost).toBeGreaterThan(final(reference).investmentCost);
  closed(delayed);closed(earlier);
 });
 it('keeps response-free deployment linear under the same burdens',()=>{
  const result=evaluateProfile({...DEFAULT_INPUTS,investmentResponse:0},policy({replacement:1.25,capitalTax:1}),undefined,'us-only');
  for(const point of result.us)expect(point.adoption).toBeCloseTo(point.year/YEARS,12);
 });
 it('combines independent partial targets with imported AI and frontier capability',()=>{
  const assumptions={...DEFAULT_INPUTS,displacement:1,reemployment:0,investmentResponse:1,foreignStrength:.6,tradeIntensity:.2,foreignTradeIntensity:.3};
  const result=evaluateProfile(assumptions,policy({pace:.33,capitalTax:1}),policy({pace:.67,capitalTax:0}),'strategic');
  const us=final(result),foreign=result.foreign!.at(-1)!;
  expect(us.adoption).toBe(.33);expect(foreign.adoption).toBeCloseTo(.67*.6,12);
  expect(us.exposure).toBeCloseTo(.33+.2*(.67*.6)*(1-.33),12);
  expect(foreign.exposure).toBeCloseTo(.67*.6+.3*.33*(1-.67*.6),12);
  for(const point of [...result.us,...result.foreign!]){
   expect(point.unemployment).toBeCloseTo(point.exposure,12);
   expect(point.unemployment).toBeGreaterThanOrEqual(0);expect(point.unemployment).toBeLessThanOrEqual(1);
  }
  closed(result);
 });
 it('allows imported AI with zero domestic deployment or zero foreign frontier capability',()=>{
  const assumptions={...DEFAULT_INPUTS,displacement:1,reemployment:0,investmentResponse:1};
  const paused=evaluateProfile(assumptions,policy({pace:0,capitalTax:1}),policy({capitalTax:1}),'strategic');
  expect(final(paused).adoption).toBe(0);
  expect(final(paused).unemployment).toBeCloseTo(assumptions.tradeIntensity,12);
  const noFrontier=evaluateProfile({...assumptions,foreignStrength:0},policy({capitalTax:1}),policy({capitalTax:1}),'strategic');
  const foreign=noFrontier.foreign!.at(-1)!;
  expect(foreign.adoption).toBe(0);
  expect(foreign.unemployment).toBeCloseTo(assumptions.foreignTradeIntensity,12);
  closed(paused);closed(noFrontier);
 });
 it('restores productive work without reducing the deployment target',()=>{
  const result=evaluateProfile({...DEFAULT_INPUTS,displacement:1,reemployment:.5,investmentResponse:1},policy({capitalTax:1}),undefined,'us-only');
  const end=final(result);
  expect(end.adoption).toBe(1);expect(end.exposure).toBe(1);
  expect(end.unemployment).toBeGreaterThan(0);expect(end.unemployment).toBeLessThan(1);
  expect(end.laborIncome).toBeGreaterThan(0);
  const totalNew=result.us.reduce((sum,point)=>sum+point.newlyDisplaced,0);
  const totalRestored=result.us.reduce((sum,point)=>sum+point.reemployed,0);
  expect(totalNew-totalRestored).toBeCloseTo(end.unemployment,12);
  closed(result);
 });
});
