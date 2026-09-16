/** A finite, illustrative policy game calibrated to adult-citizen household
 * resources. Its output index is not a dollar GDP forecast. */
import { US_COHORTS, type USIncomeCohort } from './us-electorate';
export type ModelMode = 'us-only' | 'strategic';
export type Objective = 'prosperity' | 'output' | 'workers';
export type BenefitFormula = 'current' | 'flat' | 'prior-income';
export interface ModelInputs {
  productivityGain: number; displacement: number; reemployment: number;
  capitalMobility: number; investmentResponse: number; foreignStrength: number;
  tradeIntensity: number; foreignMarketSize: number; foreignPopulationRatio: number; foreignTradeIntensity: number;
}
export interface InputSpec { key: keyof ModelInputs; label: string; min: number; max: number; step: number; description: string }
export const DEFAULT_INPUTS: ModelInputs = {
  productivityGain: .4, displacement: .35, reemployment: .2, capitalMobility: .5, investmentResponse: .35,
  foreignStrength: 1, tradeIntensity: .14175546, foreignMarketSize: 2.8463217399,
  foreignPopulationRatio: 23.0368311373, foreignTradeIntensity: .03916185,
};
export const INPUT_SPECS: readonly InputSpec[] = [
  {key:'productivityGain',label:'Potential productivity gain',min:0,max:1,step:.05,description:'Extra output at full AI exposure before displacement and resource costs; a scenario assumption.'},
  {key:'displacement',label:'Roles made obsolete',min:0,max:1,step:.05,description:'Share of work exposed to displacement at full adoption. The same risk applies to household labor income across income bands.'},
  {key:'reemployment',label:'Return to productive work',min:0,max:1,step:.05,description:'Share of affected labor income restored to productive work each year.'},
  {key:'investmentResponse',label:'Response to policy changes',min:0,max:1,step:.05,description:'Strength of investment and labor responses to policy changes relative to current taxes. An assumption, not an estimated elasticity.'},
  {key:'capitalMobility',label:'Mobile AI rents',min:0,max:1,step:.05,description:'Response of mobile AI returns to international differences in adoption and policy burdens.'},
  {key:'foreignStrength',label:'Foreign frontier capability',min:0,max:1,step:.05,description:'Foreign frontier adoption relative to the US. At zero, the foreign economy can still import AI.'},
  {key:'tradeIntensity',label:'US import exposure',min:0,max:1,step:.01,description:'AI spillover exposure anchored to 2025 US imports / GDP; the spillover mechanism is assumed.'},
  {key:'foreignMarketSize',label:'Rest-of-world GDP / US GDP',min:.25,max:8,step:.1,description:'2025 nominal GDP ratio, used for international rent accounting.'},
  {key:'foreignPopulationRatio',label:'Rest-of-world population / US population',min:.25,max:40,step:.25,description:'Population reference; separate from the GDP weight.'},
  {key:'foreignTradeIntensity',label:'Foreign exposure to US exports',min:0,max:1,step:.01,description:'2025 US exports / rest-of-world GDP. Trade within the foreign bloc is internal.'},
];
export interface Policy {
  id: string; label: string; pace: number; replacement: number; welfareScale: number;
  benefitFormula: BenefitFormula; laborTax: number; capitalTax: number;
}
export const YEARS=10, DISCOUNT_RATE=.03, EQUILIBRIUM_TOLERANCE=1e-10, UTILITY_OFFSET=.01, CAPACITY_RENEWAL_RATE=.05;
const clamp=(v:number,min=0,max=1)=>Math.max(min,Math.min(max,v));
export function normalizeInputs(values:Partial<ModelInputs>={}):ModelInputs {
  const result={...DEFAULT_INPUTS};
  for(const s of INPUT_SPECS) if(typeof values[s.key]==='number'&&Number.isFinite(values[s.key])) result[s.key]=clamp(values[s.key]!,s.min,s.max);
  return result;
}
interface Cell {
  source: USIncomeCohort; weight:number; labor:number; capital:number; passive:number; taxablePassive:number;
  benefit:number; prior:number; laborRate:number; capitalRate:number; hasLabor:boolean;
}
export interface Calibration {
  marketIncome:number; laborIncome:number; capitalIncome:number; passiveIncome:number;
  benefits:number; cashAndInKindBenefits:number; refundableCredits:number; tax:number;
  nonTransferSpending:number; laborTaxRate:number; capitalTaxRate:number;
  laborTaxBase:number; capitalTaxBase:number; weights:number[]; workerShare:number;
}
interface Prepared {cells:Cell[]; calibration:Calibration; baselineIncome:number[]; baselineWorkerIncome:number; baselineOwnerIncome:number; baselineAllIncome:number}
function prepare(cohorts:readonly USIncomeCohort[]):Prepared {
  const totalWeight=cohorts.reduce((s,c)=>s+c.weight,0);
  if(!cohorts.length||!Number.isFinite(totalWeight)||totalWeight<=0||cohorts.some(c=>!Number.isFinite(c.weight)||c.weight<0)) throw new RangeError('Cohorts need finite nonnegative citizen weights with a positive total.');
  const sums={marketIncome:0,laborIncome:0,capitalIncome:0,passiveIncome:0,benefits:0,cashAndInKindBenefits:0,refundableCredits:0,tax:0,nonTransferSpending:0,laborTaxRate:0,capitalTaxRate:0,laborTaxBase:0,capitalTaxBase:0,weights:[] as number[],workerShare:0};
  let laborTax=0,capitalTax=0;
  const cells=cohorts.map(c=>{
    const values=[c.laborIncome,c.capitalIncome,c.pensionIncome,c.otherIncome,c.benefits,c.laborTaxBaseline,c.capitalTaxBaseline];
    if(values.some(v=>!Number.isFinite(v)))throw new RangeError('Cohort income and tax values must be finite.');
    const weight=c.weight/totalWeight,labor=Math.max(0,c.laborIncome),capital=Math.max(0,c.capitalTaxBase),passive=c.pensionIncome+c.otherIncome+Math.min(0,c.laborIncome)+c.capitalIncome-capital;
    const credit=Math.max(0,-c.laborTaxBaseline)+Math.max(0,-c.capitalTaxBaseline);
    const benefit=Math.max(0,c.benefits)+credit;
    const lt=Math.max(0,c.laborTaxBaseline),ct=Math.max(0,c.capitalTaxBaseline);
    const prior=Math.max(0,labor+capital+passive+benefit-lt-ct);
    sums.marketIncome+=weight*(labor+capital+passive);sums.laborIncome+=weight*labor;sums.capitalIncome+=weight*capital;sums.passiveIncome+=weight*passive;
    sums.benefits+=weight*benefit;sums.cashAndInKindBenefits+=weight*Math.max(0,c.benefits);sums.refundableCredits+=weight*credit;
    sums.tax+=weight*(lt+ct);sums.laborTaxBase+=weight*c.noncapitalTaxBase;sums.capitalTaxBase+=weight*capital;
    laborTax+=weight*lt;capitalTax+=weight*ct;sums.weights.push(weight);if(c.group==='work')sums.workerShare+=weight;
    return {source:c,weight,labor,capital,passive,taxablePassive:c.noncapitalTaxBase-labor,benefit,prior,laborRate:c.noncapitalTaxBase>0?lt/c.noncapitalTaxBase:0,capitalRate:capital>0?ct/capital:0,hasLabor:labor>0};
  });
  if(sums.marketIncome<=0||sums.capitalIncome<=0)throw new RangeError('Calibration requires positive market resources and investment income.');
  sums.laborTaxRate=laborTax/sums.laborTaxBase;sums.capitalTaxRate=capitalTax/sums.capitalTaxBase;
  // Benefits include modeled net refunds; levies are their positive tax components.
  // No baseline deficit is silently invented if the selected data scope fails this closure.
  if(sums.tax+1e-7<sums.benefits)throw new RangeError('Baseline benefits exceed modeled taxes; an explicit baseline funding source is required.');
  sums.nonTransferSpending=Math.max(0,sums.tax-sums.benefits);
  const baselineIncome=cells.map(c=>c.prior);
  const groupIncome=(group:string)=>cells.reduce((s,c)=>s+(c.source.group===group?c.weight*c.prior:0),0);
  return {cells,calibration:sums,baselineIncome,baselineWorkerIncome:groupIncome('work'),baselineOwnerIncome:groupIncome('capital'),baselineAllIncome:cells.reduce((s,c)=>s+c.weight*c.prior,0)};
}
const PREPARED=prepare(US_COHORTS);
export const CALIBRATION:Calibration=PREPARED.calibration;
const unique=(xs:number[])=>xs.map(x=>clamp(x)).filter((x,i,a)=>a.findIndex(v=>Math.abs(v-x)<1e-12)===i);
export const LABOR_TAX_CHOICES=unique([0,CALIBRATION.laborTaxRate-.1,CALIBRATION.laborTaxRate,CALIBRATION.laborTaxRate+.1,CALIBRATION.laborTaxRate+.3,1]);
export const CAPITAL_TAX_CHOICES=unique([0,CALIBRATION.capitalTaxRate-.1,CALIBRATION.capitalTaxRate,CALIBRATION.capitalTaxRate+.1,CALIBRATION.capitalTaxRate+.3,1]);
export const RETENTION_CHOICES=[0,.5,1,1.25] as const;
export const WELFARE_CHOICES=[0,.5,1,1.5,2] as const;
export const BENEFIT_FORMULAS=['current','flat','prior-income'] as const;
export const PACE_CHOICES=[0,.33,.67,1] as const;
export function makePolicy(values:Omit<Policy,'id'|'label'>):Policy {
  const {pace,replacement,welfareScale,benefitFormula,laborTax,capitalTax}=values;
  const id=[pace,replacement,welfareScale,benefitFormula,laborTax,capitalTax].join('|');
  return {...values,id,label:`${replacement?`Retain at ${Math.round(replacement*100)}%`:'Allow layoffs'} · benefits ${welfareScale*100}% · ${benefitFormula} · noncapital ${Math.round(laborTax*1000)/10}% / investment ${Math.round(capitalTax*1000)/10}% tax`};
}
export const POLICIES:readonly Policy[]=PACE_CHOICES.flatMap(pace=>RETENTION_CHOICES.flatMap(replacement=>WELFARE_CHOICES.flatMap(welfareScale=>BENEFIT_FORMULAS.flatMap(benefitFormula=>LABOR_TAX_CHOICES.flatMap(laborTax=>CAPITAL_TAX_CHOICES.map(capitalTax=>makePolicy({pace,replacement,welfareScale,benefitFormula,laborTax,capitalTax})))))));
export const BASELINE_POLICY=makePolicy({pace:0,replacement:0,welfareScale:1,benefitFormula:'current',laborTax:CALIBRATION.laborTaxRate,capitalTax:CALIBRATION.capitalTaxRate});
export function policiesAtPace(pace=1):readonly Policy[] {
  if(!PACE_CHOICES.some(p=>Math.abs(p-pace)<1e-9))throw new RangeError('US deployment pace must be 0, .33, .67 or 1.');
  return POLICIES.filter(p=>Math.abs(p.pace-pace)<1e-9);
}
export function currentPolicy(pace=1):Policy {return makePolicy({...BASELINE_POLICY,pace});}
export interface RegionYear {
  year:number; adoption:number; exposure:number; output:number; netOutput:number;
  workerIncome:number; ownerIncome:number; allIncome:number; workerIncomeIndex:number; ownerIncomeIndex:number; allIncomeIndex:number;
  employedIncomeIndex:number; displacedIncomeIndex:number; newlyDisplacedIncomeIndex:number; longTermDisplacedIncomeIndex:number;
  cohortIncome:number[]; unemployment:number; newlyDisplaced:number; longTermDisplaced:number; reemployed:number;
  employerPay:number; employerPayRatio:number; employerNetPayRatio:number; employerFundingGap:number;
  benefitsRequired:number; benefitsPaid:number; benefitsScalePaid:number; baselineBenefits:number;
  nonTransferSpending:number; governmentFundingGap:number; welfareFundingGap:number;
  taxRevenue:number; laborTaxRevenue:number; capitalTaxRevenue:number; laborTaxBase:number; capitalTaxBase:number;
  effectiveLaborTax:number; effectiveCapitalTax:number; laborIncome:number; capitalIncome:number; capitalAfterRetention:number;
  investmentBurden:number; laborEffort:number; capacityFactor:number;
  investmentCost:number; adjustmentCost:number; netRentFlow:number; consumption:number; resourceResidual:number; feasible:boolean;
}
export interface LightProfile {id:string;usPolicy:Policy;foreignPolicy?:Policy;usUtilities:Float64Array;usScore:number;foreignScore?:number;usAdmissible:boolean;foreignAdmissible?:boolean}
export interface ProfileOutcome extends LightProfile {us:RegionYear[];foreign?:RegionYear[];feasible:boolean;foreignFeasible?:boolean;fundingGap:number;foreignFundingGap?:number}
export interface SolveOptions {mode:ModelMode;objective:Objective;foreignObjective?:Objective;pace?:number}
export interface SolveResult {
  inputs:ModelInputs;mode:ModelMode;effectiveMode:ModelMode;objective:Objective;foreignObjective:Objective;pace:number;
  policies:readonly Policy[];foreignPolicies:readonly Policy[];baselinePolicy:Policy;currentPolicy:Policy;weights:number[];
  evaluate:(us:Policy,foreign?:Policy)=>ProfileOutcome;
  evaluateLight:(us:Policy,foreign?:Policy)=>LightProfile;
  evaluateForeign:(us:Policy,foreign:Policy)=>number;
}
interface Production {adoption:number;exposure:number;u:number;newly:number;reemployed:number;output:number;labor:number;passive:number;capital:number;rents:number;investment:number;adjustment:number;effort:number;burden:number;capacity:number}
interface TrajectoryState {u:number;exposure:number;adoption:number}
function checkedPolicy(p:Policy):void {
  if(![p.pace,p.replacement,p.welfareScale,p.laborTax,p.capitalTax].every(Number.isFinite)||p.pace<0||p.pace>1||p.replacement<0||p.replacement>1.25||p.welfareScale<0||p.welfareScale>2||p.laborTax<0||p.laborTax>1||p.capitalTax<0||p.capitalTax>1||!BENEFIT_FORMULAS.includes(p.benefitFormula)) throw new RangeError('Invalid policy.');
}
function burden(inputs:ModelInputs,p:Policy,otherPotential:number,strength:number,trade:number,c:Calibration):number {
  let affected=0,previous=0;
  for(let y=1;y<=YEARS;y++) {const own=p.pace*strength*y/YEARS;const exposure=own+trade*otherPotential*y/YEARS*(1-own);affected=affected*(1-inputs.reemployment)+inputs.displacement*(exposure-previous);previous=exposure;}
  const retained=clamp(c.laborIncome*affected*p.replacement/c.capitalIncome);
  // Benchmark shifts, not the already-embedded burden of current US taxation.
  const shift=p.capitalTax-c.capitalTaxRate;
  return clamp(shift+(1-Math.max(0,shift))*retained,-1,1);
}
function produce(inputs:ModelInputs,p:Policy,old:TrajectoryState,adoption:number,foreignAdoption:number,b:number,trade:number,year:number,c:Calibration):Production {
  const exposure=adoption+trade*foreignAdoption*(1-adoption);
  const delta=Math.max(0,exposure-old.exposure),deltaAdoption=Math.max(0,adoption-old.adoption);
  const newly=inputs.displacement*delta,reemployed=old.u*inputs.reemployment,u=clamp(old.u-reemployed+newly);
  const effort=clamp(1-inputs.investmentResponse*(p.laborTax-c.laborTaxRate),0,1.5);
  const capacity=clamp(1-inputs.investmentResponse*b*(1-(1-CAPACITY_RENEWAL_RATE)**year),0,1.5);
  const L=c.laborIncome/c.marketIncome*100,P=c.passiveIncome/c.marketIncome*100;
  const output=capacity*(100-L+L*(1-u)*effort+100*inputs.productivityGain*exposure);
  const labor=capacity*L*(1-u)*effort*(1+.35*inputs.productivityGain*exposure);
  const passive=capacity*P;
  const investment=12*deltaAdoption+40*deltaAdoption**2,adjustment=.5*L*newly;
  const capital=output-labor-passive-investment-adjustment;
  return {adoption,exposure,u,newly,reemployed,output,labor,passive,capital,rents:Math.max(0,capital-(100-L-P)*capacity),investment,adjustment,effort,burden:b,capacity};
}
interface Settlement {point?:RegionYear;utilities:Float64Array;workerScore:number;prosperityScore:number;outputScore:number;admissible:boolean}
function taxRate(baseline:number,target:number,mean:number):number {
  if(target<=mean)return mean>0?clamp(baseline*target/mean):0;
  return mean<1?clamp(baseline+(1-baseline)*(target-mean)/(1-mean)):1;
}
function settle(inputs:ModelInputs,policy:Policy,p:Production,year:number,flow:number,prepared:Prepared,materialize:boolean):Settlement {
  const {cells,calibration:c}=prepared,n=cells.length,unit=c.marketIncome/100;
  const grossResources=(p.output-p.investment-p.adjustment+flow)*unit;
  const capitalBefore=(p.capital+flow)*unit;
  const requiredEmployer=c.laborIncome*p.u*policy.replacement;
  const employerPay=Math.min(requiredEmployer,Math.max(0,capitalBefore));
  const employerRatio=c.laborIncome*p.u>0?employerPay/(c.laborIncome*p.u):0;
  const capitalAfter=capitalBefore-employerPay;
  // Negative capital resources are an economic loss, not a negative tax credit.
  const capitalFactor=capitalAfter/c.capitalIncome;
  const productiveWageFactor=p.capacity*p.effort*(1+.35*inputs.productivityGain*p.exposure);
  const emNet=new Float64Array(n),unNet=new Float64Array(n),netEmployer=new Float64Array(n),capitalTax=new Float64Array(n),laborTax=new Float64Array(n);
  let laborTaxRevenue=0,capitalTaxRevenue=0,laborTaxBase=0,capitalTaxBase=0,netEmployerTotal=0;
  for(let i=0;i<n;i++) {
    const cell=cells[i]!,work=cell.labor*productiveWageFactor,retained=cell.labor*employerRatio,passive=cell.passive*p.capacity,capital=cell.capital*capitalFactor;
    const lr=taxRate(cell.laborRate,policy.laborTax,c.laborTaxRate),cr=taxRate(cell.capitalRate,policy.capitalTax,c.capitalTaxRate);
    const taxablePassive=cell.taxablePassive*p.capacity;
    const taxE=Math.max(0,work+taxablePassive)*lr,taxU=Math.max(0,retained+taxablePassive)*lr,taxC=Math.max(0,capital)*cr;
    const expectedTax=(1-p.u)*taxE+p.u*taxU;
    emNet[i]=work+passive+capital-taxE-taxC;unNet[i]=retained+passive+capital-taxU-taxC;
    netEmployer[i]=retained*(1-lr);laborTax[i]=expectedTax;capitalTax[i]=taxC;
    laborTaxRevenue+=cell.weight*expectedTax;capitalTaxRevenue+=cell.weight*taxC;
    laborTaxBase+=cell.weight*((1-p.u)*Math.max(0,work+taxablePassive)+p.u*Math.max(0,retained+taxablePassive));capitalTaxBase+=cell.weight*Math.max(0,capital);
    netEmployerTotal+=cell.weight*p.u*netEmployer[i]!;
  }
  const revenue=laborTaxRevenue+capitalTaxRevenue;
  const baseServices=Math.min(c.nonTransferSpending,revenue);
  const benefitsRequired=c.benefits*policy.welfareScale;
  const benefitsPaid=Math.min(benefitsRequired,Math.max(0,revenue-baseServices));
  const nonTransferSpending=revenue-benefitsPaid;
  const welfareGap=benefitsRequired-benefitsPaid,governmentGap=Math.max(0,c.nonTransferSpending-baseServices);
  const currentDenominator=c.benefits,priorDenominator=prepared.baselineAllIncome;
  const utilities=new Float64Array(n),income=materialize?new Array<number>(n):undefined;
  let allIncome=0,workerIncome=0,ownerIncome=0,employedIncome=0,displacedIncome=0,baselineExposed=0,prosperity=0;
  for(let i=0;i<n;i++) {
    const cell=cells[i]!;
    const share=policy.benefitFormula==='flat'?1:policy.benefitFormula==='current'?(currentDenominator>0?cell.benefit/currentDenominator:0):(priorDenominator>0?cell.prior/priorDenominator:0);
    const benefit=benefitsPaid*share,e=emNet[i]!+benefit,u=unNet[i]!+benefit;
    const expected=(1-p.u)*e+p.u*u;
    // Signed losses remain in accounting. Consumption utility floors at zero;
    // the 1% offset avoids log(0), without inventing spendable resources.
    const denominator=Math.max(cell.prior,1);
    const utility=(amount:number)=>Math.log((Math.max(0,amount)/denominator+UTILITY_OFFSET)/(1+UTILITY_OFFSET));
    utilities[i]=(1-p.u)*utility(e)+p.u*utility(u);
    if(income)income[i]=expected;
    allIncome+=cell.weight*expected;prosperity+=cell.weight*utilities[i]!;
    if(cell.source.group==='work')workerIncome+=cell.weight*expected;
    if(cell.source.group==='capital')ownerIncome+=cell.weight*expected;
    if(cell.hasLabor){employedIncome+=cell.weight*e;displacedIncome+=cell.weight*u;baselineExposed+=cell.weight*cell.prior;}
  }
  const workerScore=prepared.baselineWorkerIncome>0?workerIncome/prepared.baselineWorkerIncome-1:0;
  let point:RegionYear|undefined;
  if(materialize)point={
    year,adoption:p.adoption,exposure:p.exposure,output:p.output,netOutput:p.output-p.investment-p.adjustment,
    workerIncome,ownerIncome,allIncome,workerIncomeIndex:100*(workerScore+1),ownerIncomeIndex:prepared.baselineOwnerIncome>0?100*ownerIncome/prepared.baselineOwnerIncome:100,allIncomeIndex:100*allIncome/prepared.baselineAllIncome,
    employedIncomeIndex:baselineExposed>0?100*employedIncome/baselineExposed:100,displacedIncomeIndex:baselineExposed>0?100*displacedIncome/baselineExposed:100,
    newlyDisplacedIncomeIndex:baselineExposed>0?100*displacedIncome/baselineExposed:100,longTermDisplacedIncomeIndex:baselineExposed>0?100*displacedIncome/baselineExposed:100,
    cohortIncome:income!,unemployment:p.u,newlyDisplaced:p.newly,longTermDisplaced:Math.max(0,p.u-p.newly),reemployed:p.reemployed,
    employerPay,employerPayRatio:employerRatio,employerNetPayRatio:c.laborIncome*p.u>0?netEmployerTotal/(c.laborIncome*p.u):0,employerFundingGap:requiredEmployer-employerPay,
    benefitsRequired,benefitsPaid,benefitsScalePaid:c.benefits>0?benefitsPaid/c.benefits:0,baselineBenefits:c.benefits,
    nonTransferSpending,governmentFundingGap:governmentGap,welfareFundingGap:welfareGap,
    taxRevenue:revenue,laborTaxRevenue,capitalTaxRevenue,laborTaxBase,capitalTaxBase,effectiveLaborTax:laborTaxBase>0?laborTaxRevenue/laborTaxBase:0,effectiveCapitalTax:capitalTaxBase>0?capitalTaxRevenue/capitalTaxBase:0,
    laborIncome:p.labor*unit,capitalIncome:capitalBefore,capitalAfterRetention:capitalAfter,investmentBurden:p.burden,laborEffort:p.effort,capacityFactor:p.capacity,
    investmentCost:p.investment*unit,adjustmentCost:p.adjustment*unit,netRentFlow:flow*unit,consumption:allIncome,
    resourceResidual:allIncome+nonTransferSpending-grossResources,feasible:requiredEmployer-employerPay<1e-7&&welfareGap<1e-7&&governmentGap<1e-7,
  };
  return {point,utilities,workerScore,prosperityScore:prosperity,outputScore:p.output/100-1,admissible:governmentGap<1e-7};
}
function initialPoint(prepared:Prepared):RegionYear {
  const c=prepared.calibration,unit=c.marketIncome/100;
  const policy=makePolicy({...BASELINE_POLICY,laborTax:c.laborTaxRate,capitalTax:c.capitalTaxRate});
  return settle(DEFAULT_INPUTS,policy,{adoption:0,exposure:0,u:0,newly:0,reemployed:0,output:100,labor:c.laborIncome/unit,passive:c.passiveIncome/unit,capital:c.capitalIncome/unit,rents:0,investment:0,adjustment:0,effort:1,burden:0,capacity:1},0,0,prepared,true).point!;
}
function simulate(inputs:ModelInputs,usPolicy:Policy,foreignPolicy:Policy|undefined,foreignObjective:Objective,prepared:Prepared,materialize:boolean,foreignOnly=false):LightProfile|ProfileOutcome {
  checkedPolicy(usPolicy);if(foreignPolicy)checkedPolicy(foreignPolicy);
  const c=prepared.calibration,us:RegionYear[]=materialize?[initialPoint(prepared)]:[],foreign:RegionYear[]|undefined=materialize&&foreignPolicy?[initialPoint(prepared)]:undefined;
  const utilities=new Float64Array(prepared.cells.length);
  let usScore=0,foreignScore=0,weightTotal=0,usAdmissible=true,foreignAdmissible=true;
  let stateUS:TrajectoryState={u:0,exposure:0,adoption:0},stateForeign={...stateUS};
  const trade=foreignPolicy?inputs.tradeIntensity:0;
  const bUS=burden(inputs,usPolicy,foreignPolicy?foreignPolicy.pace*inputs.foreignStrength:0,1,trade,c);
  const bForeign=foreignPolicy?burden(inputs,foreignPolicy,usPolicy.pace,inputs.foreignStrength,inputs.foreignTradeIntensity,c):0;
  for(let year=1;year<=YEARS;year++) {
    const adoptUS=clamp(usPolicy.pace*year/YEARS*(1-inputs.investmentResponse*bUS));
    const adoptForeign=foreignPolicy?clamp(foreignPolicy.pace*year/YEARS*inputs.foreignStrength*(1-inputs.investmentResponse*bForeign)):0;
    const pUS=produce(inputs,usPolicy,stateUS,adoptUS,adoptForeign,bUS,trade,year,c);
    const pF=foreignPolicy?produce(inputs,foreignPolicy,stateForeign,adoptForeign,adoptUS,bForeign,inputs.foreignTradeIntensity,year,c):undefined;
    let flow=0;
    if(pF&&foreignPolicy) {
      const mobile=.6*inputs.capitalMobility*inputs.foreignStrength,total=mobile*(pUS.rents+inputs.foreignMarketSize*pF.rents);
      const own=(.15+adoptUS)*Math.exp(-4*inputs.capitalMobility*bUS),other=inputs.foreignMarketSize*inputs.foreignStrength*(.15+adoptForeign)*Math.exp(-4*inputs.capitalMobility*bForeign);
      flow=total*own/(own+other)-mobile*pUS.rents;
    }
    const w=(1+DISCOUNT_RATE)**-year;weightTotal+=w;
    if(!foreignOnly) {
      const result=settle(inputs,usPolicy,pUS,year,flow,prepared,materialize);
      for(let i=0;i<utilities.length;i++)utilities[i]+=w*result.utilities[i]!;
      usScore+=w*result.workerScore;usAdmissible&&=result.admissible;if(result.point)us.push(result.point);
    }
    if(pF&&foreignPolicy) {
      {
        const result=settle(inputs,foreignPolicy,pF,year,-flow/inputs.foreignMarketSize,prepared,materialize);
        foreignAdmissible&&=result.admissible;
        foreignScore+=w*(foreignObjective==='workers'?result.workerScore:foreignObjective==='output'?result.outputScore:result.prosperityScore);
        if(result.point)foreign!.push(result.point);
      }
      stateForeign={u:pF.u,exposure:pF.exposure,adoption:pF.adoption};
    }
    stateUS={u:pUS.u,exposure:pUS.exposure,adoption:pUS.adoption};
  }
  for(let i=0;i<utilities.length;i++)utilities[i]/=weightTotal;
  const light:LightProfile={id:usPolicy.id+'::'+(foreignPolicy?.id??'none'),usPolicy,foreignPolicy,usUtilities:utilities,usScore:usScore/weightTotal,foreignScore:foreignPolicy?foreignScore/weightTotal:undefined,usAdmissible,foreignAdmissible:foreignPolicy?foreignAdmissible:undefined};
  if(!materialize)return light;
  return {...light,us,foreign,feasible:us.every(p=>p.feasible),foreignFeasible:foreign?.every(p=>p.feasible),fundingGap:us.reduce((s,p)=>s+p.employerFundingGap+p.welfareFundingGap+p.governmentFundingGap,0),foreignFundingGap:foreign?.reduce((s,p)=>s+p.employerFundingGap+p.welfareFundingGap+p.governmentFundingGap,0)};
}
export function evaluateProfile(values:Partial<ModelInputs>,usPolicy:Policy,foreignPolicy?:Policy,mode:ModelMode='strategic',_objective:Objective='workers',foreignObjective:Objective='prosperity',cohorts:readonly USIncomeCohort[]=US_COHORTS):ProfileOutcome {
  return simulate(normalizeInputs(values),usPolicy,mode==='strategic'?foreignPolicy:undefined,foreignObjective,cohorts===US_COHORTS?PREPARED:prepare(cohorts),true) as ProfileOutcome;
}
export const simulateProfile=evaluateProfile;
export function solveModel(values:Partial<ModelInputs>={},options:SolveOptions={mode:'us-only',objective:'workers'}):SolveResult {
  const inputs=normalizeInputs(values),mode=options.mode,pace=options.pace??1,foreignObjective=options.foreignObjective??'prosperity';
  return {inputs,mode,effectiveMode:mode,pace,objective:options.objective,foreignObjective,policies:policiesAtPace(pace),foreignPolicies:mode==='strategic'?POLICIES:[],baselinePolicy:BASELINE_POLICY,currentPolicy:currentPolicy(pace),weights:[...CALIBRATION.weights],
    evaluate:(u,f)=>simulate(inputs,u,mode==='strategic'?f:undefined,foreignObjective,PREPARED,true) as ProfileOutcome,
    evaluateLight:(u,f)=>simulate(inputs,u,mode==='strategic'?f:undefined,foreignObjective,PREPARED,false),
    evaluateForeign:(u,f)=>{const result=simulate(inputs,u,f,foreignObjective,PREPARED,false,true);return result.foreignAdmissible?result.foreignScore!:-Infinity;},
  };
}
export const MODEL_NOTES:readonly {title:string;detail:string;equation?:string}[]=[
  {title:'Whose votes count',detail:'Survey weights represent every US adult citizen equally, without turnout weighting. Household resources are pooled across all household adults; each citizen evaluates their own share. Fixed cells preserve joint income source, income band and employment status. The approximation cannot recover every individual preference within a cell.'},
  {title:'Five separate decisions',detail:'Voters choose employer retention at 0%, 50%, 100% or 125% of previous gross labor income; a public benefit budget at 0%, 50%, 100%, 150% or 200% of current modeled benefits; current allocation, equal payments per adult or payments proportional to prior disposable income; and separate noncapital and investment tax rates.'},
  {title:'Current benefits and tax credits',detail:'The benefit reference includes observed public cash benefits, food, housing and energy assistance resource values and modeled net tax refunds. It excludes the value of Medicare and Medicaid. Current allocation preserves the observed recipient profile; it does not simulate new unemployment-benefit eligibility. Flat and prior-income formulas distribute the same funded budget across all adults, including current nonrecipients.'},
  {title:'Taxes and the budget',detail:'Noncapital income includes work, private pensions and other noninvestment income. Investment income is taxed separately. Current cohort tax-rate differences remain at the current benchmark. Lower benchmarks scale rates toward zero; higher benchmarks scale them toward 100%, so the endpoints apply to every cohort. The benchmark equals the aggregate effective rate on unchanged tax bases; the actual rate can change as incomes change. Negative baseline taxes become modeled net refund benefits. Taxes must fund a fixed baseline nontransfer spending requirement in every year for a policy to be eligible in the vote, then fund the chosen benefit budget. Any excess goes to nontransfer public spending, not an undisclosed household dividend. Voters value their private resources; they do not receive utility from this other public spending.'},
  {title:'Actual payments',detail:'Employer retention is paid from available investment income before household taxes. Public payments are capped by tax revenue after other spending. The result shows funded amounts and shortfalls, not only promises. Household resources plus nontransfer government spending equal available production after installation costs, adjustment costs and foreign rent flows.'},
  {title:'Risk and selfish voters',detail:'Each citizen compares expected log utility of their own household resources over ten years, discounted at 3%. Productive and obsolete-work states are evaluated separately. The same displacement risk applies across household income bands; there is no claim to forecast which profession disappears first. The 1% utility offset prevents log zero and adds no spendable money.'},
  {title:'Production and policy responses',detail:'The production index starts at 100 and is allocated using observed household income components; it is not a forecast of dollar GDP. Work resources respond to displacement and work incentives. Pension and other resources face aggregate capacity changes but are not directly laid off. Retention costs and tax increases relative to current rates discourage adoption and capacity renewal; tax reductions can improve incentives. The assumed annual renewal share is 5%, not an estimated capital-stock model.'},
  {title:'International assumptions',detail:'The foreign bloc chooses its own full policy and AI deployment pace to maximize worker income, average income utility or output. GDP weights cross-border rent flows. For comparability, its household distribution and baseline fiscal system use the same US-calibrated cohort structure; this is an explicit simplification, not foreign microdata.'},
  {title:'Finding a stable policy',detail:'A change passes only with strictly more than half of adult-citizen population weight. Separate ballots change one decision at a time. A reported stable policy is checked against every US single-decision alternative and every foreign package. The bounded search may miss other equilibria and cannot prove none exist. A combined US package can defeat a policy that is stable under separate ballots.'},
];
