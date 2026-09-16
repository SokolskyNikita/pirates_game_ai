# Calculator audit

September 16, 2026. Scope: interface, accessibility, calculation procedure and international assumptions. The requested format is a concise calculator with technical details available on demand.

## Findings and remedies

| Severity | Original finding | Remedy |
| --- | --- | --- |
| P1 | International calculations ran synchronously on the main thread. The original default calculation took about 694 ms in a local Node benchmark and left roughly 449 MB of heap allocated; this was not a browser measurement. | Calculation now runs in a background worker. Changing assumptions cancels the previous request. A status message sits outside the busy result region. A full revised strategic solve took about 1.5 seconds in Node, retaining roughly 128 MB after garbage collection; the larger search now checks four foreign deployment choices. |
| P1 | Small muted text on the selected world option had 4.35:1 contrast; gold endpoint text had 4.12:1 against the page. Both were below the 4.5:1 text threshold. | The revised combinations measure 4.88:1 and 5.11:1. Muted text on the page measures 5.34:1. |
| P1 | International mode treated both economies as copies with their own electorates. It could not represent a foreign actor pursuing a chosen objective. | The US keeps 1,000 self-interested voters and a 501-vote threshold. One rest-of-world actor maximizes workers’ incomes, overall prosperity or economic output and chooses its own complete policy, including deployment. |
| P1 | Foreign economic size and population were one parameter. Trade exposure was symmetric, and the original capital contribution survived even severe policy burdens. | GDP and population are separate. Bilateral import exposure differs by economy. Policy burdens affect existing capital capacity as well as new AI investment, under an explicit renewal assumption. |
| P2 | A prominent 1,000-dot whole-package comparison could be mistaken for the separate ballots that selected the policy. | Removed the dot grid and baseline tally. The primary result states its stability; separate ballot comparisons are available in details. |
| P2 | Expanded tables repeated unchanged taxes and policy choices, delaying the income result. | Employer and government tables now have three columns. Comparisons, accounting and voting mechanics are expandable. The income chart follows the selected policy and actual payments. |
| P2 | The manual sliders exposed ordinal positions instead of their salary or tax percentages. Switching result views also replaced focused buttons. | Manual choices use native selects. The comparison appears inline and leaves the primary result in place. The result-view switch was removed. |
| P2 | Dense mobile controls and small targets made the calculator harder to use. Scrollable tables had no explicit keyboard access. | Secondary assumptions and examples are expandable. Controls have 44 px minimum targets; scroll regions have names and keyboard focus. |
| P2 | A failed calculation could leave old results looking current. | Calculation state is separate from results, with cancellation and failure reporting. The error branch labels retained results as stale and disables comparisons and exports; this branch was reviewed in code, without an injected browser failure. |

P1 means a major correctness, accessibility or interaction problem to address before release. P2 means avoidable confusion or difficulty with a workaround. No final numerical score is assigned: code checks and contrast calculations do not establish complete accessibility or browser performance.

## Calculation checks

The international search compares 108 US policies at the selected US deployment target with 432 foreign policies, including the foreign actor’s four deployment choices: 46,656 pairs. A stable pair has no US change to a single decision that attracts 501 votes and no foreign policy that improves the chosen foreign objective. A package changing several US decisions can still win a majority. If no pair meets the stability condition, the result is explicitly a fallback rather than an equilibrium.

The defaults use World Bank GDP and BEA bilateral trade figures; population is listed separately for context. Its unused slider was removed. The rest of the world has approximately 2.846 times US GDP and 23.037 times its population. Import exposure is approximately 14.18% of US GDP and 3.92% of foreign GDP. Source links and the distinction between observed data and assumed economic responses are included on the page.

## Verification status

- Automated suite: **65 tests pass across three files**.
- Astro check after the markup changes: **zero errors, warnings or hints**.
- Required result and input IDs are present without duplicates; removed controls are absent.
- Corrected text contrast was calculated from the actual foreground and background colors.
- Browser QA passed for US-only mode, all three foreign objectives, a US pause with foreign deployment, manual salary comparisons, scenario URL persistence, reset and cancellation during rapid input changes. No runtime errors were recorded.
- Desktop and 390 px viewport layouts were inspected. The mobile page has no horizontal overflow. Chart labels redraw at the available width; a keyboard-focusable table provides the same values. Arrow-key adjustment changes the electorate by one voter.
- Error handling was reviewed in code; no browser failure was artificially injected. This is not a WCAG conformance certification or a Core Web Vitals measurement.

## Limits

This is a finite policy model, not a full general-equilibrium model or a forecast. Stability applies to the listed choices and voting procedure. Both economies share behavioral assumptions; the data calibrate their size and trade exposure, not their response to taxes. AI gains, displacement, return to work and policy responses remain assumptions rather than estimated elasticities. The 5% annual capital renewal requirement is also a modeling choice. Population and income aggregates do not identify the preferences of actual professions or countries.
