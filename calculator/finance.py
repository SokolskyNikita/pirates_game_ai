"""Shared fiscal rules and household preferences, in real reference-year units.

These functions contain the equations. Scalar and matrix settlement only adapt
shapes, aggregate cohorts in order, and format results. Policy batches pass
numpy as ``xp``; the public scalar reference uses Python arithmetic.
"""

from dataclasses import dataclass
from typing import Any

from .arithmetic import Scalar
from .config import UTILITY_OFFSET
from .preferences import preferences

# Dollar-per-adult tolerance for roundoff, not permission to borrow from later years.
FUNDING_TOLERANCE = 1e-7


def positive_ratio(numerator, denominator, *, xp=Scalar):
    """Divide only positive bases, without evaluating a division by zero in NumPy."""
    return xp.where(denominator > 0, numerator / xp.where(denominator > 0, denominator, 1), 0)


def tax_rate(baseline, target, mean: float, *, xp=Scalar):
    """Preserve cohort-rate differences while moving the common tax benchmark."""
    low = xp.minimum(1, xp.maximum(0, baseline * target / mean)) if mean > 0 else 0 * baseline * target
    high = (
        xp.minimum(1, xp.maximum(0, baseline + (1 - baseline) * (target - mean) / (1 - mean)))
        if mean < 1
        else 1 + 0 * baseline * target
    )
    return xp.where(target <= mean, low, high)


@dataclass(slots=True)
class EmployerBudget:
    required: Any
    paid: Any
    capital_after: Any
    nonproductive_wage_ratio: Any

    @property
    def gap(self):
        return self.required - self.paid


def employer_budget(
    labor_reference, retained_share, replacement, capital_before, nonproductive_share, *, xp=Scalar
):
    required = labor_reference * retained_share * replacement
    paid = xp.minimum(required, xp.maximum(0, capital_before))
    ratio = positive_ratio(paid, labor_reference * nonproductive_share, xp=xp)
    return EmployerBudget(required, paid, capital_before - paid, ratio)


@dataclass(slots=True)
class PublicBudget:
    benefits_required: Any
    benefits_paid: Any
    nontransfer_spending: Any
    welfare_gap: Any
    government_gap: Any


def public_budget(revenue, services_reference, benefits_reference, welfare_scale, *, xp=Scalar):
    """Fund existing public services first, then all promised transfers.

    The explicit all-revenue option distributes the surplus; fixed budgets leave it with public services.
    A future surplus cannot cure a shortfall in this year's budget.
    """
    services_paid = xp.minimum(services_reference, revenue)
    required = xp.where(
        welfare_scale == 3, xp.maximum(0, revenue - services_paid), benefits_reference * welfare_scale
    )
    paid = xp.minimum(required, xp.maximum(0, revenue - services_paid))
    return PublicBudget(
        required, paid, revenue - paid, required - paid, xp.maximum(0, services_reference - services_paid)
    )


def fully_funded(employer_gap, welfare_gap, government_gap):
    return (
        (employer_gap < FUNDING_TOLERANCE)
        & (welfare_gap < FUNDING_TOLERANCE)
        & (government_gap < FUNDING_TOLERANCE)
    )


@dataclass(slots=True)
class HouseholdIncome:
    employed_net: Any
    nonproductive_net: Any
    employed_tax: Any
    nonproductive_tax: Any
    capital_tax: Any
    ai_profit_tax: Any


def household_income(
    work,
    retained,
    passive,
    capital,
    taxable_passive,
    labor_rate,
    capital_rate,
    *,
    ai_reference=None,
    ai_rate=0,
    xp=Scalar,
):
    """Keep signed investment losses in resources; tax only positive tax bases."""
    employed_tax = xp.maximum(0, work + taxable_passive) * labor_rate
    nonproductive_tax = xp.maximum(0, retained + taxable_passive) * labor_rate
    capital_tax = xp.maximum(0, capital) * capital_rate
    ai_tax = (
        xp.maximum(0, capital - xp.maximum(0, capital if ai_reference is None else ai_reference))
        * (1 - capital_rate)
        * ai_rate
    )
    return HouseholdIncome(
        work + passive + capital - employed_tax - capital_tax - ai_tax,
        retained + passive + capital - nonproductive_tax - capital_tax - ai_tax,
        employed_tax,
        nonproductive_tax,
        capital_tax,
        ai_tax,
    )


def income_utility(income, prior, *, xp=Scalar):
    """Utility floors consumption; the resource ledger still retains all losses."""
    denominator = xp.maximum(prior, 1)
    ratio = (xp.maximum(0, income) / denominator + UTILITY_OFFSET) / (1 + UTILITY_OFFSET)
    curvature = preferences().curvature
    return xp.log(ratio) if curvature == 1 else (ratio ** (1 - curvature) - 1) / (1 - curvature)
