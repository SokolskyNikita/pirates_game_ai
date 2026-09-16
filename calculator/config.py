"""Public model assumptions and presentation metadata.

Calculation constants live here; the browser receives metadata without evaluating
any economic formulas.
"""

from __future__ import annotations

import math
from typing import Any

YEARS = 10
DISCOUNT_RATE = 0.03
EQUILIBRIUM_TOLERANCE = 1e-10
UTILITY_OFFSET = 0.01
CAPACITY_RENEWAL_RATE = 0.05

DEFAULT_INPUTS = {
    "usGdpGrowth": 0.05,
    "foreignGdpGrowth": 0.05,
    "productivityGain": 0.4,
    "displacement": 0.35,
    "reemployment": 0.2,
    "capitalMobility": 0.5,
    "investmentResponse": 0.35,
    "foreignStrength": 1,
    "tradeIntensity": 0.14175546,
    "foreignMarketSize": 2.8463217399,
    "foreignPopulationRatio": 23.0368311373,
    "foreignTradeIntensity": 0.03916185,
    "tradableShare": 0.4,
    "tradeElasticity": 4,
}

INPUT_SPECS = [
    {
        "key": "usGdpGrowth",
        "label": "US GDP growth/year at max AI proliferation",
        "min": 0,
        "max": 0.2,
        "step": 0.05,
        "description": "Annual real output growth at full AI exposure, before policy effects. Growth "
        "compounds each year and scales with AI exposure during deployment.",
    },
    {
        "key": "foreignGdpGrowth",
        "label": "Foreign GDP growth/year at max AI proliferation",
        "min": 0,
        "max": 0.2,
        "step": 0.05,
        "description": "The foreign bloc’s annual real output growth at full AI exposure, before policy "
        "effects. Independent of the US growth assumption.",
    },
    {
        "key": "productivityGain",
        "label": "Employer gain from AI",
        "min": 0,
        "max": 1,
        "step": 0.05,
        "description": "Extra employer return per automated role. At 50%, a $100,000 role yields "
        "$150,000 from AI or $50,000 after keeping its $100,000 wage, before GDP "
        "scaling, taxes and costs.",
    },
    {
        "key": "displacement",
        "label": "Roles made obsolete",
        "min": 0,
        "max": 1,
        "step": 0.05,
        "description": "Share of work made obsolete by year ten at full deployment. At 100% with no "
        "return to work, every worker is affected by then. Lower AI exposure can leave "
        "some roles productive; the same risk applies across household income bands.",
    },
    {
        "key": "reemployment",
        "label": "Return to productive work",
        "min": 0,
        "max": 1,
        "step": 0.05,
        "description": "Share of affected labor income restored to productive work each year.",
    },
    {
        "key": "investmentResponse",
        "label": "Response to policy changes",
        "min": 0,
        "max": 1,
        "step": 0.05,
        "description": "Strength of investment and labor responses to policy changes relative to "
        "current taxes. An assumption, not an estimated elasticity.",
    },
    {
        "key": "capitalMobility",
        "label": "Mobile AI rents",
        "min": 0,
        "max": 1,
        "step": 0.05,
        "description": "Response of mobile AI returns to international differences in adoption and "
        "policy burdens.",
    },
    {
        "key": "foreignStrength",
        "label": "Foreign frontier capability",
        "min": 0,
        "max": 1,
        "step": 0.05,
        "description": "Foreign frontier adoption relative to the US. At zero, the foreign economy can "
        "still import AI.",
    },
    {
        "key": "tradeIntensity",
        "label": "US import exposure",
        "min": 0,
        "max": 1,
        "step": 0.05,
        "description": "2025 US imports / GDP. Together with exports, this anchors the modeled trade "
        "basket; imported-AI diffusion is an additional assumption.",
    },
    {
        "key": "foreignMarketSize",
        "label": "Rest-of-world GDP / US GDP",
        "min": 0.25,
        "max": 8,
        "step": 0.25,
        "description": "2025 nominal GDP ratio, used for bilateral demand, relative prices and AI-return accounting.",
    },
    {
        "key": "foreignPopulationRatio",
        "label": "Rest-of-world population / US population",
        "min": 0.25,
        "max": 40,
        "step": 0.25,
        "description": "Population reference; separate from the GDP weight.",
    },
    {
        "key": "foreignTradeIntensity",
        "label": "Foreign exposure to US exports",
        "min": 0,
        "max": 1,
        "step": 0.05,
        "description": "2025 US exports / rest-of-world GDP. Trade within the foreign bloc is internal.",
    },
    {
        "key": "tradableShare",
        "label": "Share exposed to international competition",
        "min": 0,
        "max": 1,
        "step": 0.05,
        "description": "Assumed share of spending and remaining jobs in goods or services that can "
        "be purchased abroad. Includes tradable services. The 40% default is illustrative, "
        "not a measured share of today's US economy.",
    },
    {
        "key": "tradeElasticity",
        "label": "Response to relative import prices",
        "min": 1,
        "max": 8,
        "step": 1,
        "description": "How strongly buyers switch between domestic and foreign products as prices "
        "change. Four is a research-based reference; the same value applies to both blocs.",
    },
]

