# US electorate and income data

The simulator uses the **2026 Current Population Survey Annual Social and Economic Supplement (CPS ASEC)**, released in September 2026. Annual income and benefit amounts refer to **2025**. Employment status refers to the survey period in March 2026. The source was downloaded on September 16, 2026.

The committed file contains 99 weighted cohorts derived from 94,612 adult citizen records. Their survey weights represent about **243.87 million adult US citizens**. These are estimates for the population covered by the survey, not a count of registered voters or a turnout prediction.

## Reproduce the data

From the repository root, using the project’s Python 3.13+ environment and pinned uv launcher:

```sh
node scripts/python-tool.mjs python scripts/build-us-electorate.py
```

The script downloads the official archive and record layout to `/tmp/ai-pirates-cps-2026`, then writes `calculator/data/us-electorate-data.json`. The aggregation script uses only the Python standard library; the calculator reads this JSON directly. Run `npm run build` after regenerating it to refresh the browser’s descriptive metadata and precomputed scenarios. To use an existing download:

```sh
node scripts/python-tool.mjs python scripts/build-us-electorate.py --cache-dir /path/to/cache --offline
```

The generated metadata records the source URLs and SHA-256 hashes. Raw survey records, household identifiers and person identifiers are not committed. The archive contains a fixed-width person, family and household file; the script reads person records (`PRECORD=3`) using the official field offsets in `persfmt.txt`.

Sources:

