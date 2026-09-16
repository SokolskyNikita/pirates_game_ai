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

The development command prints the local address (normally `http://localhost:4321`). Set `PIRATES_SITE_PORT` or `PIRATES_API_PORT` if another project uses its default ports. Changes to Python source restage the local Worker automatically; development disables the production precomputed cache. It serves Astro's rendered pages and the Python calculator together. No account, database, API key or environment file is required for local use.

Python commands run through `node scripts/python-tool.mjs`, which uses the pinned uv version and the locked project environment. Python dependencies are declared in `pyproject.toml` and locked in `uv.lock`; JavaScript dependencies are pinned in `package-lock.json`. `PIRATES_UV_EXECUTABLE` can point the launcher to an existing uv executable.

## Validate and build

```sh
npm run check
npm test
npm run build
npm run preview
```

Checks cover the Astro/TypeScript rendering layer and Python source. Tests cover the economic accounting, voting rules, API validation, and presentation behavior. Migration fixtures preserve domestic results from the previous TypeScript calculator. International tests cover trade accounting, price effects, worker adjustment and mutually consistent choices.

The build runs the Python artifact generator, builds Astro into `dist/`, and stages the Python Worker for deployment. It generates thirty-two common scenario results and presentation metadata from the same Python model used by the API. `npm run preview` serves the built pages and calculator together; an Astro-only file server cannot answer calculation requests.

To check a running deployment against the native Python calculator, run `npm run test:api -- https://ai-pirates-game.com` (or a local preview URL). It checks complete ballots and manual comparisons in both modes, plus request validation.

The static output includes a sitemap, `robots.txt`, and a custom `404.html`. Build output and generated scenario assets are not committed.

## Population and reference policy

The electorate uses the **2026 Census CPS ASEC, covering 2025 income**. Every represented US citizen age 18+ has equal voting weight; there is no turnout adjustment or adjustable worker/owner ratio. The CPS household sample does not cover every institutionalized, overseas or military-barracks population.

The published aggregate data contain 99 groups by household income source, income quintile and employment status. Household resources are shared among all household adults, including noncitizens; citizen adults retain their individual survey weights for voting. People with wages, investment income and benefits keep every component. Descriptive personal-income and benefit-receipt percentages are reported separately from the household groups used to calculate preferences.

See [the data definitions and reproduction instructions](docs/us-electorate-data.md). The source archive stays outside the repository; only aggregate groups and a reproducible processing script are published.

## What the model decides

The US-only ballot contains all 6,480 combinations of six policy terms (4,320 when pausing AI is unavailable). International mode adds a trade choice, giving each side 12,960 combinations (8,640 without a pause). Disallowing the US status quo excludes its exact current-policy package from these counts; it does not remove a foreign option:

1. Pause AI, allow current AI pace, or accelerate AI.
2. Allow layoffs or require employers to retain affected workers at 50%, 100% or 125% of prior wages.
3. Set the modeled benefit budget to 0%, 50%, 100%, 150% or 200% of its 2025 reference.
4. Preserve the current recipient mix, pay equally to every adult, or pay in proportion to pre-AI disposable household income.
5. Change the tax benchmark on work, pensions and other non-investment income.
6. Change the tax benchmark on investment income.
7. In international mode, allow or ban trade with the other economy.

“Pausing AI isn’t possible” is unchecked by default. When checked, it excludes Pause AI from the US ballot and, in international mode, from the foreign actor’s menu. Shared links, downloads and precomputed keys include this setting. Reset restores the unchecked default. The no-AI baseline remains a diagnostic reference, not an available policy.

Tax choices include reductions, the current reference, increases and the 0%/100% endpoints. Each group's tax profile changes toward those endpoints; the page distinguishes the selected benchmark from the resulting average rate after incomes change. References are model allocations of Census-estimated federal/state income taxes and payroll contributions, including self-employment contributions. They are not statutory rates or all US taxes. Negative net tax amounts are represented as benefit payments without double counting.

