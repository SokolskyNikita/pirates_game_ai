# US tax and benefit reference for the electorate model

Research checked 16 September 2026. These recommendations concern the model's accounting and labels; they are not estimates of the effects of changing US tax law.

> This research note records alternatives considered before implementation. The final all-adult redistribution design and precise data definitions are documented in [us-electorate-data.md](us-electorate-data.md), the README and the page’s model notes.

## Reference period

The 2026 CPS Annual Social and Economic Supplement reports **2025 income**. Census released the accompanying income report on 15 September 2026. It distinguishes money income from post-tax income; the latter deducts federal and state income taxes after credits and payroll taxes. Use this survey vintage, rather than describing the previous year's public-use file as current. [Census income report](https://www.census.gov/library/publications/2026/demo/p60-289.html), [public-use data and documentation](https://www.census.gov/data/datasets/time-series/demo/cps/cps-asec.html).

“Current” in the interface should mean **the 2025 survey reference**, not a reconstruction of every provision of September 2026 tax law. The model can show the short label “2025 US reference” next to the rates.

## Tax accounting

CPS respondents do not report tax liabilities. Census estimates them with a tax model. Its outputs include federal income tax after refundable credits (`FEDTAX_AC`), state income tax after credits (`STATETAX_A`), and payroll taxes (`FICA`). Income-tax outputs are attached to the main filer, so joint liabilities must be pooled before allocating household resources among adults. Payroll estimates include self-employment contributions; adding SECA a second time would duplicate them. Negative after-credit tax liabilities are legitimate refunds. [Census tax-model overview](https://www.census.gov/topics/income-poverty/income/guidance/tax-model.html), [methods, especially pp. 5–6 and 15–16](https://www.census.gov/content/dam/Census/library/working-papers/2022/demo/sehsd-wp2022-18.pdf).

Recommended baseline for household h:

```
IncomeTax_h = sum(FEDTAX_AC + STATETAX_A)
PayrollTax_h = sum(FICA)
Tax_h = IncomeTax_h + PayrollTax_h
```

Pool all household members before dividing resources among resident adults. Retain citizen adult person weights for voting. Dividing only by citizen adults would wrongly assign a noncitizen spouse's entire consumption share to citizen voters. This pooling is an explicit model assumption; it does not turn the household into one vote.

Two tax decisions should apply to **income sources**, not mutually exclusive kinds of people. A worker can also own stocks; a retiree can receive a pension, Social Security and interest. If the model needs to split existing income tax across sources, use a stated allocation rule: payroll tax belongs to earned income; allocate household income tax proportionately to positive noncapital and capital bases. These are model allocations, not observed marginal tax rates or official estimates of the tax burden on each factor. Keep negative refunds and report the chosen tax bases.

Display baseline averages as ratios of weighted totals, not the average of each person's percentage:

```
ReferenceRate_g = sum(weight * allocatedTax_g) / sum(weight * incomeBase_g)
```

A change from 20% to 10% is **10 percentage points lower**, not “10% less tax.” If a policy shifts each cohort's baseline rate, show both the shift and the resulting aggregate effective rate. A uniform rate is a different policy from preserving the baseline income-dependent rates plus a common shift.

These CPS rates omit corporate, sales and property taxes and employer payroll contributions. They must not be labeled “all US taxes.” CBO's broader federal tax measure includes corporate and excise taxes, and its income denominator includes employer compensation and social insurance. Therefore CBO's published quintile rates are not interchangeable with the CPS rates. [CBO, 2022 distribution report, published January 2026](https://www.cbo.gov/publication/61911).

## Benefit accounting

Use observed benefits to establish the reference, rather than assigning every displaced person an assumed US wage-replacement percentage. A practical cash aggregate includes `SS_VAL`, `SSI_VAL`, `UC_VAL`, `PAW_VAL` and `VET_VAL`. It covers Social Security, SSI, unemployment compensation, public assistance and veterans' benefits. Keep any additional source-coded public pension, survivor or disability benefits explicit; they should not be inferred from a broad “other income” residual.

If taxes use `FEDTAX_AC`, refundable tax credits have already increased net resources. Do not also add EITC or the refundable child tax credit as welfare. The alternative is to use before-credit tax liabilities and record credits separately, consistently throughout the model.

Food, housing and energy assistance can be added as **consumption support** using the SPM valuations, counted once per SPM unit and then allocated to household members. Keep those values separate from cash payments in documentation. Medicare and Medicaid receipt flags identify recipients, but their insurance coverage is not spendable cash. Do not assign a cash value without a separate valuation model. Census's SPM framework distinguishes money income and noncash resources. [2025 poverty report](https://www.census.gov/library/publications/2026/demo/p60-290.html).

“Receives government support” overlaps employment and retirement; it is not a mutually exclusive labor-market status. A working adult receiving SNAP or living with a Social Security recipient must retain both exposures.

## Keep the five ballots distinct

1. **Employer retention:** allow dismissal or require a specified fraction of the employee's prior wage. Show the employer's payment separately from government support.
2. **Existing benefits:** decrease, retain or increase each recipient's observed reference entitlement. Report the aggregate and the effect on existing recipients.
3. **Distribution rule:** compare flat and earnings-linked support for the same eligible population and budget. For new displacement support, a flat payment goes to every eligible displaced person; earnings-linked payments use prior earnings. For retirees with no prior-year earnings, retaining existing benefits avoids inventing an earnings history.
4. **Noncapital-income tax:** show the chosen level and change from the defined reference rate.
5. **Capital-income tax:** likewise; mixed-income households can be affected by both ballots.

If “flat” instead means replacing all existing cash benefits with an equal payment to every adult, state that explicitly. Keeping the aggregate budget is not keeping each recipient's current benefit, and a universal dividend is not the same policy as flat unemployment support. The model should not silently choose between these meanings.

## Fiscal consistency

Once tax settings represent existing taxes rather than a new levy, not all receipts can fund the chosen cash benefits. Let T0 be modeled baseline tax receipts and B0 modeled baseline benefits. Holding other public spending and baseline financing fixed gives a residual reserve R = T0 − B0 and a cash-benefit budget:

```
AvailableBenefits = B0 + (PolicyTaxReceipts - T0)
```

This is a modeling convention, not a claim that the real federal budget balances. Changes in production and taxable income must change receipts. Existing and new benefits share the available budget. Infeasible combinations should either be excluded or have a visible funding shortfall and an explicit rule for reducing actual payments. Never call the requested entitlement the amount received when its funding has failed.

## Income-definition checks

CPS money income includes retirement withdrawals net of rollovers and retirement-account interest. `DBTN_VAL` belongs with retirement resources, not an unexplained residual. `TRDINT_VAL` excludes retirement-account interest; avoid counting it again through `INT_VAL`. [Census processing evaluation, 2019](https://www.census.gov/content/dam/Census/library/working-papers/2019/demo/sehsd-wp2019-18.pdf).

Capital gains are outside the ordinary money-income total but can affect simulated taxes. Capture `CAP_VAL` separately. If gains are included in the model's consumption resources, make the corresponding denominator adjustment; if excluded, disclose the tax-base mismatch. Pension withdrawals and asset sales are resources available for consumption, but they are not all new economic output. Do not add them to GDP when calibrating production.
