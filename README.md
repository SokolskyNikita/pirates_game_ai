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

Astro prints the local address. All simulation calculations run in the browser. No account, database, API key or environment file is required.

## Validate and build

```sh
npm run check
npm test
npm run build
npm run preview
```

The static output is in `dist/`. The build generates a sitemap for the production domain; `public/robots.txt` identifies it. A custom `404.html` is included. Dependencies are pinned and recorded in `package-lock.json`.

## What the model assumes

- There are 1,000 equal-weight voters and a change requires 501 votes. The ratio of worker to owner households can be changed in one-voter increments, with both groups present.
- Voters are rational and self-interested. They compare their own expected income over ten years using logarithmic utility, a 3% annual discount rate and known exposure order. Rationality alone does not imply this utility function.
- Separate ballots choose layoffs or employer retention at 50%, 100% or 125% of the starting wage; a government income floor at 0%, 50% or 100%; and worker and owner household taxes at 0%, 50% or 100%.
- Retaining an obsolete role creates no extra output. Employer payments reduce capital income. Government receipts fund income top-ups first, with the remainder returned as an equal dividend to every voter.
- Taxes and retention obligations can reduce investment. Worker taxes can reduce productive labor effort. The strength of those responses is an explicit scenario input.
- At a fixed deployment pace the solver enumerates all 108 policies, or all 11,664 international policy pairs. A stable result cannot be defeated by 501 votes on one decision with the others fixed. That is narrower than defeating every possible policy package; the page reports this distinction and any fallback agenda.
- This is an illustrative model, not a calibrated forecast of the US economy. It does not solve a full general-equilibrium economy, firm optimization, repeated elections or AI safety outcomes.

The page includes equations, budget accounting, voting diagnostics, manual policy comparisons and downloadable results. Scenario assumptions are stored in the URL for sharing.

## Source layout

- `src/pages/index.astro`: interface, explanations and citations.
- `src/components/economy/pirates-game.ts`: browser controls, charts and results.
- `src/lib/economy/pirates-model.ts`: economic outcomes and resource accounting.
- `src/lib/economy/pirates-voting.ts`: individual preferences and majority voting.
- `src/lib/economy/*.test.ts`: economic and voting checks.
- `src/styles/pirates-game.css`: responsive page styles.

This repository is independent of the original personal website. It contains no personal-site APIs or analytics integration. Fonts are requested from Google Fonts, with local fallback fonts.

## Publication

The site is hosted on Cloudflare Workers Static Assets. `wrangler.jsonc` is the deployment configuration. Run `npm run deploy` with an authenticated Wrangler session to check, test, build and publish it. The GitHub Actions workflow validates pushes and pull requests; it has read-only repository access and does not store Cloudflare credentials.

Publish the generated `dist/` directory as a static site. The canonical URL is set in `astro.config.mjs` and the homepage metadata. Hosting and deployment configuration belong to this repository; no files from the original personal site are required.

Before publication, run the checks above and verify the homepage, both simulation modes, scenario links, asset loading, robots file, sitemap and a missing URL over HTTPS.

## Inspiration and sources

Inspired by [Nuño Sempere (@NunoSempere)](https://nunosempere.com/) and [Humans on AI #53, September 15, 2026](https://p3humansonai.substack.com/p/humans-on-ai-53-september-15th-2026). These credits do not imply endorsement of the model or its assumptions.

The page also cites Acemoglu and Restrepo on automation and new tasks; the IMF on AI and fiscal policy; Guerreiro, Rebelo and Teles on robot taxation; the OECD on employment support; and Ian Stewart’s pirate voting puzzle. Source-specific explanations and links are on the page.

No software license has been selected for this repository.