The benefit reference includes cash benefits, valued food/housing/energy assistance and those net tax refunds. Medicare and Medicaid coverage is shown descriptively but is not converted into cash. The flat and prior-income formulas redesign the entire modeled benefit allocation. Keeping the same total budget does not keep every person's benefit unchanged. The current mix freezes observed recipient shares; it does not simulate each program's future eligibility rules.

Employer retention is paid from capital resources and creates no extra production. A package is eligible only when employers can pay promised retained wages and taxes can pay all promised benefits plus the fixed commitment to other public spending in every year. Later surpluses cannot finance earlier deficits; borrowing is not modeled. Eligibility is checked after behavioral responses. Underfunded packages cannot receive votes. Under the default majority rule, current policy remains the automatic fallback if no eligible package wins a majority, even if it becomes underfunded; the result then shows the shortfall. Under the most-votes rule, only a fully funded package other than US current policy can take office. If no such package exists, the calculation reports an error rather than inventing a fallback. Extra tax receipts become non-transfer public spending, not an unrequested dividend.

## Voting and international competition

Every citizen selects the fully funded package with the greatest ten-year expected household-income utility. By default, the package with the most votes passes only if **more than half** the population chooses it; otherwise the exact current-tax/current-benefit package with current AI pace remains. Checking **“Retaining status quo isn’t an option”** changes this to a plurality rule: the fully funded package with the most votes wins regardless of its share. It removes the exact current-policy package from the US ballot, as well as the automatic fallback; the winner must be a different package. Current policy remains available as a counterfactual comparison, clearly labeled as outside the ballot. The foreign actor’s menu is unchanged. Everyone knows the selected rule before choosing a package. The setting defaults to false, is included in links, downloads, API requests and precomputed keys, and is cleared by Reset. There is one vote, with no runoff. Utility uses a 3% discount rate, a logarithm and a small offset at zero income. Displacement risk is equal across labor-income groups. The model computes expected utility across work/no-work states, not utility of average income.

Exact personal-utility ties prefer current policy when eligible, then a fixed policy-ID order. Under plurality, current policy is excluded; both personal-utility ties and ties for the highest vote total use that fixed policy-ID order. This is a specified favorite-package ballot rule. Perfect rationality alone does not uniquely select sincere voting over tactical coordination. A majority failure can result from votes splitting across similar packages.

In international mode the rest of the world is one actor choosing its own complete funded package. Its objective is worker-household income, population-weighted income utility, or modeled output. The decisions are simultaneous and independent: both sides take the other's choice and the US voting rule as known, and every policy term can differ. There is no joint objective, bargaining or requirement to match policies. A reported consistent pair passes a complete US ballot at the foreign choice and a full foreign best-response check at the **enacted** US policy, including its status-quo fallback when the majority rule applies. There is no treaty stage or second vote. Chosen policies remain in place for ten years. If both independently choose to pause, each expects the other’s pause to last the decade.

The search starts from current fiscal policy with each foreign AI pace and both trade choices: six starts, or four when pausing is unavailable. It follows at most eight response steps per start. These are computational search steps, not repeated elections. Ballots and foreign responses are cached by the other side's policy. Only verified pairs are labeled consistent; an unsuccessful search is explicitly unverified and does not prove no pair exists. If several pairs are found, the first verified pair in the fixed search order is displayed and the count is reported. The search does not enumerate every equilibrium.

The foreign economy uses the US household structure as a simplifying assumption; its GDP size, trade exposure and frontier capability differ. It must fund its own commitments without cross-border government transfers. Cross-border AI profit payments are modeled separately.

A pause prevents domestic and imported AI use for the whole decade. It does not prevent job losses from foreign competition when trade is open. Current pace completes domestic deployment in year ten; acceleration compresses that deployment curve into five years. Imported exposure also depends on the other side's AI availability. Policy burdens can delay rollout within the chosen schedule and reduce productive capacity, but cannot silently lower the domestic endpoint. The rollout-delay burden is measured against a common ten-year reference so the pace choice changes timing consistently. With full exposure, 100% obsolescence and no return to work, every worker is affected. Retained employees still count as having obsolete roles. The chart omits income for states with no remaining workers.

