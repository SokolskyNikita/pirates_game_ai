"""AI deployment, displacement, output, and cross-border investment returns."""

from __future__ import annotations

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
    trade_adjustment: float | None = None,
) -> Production:
    exposure = ai_exposure(policy["pace"], adoption, foreign_adoption, trade, policy["pace"] * year / YEARS)
    delta = max(0, exposure - old.exposure)
    delta_adoption = max(0, adoption - old.adoption)
    newly_ai = inputs["displacement"] * delta
    reemployed_ai = old.unemployment * inputs["reemployment"]
    ai_unemployment = clamp(old.unemployment - reemployed_ai + newly_ai)
    recovered_trade = old.trade_adjustment * (1 - inputs["reemployment"])
    trade_adjustment = recovered_trade if trade_adjustment is None else trade_adjustment
    trade_unemployment = (1 - ai_unemployment) * trade_adjustment
    unemployment = ai_unemployment + trade_unemployment
    recovered_ai = old.unemployment - reemployed_ai
    recovered_total = recovered_ai + (1 - recovered_ai) * recovered_trade
    old_total = old.unemployment + (1 - old.unemployment) * old.trade_adjustment
    newly = newly_ai if trade_adjustment == 0 else unemployment - recovered_total
    reemployed = reemployed_ai if old.trade_adjustment == 0 else old_total - recovered_total
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
    production_base = (
        100 + labor_base * (1 - ai_unemployment) * (effort - 1) - labor_base * trade_unemployment * effort
    )
    output = capacity * growth * production_base
    raw_claims = production_base + inputs["productivityGain"] * labor_base * ai_unemployment
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
        ai_unemployment=ai_unemployment,
        trade_unemployment=trade_unemployment,
        trade_adjustment=trade_adjustment,
    )
