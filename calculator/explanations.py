"""Human-readable model explanations exported with presentation metadata."""

MODEL_NOTES = [
    {
        "title": "Whose votes count",
        "detail": "Survey weights represent every US adult citizen equally, without turnout weighting. "
        "Household resources are pooled across all household adults; each citizen evaluates their "
        "own share. Fixed cells preserve joint income source, income band and employment status. "
        "Each cell has 100 deterministic career paths. Whole-person rounding bounds annual employment-state shares to "
        "one percentage point; budgets integrate the unsampled job stocks. Income heterogeneity within cells remains unmodeled.",
    },
    {
        "title": "The complete policy package",
        "detail": "Every package specifies Pause AI, Allow current AI pace or Accelerate AI, together with "
        "employer retention at 0%, 50%, 100% or 125% of previous gross labor income; a public "
        "benefit budget at 0%, 50%, 100%, 150% or 200% of current modeled benefits, or all tax revenue after public services; current "
        "allocation, equal payments per adult or payments proportional to prior disposable income; "
        "and a noncapital tax benchmark and an additional AI-profits tax. International packages also specify "
        "whether to allow free trade. Both sides must allow it for bilateral trade to continue.",
    },
    {
        "title": "Current benefits and tax credits",
        "detail": "The benefit reference includes observed public cash benefits, food, housing and energy "
        "assistance resource values and modeled net tax refunds. It excludes the value of Medicare "
        "and Medicaid. Current allocation preserves the observed recipient profile; it does not "
        "simulate new unemployment-benefit eligibility. Flat and prior-income formulas distribute "
        "the same funded budget across all adults, including current nonrecipients.",
    },
    {
        "title": "Taxes and the budget",
        "detail": "Noncapital income includes work, private pensions and other noninvestment income. "
        "Ordinary investment tax rates remain fixed for each income group. The additional AI-profits "
        "tax applies only to positive profits above a matched no-AI economy, after ordinary tax. "
        "The reference holds noncapital taxes and trade permissions fixed and pauses both economies. "
        "Actual profits already deduct wages, retention, installation, operating and adjustment costs. "
        "Ongoing AI costs are assumed to be 2% of AI-exposed output each year. This is an annual economy-wide proxy, not firm-level identification of AI profits or loss carryforwards. "
        "Noncapital tax benchmarks preserve cohort-rate differences. "
        "Negative baseline taxes become modeled net refund benefits. A policy is eligible only if "
        "taxes fund both the fixed baseline nontransfer spending requirement and the entire chosen "
        "benefit budget in every year. Employer-funded retention promises must also be covered in "
        "every year, after the modeled effects on investment, output and international returns. Any "
        "excess goes to nontransfer public spending under fixed budgets. The all-revenue option instead distributes it. Voters "
        "value their private resources; they do not receive utility from this other public "
        "spending.",
    },
    {
        "title": "Actual payments",
        "detail": "Employer retention is paid from available investment income before household taxes. Public "
        "payments are capped by tax revenue after other spending. Underfunded packages cannot be "
        "chosen on the ballot. Diagnostic comparisons and the automatic status-quo fallback can "
        "still show shortfalls; their income figures use actual payments rather than inventing "
        "funds. Household resources plus nontransfer government spending equal available production "
        "after installation costs, adjustment costs and foreign rent flows, converted to purchasing "
        "power at the modeled consumer price index.",
    },
    {
        "title": "Risk and selfish voters",
        "detail": "Each citizen compares expected log utility of their own household resources over ten "
        "years, discounted at 3%. Productive and nonproductive work states are evaluated "
        "separately. The same job-market risk applies across household income bands. Productive "
        "workers receive the aggregate average contracted wage; this approximation does not track "
        "every individual wage or career history. The 1% utility offset prevents log zero and adds "
        "no spendable money.",
    },
    {
        "title": "Jobs affected, jobs available and people",
        "detail": "At AI exposure e, the fraction of original roles affected is A = affected share × e. "
        "Original productive positions are 1 − A, and new or transformed positions are A + job "
        "change × e. Total productive positions are therefore 1 + job change × e. A cannot be lower "
        "than the net reduction in jobs, so no negative replacement positions are created. "
        "Positions and people are separate: the workforce is fixed to the people initially working, "
        "so a larger job pool can contain vacancies. The same assumptions apply to each economy "
        "before trade effects.",
        "equation": "Original positions + new/transformed positions = (1 − A) + (A + job change × exposure) = "
        "1 + job change × exposure",
    },
    {
        "title": "Job search and sticky wages",
        "detail": "On each layoff, the chosen participation share enters job search; the remainder leaves the "
        "modeled job market. There is no guaranteed reemployment rate and non-searchers do not "
        "automatically re-enter later. Employers fill vacancies from active searchers. A smaller "
        "pool of jobs relative to employed people and searchers lowers the new-contract wage in "
        "direct proportion. Existing contracts do not receive an immediate cut: one annual "
        "replacement round lets searchers replace higher-paid incumbents, who can themselves enter "
        "search. Replacing a worker creates a hire and a layoff, not an additional job. The model "
        "tracks average contracted wage bills within original and transformed roles. These wage "
        "multipliers are sticky; realized pay still changes with output, work incentives and prices.",
        "equation": "New-contract wage multiplier = min(1, productive positions / (employed workers + active "
        "searchers + retained workers available for redeployment))",
    },
    {
        "title": "Retained workers and prior-income benefits",
        "detail": "Retention requirements protect workers from competitive dismissal. Workers whose "
        "productive roles disappear stay on the employer’s payroll at the selected share of their "
        "pre-AI wage. Retained workers can be redeployed into vacancies first; they are not paid "
        "both productive wages and retention pay for the same period. People on protected payrolls "
        "are not counted as laid-off job seekers. Prior-income benefits continue to use pre-AI "
        "household income; later wage competition does not alter those weights.",
    },
    {
        "title": "Firm returns and the separate GDP path",
        "detail": "The employer-gain assumption changes income claims, not the independently specified growth "
        "path. Replacing an original task claims its former wage plus the employer-gain percentage "
        "before the cost of employing people in remaining or new roles. Paying retained workers or "
        "hiring into transformed jobs reduces the income left for owners. Productive wage claims "
        "reflect the contracted wage bill; aggregate income is allocated from actual output. "
        "Installation and adjustment costs, taxes and retained wages are paid from those resources. "
        "There is no extra GDP from merely reallocating income.",
    },
    {
        "title": "Background growth and the AI increment",
        "detail": "Background real growth is an illustrative 2% per year in the US and 3% in the foreign "
        "bloc. The AI growth input adds percentage points at full exposure: a 5-point AI increment "
        "gives 7% potential US growth at full exposure, before policy and labor-market effects. "
        "During rollout the AI increment scales with exposure. Both growth components compound. A "
        "pause removes the AI increment but retains background growth. Investment responses, "
        "missing workers for available roles and trade losses can reduce output enough for actual "
        "growth to be negative. Benefit budgets, retained wages and prior-income benefit weights "
        "keep their pre-AI reference. The baseline trends are modeling assumptions, not estimates "
        "of a world without AI.",
        "equation": "Potential outputₜ = potential outputₜ₋₁ × (1 + background growth + AI growth increment × "
        "exposureₜ)",
    },
    {
        "title": "Production and policy responses",
        "detail": "The production index starts at 100 and is allocated using observed household income "
        "components; it is not a forecast of dollar GDP. Work resources respond to displacement and "
        "work incentives. Pension and other resources face aggregate capacity changes but are not "
        "directly laid off. Current AI pace reaches full domestic deployment in year ten; "
        "acceleration compresses the same domestic deployment curve into five years, bringing "
        "forward job replacement and the available annual AI growth increment. Imported AI also "
        "requires domestic adoption capacity: its diffusion reaches the chosen import-exposure "
        "limit in year ten at current pace or year five when accelerated, and is further limited by "
        "the other region’s available AI. Total exposure therefore depends on both regions’ "
        "choices. Faster installation has higher annual adjustment and installation costs. "
        "Retention costs delay deployment within the "
        "chosen horizon and discourage capacity renewal. The additional AI tax reduces deployment separately. To "
        "compare speeds consistently, the policy burden uses required retention at full rollout, "
        "independently of rollout speed, before the timing response. Job matching and wage-contract turnover occur once per "
        "calendar year. Foreign deployment is also limited by frontier capability. The assumed "
        "annual renewal share is 5%, not an estimated capital-stock model.",
    },
    {
        "title": "International choices",
        "detail": "The foreign bloc chooses a complete policy to maximize worker income, average income "
        "utility or physical output. Each side knows the other's choice. Free trade requires both "
        "to allow it; a ban by either ends bilateral goods and services trade, imported-AI "
        "diffusion and the modeled cross-border AI-service profit flows. Trade within the foreign "
        "bloc continues. This is not a model of tariffs, existing foreign assets or separate "
        "capital controls. A pause blocks domestic and imported AI use, but open trade can still "
        "displace workers through foreign competition. If both pause, neither deploys AI during the "
        "ten years. The foreign bloc uses the US household distribution and fiscal reference, not "
        "foreign household microdata.",
    },
    {
        "title": "Trade prices and purchasing power",
        "detail": "An Armington-inspired approximation separates internationally tradable spending from local "
        "spending. Buyers substitute between domestic and foreign products; relative producer "
        "prices clear the two regions' goods markets, including net AI-service profit income. "
        "Foreign growth changes import prices, competition and export demand. Household utility "
        "uses income divided by the consumer price index. Cheaper imports therefore raise "
        "purchasing power without being counted again as physical GDP. A ban removes foreign "
        "varieties without renormalizing preferences, raising the cost of the consumption basket. "
        "Real wage-retention, benefit and other public-spending promises are indexed to that cost "
        "before testing funding. The model uses one aggregate tradable sector, not detailed "
        "industry supply chains.",
        "equation": "Import share = βa r⁻ᶿ / (1 − a + a r⁻ᶿ); consumer price / domestic producer price = (1 − "
        "a + a r⁻ᶿ)⁻ᵝ⁄ᶿ",
    },
    {
        "title": "Trade calibration and assumptions",
        "detail": "The starting data use revised 2025 US goods and services imports of $4.361773 trillion and "
        "exports of $3.429813 trillion. The model does not track deficit financing: it normalizes "
        "baseline two-way trade to their geometric mean, about $3.868 trillion in each direction. "
        "GDP is an approximate spending base here, not the gross-expenditure measure used in "
        "structural trade estimates. The assumed tradable share defaults to 40%; the trade "
        "elasticity defaults to four. Both can be changed. If custom inputs imply more trade than "
        "the tradable sector permits, the common flow is capped at 95% of the smaller bloc's "
        "tradable spending. This calibration illustrates mechanisms; it does not estimate the cost "
        "of a real US trade embargo.",
    },
    {
        "title": "Trade and available jobs",
        "detail": "Import competition and declining exports reduce available productive positions, including "
        "under a domestic AI pause. Trade pressure follows changes in import spending share and "
        "export volumes, bounded by the tradable share. Improving trade conditions can restore "
        "positions; a worker’s decision to search does not recreate a lost job. The one-for-one "
        "response to trade pressure is a modeling assumption, not an estimated employment "
        "elasticity. Trade losses and unfilled human roles reduce production rather than being "
        "counted as domestic AI output.",
    },
    {
        "title": "One vote on a complete package",
        "detail": "Voters know their modeled career and income path. They initially favor their highest-utility funded package. "
        "Compromises are considered by a conservative estimate of their benefiting coalition, not policy names. Voters may "
        "withdraw support through abstention to restore a preferred status quo; abstention never lowers the majority threshold. "
        "Exact ties use a deterministic policy-terms hash, with eligible current policy preferred on personal indifference. "
        "A cycle or 64 switches selects a funded recorded outcome with the smallest strongest-challenger support, then "
        "greatest ballot support. This rule-selected outcome is not certified stable. A complete package needs more than "
        "half of adult-citizen weight; otherwise current policy remains. There is one ballot. International choices are "
        "checked against the other side’s known policy; only verified pairs are described as mutually consistent. "
        "The public horizon is ten years. This is an explicit bargaining protocol, not a proof of unique Nash play.",
    },
]

MODEL_NOTES.append(
    {
        "title": "AI tax and adoption",
        "detail": "Private deployment is multiplied by (1 − additional AI tax) raised to the policy-response parameter. At 100% additional tax private domestic deployment is zero; imported spillovers may remain if trade is open. This reduced-form response is an assumption, not an estimated firm optimization. The AI tax does not directly reduce non-AI productive capacity. International mobile AI returns also respond to the additional tax. Ordinary capital taxes stay fixed.",
    }
)
