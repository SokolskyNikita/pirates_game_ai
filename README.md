# AI Pirate’s Game

[Live simulator](https://ai-pirates-game.com) · [Source repository](https://github.com/SokolskyNikita/pirates_game_ai)

An interactive automation-policy simulator at [ai-pirates-game.com](https://ai-pirates-game.com/), by [Nikita Sokolsky](https://sokolsky.me).

When AI makes a job obsolete, should the employer retain the worker, should the government provide income, and who should pay? This model compares separate majority votes on those decisions. It includes a US-only scenario and a scenario with international AI competition.

## Run locally

Use Node.js 22.12 or newer (Node 24 is specified in `.nvmrc`).

```sh
npm ci
npm run dev
```

Astro prints the local address. All simulation calculations run in a browser background worker, so changing a control can cancel an unfinished calculation. No account, database, API key or environment file is required.

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

Five separate majority ballots choose:

1. Allow layoffs or require employers to retain obsolete roles at 50%, 100% or 125% of prior wages.
2. Set the modeled benefit budget to 0%, 50%, 100%, 150% or 200% of its 2025 reference.
3. Preserve the current recipient mix, pay equally to every adult, or pay in proportion to pre-AI disposable household income.
4. Change the tax benchmark on work, pensions and other non-investment income.
5. Change the tax benchmark on investment income.

Tax choices include reductions, the current reference, increases and the 0%/100% endpoints. Each group's tax profile changes toward those endpoints; the page distinguishes the selected benchmark from the resulting average rate after incomes change. References are model allocations of Census-estimated federal/state income taxes and payroll contributions, including self-employment contributions. They are not statutory rates or all US taxes. Negative net tax amounts are represented as benefit payments without double counting.

The benefit reference includes cash benefits, valued food/housing/energy assistance and those net tax refunds. Medicare and Medicaid coverage is shown descriptively but is not converted into cash. The flat and prior-income formulas redesign the entire modeled benefit allocation. Keeping the same total budget does not keep every person's benefit unchanged. The current mix freezes observed recipient shares; it does not simulate each program's future eligibility rules.

Employer retention is paid from capital resources and creates no extra production. Taxes must fund the fixed reference commitment to other public spending. Policies that cannot fund it are excluded from majority selection. Promised retention or welfare above the remaining budget is shown as a shortfall; voters compare actual payments. Extra tax receipts become non-transfer public spending, not an unrequested dividend.

## Voting and international competition

A change passes only when **more than half** of the weighted population strictly prefers it. Voters compare ten years of their own expected household-income utility, discounted at 3%, with a logarithm and a small offset at zero income. Displacement risk is assumed equal across labor-income groups. The model computes expected utility across work/no-work states, not utility of average income.

The solver searches from several starting policies. A reported stable result is then checked against every single-decision US amendment. Stability does not mean everyone prefers the outcome or that it beats every joint package. Failure to find a verified result does not prove that no equilibrium exists.

In international mode the rest of the world is one actor choosing its own complete policy and deployment pace. Its objective is worker-household income, population-weighted income utility, or modeled output. Verification checks its full policy menu at the selected US policy. The foreign economy uses the US household structure as an explicit simplifying assumption; its GDP size, trade exposure and frontier capability differ.

International size and trade references use 2025 World Bank and BEA data. Investment and labor responses are measured relative to the current-tax baseline, so a no-AI/current-policy run reproduces reference incomes. High policy burdens can reduce adoption, labor effort and productive capacity. The 5% capacity-renewal rate and behavioral responses are assumptions, not estimated elasticities.

This is a finite policy model, not a calibrated general-equilibrium forecast. Its dollar amounts describe household resources, which include pension withdrawals and capital gains; its output index is not observed GDP. It does not solve prices, debt, firm investment decisions, repeated elections, or the value of individual public services.

The page includes expandable equations, accounting, comparisons and survey definitions. Calculations run in a cancellable background worker. Scenarios and results can be shared or downloaded. See the [earlier calculator audit](docs/calculator-audit.md) for the previous version's changes.

## Source layout

- `src/pages/index.astro`: interface, explanations and citations.
- `src/components/economy/pirates-game.ts`: browser controls, charts and results.
- `src/lib/economy/pirates-model.ts`: economic outcomes and resource accounting.
- `src/lib/economy/pirates-voting.ts`: individual preferences and majority voting.
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
