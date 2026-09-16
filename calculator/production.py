"""AI deployment, displacement, output, and cross-border investment returns."""

from __future__ import annotations

import math

from .config import CAPACITY_RENEWAL_RATE, YEARS, clamp
from .types import Calibration, ModelInputs, Policy, Production, TrajectoryState


def ai_exposure(
    pace: float, adoption: float, foreign_adoption: float, trade: float, import_progress: float
) -> float:
    """A pause blocks domestic and imported AI use, but not rent competition."""
    if pace == 0:
        return 0
    return clamp(adoption + trade * clamp(import_progress) * foreign_adoption * (1 - adoption))


def deployment_at_year(target: float, pace: float, year: int, response: float, burden: float) -> float:
    progress = clamp(pace * year / YEARS)
    return target * progress * (1 - response * burden * (1 - progress))


def policy_burden(
    inputs: ModelInputs,
    policy: Policy,
    other_pace: float,
    other_strength: float,
    strength: float,
    trade: float,
    calibration: Calibration,
) -> float:
    """Price retention against a common ten-step rollout, independent of speed."""
    affected = previous = 0.0
    for year in range(1, YEARS + 1):
        own = deployment_at_year(strength, 0 if policy["pace"] == 0 else 1, year, 0, 0)
        other = deployment_at_year(other_strength, 0 if other_pace == 0 else 1, year, 0, 0)
        exposure = ai_exposure(policy["pace"], own, other, trade, year / YEARS)
        affected = affected * (1 - inputs["reemployment"]) + inputs["displacement"] * max(
            0, exposure - previous
        )
        previous = exposure
    retained = clamp(
        calibration["laborIncome"] * affected * policy["replacement"] / calibration["capitalIncome"]
    )
    shift = policy["capitalTax"] - calibration["capitalTaxRate"]
    return clamp(shift + (1 - max(0, shift)) * retained, -1, 1)


def produce(
    inputs: ModelInputs,
    policy: Policy,
    old: TrajectoryState,
    adoption: float,
    foreign_adoption: float,
    burden: float,
    trade: float,
    year: int,
    calibration: Calibration,
    gdp_growth: float,
) -> Production:
    exposure = ai_exposure(policy["pace"], adoption, foreign_adoption, trade, policy["pace"] * year / YEARS)
    delta = max(0, exposure - old.exposure)
    delta_adoption = max(0, adoption - old.adoption)
    newly = inputs["displacement"] * delta
    reemployed = old.unemployment * inputs["reemployment"]
    unemployment = clamp(old.unemployment - reemployed + newly)
    effort = clamp(
        1 - inputs["investmentResponse"] * (policy["laborTax"] - calibration["laborTaxRate"]), 0, 1.5
    )
    capacity = clamp(
        1 - inputs["investmentResponse"] * burden * (1 - (1 - CAPACITY_RENEWAL_RATE) ** year), 0, 1.5
    )
    labor_base = calibration["laborIncome"] / calibration["marketIncome"] * 100
    passive_base = calibration["passiveIncome"] / calibration["marketIncome"] * 100
    potential_growth_rate = gdp_growth * exposure
    growth = old.growth * (1 + potential_growth_rate)
    # Productivity claims redistribute the separately assumed output path.
    output = capacity * growth * (100 + labor_base * (1 - unemployment) * (effort - 1))
    raw_claims = (
        100
        + labor_base * (1 - unemployment) * (effort - 1)
        + inputs["productivityGain"] * labor_base * unemployment
    )
    allocation = output / raw_claims
    labor = allocation * labor_base * (1 - unemployment) * effort
    passive = allocation * passive_base
    actual_growth = output / old.output - 1 if old.output > 0 else 0
    investment = 12 * delta_adoption + 40 * delta_adoption**2
    adjustment = 0.5 * labor_base * newly
    capital = output - labor - passive - investment - adjustment
    rents = max(0, capital - (100 - labor_base - passive_base) * allocation)
    return Production(
        income_allocation_factor=allocation,
        growth=growth,
        potential_growth_rate=potential_growth_rate,
        gdp_growth_rate=actual_growth,
        adoption=adoption,
        exposure=exposure,
        unemployment=unemployment,
        newly=newly,
        reemployed=reemployed,
        output=output,
        labor=labor,
        passive=passive,
        capital=capital,
        rents=rents,
        investment=investment,
        adjustment=adjustment,
        effort=effort,
        burden=burden,
        capacity=capacity,
    )


def international_rent_flow(inputs: ModelInputs, us: Production, foreign: Production) -> float:
    """Return the US inflow in US output-index units; the other bloc pays it."""
    mobile = 0.6 * inputs["capitalMobility"] * inputs["foreignStrength"]
    total = mobile * (us.rents + inputs["foreignMarketSize"] * foreign.rents)
    own = (0.15 + us.adoption) * math.exp(-4 * inputs["capitalMobility"] * us.burden)
    other = (
        inputs["foreignMarketSize"]
        * inputs["foreignStrength"]
        * (0.15 + foreign.adoption)
        * math.exp(-4 * inputs["capitalMobility"] * foreign.burden)
    )
    return total * own / (own + other) - mobile * us.rents