The GDP controls set **annual real growth at full AI exposure**, defaulting to 5% separately for the US and foreign economy. The potential index compounds by `1 + growthRate × AIExposure` each year. Under the ten-year rollout, 5% is reached at full exposure; it is not a one-off 5% output gain or ten years of immediate full-adoption growth. A no-AI baseline stays flat. Capacity and work-incentive responses can change realized growth, which is shown in the result.

The employer-gain setting affects income allocation, not that GDP path. Before economy-wide scaling, a role with a $100,000 prior wage produces a $150,000 claim for the employer at a 50% gain; paying the retained worker $100,000 leaves $50,000. Without trade adjustment, the unscaled claims are productive labor `L × (1 − u) × effort`, passive income `P`, and capital `K + (1 + gain) × L × u`, where `u` is AI displacement. Trade adjustment separately reduces productive labor; it does not create an AI income claim. The model scales them proportionally to the independently calculated GDP, then pays real costs, retained wages and taxes. This prevents extra employer gains from inventing output. Actual income can therefore differ from the simple firm example. Higher employer gains redistribute the fixed output toward capital; they can indirectly affect GDP by changing the policies selected. This is an assumed allocation rule, not an estimated system of market prices. Benefits and retained-wage targets remain in reference-year dollars rather than growing automatically with GDP.

International size and trade references use 2025 World Bank and BEA data. Investment and labor responses are measured relative to the current-tax baseline, so a no-AI/current-policy run reproduces reference incomes. High policy burdens can reduce adoption, labor effort and productive capacity. The 5% capacity-renewal rate and behavioral responses are assumptions, not estimated elasticities.

This is a finite policy model, not a calibrated general-equilibrium forecast. Its dollar amounts describe household resources, which include pension withdrawals and capital gains; its output index is not observed GDP. It solves relative producer prices and consumer demand in a simplified two-region trade model. It does not solve sector or asset prices, debt, firm investment decisions, repeated elections, or the value of individual public services.

The page includes expandable equations, accounting, comparisons and survey definitions. Common scenarios use precomputed data; other calculations run in the Python API. The browser requests results and renders them; it does not calculate economic outcomes or votes. Scenarios and results can be shared or downloaded. See the [earlier calculator audit](docs/calculator-audit.md) for the previous version's changes.

## International trade

“Allow free trade?” belongs to both actors’ complete policy packages. Bilateral trade is open only if both permit it. If either bans it, both lose access to the other economy’s products, export market and imported AI. The modeled cross-border AI profit payments also stop; trade inside the rest-of-world bloc continues. The US-only scenario ignores these channels.

