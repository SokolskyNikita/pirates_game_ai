"""Cohort-matrix adapter for annual taxes, benefit budgets and utility.

Rows are independent policy packages; columns are the fixed voter cohorts.
Cohort totals accumulate in the scalar reference's order, never parallel sum.
"""

from dataclasses import dataclass

import numpy as np

from .finance import (
    FUNDING_TOLERANCE,
    employer_budget,
    fully_funded,
    household_income,
    income_utility,
    public_budget,
    tax_rate,
)


@dataclass(slots=True)
class BatchSettlement:
    utilities: np.ndarray
    employed_utility: np.ndarray
    obsolete_utility: np.ndarray
    worker_score: np.ndarray
    prosperity_score: np.ndarray
    output_score: np.ndarray
    admissible: np.ndarray
    funding_distance: np.ndarray


def _sequential_total(values: np.ndarray) -> np.ndarray:
    return np.cumsum(values, axis=1)[:, -1]


def _tax_rates(baseline, target, mean):
    baseline = baseline[None, :]
    target = target[:, None]
    return tax_rate(baseline, target, mean, xp=np)


def prepare_settlement_arrays(prepared, policy):
    cells, c = prepared.cells, prepared.calibration
    fields = {
        name: np.asarray([getattr(cell, name) for cell in cells])
        for name in (
            "weight",
            "labor",
            "capital",
            "passive",
            "taxable_passive",
            "benefit",
            "prior",
            "labor_rate",
            "capital_rate",
        )
    }
    fields["worker"] = np.asarray([cell.source["group"] == "work" for cell in cells])
    fields["labor_rates"] = _tax_rates(fields["labor_rate"], policy["laborTax"], c["laborTaxRate"])
    fields["capital_rates"] = fields["capital_rate"][None, :]
    current = fields["benefit"] / c["benefits"] if c["benefits"] > 0 else fields["benefit"] * 0
    prior = (
        fields["prior"] / prepared.baseline_all_income
        if prepared.baseline_all_income > 0
        else fields["prior"] * 0
    )
    fields["benefit_share"] = np.where(
        policy["formula"][:, None] == "flat",
        1,
        np.where(policy["formula"][:, None] == "current", current, prior),
    )
    return fields


def settle_batch(policy, production, flow, prepared, arrays, price_index=1):
    c = prepared.calibration
    capital_before = (production["capital"] + flow) * (c["marketIncome"] / 100 / price_index)
    employer = employer_budget(
        c["laborIncome"],
        production["retained"],
        policy["replacement"],
        capital_before,
        production["u"],
        xp=np,
    )
    employer_ratio = employer.nonproductive_wage_ratio
    capital_factor = employer.capital_after / c["capitalIncome"]
    real_allocation = production["allocation"] / price_index
    allocation = real_allocation[:, None]
    productive = real_allocation * production["average_wage"] * production["effort"]
    work = arrays["labor"] * productive[:, None]
    retained = arrays["labor"] * employer_ratio[:, None]
    passive = arrays["passive"] * allocation
    capital = arrays["capital"] * capital_factor[:, None]
    taxable_passive = arrays["taxable_passive"] * allocation
    household = household_income(
        work,
        retained,
        passive,
        capital,
        taxable_passive,
        arrays["labor_rates"],
        arrays["capital_rates"],
        ai_reference=arrays["capital"]
        * (production["ai_reference_capital"] * c["marketIncome"] / 100 / c["capitalIncome"])[:, None],
        ai_rate=policy["aiProfitTax"][:, None],
        xp=np,
    )
    tax_e, tax_u, tax_c = household.employed_tax, household.nonproductive_tax, household.capital_tax
    unemployment = production["u"][:, None]
    expected_tax = (1 - unemployment) * tax_e + unemployment * tax_u
    labor_revenue = _sequential_total(arrays["weight"] * expected_tax)
    capital_revenue = _sequential_total(arrays["weight"] * tax_c)
    revenue = labor_revenue + capital_revenue + _sequential_total(arrays["weight"] * household.ai_profit_tax)
    budget = public_budget(revenue, c["nonTransferSpending"], c["benefits"], policy["welfareScale"], xp=np)
    gaps = np.stack((employer.gap, budget.welfare_gap, budget.government_gap), axis=1)
    admissible = fully_funded(employer.gap, budget.welfare_gap, budget.government_gap)
    funding_distance = np.min(np.abs(gaps - FUNDING_TOLERANCE), axis=1)
    payment = budget.benefits_paid[:, None] * arrays["benefit_share"]
    employed_income = household.employed_net + payment
    displaced_income = household.nonproductive_net + payment
    expected = (1 - unemployment) * employed_income + unemployment * displaced_income
    employed_utility = income_utility(employed_income, arrays["prior"], xp=np)
    displaced_utility = income_utility(displaced_income, arrays["prior"], xp=np)
    utilities = (1 - unemployment) * employed_utility + unemployment * displaced_utility
    worker_income = _sequential_total(np.where(arrays["worker"], arrays["weight"] * expected, 0))
    worker_score = (
        worker_income / prepared.baseline_worker_income - 1
        if prepared.baseline_worker_income > 0
        else np.zeros_like(worker_income)
    )
    prosperity_score = _sequential_total(arrays["weight"] * utilities)
    return BatchSettlement(
        utilities,
        employed_utility,
        displaced_utility,
        worker_score,
        prosperity_score,
        production["output"] / 100 - 1,
        admissible,
        funding_distance,
    )
