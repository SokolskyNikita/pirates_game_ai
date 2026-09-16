"""Annual employer payments, taxes, public benefits, and household utility."""

from __future__ import annotations

import math
from typing import Any

from .config import UTILITY_OFFSET, clamp
from .types import Policy, Prepared, Production, Settlement


def tax_rate(baseline: float, target: float, mean: float) -> float:
    """Preserve cohort rate differences while moving the aggregate benchmark."""
    if target <= mean:
        return clamp(baseline * target / mean) if mean > 0 else 0
    return clamp(baseline + (1 - baseline) * (target - mean) / (1 - mean)) if mean < 1 else 1


def settle(
    policy: Policy, production: Production, year: int, flow: float, prepared: Prepared, materialize: bool
) -> Settlement:
    """Pay from actual resources and reject any unfunded annual promise."""
    p = production
    c = prepared.calibration
    cells = prepared.cells
    unit = c["marketIncome"] / 100
    gross_resources = (p.output - p.investment - p.adjustment + flow) * unit
    capital_before = (p.capital + flow) * unit
    required_employer = c["laborIncome"] * p.unemployment * policy["replacement"]
    employer_pay = min(required_employer, max(0, capital_before))
    obsolete_wages = c["laborIncome"] * p.unemployment
    employer_ratio = employer_pay / obsolete_wages if obsolete_wages > 0 else 0
    capital_after = capital_before - employer_pay
    capital_factor = capital_after / c["capitalIncome"]
    productive_wage_factor = p.income_allocation_factor * p.effort
    employed_net = []
    obsolete_net = []
    labor_tax_revenue = capital_tax_revenue = 0.0
    labor_tax_base = capital_tax_base = net_employer_total = 0.0
    for cell in cells:
        work = cell.labor * productive_wage_factor
        retained = cell.labor * employer_ratio
        passive = cell.passive * p.income_allocation_factor
        capital = cell.capital * capital_factor
        labor_rate = tax_rate(cell.labor_rate, policy["laborTax"], c["laborTaxRate"])
        capital_rate = tax_rate(cell.capital_rate, policy["capitalTax"], c["capitalTaxRate"])
        taxable_passive = cell.taxable_passive * p.income_allocation_factor
        tax_employed = max(0, work + taxable_passive) * labor_rate
        tax_obsolete = max(0, retained + taxable_passive) * labor_rate
        tax_capital = max(0, capital) * capital_rate
        expected_tax = (1 - p.unemployment) * tax_employed + p.unemployment * tax_obsolete
        employed_net.append(work + passive + capital - tax_employed - tax_capital)
        obsolete_net.append(retained + passive + capital - tax_obsolete - tax_capital)
        net_employer = retained * (1 - labor_rate)
        labor_tax_revenue += cell.weight * expected_tax
        capital_tax_revenue += cell.weight * tax_capital
        labor_tax_base += cell.weight * (
            (1 - p.unemployment) * max(0, work + taxable_passive)
            + p.unemployment * max(0, retained + taxable_passive)
        )
        capital_tax_base += cell.weight * max(0, capital)
        net_employer_total += cell.weight * p.unemployment * net_employer
    revenue = labor_tax_revenue + capital_tax_revenue
    base_services = min(c["nonTransferSpending"], revenue)
    benefits_required = c["benefits"] * policy["welfareScale"]
    benefits_paid = min(benefits_required, max(0, revenue - base_services))
    nontransfer_spending = revenue - benefits_paid
    welfare_gap = benefits_required - benefits_paid
    government_gap = max(0, c["nonTransferSpending"] - base_services)
    utilities = []
    income = [] if materialize else None
    all_income = worker_income = owner_income = 0.0
    employed_income = displaced_income = baseline_exposed = prosperity = 0.0
    for index, cell in enumerate(cells):
        if policy["benefitFormula"] == "flat":
            share = 1
        elif policy["benefitFormula"] == "current":
            share = cell.benefit / c["benefits"] if c["benefits"] > 0 else 0
        else:
            share = cell.prior / prepared.baseline_all_income if prepared.baseline_all_income > 0 else 0
        benefit = benefits_paid * share
        employed = employed_net[index] + benefit
        obsolete = obsolete_net[index] + benefit
        expected = (1 - p.unemployment) * employed + p.unemployment * obsolete
        denominator = max(cell.prior, 1)
        # Utility floors consumption only; signed losses remain in accounting.
        utility_employed = math.log((max(0, employed) / denominator + UTILITY_OFFSET) / (1 + UTILITY_OFFSET))
        utility_obsolete = math.log((max(0, obsolete) / denominator + UTILITY_OFFSET) / (1 + UTILITY_OFFSET))
        utility = (1 - p.unemployment) * utility_employed + p.unemployment * utility_obsolete
        utilities.append(utility)
        if income is not None:
            income.append(expected)
        all_income += cell.weight * expected
        prosperity += cell.weight * utility
        if cell.source["group"] == "work":
            worker_income += cell.weight * expected
        if cell.source["group"] == "capital":
            owner_income += cell.weight * expected
        if cell.has_labor:
            employed_income += cell.weight * employed
            displaced_income += cell.weight * obsolete
            baseline_exposed += cell.weight * cell.prior
    worker_score = (
        worker_income / prepared.baseline_worker_income - 1 if prepared.baseline_worker_income > 0 else 0
    )
    fully_funded = required_employer - employer_pay < 1e-7 and welfare_gap < 1e-7 and government_gap < 1e-7
    point: dict[str, Any] | None = None
    if materialize:
        point = {
            "year": year,
            "adoption": p.adoption,
            "exposure": p.exposure,
            "output": p.output,
            "netOutput": p.output - p.investment - p.adjustment,
            "potentialOutput": 100 * p.growth,
            "potentialGrowthRate": p.potential_growth_rate,
            "gdpGrowthRate": p.gdp_growth_rate,
            "workerIncome": worker_income,
            "ownerIncome": owner_income,
            "allIncome": all_income,
            "workerIncomeIndex": 100 * (worker_score + 1),
            "ownerIncomeIndex": 100 * owner_income / prepared.baseline_owner_income
            if prepared.baseline_owner_income > 0
            else 100,
            "allIncomeIndex": 100 * all_income / prepared.baseline_all_income,
            "employedIncomeIndex": 100 * employed_income / baseline_exposed if baseline_exposed > 0 else 100,
            "displacedIncomeIndex": 100 * displaced_income / baseline_exposed
            if baseline_exposed > 0
            else 100,
            "newlyDisplacedIncomeIndex": 100 * displaced_income / baseline_exposed
            if baseline_exposed > 0
            else 100,
            "longTermDisplacedIncomeIndex": 100 * displaced_income / baseline_exposed
            if baseline_exposed > 0
            else 100,
            "cohortIncome": income,
            "unemployment": p.unemployment,
            "newlyDisplaced": p.newly,
            "longTermDisplaced": max(0, p.unemployment - p.newly),
            "reemployed": p.reemployed,
            "employerPay": employer_pay,
            "employerPayRatio": employer_ratio,
            "employerNetPayRatio": net_employer_total / obsolete_wages if obsolete_wages > 0 else 0,
            "employerFundingGap": required_employer - employer_pay,
            "benefitsRequired": benefits_required,
            "benefitsPaid": benefits_paid,
            "benefitsScalePaid": benefits_paid / c["benefits"] if c["benefits"] > 0 else 0,
            "baselineBenefits": c["benefits"],
            "nonTransferSpending": nontransfer_spending,
            "governmentFundingGap": government_gap,
            "welfareFundingGap": welfare_gap,
            "taxRevenue": revenue,
            "laborTaxRevenue": labor_tax_revenue,
            "capitalTaxRevenue": capital_tax_revenue,
            "laborTaxBase": labor_tax_base,
            "capitalTaxBase": capital_tax_base,
            "effectiveLaborTax": labor_tax_revenue / labor_tax_base if labor_tax_base > 0 else 0,
            "effectiveCapitalTax": capital_tax_revenue / capital_tax_base if capital_tax_base > 0 else 0,
            "laborIncome": p.labor * unit,
            "capitalIncome": capital_before,
            "capitalAfterRetention": capital_after,
            "investmentBurden": p.burden,
            "laborEffort": p.effort,
            "capacityFactor": p.capacity,
            "investmentCost": p.investment * unit,
            "adjustmentCost": p.adjustment * unit,
            "netRentFlow": flow * unit,
            "consumption": all_income,
            "resourceResidual": all_income + nontransfer_spending - gross_resources,
            "feasible": fully_funded,
        }
    return Settlement(point, utilities, worker_score, prosperity, p.output / 100 - 1, fully_funded)
