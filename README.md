# AI Pirate’s Game

[Live simulator](https://ai-pirates-game.com) · [Source repository](https://github.com/SokolskyNikita/pirates_game_ai)

A game-theory simulation of automation and majority voting at [ai-pirates-game.com](https://ai-pirates-game.com/), by [Nikita Sokolsky](https://sokolsky.me).

When AI makes jobs obsolete, which job protections, benefits and taxes would perfectly rational, self-interested voters choose? This model puts every complete policy package on one ballot, including AI deployment pace. It includes a US-only scenario and a scenario with international AI competition.

The players are idealized: they understand all modeled consequences and maximize only their own objective. Each US voter maximizes expected household-income utility over ten years, with no separate concern for anyone else’s welfare. The results describe hypothetical outcomes under these assumptions; they are not policy recommendations or predictions of real elections.

## Run locally

Use Node.js 22.12 or newer (Node 24 is specified in `.nvmrc`).

```sh
npm ci
npm run dev
```

Astro prints the local address. Eight common scenarios are calculated at build time and loaded as exact matches. Other inputs run in a cancellable browser background worker. No account, database, API key or environment file is required.

## Validate and build

```sh
npm run check
npm test
npm run build
npm run preview
```

The static output is in `dist/`. The build generates a sitemap for the production domain; `public/robots.txt` identifies it. A custom `404.html` is included. Dependencies are pinned and recorded in `package-lock.json`.

## Population and reference policy

The electorate uses the **2026 Census CPS ASEC, covering 2025 income**. Every represented US citizen age 18+ has equal voting weight; there is no turnout adjustment or adjustable worker/owner ratio. The CPS household sample does not cover every institutionalized, overseas or military-barracks population.

The published aggregate data contain 99 groups by household income source, income quintile and employment status. Household resources are shared among all household adults, including noncitizens; citizen adults retain their individual survey weights for voting. People with wages, investment income and benefits keep every component. Descriptive personal-income and benefit-receipt percentages are reported separately from the household groups used to calculate preferences.

See [the data definitions and reproduction instructions](docs/us-electorate-data.md). The source archive stays outside the repository; only aggregate groups and a reproducible processing script are published.

## What the model decides

One ballot contains all 6,480 combinations of six policy terms:

1. Pause AI, allow current AI pace, or accelerate AI.
2. Allow layoffs or require employers to retain obsolete roles at 50%, 100% or 125% of prior wages.
3. Set the modeled benefit budget to 0%, 50%, 100%, 150% or 200% of its 2025 reference.
4. Preserve the current recipient mix, pay equally to every adult, or pay in proportion to pre-AI disposable household income.
5. Change the tax benchmark on work, pensions and other non-investment income.
6. Change the tax benchmark on investment income.

Tax choices include reductions, the current reference, increases and the 0%/100% endpoints. Each group's tax profile changes toward those endpoints; the page distinguishes the selected benchmark from the resulting average rate after incomes change. References are model allocations of Census-estimated federal/state income taxes and payroll contributions, including self-employment contributions. They are not statutory rates or all US taxes. Negative net tax amounts are represented as benefit payments without double counting.

The benefit reference includes cash benefits, valued food/housing/energy assistance and those net tax refunds. Medicare and Medicaid coverage is shown descriptively but is not converted into cash. The flat and prior-income formulas redesign the entire modeled benefit allocation. Keeping the same total budget does not keep every person's benefit unchanged. The current mix freezes observed recipient shares; it does not simulate each program's future eligibility rules.

Employer retention is paid from capital resources and creates no extra production. A package is eligible only when employers can pay promised retained wages and taxes can pay all promised benefits plus the fixed commitment to other public spending in every year. Later surpluses cannot finance earlier deficits; borrowing is not modeled. Eligibility is checked after behavioral responses. Underfunded packages cannot receive votes. Current policy remains the automatic fallback if no eligible package wins a majority, even if it becomes underfunded; the result then shows the shortfall. Extra tax receipts become non-transfer public spending, not an unrequested dividend.

## Voting and international competition

Every citizen selects the fully funded package with the greatest ten-year expected household-income utility. The package with the most votes passes only if **more than half** the population chooses it; otherwise the exact current-tax/current-benefit package with current AI pace remains. There is one vote, with no runoff. Utility uses a 3% discount rate, a logarithm and a small offset at zero income. Displacement risk is equal across labor-income groups. The model computes expected utility across work/no-work states, not utility of average income.

Exact personal-utility ties prefer current policy when eligible, then a fixed policy-ID order. This is a specified favorite-package ballot rule. Perfect rationality alone does not uniquely select sincere voting over tactical coordination. A majority failure can result from votes splitting across similar packages.

In international mode the rest of the world is one actor choosing its own complete funded package. Its objective is worker-household income, population-weighted income utility, or modeled output. Both sides take the other's choice as known. A reported consistent pair passes a complete US ballot at the foreign choice and a full foreign best-response check at the **enacted** US policy, including its status-quo fallback. There is no treaty stage or second vote. Chosen policies remain in place for ten years, including a mutual pause.

The search starts from current fiscal policy with each of the three foreign AI paces and follows at most eight response steps per start. These are computational search steps, not repeated elections. Ballots and foreign responses are cached by the other side's policy. Only verified pairs are labeled consistent; an unsuccessful search is explicitly unverified and does not prove no pair exists. If several pairs are found, the first verified pair in the fixed search order is displayed and the count is reported. The search does not enumerate every equilibrium.

The foreign economy uses the US household structure as a simplifying assumption; its GDP size, trade exposure and frontier capability differ. It must fund its own commitments without cross-border payments.

A pause prevents AI exposure and job replacement for the whole decade, including imported AI. Foreign competition can still change rents and income. Current pace completes domestic deployment in year ten; acceleration compresses that deployment curve into five years. Imported exposure also depends on the other side's AI availability. Policy burdens can delay rollout within the chosen schedule and reduce productive capacity, but cannot silently lower the domestic endpoint. The rollout-delay burden is measured against a common ten-year reference so the pace choice changes timing consistently. With full exposure, 100% obsolescence and no return to work, every worker is affected. Retained employees still count as having obsolete roles. The chart omits income for states with no remaining workers.

The GDP controls set **annual real growth at full AI exposure**, defaulting to 5% separately for the US and foreign economy. The potential index compounds by `1 + growthRate × AIExposure` each year. Under the ten-year rollout, 5% is reached at full exposure; it is not a one-off 5% output gain or ten years of immediate full-adoption growth. A no-AI baseline stays flat. Capacity and work-incentive responses can change realized growth, which is shown in the result.

The employer-gain setting affects income allocation, not that GDP path. Before economy-wide scaling, a role with a $100,000 prior wage produces a $150,000 claim for the employer at a 50% gain; paying the retained worker $100,000 leaves $50,000. The unscaled claims are productive labor `L × (1 − u) × effort`, passive income `P`, and capital `K + (1 + gain) × L × u`. The model scales them proportionally to the independently calculated GDP, then pays real costs, retained wages and taxes. This prevents extra employer gains from inventing output. Actual income can therefore differ from the simple firm example. Higher employer gains redistribute the fixed output toward capital; they can indirectly affect GDP by changing the policies selected. This is an assumed allocation rule, not an estimated system of market prices. Benefits and retained-wage targets remain in reference-year dollars rather than growing automatically with GDP.

International size and trade references use 2025 World Bank and BEA data. Investment and labor responses are measured relative to the current-tax baseline, so a no-AI/current-policy run reproduces reference incomes. High policy burdens can reduce adoption, labor effort and productive capacity. The 5% capacity-renewal rate and behavioral responses are assumptions, not estimated elasticities.

This is a finite policy model, not a calibrated general-equilibrium forecast. Its dollar amounts describe household resources, which include pension withdrawals and capital gains; its output index is not observed GDP. It does not solve prices, debt, firm investment decisions, repeated elections, or the value of individual public services.

The page includes expandable equations, accounting, comparisons and survey definitions. Common scenarios load precomputed data; other calculations run in a cancellable background worker. Scenarios and results can be shared or downloaded. See the [earlier calculator audit](docs/calculator-audit.md) for the previous version's changes.

## Precomputation coverage

`npm run build` generates eight exact scenario assets: defaults and 100% obsolete roles / zero return to work / 50% employer gain, each in US-only mode and the three international objectives. Their manifest includes a checksum of model sources and population data. The loader rejects stale versions and mismatched assumptions; typed utility arrays are restored for manual comparisons. Generated assets are not committed, and are regenerated for deployment.

Other slider combinations still calculate in the browser. This is **not exhaustive precomputation** of all possible assumptions. Controls use discrete 5-percentage-point increments (GDP size in 0.25 increments), while retaining exact calibrated references and legacy URL values. The policy grid is already coarser than five points on most axes. See [the feasibility and coverage notes](docs/precomputation-options.md) for why a fully precomputed interface would need a smaller declared assumption grid.

## Source layout

- `src/pages/index.astro`: interface, explanations and citations.
- `src/components/economy/pirates-game.ts`: browser controls, charts and results.
- `src/lib/economy/pirates-model.ts`: economic outcomes and resource accounting.
- `src/lib/economy/package-ballot.ts`: one personal choice per citizen, full-funding eligibility and majority fallback.
- `src/lib/economy/package-election.ts`: full US ballots and verified international responses.
- `src/lib/economy/pirates-voting.ts` and `pirates-treaty.ts`: historical solvers retained for comparison; the live simulator uses only the former’s pairwise preference helper for manual comparisons.
- `scripts/build-precomputed.mjs` and `src/lib/economy/precomputed.ts`: versioned exact-match scenario generation and loading.
- `src/lib/economy/simulation.ts` and `simulation.worker.ts`: compact results and cancellable background calculation.
- `src/lib/economy/us-electorate.ts` and `us-electorate-data.json`: weighted survey groups and reference statistics.
- `scripts/build-us-electorate.py`: reproducible Census microdata aggregation.
- `src/lib/economy/*.test.ts`: population, economic and voting checks.
- `src/styles/pirates-game.css`: responsive page styles.
- `worker/index.ts`: canonical HTTPS redirects and the static-assets entrypoint.
- `worker/env.d.ts`: generated Cloudflare bindings and runtime types; refresh with `npm run types` after changing Wrangler configuration.

This repository is independent of the original personal website. It contains no personal-site APIs or analytics integration. Fonts are requested from Google Fonts, with local fallback fonts.

## Publication

The site is hosted on Cloudflare Workers Static Assets. `wrangler.jsonc` is the deployment configuration. Run `npm run deploy` with an authenticated Wrangler session to check, test, build and publish it. The GitHub Actions workflow validates pushes and pull requests; it has read-only repository access and does not store Cloudflare credentials.

The Worker sends HTTP requests on the custom domain and all `www.ai-pirates-game.com` requests to `https://ai-pirates-game.com` with a 308 redirect, preserving the path and query. It serves other requests through the `ASSETS` binding, retaining the static headers, old-path redirects and custom 404 page. The HTTPS `workers.dev` address remains available for troubleshooting.

Publish the generated `dist/` directory together with the Worker entrypoint. The canonical URL is set in `astro.config.mjs` and the homepage metadata. Hosting and deployment configuration belong to this repository; no files from the original personal site are required.

Before publication, run the checks above and verify the homepage, both simulation modes, scenario links, asset loading, robots file, sitemap and a missing URL over HTTPS.

## Inspiration and sources

Inspired by [Nuño Sempere (@NunoSempere)](https://nunosempere.com/) and [Humans on AI #53, September 15, 2026](https://p3humansonai.substack.com/p/humans-on-ai-53-september-15th-2026). These credits do not imply endorsement of the model or its assumptions.

The international defaults cite the World Bank, BEA and Stanford AI Index 2026. The page also cites Acemoglu and Restrepo on automation and new tasks; the IMF on AI and fiscal policy; Guerreiro, Rebelo and Teles on robot taxation; the OECD on employment support; and Ian Stewart’s pirate voting puzzle. Source-specific explanations and links are on the page.

No software license has been selected for this repository.
