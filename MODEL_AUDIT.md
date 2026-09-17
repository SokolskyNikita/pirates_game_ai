# Model audit — September 17, 2026

Model fingerprint: `7692e9ad889dbac6958a`. All 384 supported scenarios were recalculated locally. Compressed scenario library: 171,361 bytes.

## What changed

- Policy compromises are ranked using conservative support estimates and verified with strict individual utility comparisons. Policy names and menu order do not determine priority. A policy-terms hash breaks ties.
- Voters may withdraw compromise support by abstaining to restore a preferred status quo. Abstention does not lower the strict-majority threshold.
- Each income cohort has 100 known career paths through layoffs, search, hiring and retention. Annual employment-state shares are within one percentage point of the continuous model; fiscal accounts integrate the continuous stocks. Multiple household earners are not modeled separately.
- Ordinary investment tax rates stay fixed. The additional AI-profits tax is 0–100% in ten-point steps. Noncapital taxes retain their benchmark menu.
- AI profits are the positive increase over a matched no-AI economy, net of ordinary capital tax, wages, retention, installation, operating and adjustment costs. Both sides pause in the reference; noncapital taxes and trade permissions remain fixed.
- Private adoption responds to the remaining after-tax AI return; 100% additional tax stops private domestic adoption. Other capital is not directly penalized. Ongoing AI resource costs are assumed to equal 2% of AI-exposed output each year.
- The all-revenue benefit option distributes receipts remaining after reference public services, using the selected benefit formula without the fixed-budget ceiling.
- International consistency requires a funded US result, a funded foreign choice with no profitable best-response deviation, and US stability under the stated protocol. Multiple verified pairs use greatest US ballot support, with disclosed tie-breaking.

## Validation

Scalar and batched regression ballots agree. Tests cover conserved resources and population weights, annual funding, tax endpoints, career exits, full job elimination, a paused US exposed to foreign competition, proposal renaming, and exhaustive strictly beneficial vote/abstention deviations in small games. The baseline Census calibration remains unchanged.

## Sensitivity checks

| Assumption | US choice | Classification | Support |
|---|---|---|---|
| default | Pause AI · Allow layoffs · benefits all revenue after services · flat · noncapital 21.8% / additional AI-profit 10% tax | selected-by-rule | 88.76% |
| 50-career-resolution | Accelerate AI · Allow layoffs · benefits all revenue after services · flat · noncapital 21.8% / additional AI-profit 90% tax | selected-by-rule | 64.73% |
| 200-career-resolution | Pause AI · Allow layoffs · benefits all revenue after services · flat · noncapital 21.8% / additional AI-profit 10% tax | selected-by-rule | 88.76% |
| linear-income | Accelerate AI · Allow layoffs · benefits all revenue after services · flat · noncapital 10% / additional AI-profit 90% tax | selected-by-rule | 68.16% |
| zero-discount | Accelerate AI · Allow layoffs · benefits all revenue after services · flat · noncapital 60% / additional AI-profit 90% tax | selected-by-rule | 63.20% |
| ten-percent-discount | Pause AI · Allow layoffs · benefits all revenue after services · flat · noncapital 21.8% / additional AI-profit 10% tax | selected-by-rule | 94.87% |
| twenty-year-horizon | Accelerate AI · Allow layoffs · benefits all revenue after services · flat · noncapital 10% / additional AI-profit 80% tax | selected-by-rule | 70.16% |
| international-workers | Pause AI · Allow layoffs · benefits all revenue after services · flat · noncapital 21.8% / additional AI-profit 10% tax | selected-by-rule | 63.40% |
| international-prosperity | Pause AI · Allow layoffs · benefits all revenue after services · flat · noncapital 20% / additional AI-profit 30% tax · Ban US–world trade | selected-by-rule | 89.27% |
| international-output | Pause AI · Allow layoffs · benefits all revenue after services · flat · noncapital 20% / additional AI-profit 30% tax · Ban US–world trade | selected-by-rule | 89.27% |

## Limits of the result

Perfect knowledge and selfishness do not select a unique bargaining protocol. Stability is conditional on the declared strict-improvement protocol. Cycles or a bounded search can return a clearly labeled rule-selected outcome; this is not presented as an equilibrium. The international search tests six starts (four without Pause), not every possible equilibrium.

Ten years, logarithmic real household income and 3% annual discounting are the published preference assumptions. The audit also tests alternative preferences and career resolutions. Income groups, firm responses and two-region trade remain approximations; the model does not forecast individual occupations, new labor-force entry, debt or every welfare program.

Library classifications: domestic-ballot: 40, selected-by-rule: 238, verified-consistent: 106.