MODEL_NOTES = [
    {
        "title": "Whose votes count",
        "detail": "Survey weights represent every US adult citizen equally, without turnout weighting. "
        "Household resources are pooled across all household adults; each citizen evaluates "
        "their own share. Fixed cells preserve joint income source, income band and "
        "employment status. The approximation cannot recover every individual preference "
        "within a cell.",
    },
    {
        "title": "The complete policy package",
        "detail": "Every package specifies Pause AI, Allow current AI pace or Accelerate AI, together "
        "with employer retention at 0%, 50%, 100% or 125% of previous gross labor income; a "
        "public benefit budget at 0%, 50%, 100%, 150% or 200% of current modeled benefits; "
        "current allocation, equal payments per adult or payments proportional to prior "
        "disposable income; and separate noncapital and investment tax rates. International "
        "packages also specify whether to allow free trade. Both sides must allow it for "
        "bilateral trade to continue.",
    },
    {
        "title": "Current benefits and tax credits",
        "detail": "The benefit reference includes observed public cash benefits, food, housing and "
        "energy assistance resource values and modeled net tax refunds. It excludes the value "
        "of Medicare and Medicaid. Current allocation preserves the observed recipient "
        "profile; it does not simulate new unemployment-benefit eligibility. Flat and "
        "prior-income formulas distribute the same funded budget across all adults, including "
        "current nonrecipients.",
    },
    {
        "title": "Taxes and the budget",
        "detail": "Noncapital income includes work, private pensions and other noninvestment income. "
        "Investment income is taxed separately. Current cohort tax-rate differences remain at "
        "the current benchmark. Lower benchmarks scale rates toward zero; higher benchmarks "
        "scale them toward 100%, so the endpoints apply to every cohort. The benchmark equals "
        "the aggregate effective rate on unchanged tax bases; the actual rate can change as "
        "incomes change. Negative baseline taxes become modeled net refund benefits. A policy "
        "is eligible only if taxes fund both the fixed baseline nontransfer spending "
        "requirement and the entire chosen benefit budget in every year. Employer-funded "
        "retention promises must also be covered in every year, after the modeled effects on "
        "investment, output and international returns. Any excess goes to nontransfer public "
        "spending, not an undisclosed household dividend. Voters value their private "
        "resources; they do not receive utility from this other public spending.",
    },
    {
        "title": "Actual payments",
        "detail": "Employer retention is paid from available investment income before household taxes. "
        "Public payments are capped by tax revenue after other spending. Underfunded packages "
        "cannot be chosen on the ballot. Diagnostic comparisons and the automatic status-quo "
        "fallback can still show shortfalls; their income figures use actual payments rather "
        "than inventing funds. Household resources plus nontransfer government spending equal "
        "available production after installation costs, adjustment costs and foreign rent "
        "flows, converted to purchasing power at the modeled consumer price index.",
    },
    {
        "title": "Risk and selfish voters",
        "detail": "Each citizen compares expected log utility of their own household resources over ten "
        "years, discounted at 3%. Productive and obsolete-work states are evaluated "
        "separately. The same displacement risk applies across household income bands; there "
        "is no claim to forecast which profession disappears first. The 1% utility offset "
        "prevents log zero and adds no spendable money.",
    },
    {
        "title": "Firm returns and fixed GDP",
        "detail": "Before economy-wide adjustment, automating a role claims its former wage plus the "
        "employer-gain percentage as investment income. A $100,000 role at a 50% gain "
        "therefore claims $150,000; paying its old salary would leave $50,000 before taxes "
        "and costs. Aggregate GDP is set separately: productive wages, passive income and "
        "gross investment claims receive a common scaling factor so their total equals "
        "output. Higher employer gains therefore change income shares, not GDP growth. Real "
        "installation and adjustment costs and actual retention payments are then deducted "
        "from investment income. Retained wages remain promises in baseline dollars, so "
        "actual proceeds can differ from the simple example.",
        "equation": "Raw investment claim = baseline investment income + obsolete wages × (1 + employer "
        "gain)",
    },
    {
        "title": "Annual GDP growth",
        "detail": "US and foreign potential output compound independently at their chosen annual growth "
        "rates multiplied by that year’s AI exposure. Exposure includes imported AI only "
        "where deployment is allowed. A pause prohibits domestic and imported AI use for all "
        "ten years, so it creates no AI job losses or AI growth. The no-AI reference assumes "
        "no growth; current-pace deployment ramps over ten years, so a 5% full-AI rate does "
        "not mean ten years of 5% growth. Displacement changes who receives production income "
        "rather than automatically destroying the production AI replaces. Policy responses "
        "can raise or lower realized GDP relative to this potential path. Growth scales "
        "productive wages, pensions and other passive resources; benefit budgets and "
        "retained-wage promises remain fixed in real baseline dollars. In international "
        "scenarios, trade adjustment can reduce production even when domestic AI is paused.",
        "equation": "Potential outputₜ = potential outputₜ₋₁ × (1 + annual growth at full AI × exposureₜ)",
    },
    {
        "title": "Production and policy responses",
        "detail": "The production index starts at 100 and is allocated using observed household income "
        "components; it is not a forecast of dollar GDP. Work resources respond to "
        "displacement and work incentives. Pension and other resources face aggregate "
        "capacity changes but are not directly laid off. Current AI pace reaches full "
        "domestic deployment in year ten; acceleration compresses the same domestic "
        "deployment curve into five years, bringing forward job replacement and the full "
        "annual productivity growth rate. Imported AI also requires domestic adoption "
        "capacity: its diffusion reaches the chosen import-exposure limit in year ten at "
        "current pace or year five when accelerated, and is further limited by the other "
        "region’s available AI. Total exposure therefore depends on both regions’ choices. "
        "Faster installation has higher annual adjustment and installation costs. Retention "
        "costs and tax increases relative to current rates delay deployment within the chosen "
        "horizon and discourage capacity renewal; tax reductions can advance deployment. To "
        "compare speeds consistently, the policy burden uses a common ten-step nominal "
        "rollout before the timing response. Recovery from displacement still occurs on "
        "calendar years. Foreign deployment is also limited by frontier capability. The "
        "assumed annual renewal share is 5%, not an estimated capital-stock model.",
    },
    {
        "title": "International choices",
        "detail": "The foreign bloc chooses a complete policy to maximize worker income, average "
        "income utility or physical output. Each side knows the other's choice. Free trade "
        "requires both to allow it; a ban by either ends bilateral goods and services trade, "
        "imported-AI diffusion and the modeled cross-border AI-service profit flows. Trade "
        "within the foreign bloc continues. This is not a model of tariffs, existing foreign "
        "assets or separate capital controls. A pause blocks domestic and imported AI use, "
        "but open trade can still displace workers through foreign competition. If both "
        "pause, neither deploys AI during the ten years. The foreign bloc uses the US "
        "household distribution and fiscal reference, not foreign household microdata.",
    },
    {
        "title": "Trade prices and purchasing power",
        "detail": "An Armington-inspired approximation separates internationally tradable spending "
        "from local spending. Buyers substitute between domestic and foreign products; "
        "relative producer prices clear the two regions' goods markets, including net "
        "AI-service profit income. Foreign growth changes import prices, competition and "
        "export demand. Household utility uses income divided by the consumer price index. "
        "Cheaper imports therefore raise purchasing power without being counted again as "
        "physical GDP. A ban removes foreign varieties without renormalizing preferences, "
        "raising the cost of the consumption basket. Real wage-retention, benefit and other "
        "public-spending promises are indexed to that cost before testing funding. The "
        "model uses one aggregate tradable sector, not detailed industry supply chains.",
        "equation": "Import share = βa r⁻ᶿ / (1 − a + a r⁻ᶿ); consumer price / domestic producer price = "
        "(1 − a + a r⁻ᶿ)⁻ᵝ⁄ᶿ",
    },
    {
        "title": "Trade calibration and assumptions",
        "detail": "The starting data use revised 2025 US goods and services imports of $4.361773 "
        "trillion and exports of $3.429813 trillion. The model does not track deficit "
        "financing: it normalizes baseline two-way trade to their geometric mean, about "
        "$3.868 trillion in each direction. GDP is an approximate spending base here, "
        "not the gross-expenditure measure used in structural trade estimates. The assumed "
        "tradable share defaults to 40%; the trade elasticity defaults to four. Both can "
        "be changed. If custom inputs imply more trade than the tradable sector permits, "
        "the common flow is capped at 95% of the smaller bloc's tradable spending. This "
        "calibration illustrates mechanisms; it does not estimate the cost of a real US "
        "trade embargo.",
    },
    {
        "title": "Jobs affected by trade",
        "detail": "AI displacement and trade adjustment are separate. At the start of each year, "
        "trade-affected workers recover at the chosen return-to-work rate. Initial trade "
        "prices then determine adjustment: each percentage-point increase in import "
        "spending share, or contraction in export volume divided by prior available output, affects "
        "one percentage point of remaining productive workers, capped at the tradable "
        "share. A ban creates an initial export adjustment. This one-for-one response is "
        "an assumption, not an estimated employment elasticity. Production and trade "
        "prices are recalculated after adjustment. These workers lose productive income "
        "and output until they return to work; they do not generate domestic AI output. "
        "Employer retention protects both AI- and trade-affected workers. Its additional "
        "trade-related investment burden responds to the previous year’s retained wages, "
        "so this response has a one-year lag. Export expansion "
        "limits new losses; recovery occurs at the specified annual rate.",
    },
    {
        "title": "One vote on a complete package",
        "detail": "Each citizen chooses the fully funded package that maximizes their own expected "
        "household-resource utility. The package with the largest support wins only if it "
        "receives strictly more than half of adult-citizen population weight; otherwise "
        "current US policy continues. There is no second ballot. In international scenarios, "
        "each side evaluates its choice knowing the other side’s policy; a reported mutually "
        "consistent outcome must reproduce those choices. All policies last for the modeled "
        "ten years.",
    },
]


def clamp(value: float, minimum: float = 0, maximum: float = 1) -> float:
    """Restrict a finite value to the requested closed interval."""
    return max(minimum, min(maximum, value))


def normalize_inputs(values: dict[str, Any] | None = None) -> dict[str, float]:
    """Apply defaults and limits without discretizing diagnostic inputs."""
    result = DEFAULT_INPUTS.copy()
    values = values or {}
    for spec in INPUT_SPECS:
        value = values.get(spec["key"])
        if isinstance(value, (float, int)) and not isinstance(value, bool) and math.isfinite(value):
            result[spec["key"]] = clamp(value, spec["min"], spec["max"])
    return result
