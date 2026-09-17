# Model audit — September 17, 2026

Model fingerprint: `df1853e95041822a625a`. All 384 supported scenarios were recalculated locally. Compressed scenario library: 194,971 bytes.

## What changed

- Policy compromises are ranked using conservative support estimates and verified with strict individual utility comparisons. Policy names and menu order do not determine priority. A policy-terms hash breaks ties.
- Voters may withdraw compromise support by abstaining to restore a preferred status quo. Abstention does not lower the strict-majority threshold.
- Each income cohort has 100 known career paths through layoffs, search, hiring and retention. Annual employment-state shares are within one percentage point of the continuous model; fiscal accounts integrate the continuous stocks. Multiple household earners are not modeled separately.
- Taxes use 10-percentage-point alternatives plus a separate current-reference option. Employer wages, benefits and their allocation remain distinct policy terms.
- International consistency requires a funded US result, a funded foreign choice with no profitable best-response deviation, and US stability under the stated protocol. Multiple verified pairs use greatest US ballot support, with disclosed tie-breaking.

## Validation

Scalar and batched regression ballots agree. Tests cover conserved resources and population weights, annual funding, tax endpoints, career exits, full job elimination, a paused US exposed to foreign competition, proposal renaming, and exhaustive strictly beneficial vote/abstention deviations in small games. The baseline Census calibration remains unchanged.

## Sensitivity checks

| Assumption | US choice | Classification | Support |
|---|---|---|---|
| default | Pause AI · Allow layoffs · benefits 100% · flat · noncapital 21.8% / investment 17.7% tax | domestic-ballot | 63.65% |
| 50-career-resolution | Pause AI · Allow layoffs · benefits 100% · flat · noncapital 21.8% / investment 17.7% tax | domestic-ballot | 63.65% |
| 200-career-resolution | Pause AI · Allow layoffs · benefits 100% · flat · noncapital 21.8% / investment 17.7% tax | domestic-ballot | 63.65% |
| linear-income | Pause AI · Allow layoffs · benefits 100% · flat · noncapital 21.8% / investment 17.7% tax | domestic-ballot | 74.65% |
| zero-discount | Pause AI · Allow layoffs · benefits 100% · flat · noncapital 21.8% / investment 17.7% tax | domestic-ballot | 74.79% |
| ten-percent-discount | Pause AI · Allow layoffs · benefits 100% · flat · noncapital 21.8% / investment 17.7% tax | selected-by-rule | 53.05% |
| twenty-year-horizon | Allow current AI pace · Retain at 125% · benefits 150% · flat · noncapital 30% / investment 0% tax | selected-by-rule | 63.48% |
| international-workers | Pause AI · Allow layoffs · benefits 100% · flat · noncapital 21.8% / investment 17.7% tax | verified-consistent | 79.58% |
| international-prosperity | Pause AI · Allow layoffs · benefits 100% · flat · noncapital 21.8% / investment 17.7% tax | verified-consistent | 79.58% |
| international-output | Pause AI · Allow layoffs · benefits 150% · flat · noncapital 30% / investment 0% tax · Ban US–world trade | selected-by-rule | 75.46% |

## Limits of the result

Perfect knowledge and selfishness do not select a unique bargaining protocol. Stability is conditional on the declared strict-improvement protocol. Cycles or a bounded search can return a clearly labeled rule-selected outcome; this is not presented as an equilibrium. The international search tests six starts (four without Pause), not every possible equilibrium.

Ten years, logarithmic real household income and 3% annual discounting are the published preference assumptions. The audit also tests alternative preferences and career resolutions. Income groups, firm responses and two-region trade remain approximations; the model does not forecast individual occupations, new labor-force entry, debt or every welfare program.

Library classifications: domestic-ballot: 69, selected-by-rule: 119, verified-consistent: 196.
