# Precomputation coverage and limits

The deployed build generates **thirty-two exact common scenarios**, not the full assumption grid. Default assumptions and the all-obsolete/no-return scenario (50% employer gain) each have sixteen results: US only or any of the three international objectives, with both pause-availability settings and both voting rules. The US-only menu has 6,480 packages when pausing is allowed, or 4,320 when it is unavailable. International mode adds both trade choices, giving each side 12,960 or 8,640 packages. Selecting “Retaining status quo isn’t an option” excludes the exact current-policy package from the US ballot, leaving one fewer option. It does not restrict the foreign menu. In every case, packages must be fully funded to receive votes.

The Python generator records the model/data/dependency fingerprint, normalized assumption key, votes, selected outcome, references, top eight packages and search diagnostics. It refuses mismatched keys, unfunded winners or an excluded current-policy winner. The Python API accepts only an exact matching result from the deployed assets. Other assumptions use the same Python solver on demand. The browser receives ordinary JSON arrays and renders the result. Build failure prevents publishing a partially generated library.

## Why five-point steps do not make the full grid small

The unrestricted US-only ballot has 3 AI paces × 4 retained wages × 5 benefit budgets × 3 benefit formulas × 6 work/pension tax benchmarks × 6 capital tax benchmarks = **6,480 packages**. International mode doubles this with the trade choice. Most policy axes are already coarser than five percentage points.

Making every policy percentage a five-point increment would create 26 retained-wage values (0–125%), 41 benefit-budget values (0–200%), 3 formulas, and 21 values for each tax. That is **4,230,954 packages** with the three AI paces, before adding the international trade choice or exact current-tax reference exceptions.

Domestic assumptions alone have 5 growth values (0–20%) × 21 employer gains × 21 obsolescence rates × 21 return-to-work rates × 21 policy-response strengths = **972,405 combinations**. International assumptions add foreign growth, mobile rents, frontier capability, two trade exposures and GDP size. Even with GDP size in 0.25 increments, the Cartesian grid has **30,258,287,488,800 combinations**, before the three foreign objectives, the two checkbox settings, population size, tradable share and trade elasticity. This is a lower-bound illustration, not the full current grid. Calibrated reference values and exact legacy URL values are additional exceptions.

The initial **TypeScript scalar implementation** measured approximately 27 microseconds per domestic policy and 54 microseconds per paired policy on the development machine, before voting/search overhead. At that historical rate the five-point domestic policy grid alone would take roughly **3.54 CPU-years** across all domestic assumptions. These estimates describe the old implementation, not the Python runtime or a lower bound for redesigned algorithms.

The Python engine evaluates menus in NumPy batches and checks candidates near utility maxima and funding thresholds with its scalar model. Before the trade extension, a native Python benchmark of one international, pause-unavailable, all-obsolete scenario took about **1.5 seconds** with approximately **58 MiB peak process memory**. This is a development-machine measurement, not a Cloudflare Workers latency or memory guarantee. The coarser policy menu, cached international responses and thirty-two common scenarios reduce routine work; they do not make the entire assumption grid precomputed.

## A completely precomputed alternative

A fully precomputed interface would need an explicit smaller assumption grid. For example:

| Assumption | Supported choices |
| --- | --- |
| US growth | 0%, 5%, 10% |
| Obsolete roles | 35%, 100% |
| Return to work | 0%, 20% |
| Economy | US only; international workers, prosperity, output |

This gives **48 results**, with other assumptions fixed and disclosed, including both checkboxes unchecked. Every combination of those controls could then load existing data. This restriction has not been applied: the current interface retains independent controls and calculates custom cases.

Any future complete library must declare its supported axes, policy menu, fixed inputs and expected keys; fail a build if a result is missing; and disclose unsupported legacy links rather than silently substituting unrelated scenarios. A partial cache must never be described as exhaustive precomputation.
