# Complete local precomputation

The static edition covers **all 384 valid selectable scenarios**. It does not calculate custom assumptions on a server. The user approved reducing control choices after measuring the original grid: 120,578,220 domestic scenarios and at least 2,140,263,771,557,788,800 international scenarios, excluding an unused population axis and arbitrary legacy URL values.

## Supported assumptions

| Control | Choices |
| --- | --- |
| Extra annual US growth from AI | 0 or 5 percentage points |
| Employer gain from AI | 0% or 40% |
| Net change in productive jobs | −100%, −90%, 0%, +100% |
| Current roles eventually affected | 0% or 100%, constrained to cover job losses |
| Laid-off workers entering search | 0% or 85% |
| Mode | Domestic; international workers, prosperity or output objective |
| Pause unavailable | Off or on |

All other economic parameters remain at their disclosed references, including a 5-point foreign growth increment, 35% investment response and 50% capital mobility. The interface shows these as fixed assumptions. There are 48 valid economic input combinations × four mode/objective combinations × two pause settings. Invalid job-count/affected-share pairs are never generated or offered.

Each scenario evaluates the full valid policy menu: 4,860 domestic packages or 9,720 international packages when pausing is available. The foreign actor's choice remains independent. Every supported scenario returns a selected outcome. Stable coalitions and mutually consistent international choices are preferred; fixed selection rules resolve cycling or limited searches. The method is disclosed rather than claiming all selected outcomes are unique equilibria.

The page retains the enacted US and foreign policy decisions, the US income chart and its accessible table, year-ten summaries, the leading package’s vote share, funding warnings and search limitations. Alternative comparisons, detailed labor and trade tables, and the accounting table are removed. Full-precision calculation records remain local.

## Local calculation and regeneration

```sh
npm run precompute:plan       # Size of the original unrestricted UI grid
npm run precompute:local      # All supported scenarios; up to 12 processes
npm run precompute:import     # Validate and package completed results
npm run build                # Revalidate the committed library, then build Astro
```

Use `npm run precompute:local -- --workers 8` to leave more CPU capacity available. Each Python process evaluates separate scenarios; NumPy/BLAS thread pools are capped to avoid nested oversubscription. The default leaves two logical cores free, up to twelve workers.

Results checkpoint atomically in `.precompute/<model-fingerprint>/`. Interrupted runs reuse matching, validated checkpoints. An explicit `--requests path.json` can calculate another finite manifest, but only the exact grid in `scripts/static_grid.py` can be packaged for this interface. A model/data/dependency change invalidates previous results. Missing or stale files fail the production build rather than enabling a calculation fallback.

On the user's 14-core, 48-GB M4 Pro, generating the 768-case manifest with 12 processes took **401.8 seconds** (6 minutes 42 seconds), including compression. Sixteen previously calculated common cases were reused. The 752 new cases all ran locally.

The pause-retention restriction recalculation of all 768 scenarios on September 17 took **357.7 seconds** using 12 processes, with no reused checkpoints. All 768 return an outcome: 486 satisfy the stated coalition-stability checks (374 international and 112 domestic), and 282 use the declared cycle-resolution rule. Every ballot winner and every selected foreign package passes the funding checks.

## Size and delivery

The complete presentation library is **176,107 bytes gzip** for all 384 scenarios, below the enforced **3,500,000-byte** limit. The earlier 212.8 MB export included alternative trajectories, cohort arrays and ballot tallies that the compact interface no longer needs.

`src/generated/results.json.gz` is the committed, reproducible source. The build validates coverage and the model fingerprint, then embeds every result in the page. Controls perform local lookups, without scenario downloads or a calculation backend. The old per-scenario public assets are removed.

Only displayed values are exported: eleven US chart points, the foreign endpoint, policy choices and outcome diagnostics. Reporting metrics are rounded to four decimal places after solving; policy rates, ballot support and worker membership fractions retain full precision. No rounding affects winners, funding eligibility, search verification or chart group presence.

Full local records still contain all economic detail for research and debugging. The page download contains only the compact displayed result. To regenerate from a fresh output directory:

```sh
npm run precompute:local -- --workers 12 --output .precompute-refresh
npm run precompute:import -- --source .precompute-refresh
npm run build
```

Cloudflare serves the static page and canonical redirects. No Python Worker or calculation endpoint is deployed. Scenario URL parameters are ignored and the browser address is not rewritten. No interpolation is performed.

Pause AI packages fix employer retention to None (0%). This restriction applies independently to both countries, including when open trade permits foreign competition. Other AI paces retain all wage-retention options.

The public status-quo-exclusion control was removed on September 17. The 384 majority-rule results were repackaged from the validated calculation records above; no economic recalculation was needed. Scenario-link support has also been removed; a new page load starts with defaults.
