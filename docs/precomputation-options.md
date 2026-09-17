# Complete local precomputation

The static edition covers **all 768 valid selectable scenarios**. It does not calculate custom assumptions on a server. The user approved reducing control choices after measuring the original grid: 120,578,220 domestic scenarios and at least 2,140,263,771,557,788,800 international scenarios, excluding an unused population axis and arbitrary legacy URL values.

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
| Status quo unavailable | Off or on |

All other economic parameters remain at their disclosed references, including a 5-point foreign growth increment, 35% investment response and 50% capital mobility. The interface shows these as fixed assumptions. There are 48 valid economic input combinations × four mode/objective combinations × four checkbox combinations. Invalid job-count/affected-share pairs are never generated or offered.

Each scenario evaluates the unchanged full policy menu: 6,480 domestic packages or 12,960 international packages when pausing is available. The foreign actor's choice remains independent. Precomputation does not turn an incomplete bounded equilibrium search into a verified outcome; search diagnostics are preserved.

The selected package, current policy and up to eight leading candidates can be compared using saved trajectories and pairwise preference shares. Arbitrary manual policy construction is not available in the static edition. Full ballot tallies, cohort detail and numerical precision remain in the saved files. Duplicate profiles within a result share a reference, which the browser expands losslessly.

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

## Size and delivery

The unmodified results total about **1.084 GB JSON**, or **253.4 MB gzip**. Lossless profile sharing reduces the whole-library gzip measurement to about **212.8 MB**. The 768 individual gzip files total **212.4 MB**, averaging about **277 KB per scenario**. These measurements include full detailed results, not just headline policies.

The full library is therefore above the requested **3,500,000-byte** inline limit. Each page loads only its selected scenario, with a small bounded browser cache. The build measures the entire packed JSON library and embeds it if it falls below that threshold in a future smaller edition. Gzip decoding handles both hosts that deliver compressed bytes and hosts that apply HTTP decompression automatically.

Compressed files are committed for reproducible builds. The static asset paths identify the model and scenario, and a packaging-version query prevents stale browser data after encoding changes. Cloudflare only serves static assets and canonical redirects. No Python Worker or calculation endpoint is deployed.

Old links are snapped to supported choices with a visible notice. The resulting controls and updated URL show the actual saved assumptions; there is no interpolation between outcomes.
