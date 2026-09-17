# Python model refactor and audit — September 16, 2026

The calculator now shares its annual economic loop and fiscal equations between the scalar reference and the NumPy policy evaluator. This removes two places where future changes could otherwise produce different policy rankings. Astro and browser code still only request and display results.

## Calculation boundaries

1. `config.py`, `policies.py` and `population.py` normalize assumptions, construct policy packages and prepare citizen weights. `explanations.py` contains the interface's model notes.
2. `trajectory.py` advances both economies through ten years. `production.py`, `labor_market.py` and `trade.py` calculate production, worker transitions, wage competition and bilateral prices. The second trade-adjustment production pass starts from the same previous-year state; it does not compound growth or dismiss workers twice.
3. `finance.py` contains employer budgets, public budgets, taxes, household disposable income and utility equations. `settlement.py` aggregates the scalar cohorts and creates reporting records; `batch_settlement.py` adapts those equations to policy-by-cohort arrays.
4. `model.py` discounts annual preferences and exposes complete or lightweight profiles. `batch.py` reuses identical production paths, evaluates distinct fiscal packages in chunks and rechecks close funding and preference comparisons with the scalar reference.
5. `ballot.py` counts citizens' favorite eligible packages. `election.py` applies the majority or plurality rule and checks independent foreign best responses. `simulation.py` and `comparison.py` assemble display results.

Named settlement records replace positional multi-value returns. Shared arithmetic supports ordinary floats and NumPy arrays without a second set of economic equations.

## Corrections

- Foreign consistency checks formerly accepted a positive improvement smaller than a numerical tolerance. Manual pairwise comparisons also ignored such improvements, although the US ballot used strict preferences. Both now honor every strictly better scalar result. Exact indifference remains valid: a foreign actor need not leave an equally good policy. Deterministic tie-breaking selects a response when the search needs one; it does not disqualify other equally good responses.
- Cohort tax bases are now checked for finite, nonnegative values before calibration. A missing aggregate non-capital tax base produces an explicit validation error rather than division by zero. These checks do not alter the supplied Census calibration.
- Direct policy checks reject boolean and nonnumeric rates. Policy batch sizes must be positive integers.

Funding tolerances remain limited to dollar-level floating-point roundoff. They do not allow borrowing across years. Investment losses remain in household resources; they do not become negative capital taxes. Public services and benefits draw from the same receipts, and surplus receipts are not silently converted into a dividend.

## Verification

Before editing, forty complete domestic and international trajectories were captured across fixed and randomized assumptions. The refactored economic calculations reproduced every stored value exactly. Regression tests separately cover analytical employer and public budgets, signed investment losses, zero tax bases, strict foreign preferences, population validation and batch validation.

The 133 Python tests and 26 UI tests pass. A further 200 randomized complete profiles passed finite-value, workforce-conservation, job-capacity and resource-accounting checks; the largest absolute accounting residual was less than $0.000000001 per adult.

The full suite also checks scalar/batch ballot agreement, resource conservation, job-market transitions, funding in every year, trade symmetry and prices, majority versus plurality, excluded status quo, independent foreign policies, exact ties and incomplete searches. Native Python and the deployed Python runtime are checked against the same API scenarios before release.

## What the result means

- This is one **sincere favorite-package ballot**. Perfect information and self-interest do not by themselves imply sincere voting in a strategic plurality election. Tactical voting, coalitions and agenda setting are outside this model.
- Every package in the declared finite menu is evaluated for a domestic ballot. The menu is not every possible continuous policy. International search tries bounded best-response paths; a verified pair passes the complete menus, but an incomplete search does not prove that no equilibrium exists. Multiple consistent pairs need not have a unique prediction.
- Only fully funded packages can receive votes. The separate, user-requested majority fallback can retain current policy even when it becomes underfunded; the result reports its funding gap. Removing that fallback instead requires an eligible plurality winner.
- Citizen weights come from the survey calibration. Labor outcomes and wage contracts are aggregated; they are not individual employment histories. The workforce is fixed, search behavior and economic responses are assumptions, and foreign households reuse the US cohort structure. Results are conditional simulations rather than forecasts.

These limits are part of the model's interpretation, not guarantees supplied by the refactor. Automated checks reduce implementation risk; they do not establish that the economic assumptions describe every real-world response.
