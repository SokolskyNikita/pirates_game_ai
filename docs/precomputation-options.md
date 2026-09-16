# Precomputation coverage and limits

The deployed build generates **eight exact common scenarios**, not the full assumption grid. Default assumptions and the all-obsolete/no-return scenario (50% employer gain) each have four results: US only, or international competition with workers' incomes, prosperity or output as the foreign objective. Every result uses the full 6,480-package ballot.

The generator records the source/data fingerprint, normalized assumption key, votes, selected outcome, references, top eight packages and search diagnostics. It refuses mismatched keys or unfunded winners. The browser accepts only an exact matching result and restores typed utility arrays. Other assumptions run the same solver in a cancellable background worker. Build failure prevents publishing a partially generated library.

## Why five-point steps do not make the full grid small

The current ballot has 3 AI paces × 4 retained wages × 5 benefit budgets × 3 benefit formulas × 6 work/pension tax benchmarks × 6 capital tax benchmarks = **6,480 packages**. Most policy axes are already coarser than five percentage points.

Making every policy percentage a five-point increment would create 26 retained-wage values (0–125%), 41 benefit-budget values (0–200%), 3 formulas, and 21 values for each tax. That is **4,230,954 packages** with the three AI paces, before adding exact current-tax reference exceptions.

Domestic assumptions alone have 5 growth values (0–20%) × 21 employer gains × 21 obsolescence rates × 21 return-to-work rates × 21 policy-response strengths = **972,405 combinations**. International assumptions add foreign growth, mobile rents, frontier capability, two trade exposures and GDP size. Even with GDP size in 0.25 increments, the Cartesian grid has **30,258,287,488,800 combinations**, before the three foreign objectives. Calibrated reference values and exact legacy URL values are additional exceptions.

The initial scalar model benchmark measured approximately 27 microseconds per domestic policy and 54 microseconds per paired policy on the development machine, before voting/search overhead. At that rate the five-point domestic policy grid alone would take roughly **3.54 CPU-years** across all domestic assumptions. These are brute-force estimates, not lower bounds for redesigned algorithms. The current coarser policy menu and cached international response search are much faster; the eight common cases take seconds to generate.

## A completely precomputed alternative

A fully precomputed interface would need an explicit smaller assumption grid. For example:

| Assumption | Supported choices |
| --- | --- |
| US growth | 0%, 5%, 10% |
| Obsolete roles | 35%, 100% |
| Return to work | 0%, 20% |
| Economy | US only; international workers, prosperity, output |

This gives **48 results**, with other assumptions fixed and disclosed. Every combination of those controls could then load existing data. This restriction has not been applied: the current interface retains independent controls and calculates custom cases.

Any future complete library must declare its supported axes, policy menu, fixed inputs and expected keys; fail a build if a result is missing; and disclose unsupported legacy links rather than silently substituting unrelated scenarios. A partial cache must never be described as exhaustive precomputation.