The consumption model separates tradable goods and services from local services. The default tradable share is 40%, an adjustable assumption. Within that share, buyers substitute domestic and foreign products with a trade elasticity of 4 (CES substitution elasticity 5), informed by [Simonovska and Waugh](https://www.nber.org/papers/w16796). It is not an AI-specific estimate. Relative producer prices clear bilateral goods markets including profit income. Consumer price indices convert each household’s after-tax resources into purchasing power. Cheaper imports can improve real household income without increasing physical domestic output.

The [June 2026 BEA release](https://www.bea.gov/sites/default/files/2026-06/trad1326.pdf) gives 2025 imports of $4.361773 trillion and exports of $3.429813 trillion. To avoid an unmodeled borrowing requirement, the calculator balances the reference flow at their geometric mean (about $3.868 trillion each way), rather than reproducing the US deficit. It caps this flow at feasible tradable capacity when inputs require it. Observed ratios set the scale; the balanced-flow assumption is explicit.

Trade-related displacement is separate from domestic AI replacement. A rise in the import spending share or loss of export volume creates worker-reallocation risk, including during an AI pause. The assumed coefficient is one percentage point of worker exposure per point of import-share growth or export-volume loss relative to prior available output, capped by the tradable share. The preceding year’s market changes affect current labor adjustment, and affected workers recover at the chosen reemployment rate. This coefficient is illustrative. [Autor, Dorn and Hanson](https://www.nber.org/papers/w21906) support persistent adjustment costs, not this specific formula.

Trade-adjustment unemployment reduces productive labor and output; it is not booked as domestic AI production. Loss of imported varieties raises consumer prices when trade closes. Retained-wage, benefit and required-public-spending promises keep their baseline purchasing power, so their producer-currency funding requirements adjust with consumer prices. The public result reports monetary resources in real reference-year dollars and physical output separately. A policy must still fund every promise in each year after these effects.

Annual results include `consumerPriceIndex`, `aiUnemployment`, `tradeUnemployment`, `tradeOpen`, `importShare`, `exportShare` and `relativeProducerPrice`. Both AI and trade displacement are visible in worker outcomes; the annual trade table shows the trade component separately. This broad two-region model does not resolve individual industries, supply chains, tariffs or exchange-rate policy. Its response parameters and 40% tradable share are assumptions, not values inferred from the cited economy totals.

## Precomputation coverage

`npm run build` generates thirty-two exact scenario assets: defaults and 100% obsolete roles / zero return to work / 50% employer gain, each in US-only mode and the three international objectives, with pausing allowed or unavailable and with majority or plurality voting. Their manifest includes a fingerprint of Python model sources, population data and dependency configuration. The API accepts only the matching version and normalized assumptions; otherwise it calculates the requested scenario with the same Python engine. Results use ordinary JSON arrays.

Other slider combinations calculate on demand in Python. This is **not exhaustive precomputation** of all possible assumptions. Controls use discrete 5-percentage-point increments (GDP size in 0.25 increments and trade elasticity in whole units), while retaining exact calibrated references and legacy URL values. The policy grid is already coarser than five points on most axes. See [the feasibility and coverage notes](docs/precomputation-options.md) for why a fully precomputed interface would need a smaller declared assumption grid.

## Architecture

All economic calculations, utility comparisons, ballots, international responses and manual policy comparisons live in `calculator/`. Astro creates the page markup. Browser TypeScript handles controls, links, formatting, charts and HTTP requests; it contains no second implementation of the calculator.

| Area | Files and responsibility |
| --- | --- |
| Assumptions and population | `calculator/config.py` defines model constants and input metadata. `population.py` prepares the weighted cohorts in `calculator/data/us-electorate-data.json`. |
| Policy menu | `calculator/policies.py` constructs the complete finite menu and exact current-policy references. |
| Economic calculation | `calculator/production.py` calculates deployment, displacement, productive capacity and income claims. `trade.py` calculates bilateral trade, producer and consumer prices, and trade-adjustment exposure. `settlement.py` pays retained wages, taxes and benefits and checks resource accounting. `model.py` runs the ten-year profiles and computes utilities. |
| Batch evaluation | `calculator/batch.py` evaluates policy menus with NumPy. Packages sharing production, investment and trade assumptions reuse one economic trajectory; household funding and utility are still evaluated for every package in bounded chunks. Candidates close to utility maxima or funding thresholds are checked with the scalar model before exact ballot comparisons. |
| Voting | `calculator/ballot.py` counts one favorite-package vote per citizen. `election.py` applies the selected majority-with-fallback or plurality rule and verifies international responses. |
| Results and comparisons | `calculator/simulation.py` assembles the selected, reference and leading profiles. `comparison.py` evaluates manual packages and their pairwise preference shares. |
| API and generated data | `calculator/requests.py` validates request payloads. `artifacts.py` generates presentation metadata and common scenario assets. `worker/entry.py` handles HTTP, canonical redirects, API responses and static assets. |
| Pages | `src/pages/index.astro` composes the introduction, controls, results, model notes and sources from `src/components/economy/`. |
| Browser rendering | `src/components/economy/pirates-game.ts` coordinates requests and updates. `src/lib/presentation/` separates state, controls, charts, results, population displays and formatting. `src/lib/api/` holds the HTTP client and response types. |
| Build and research | `scripts/build-precomputed.py` runs the Python artifact generator. `scripts/stage-worker.py` stages deployable Python source and data. `scripts/build-us-electorate.py` reproduces the Census aggregates. |
| Tests | `tests/python/` covers the Python calculator and HTTP boundary; `tests/fixtures/` contains migration references. Frontend tests live beside the API and presentation modules. |

Generated `src/generated/calculator-config.json` supplies the interface with Python-owned labels, choices and reference values. The common scenarios live in `public/precomputed/`; `calculator/_generated.py` contains their deployment manifest. Shared Python data structures are in `calculator/types.py`.

## Calculator API

The page and calculator share an origin. Calculation endpoints accept `POST` requests with `Content-Type: application/json` and bodies up to 16 KiB. Invalid assumptions, policy IDs or pause restrictions return a validation error.

- `GET /api/health` returns the engine name and deployed model fingerprint.
- `POST /api/simulate` accepts `{id, inputs, mode, foreignObjective, pauseUnavailable, statusQuoUnavailable}` and returns `{id, snapshot, source}`. The source is `precomputed` or `calculated`.
- `POST /api/compare` accepts `{scenario, policyId, selectedPolicyId, foreignPolicyId?}` and returns `{profile, voteShare}`. International comparisons require the selected foreign policy. The share is a pairwise preference diagnostic, not a new full-package election.

The scenario `mode` is `us-only` or `strategic`; the foreign objective is `workers`, `prosperity` or `output`. `pauseUnavailable` and `statusQuoUnavailable` default to false. Missing assumptions use model defaults; finite values are normalized to their permitted ranges. Policy IDs come from the published finite menu. Legacy `pace` fields do not restrict the ballot.

This repository is independent of the original personal website. It contains no personal-site APIs or analytics integration. Fonts are requested from Google Fonts, with local fallback fonts.

## Publication

The site uses a Python Cloudflare Worker with Workers Static Assets. `wrangler.jsonc` configures the custom domains, Python runtime, static asset binding and resource limits. Run `npm run deploy` with an authenticated Cloudflare deployment session to check, test, build and publish. Python deployment tools run through the pinned uv launcher. The GitHub Actions workflow validates pushes and pull requests; it has read-only repository access and does not store Cloudflare credentials.

The Worker redirects HTTP requests on the custom domain and all `www.ai-pirates-game.com` requests to `https://ai-pirates-game.com` with a 308 response, preserving the path and query. It handles `/api/` in Python and serves page and asset requests through `ASSETS`, retaining static headers, old-path redirects and the custom 404 page. The HTTPS `workers.dev` address remains available for troubleshooting.

Publish the generated `dist/` directory together with the staged Python Worker and its calibration data. The canonical URL is set in `astro.config.mjs` and the homepage metadata. Hosting and deployment configuration belong to this repository; no files from the original personal site are required.

Before publication, run the checks above and verify the homepage, both simulation modes, manual comparisons, scenario links, API health, asset loading, robots file, sitemap and a missing URL over HTTPS.

## Inspiration and sources

Inspired by [Nuño Sempere (@NunoSempere)](https://nunosempere.com/) and [Humans on AI #53, September 15, 2026](https://p3humansonai.substack.com/p/humans-on-ai-53-september-15th-2026). These credits do not imply endorsement of the model or its assumptions.

The international defaults cite the World Bank, BEA and Stanford AI Index 2026. Trade mechanisms cite Simonovska and Waugh on elasticity, Arkolakis, Costinot and Rodríguez-Clare on gains from trade, Gervais and Jensen on tradable services, and Autor, Dorn and Hanson on labor-market adjustment. The page also cites Acemoglu and Restrepo on automation and new tasks; the IMF on AI and fiscal policy; Guerreiro, Rebelo and Teles on robot taxation; the OECD on employment support; and Ian Stewart’s pirate voting puzzle. Source-specific explanations and links are on the page.

No software license has been selected for this repository.
