# AI Pirate’s Game

[Live simulator](https://ai-pirates-game.com) · [Source repository](https://github.com/SokolskyNikita/pirates_game_ai)

A game-theory simulation of automation and voting at [ai-pirates-game.com](https://ai-pirates-game.com/), by [Nikita Sokolsky](https://sokolsky.me).

When AI makes jobs obsolete, which job protections, benefits and taxes would perfectly rational, self-interested voters choose? This model puts every complete policy package on one ballot, including AI deployment pace. It includes a US-only scenario and a scenario with international AI competition.

The players are idealized: they understand all modeled consequences and maximize only their own objective. Each US voter maximizes expected household-income utility over ten years, with no separate concern for anyone else’s welfare. The results describe hypothetical outcomes under these assumptions; they are not policy recommendations or predictions of real elections.

## Run locally

Use Node.js 22.12 or newer (Node 24 is specified in `.nvmrc`), Python 3.13 or newer, and [uv](https://docs.astral.sh/uv/getting-started/installation/).

```sh
npm ci
npm run dev
```

Development serves the static Astro site, normally at `http://localhost:4321`. It reads the committed compressed scenario library. No Python server, account or API key is needed to use the site.

Python commands run through `node scripts/python-tool.mjs`, which uses the pinned uv version and the locked project environment. Python dependencies are declared in `pyproject.toml` and locked in `uv.lock`; JavaScript dependencies are pinned in `package-lock.json`. `PIRATES_UV_EXECUTABLE` can point the launcher to an existing uv executable.

## Validate and build

```sh
npm run check
npm test
npm run build
npm run preview
```

Checks cover the Astro/TypeScript rendering layer and Python source. Tests cover economic accounting, job competition, voting rules, API validation and presentation behavior. International tests cover trade accounting, price effects, worker adjustment and mutually consistent choices.

The build validates every declared static scenario, measures the compressed library, generates its index and builds Astro into `dist/`. Missing or stale results fail the build. It never starts a live calculation service. `npm run preview` serves the same assets through the small redirect-only Cloudflare Worker.

Use `npm run test:api -- https://ai-pirates-game.com` to check static asset delivery and confirm the old calculation endpoint is absent. The historical Python HTTP adapter is retained for reference and tests; it is not deployed.

Compressed scenario assets are committed so a checkout builds without repeating the expensive calculations. To regenerate after changing the Python model, follow [the static-library instructions](docs/precomputation-options.md).

## Population and reference policy

The electorate uses the **2026 Census CPS ASEC, covering 2025 income**. Every represented US citizen age 18+ has equal voting weight; there is no turnout adjustment or adjustable worker/owner ratio. The CPS household sample does not cover every institutionalized, overseas or military-barracks population.

The published aggregate data contain 99 groups by household income source, income quintile and employment status. Household resources are shared among all household adults, including noncitizens; citizen adults retain their individual survey weights for voting. People with wages, investment income and benefits keep every component. Descriptive personal-income and benefit-receipt percentages are reported separately from the household groups used to calculate preferences.

See [the data definitions and reproduction instructions](docs/us-electorate-data.md). The source archive stays outside the repository; only aggregate groups and a reproducible processing script are published.

## What the model decides

The US-only ballot contains all 4,860 valid combinations of six policy terms (4,320 when pausing AI is unavailable). International mode adds a trade choice, giving each side 9,720 combinations (8,640 without a pause). The current-policy package remains on the US ballot:

1. Pause AI, allow current AI pace, or accelerate AI.
2. Allow layoffs or require employers to retain affected workers at 50%, 100% or 125% of prior wages.
3. Set the modeled benefit budget to 0%, 50%, 100%, 150% or 200% of its 2025 reference.
4. Preserve the current recipient mix, pay equally to every adult, or pay in proportion to pre-AI disposable household income.
5. Change the tax benchmark on work, pensions and other non-investment income.
6. Change the tax benchmark on investment income.
7. In international mode, allow or ban trade with the other economy.

“Pausing AI isn’t possible” is unchecked by default. When checked, it excludes Pause AI from the US ballot and, in international mode, from the foreign actor’s menu. Shared links, downloads and precomputed keys include this setting. Reset restores the unchecked default. The no-AI baseline remains a diagnostic reference, not an available policy.

Tax choices include reductions, the current reference, increases and the 0%/100% endpoints. Each group's tax profile changes toward those endpoints; the page distinguishes the selected benchmark from the resulting average rate after incomes change. References are model allocations of Census-estimated federal/state income taxes and payroll contributions, including self-employment contributions. They are not statutory rates or all US taxes. Negative net tax amounts are represented as benefit payments without double counting.

The benefit reference includes cash benefits, valued food/housing/energy assistance and those net tax refunds. Medicare and Medicaid coverage is shown descriptively but is not converted into cash. The flat and prior-income formulas redesign the entire modeled benefit allocation. Prior-income payments use frozen pre-AI disposable household income; wage changes after hiring do not change that reference. Keeping the same total budget does not keep every person's benefit unchanged. The current mix freezes observed recipient shares; it does not simulate each program's future eligibility rules.

Employer retention is paid from capital resources and creates no extra production while workers remain in replaced roles. Retained workers do not join the external search pool; employers can redeploy them into productive vacancies before outside hires. Protected wages stay tied to pre-AI pay. A package is eligible only when employers can pay promised retained wages and taxes can pay all promised benefits plus the fixed commitment to other public spending in every year. Later surpluses cannot finance earlier deficits; borrowing is not modeled. Eligibility is checked after behavioral responses. Underfunded packages cannot receive votes. Under the default majority rule, current policy remains the automatic fallback if no eligible package wins a majority, even if it becomes underfunded; the result then shows the shortfall. Under the most-votes rule, only a fully funded package other than US current policy can take office. If no such package exists, the calculation reports an error rather than inventing a fallback. Extra tax receipts become non-transfer public spending, not an unrequested dividend.

## Voting and international competition

Every citizen begins with the fully funded package giving their household the greatest ten-year expected utility, but can support a strategically preferable compromise through the coordination protocol below. By default, the package with the most votes passes only if **more than half** the population chooses it; otherwise the exact current-tax/current-benefit package with current AI pace remains. The public simulator always uses this majority rule. Legacy links selecting plurality are migrated to majority voting with a visible notice. There is one vote, with no runoff. Utility uses a 3% discount rate, a logarithm and a small offset at zero income. Displacement risk is equal across labor-income groups. The model computes expected utility across work/no-work states, not utility of average income.

Exact personal-utility ties prefer current policy when eligible, then a fixed policy-ID order. The Python research API retains a separately tested plurality rule, but it is not offered by the public site. Initial intentions are sincere. `strategic_ballot.py` then checks funded challengers in fixed policy-ID order: every citizen strictly preferring an enactable challenger to the anticipated outcome can switch, while nonmembers keep their intentions. Only one final ballot is cast. A repeated ballot or 64 switches invokes a fixed rule selecting the most-supported recorded passing package, with canonical tie-breaking. The result identifies whether it was coalition-stable or selected by this rule. This explicit single-package coalition protocol does not exhaust all strategic deviations or determine a unique Nash equilibrium. Deliberately splitting votes to trigger fallback is outside the protocol.

In international mode the rest of the world is one actor choosing its own complete funded package. Its objective is worker-household income, population-weighted income utility, or modeled output. The decisions are simultaneous and independent: both sides take the other's choice and the US voting rule as known, and every policy term can differ. There is no joint objective, bargaining or requirement to match policies. A reported consistent pair passes a complete US ballot at the foreign choice and a full foreign best-response check at the **enacted** US policy, including its status-quo fallback when the majority rule applies. There is no treaty stage or second vote. Chosen policies remain in place for ten years. If both independently choose to pause, each expects the other’s pause to last the decade.

The search starts from current fiscal policy with each foreign AI pace and both trade choices: six starts, or four when pausing is unavailable. It follows at most eight response steps per start. These are computational search steps, not repeated elections. Ballots and foreign responses are cached by the other side's policy. Verified pairs are preferred. Otherwise a fixed selection rule chooses the examined funded foreign choice with the smallest remaining improvement from switching, followed by greatest US ballot support and canonical policy IDs. This returns a selected outcome without claiming every profitable deviation has been eliminated. If several pairs are found, the first verified pair in the fixed search order is displayed and the count is reported. The search does not enumerate every equilibrium.

The foreign economy uses the US household structure as a simplifying assumption; its GDP size, trade exposure and frontier capability differ. It must fund its own commitments without cross-border government transfers. Cross-border AI profit payments are modeled separately.

A pause prevents domestic and imported AI use for the whole decade. It does not prevent job losses from foreign competition when trade is open. Current pace completes domestic deployment in year ten; acceleration compresses that deployment curve into five years. Imported exposure also depends on the other side's AI availability. Policy burdens can delay rollout within the chosen schedule and reduce productive capacity, but cannot silently lower the domestic endpoint. The rollout-delay burden prices the required retention payroll at full rollout, independently of rollout speed. Transformed jobs can absorb retained workers, so changing a role without reducing job counts does not create a permanent extra payroll charge. The chart omits income for states with no remaining workers.

## Jobs, wages and growth

Three assumptions separate job changes from job search:

- `jobChange` is the net change in productive job slots at full AI exposure, from −100% to +100%, default −90%.
- `jobsAffected` is the share of current roles eventually changed or replaced, default 100%. It must be at least `max(0, -jobChange)`. Controls, request normalization and precomputation enforce the same bound.
- `jobSearch` is the share of newly laid-off workers entering the active search pool, default 85%. It is not a probability of being hired or an annual return-to-work rate.

At exposure `e`, the affected share is `A = jobsAffected × e`. Original productive slots are `1 − A`; new or transformed slots are `A + jobChange × e`, before trade adjustment. Thus 100% of original jobs can change while the number of jobs stays constant. A 90% net reduction requires at least 90% of original jobs to change. The starting workforce stays fixed: the model does not add immigrants or recruit adults who had no work income at the start, so excess slots can remain vacant.

New layoffs add searchers according to `jobSearch`. Active searchers compete for available slots; they are not automatically reemployed after a year. New contracts receive the wage factor `min(1, jobSlots / (employed + activeSearchers + retained))`, where retained workers are available for redeployment. Existing contracts keep their factor until replacement, while actual pay still changes with aggregate income allocation, work incentives and consumer prices. When layoffs are allowed, one replacement round per year lets searchers take existing jobs at the lower factor and displace incumbents, who can then enter the search pool. Each job pool uses an average contract factor rather than individual wage histories. Workers covered by employer retention do not search while retained and can be redeployed before outside hires. Their protected-pay reference and prior-income benefits remain fixed at pre-AI amounts.

The 85% default rounds the BLS estimate that 86.9% of all workers displaced during 2023–25 were employed or unemployed in January 2026: 67.6% employed plus 19.3% unemployed. This is a participation proxy, not a measured median or immediate willingness to search. It covers displaced workers aged 20+ across all tenures. See [BLS table 8, released August 27, 2026](https://www.bls.gov/news.release/disp.t08.htm).

The GDP controls `usAiGrowth` and `foreignAiGrowth` set **AI’s addition to annual real growth at full exposure**, defaulting to 5 percentage points each. Potential output compounds by `1 + backgroundGrowth + aiGrowth × AIExposure`. Background growth is assumed to be 2% in the US and 3% abroad. A pause leaves that background growth in place. At full exposure the default US potential growth rate is therefore 7%, before policy effects. Weaker investment, work incentives and trade losses can still make realized output fall.

The background rates are rounded modeling assumptions. [CBO’s February 2026 outlook](https://www.cbo.gov/publication/62050) projects 1.8% US real growth from 2027 onward and already includes a small AI productivity contribution. [The World Bank’s June 2026 outlook](https://www.worldbank.org/en/news/press-release/2026/06/11/global-economic-prospects-june-2026-press-release) projects 2.8% world growth in 2027. These forecasts inform the scale of the background assumptions; they do not identify growth in a world without AI.

The employer-gain setting affects income allocation, not the potential GDP path. Before economy-wide scaling, a role with a $100,000 prior wage produces a $150,000 claim for the employer at a 50% gain; paying the retained worker $100,000 leaves $50,000. Productive wage claims reflect employment and sticky contracts. Trade adjustment separately changes job capacity; it does not create a domestic AI income claim. The model scales gross income claims to the independently calculated GDP, then pays real costs, retained wages and taxes. Actual income can therefore differ from the simple firm example. Higher employer gains can also change which policies voters select. This is an assumed allocation rule, not an estimated system of market prices. Benefits and retained-wage targets remain in reference-year dollars rather than growing automatically with GDP.

International size and trade references use 2025 World Bank and BEA data. Investment and labor responses are measured relative to the current-tax baseline; background growth continues even without new AI adoption. High policy burdens can reduce adoption, labor effort and productive capacity. The 5% capacity-renewal rate and behavioral responses are assumptions, not estimated elasticities.

This is a finite policy model, not a calibrated general-equilibrium forecast. Its dollar amounts describe household resources, which include pension withdrawals and capital gains; its output index is not observed GDP. It solves relative producer prices and consumer demand in a simplified two-region trade model. It does not solve sector or asset prices, debt, firm investment decisions, repeated elections, or the value of individual public services.

The page includes expandable equations, accounting, comparisons and survey definitions. Every supported scenario uses precomputed data. The browser downloads and decompresses exact saved results; it does not calculate economic outcomes or votes. Scenarios and results can be shared or downloaded. See the [Python refactor and model audit](docs/python-model-audit.md) for the current calculation structure and remaining limits, and the [earlier calculator audit](docs/calculator-audit.md) for the previous version's changes.

## International trade

“Allow free trade?” belongs to both actors’ complete policy packages. Bilateral trade is open only if both permit it. If either bans it, both lose access to the other economy’s products, export market and imported AI. The modeled cross-border AI profit payments also stop; trade inside the rest-of-world bloc continues. The US-only scenario ignores these channels.

The consumption model separates tradable goods and services from local services. The default tradable share is 40%, an adjustable assumption. Within that share, buyers substitute domestic and foreign products with a trade elasticity of 4 (CES substitution elasticity 5), informed by [Simonovska and Waugh](https://www.nber.org/papers/w16796). It is not an AI-specific estimate. Relative producer prices clear bilateral goods markets including profit income. Consumer price indices convert each household’s after-tax resources into purchasing power. Cheaper imports can improve real household income without increasing physical domestic output.

The [June 2026 BEA release](https://www.bea.gov/sites/default/files/2026-06/trad1326.pdf) gives 2025 imports of $4.361773 trillion and exports of $3.429813 trillion. To avoid an unmodeled borrowing requirement, the calculator balances the reference flow at their geometric mean (about $3.868 trillion each way), rather than reproducing the US deficit. It caps this flow at feasible tradable capacity when inputs require it. Observed ratios set the scale; the balanced-flow assumption is explicit.

Trade-related job losses are separate from domestic AI replacement. A rise in the import spending share or loss of export volume reduces productive job slots, including during an AI pause. The assumed coefficient is one percentage point of capacity per point of import-share growth or export-volume loss relative to prior available output, capped by the tradable share. The preceding year’s market changes affect current capacity. Signed changes allow improving trade conditions to restore slots. This capacity adjustment is independent of job-search participation; workers compete for the resulting pool of jobs. The coefficient is illustrative. [Autor, Dorn and Hanson](https://www.nber.org/papers/w21906) support persistent adjustment costs, not this specific formula.

Trade-adjustment unemployment reduces productive labor and output; it is not booked as domestic AI production. Loss of imported varieties raises consumer prices when trade closes. Retained-wage, benefit and required-public-spending promises keep their baseline purchasing power, so their producer-currency funding requirements adjust with consumer prices. The public result reports monetary resources in real reference-year dollars and physical output separately. A policy must still fund every promise in each year after these effects.

Annual results report job availability and worker outcomes alongside consumer prices, import and export shares, and whether trade is open. The annual trade table separates trade adjustment from domestic AI exposure. This broad two-region model does not resolve individual industries, supply chains, tariffs or exchange-rate policy. Its response parameters and 40% tradable share are assumptions, not values inferred from the cited economy totals.

## Complete static library

All 384 valid combinations in the reduced grid are saved. US AI growth offers 0 or 5 additional points, employer gain 0 or 40%, net jobs −100%, −90%, 0% or +100%, affected roles 0 or 100%, and search participation 0 or 85%. The job constraint removes invalid combinations. The pause setting remains selectable; international mode retains all three foreign objectives. Advanced assumptions remain at their disclosed defaults.

Every scenario still evaluates the full policy ballot. The compact interface shows enacted policies, the main income chart and outcome summaries; detailed alternative comparisons are retained only in local calculation records. Old off-grid links move to supported choices with a visible notice. There is no interpolation or calculation fallback.

See [coverage, timings and regeneration](docs/precomputation-options.md).

## Architecture

All economic calculations, utility comparisons, ballots, international responses and manual policy comparisons live in `calculator/`. Astro creates the page markup. Browser TypeScript handles controls, links, formatting, charts and embedded-data lookup; it contains no second implementation of the calculator.

| Area | Files and responsibility |
| --- | --- |
| Assumptions and population | `calculator/config.py` defines model constants and input metadata. `population.py` prepares the weighted cohorts in `calculator/data/us-electorate-data.json`. |
| Policy menu | `calculator/policies.py` constructs the complete finite menu and exact current-policy references. |
| Economic calculation | `calculator/production.py` calculates deployment, job capacity, income claims and productive capacity. `labor_market.py` tracks workers, matches them to jobs and updates wage contracts for scalar and NumPy calculations. `trade.py` calculates bilateral trade, producer and consumer prices, and trade-adjustment exposure. `trajectory.py` shares the annual loop between scalar and batch evaluation. `finance.py` owns employer budgets, taxes, benefits and household utility; `settlement.py` aggregates and reports scalar results. `model.py` accumulates discounted ten-year profiles. |
| Batch evaluation | `calculator/batch.py` evaluates policy menus with NumPy; `batch_settlement.py` adapts the shared fiscal equations to policy-by-cohort arrays. Packages sharing production, investment and trade assumptions reuse one economic trajectory; household funding and utility are still evaluated for every package in bounded chunks. Candidates close to utility maxima or funding thresholds are checked with the scalar model before exact ballot comparisons. |
| Voting | `calculator/ballot.py` establishes sincere intentions; `strategic_ballot.py` searches strictly improving coalitions before the final vote. `election.py` applies the selected majority-with-fallback or plurality rule and verifies international responses. |
| Results and comparisons | `calculator/simulation.py` assembles the selected, reference and leading profiles. `comparison.py` evaluates manual packages and their pairwise preference shares. |
| API and generated data | `calculator/requests.py` validates request payloads. `artifacts.py` generates presentation metadata and common scenario assets. `worker/static.ts` handles canonical redirects and serves static assets. The Python HTTP adapter is not deployed. |
| Pages | `src/pages/index.astro` composes the introduction, controls, results, model notes and sources from `src/components/economy/`. |
| Browser rendering | `src/components/economy/pirates-game.ts` coordinates requests and updates. `src/lib/presentation/` separates state, controls, charts, results, population displays and formatting. `src/lib/api/` holds the HTTP client and response types. |
| Build and research | `scripts/precompute-local.py` runs a resumable process pool. `scripts/static_grid.py` declares the supported grid. `scripts/build-static-library.py` validates and packages the completed results. `scripts/build-us-electorate.py` reproduces the Census aggregates. |
| Tests | `tests/python/` covers the Python calculator and HTTP boundary; `tests/fixtures/` contains migration references. Frontend tests live beside the API and presentation modules. |

Generated `src/generated/calculator-config.json` supplies the interface with Python-owned labels, choices and reference values. The complete compact library lives in `src/generated/results.json.gz`; the build validates and embeds it in the page. Shared Python data structures are in `calculator/types.py`.

## Static delivery

`src/generated/static-grid.json` defines all supported control stops and fixed assumptions. `src/generated/static-library.json` records coverage, fingerprint and compressed size. `src/lib/api/calculator.ts` reads exact saved results from the embedded library without network requests. The complete library must remain below 3.5 MB gzip. The former `/api/health`, `/api/simulate` and `/api/compare` endpoints are no longer served.

This repository is independent of the original personal website. It contains no personal-site APIs or analytics integration. Fonts are requested from Google Fonts, with local fallback fonts.

## Publication

The site uses Cloudflare Workers Static Assets. The tiny `worker/static.ts` only redirects the canonical domain and calls the asset binding; it imports no calculator and exposes no calculation API. `wrangler.jsonc` keeps the existing domain bindings. `npm run deploy` validates, builds and publishes with the existing authenticated Cloudflare session.

HTTP and `www` requests redirect to `https://ai-pirates-game.com`, preserving paths and query strings. Scenario files are gzip-compressed JSON fetched individually and decompressed by the browser. The full library is embedded only when its measured compressed size is below 3,500,000 bytes. Otherwise the site remains static and fetches the chosen file; there is still no calculation backend.

Pause AI packages fix employer retention to None (0%). This restriction applies independently to both countries, including when open trade permits foreign competition. Other AI paces retain all wage-retention options.