- [2026 CPS ASEC data and documentation](https://www.census.gov/data/datasets/2026/demo/cps/cps-asec-2026.html)
- [Public-use archive](https://www2.census.gov/programs-surveys/cps/datasets/2026/march/asec2026_pubuse.zip)
- [Person record layout](https://www2.census.gov/programs-surveys/cps/datasets/2026/march/persfmt.txt)
- [Data dictionary](https://www2.census.gov/programs-surveys/cps/datasets/2026/march/asec2026_ddl_pub_full.pdf)
- [Census tax-model explanation](https://www.census.gov/topics/income-poverty/income/guidance/tax-model.html)
- [CPS population coverage](https://www.census.gov/topics/income-poverty/guidance/group-quarters.html)

## Who votes

Select `A_AGE >= 18`, `PRCITSHP` in 1–4, and positive `MARSUPWT`. The citizenship codes include US-born citizens, citizens born in US territories, citizens born abroad to US parents and naturalized citizens. `MARSUPWT` has two implied decimal places; divide it by 100 for population counts. Normalize the selected weights to one for majority comparisons.

Each adult citizen has equal voting weight in the represented population. Survey weights correct sampling; they do not give an affluent respondent additional political influence. No adjustment is made for turnout, registration or partisan affiliation. The data do not identify every legal voting disqualification. They omit institutional populations and most military barracks; some Armed Forces members living in covered households are included. Citizens abroad are outside this sample.

Employment groups use `PEMLR`: 1–2 employed, 3–4 unemployed, 5 retired, 6–7 otherwise outside the labor force. Covered active Armed Forces members (`PRPERTYP=3`) are included with employed adults, since the civilian labor-force question does not apply to them. The unemployed share is a percentage of all represented adult citizens, **not** the official unemployment rate, whose denominator is the civilian labor force.

## Household resources and cohorts

Members are linked by `PH_SEQ`. All household members' income and tax amounts are pooled and divided by the number of household members age 18 or older, including noncitizen adults. Each citizen adult's survey weight is then attached to that per-adult amount. Children do not vote; their income and benefit resources remain in the household total. This is an assumption about shared consumption, not an official Census equivalence scale. It prevents a homemaker or student with no personal earnings from being treated as having no access to household income.

The 99 cohorts are the nonempty combinations of:

1. Household's largest income source: work, public benefits, pensions, capital, or other.
2. Weighted quintile of household resources per adult, before personal taxes.
3. The citizen's own employment status.

Quintile boundaries are $24,800, $40,477, $60,172.50 and $94,010.50 per adult per year. Equal resource amounts are assigned to the same band, so weights are close to, rather than exactly, 20% each. Each cohort stores its survey-weighted mean income components. Compression preserves weighted totals, but preferences within a cohort can differ from the preference of its mean-income representative. This is a finite approximation to the microdata, not a ballot from every survey respondent.

`priorIncome` retains the household labor-income component per adult. **It is not the redistribution formula's income reference.** For redistribution proportional to previous living standards, the model uses pre-AI disposable household resources (`disposableIncome`). `ownLaborIncome` is retained separately for description; it must not be added to already pooled labor income.

## Income and benefit definitions

| Stored component | Official fields and treatment |
| --- | --- |
| Labor income | `PEARNVAL`, the edited total of wage/salary and farm/nonfarm self-employment earnings. Self-employment is treated as labor because CPS does not split its labor and capital returns. |
| Capital income | Non-retirement interest `TRDINT_VAL`, dividends `DIV_VAL`, net rent `RNT_VAL`, plus `CAP_VAL` capital gains. |
| Pension income | `PNSN_VAL`, nonnegative `ANN_VAL`, `DBTN_VAL` retirement distributions, and retirement-account interest `RINT_VAL1` + `RINT_VAL2`. Includes public employee pensions. |
| Public cash benefits | Social Security `SS_VAL` (including its disability benefits), SSI `SSI_VAL`, unemployment compensation `UC_VAL`, cash public assistance `PAW_VAL`, veterans' benefits `VET_VAL`, and separately identified public black-lung/state temporary-sickness disability or survivor benefits. |
| Other income | Residual of official total money income `PTOTVAL` after the preceding components, excluding added capital gains. Includes private transfers and other insurance/survivor income. |
| Noncash benefits | SPM values for SNAP `SPM_SNAPSUB`, WIC `SPM_WICVAL`, school meals `SPM_SCHLUNCH`, housing subsidies `SPM_CAPHOUSESUB`, and energy assistance `SPM_ENGVAL`. Count each `SPM_ID` once within its household, since every member repeats the unit's amounts. |
| Taxes | Federal income tax after credits `FEDTAX_AC` + state income tax after credits `STATETAX_A` + payroll deductions `FICA`. Sum across household members before dividing by adults; joint tax liabilities are attached to a tax-unit filer. |

Tax liabilities are **Census model estimates**, not directly reported tax bills. The edited `CAP_VAL` field contains reported or imputed capital gains; Census began asking respondents about capital gains in 2014. [The 2022 tax-method documentation explains the treatment on page 10](https://www.census.gov/content/dam/Census/library/working-papers/2022/demo/sehsd-wp2022-18.pdf). Official `PTOTVAL` excludes capital gains; this model adds `CAP_VAL` once to its resource and capital-tax base. Pension withdrawals are distinguished from non-retirement capital income. Assets, unrealized gains, most sales of principal and total household wealth are not measured by this income dataset. “Capital-primary” therefore does not mean “owns any assets” or “could live from wealth.”

The derived data preserve reported losses and negative net taxes. Benefits and credits are not counted twice: refundable credits already reduce `FEDTAX_AC`/`STATETAX_A`, so EITC and refundable child credits are not separately added to benefits. The model's noncash values are consumption equivalents, not cash deposited in a recipient's account.

Medicare and Medicaid receipt are recorded using `MCARE` and `MCAID`, but their insurance value is **not** invented as cash income. Public-health coverage stays outside the adjustable cash/food/housing benefit budget. The model is consequently not a simulation of all US government spending or all welfare programs.

## Baseline taxes

The stored baseline rates are allocations for this model, not statutory marginal rates or official tax rates for “workers” and “capital owners.” The Census does not publish that exact split.

For each household, the positive noncapital base is labor + pension + other income, taking the positive part of each component. The positive capital base is the positive part of capital income. Payroll deductions are allocated to the noncapital side. Net federal/state income tax is split in proportion to those positive bases; if both bases are zero, it remains on the noncapital side. This allocation preserves total net taxes, including refundable credits. It does not reconstruct the legal tax treatment of each dollar, Social Security benefit taxation, or every preferential rate.

Weighted allocated net taxes divided by their weighted bases give the reference averages: **21.80% for noncapital income** and **17.67% for capital income**. The noncapital reference includes pension/other income; it is not solely an employee wage tax. Income-tax, payroll-tax and total-tax components remain separately available in the data. These refer to income year 2025, not a claim about an individual taxpayer's current bill.

Average resources per represented adult are about $69,019 before these taxes, $13,407 in net taxes, and $55,612 after taxes. The modeled public benefit amount averages $6,787, of which $6,413 is cash and $373 is food/housing/energy value. Other public expenditure and debt are outside this household dataset.

## Descriptive percentages and overlap

Personal primary-income groups are mutually exclusive: work 60.15%, public benefits 19.26%, pensions 6.13%, capital 4.22%, other 2.60%, and no positive personal income 7.64%. They describe the individual's annual income sources, including reported or imputed gains. The model's household-source groups differ because adults can share a partner's wages, pension or benefits.

Receipt indicators overlap. For example, 24.63% receive Social Security, 26.87% have Medicare, 12.36% have Medicaid, and 8.93% live in a SNAP-receiving household. A working adult can receive a benefit, own investments and share a pensioner's household. The “any measured public benefit” indicator, about 55.39%, is the union of own cash benefits, own Medicare/Medicaid coverage, and measured noncash benefits in the household; it must not be added to employment or source shares.

These estimates inherit survey error, income nonresponse/imputation, benefit underreporting and confidentiality treatments at high incomes. The script uses the final weights for point estimates; it does not calculate replicate-weight sampling errors. Neither the precise percentage display nor the cohort model establishes a real-world optimal policy.
