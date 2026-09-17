"""AI deployment, labor matching, output, and cross-border investment returns."""

from __future__ import annotations

from typing import Any

from .arithmetic import Scalar
from .config import CAPACITY_RENEWAL_RATE, YEARS
from .labor_market import advance_labor
from .types import Calibration, ModelInputs, Policy, Production


def deployment_at_year(target, pace, year: int, response: float, burden, *, xp=None):
    """Keep installation timing identical for scalar and policy-array inputs."""
    xp = xp or Scalar
    progress = xp.minimum(1, xp.maximum(0, pace * year / YEARS))
    return target * progress * (1 - response * burden * (1 - progress))


def policy_burden_values(
    inputs, policy, other_pace, other_strength, strength, trade, calibration, *, xp=None
):
    """Price required retention at full rollout, independently of rollout speed.

    Retained staff can fill new roles, so transforming a job without reducing
    the available job count does not create a permanent extra payroll charge.
    Actual additional trade-retention costs enter subsequent annual burdens.
    """
    xp = xp or Scalar
    own = xp.where(policy["pace"] == 0, 0, strength)
    other = xp.where(other_pace == 0, 0, other_strength)
    exposure = xp.where(policy["pace"] == 0, 0, xp.minimum(1, xp.maximum(0, own + trade * other * (1 - own))))
    nonproductive = xp.maximum(0, -inputs["jobChange"] * exposure)
    retained = xp.minimum(
        1, calibration["laborIncome"] * nonproductive * policy["replacement"] / calibration["capitalIncome"]
    )
    shift = 0  # Ordinary capital taxation stays fixed; AI tax affects adoption only.
    return xp.minimum(1, xp.maximum(-1, shift + (1 - xp.maximum(0, shift)) * retained))


def production_values(
    inputs: ModelInputs,
    policy: Policy,
    old: dict[str, Any],
    adoption: Any,
    foreign_adoption: Any,
    burden: Any,
    trade: Any,
    year: int,
    calibration: Calibration,
    ai_growth: float,
    baseline_growth: float,
    trade_adjustment: Any = None,
    *,
    xp: Any = None,
) -> dict[str, Any]:
    """Shared scalar/NumPy equations; only the arithmetic provider differs.

    Baseline growth plus AI's marginal contribution defines potential output.
    Capacity, labor effort, and unfilled required human tasks can still reduce realized
    GDP. Productivity-gain claims and wage competition only divide that output.
    """
    xp = xp or Scalar
    progress = xp.minimum(1, xp.maximum(0, policy["pace"] * year / YEARS))
    exposure = xp.where(
        policy["pace"] == 0,
        0,
        xp.minimum(1, xp.maximum(0, adoption + trade * progress * foreign_adoption * (1 - adoption))),
    )
    delta_adoption = xp.maximum(0, adoption - old["adoption"])
    trade_adjustment = old["trade_adjustment"] if trade_adjustment is None else trade_adjustment
    affected = inputs["jobsAffected"] * exposure
    labor_state = advance_labor(
        old["labor_state"],
        affected,
        inputs["jobChange"],
        exposure,
        inputs["jobSearch"],
        policy["replacement"],
        trade_adjustment,
        xp=xp,
    )
    employed = labor_state["employment"]
    unemployment = xp.maximum(0, 1 - employed)
    # A descriptive partition of nonproductive workers, not a causal estimate:
    # trade's missing slot capacity first, then remaining domestic/nonsearch loss.
    trade_unemployment = xp.minimum(
        unemployment, xp.maximum(0, labor_state["nominal_slots"] - labor_state["slots"])
    )
    ai_unemployment = xp.maximum(0, unemployment - trade_unemployment)
    effort = xp.minimum(
        1.5,
        xp.maximum(0, 1 - inputs["investmentResponse"] * (policy["laborTax"] - calibration["laborTaxRate"])),
    )
    capacity = xp.minimum(
        1.5,
        xp.maximum(0, 1 - inputs["investmentResponse"] * burden * (1 - (1 - CAPACITY_RENEWAL_RATE) ** year)),
    )
    labor_base = calibration["laborIncome"] / calibration["marketIncome"] * 100
    passive_base = calibration["passiveIncome"] / calibration["marketIncome"] * 100
    potential_growth_rate = baseline_growth + ai_growth * exposure
    growth = old["growth"] * (1 + potential_growth_rate)
    # Automated-away jobs need no human replacement. Original and transformed
    # baseline tasks still do. Extra vacancies are opportunities, not lost
    # existing production: adding unfilled new jobs cannot erase work still
    # performed by incumbents. No extra worker or wage is created by a vacancy.
    required_new = xp.minimum(affected, xp.maximum(0, affected + inputs["jobChange"] * exposure))
    unfilled_tasks = xp.maximum(0, 1 - affected - labor_state["original_filled"]) + xp.maximum(
        0, required_new - labor_state["new_filled"]
    )
    production_base = 100 + labor_base * employed * (effort - 1) - labor_base * unfilled_tasks
    output = capacity * growth * production_base
    raw_claims = production_base + inputs["productivityGain"] * labor_base * affected
    allocation = output / raw_claims
    labor = allocation * labor_base * labor_state["wage_bill"] * effort
    passive = allocation * passive_base
    investment = 12 * delta_adoption + 40 * delta_adoption**2
    adjustment = 0.5 * labor_base * labor_state["newly_displaced"]
    # Illustrative ongoing resource cost: 2% of AI-exposed output each year.
    operating = 0.02 * output * exposure
    capital = output - labor - passive - investment - adjustment - operating
    return {
        "allocation": allocation,
        "growth": growth,
        "potential_growth_rate": potential_growth_rate,
        "gdp_growth_rate": output / xp.maximum(old["output"], 1e-15) - 1,
        "adoption": adoption,
        "exposure": exposure,
        "u": unemployment,
        "ai_u": ai_unemployment,
        "trade_u": trade_unemployment,
        "trade_adjustment": trade_adjustment,
        "output": output,
        "labor": labor,
        "passive": passive,
        "investment": investment,
        "operating": operating,
        "adjustment": adjustment,
        "burden": burden,
        "capacity": capacity,
        "capital": capital,
        "effort": effort,
        "rents": xp.maximum(0, capital - (100 - labor_base - passive_base) * allocation),
        "labor_state": labor_state,
        "average_wage": labor_state["average_wage"],
        "retained": labor_state["retained"],
        "jobs_affected": affected,
    }


def production_record(values: dict[str, Any]) -> Production:
    """Adapt one scalar year's shared economic values for public reporting."""
    labor_state = values["labor_state"]
    return Production(
        income_allocation_factor=values["allocation"],
        growth=values["growth"],
        potential_growth_rate=values["potential_growth_rate"],
        gdp_growth_rate=values["gdp_growth_rate"],
        adoption=values["adoption"],
        exposure=values["exposure"],
        unemployment=values["u"],
        newly=labor_state["newly_displaced"],
        reemployed=labor_state["hired"],
        output=values["output"],
        labor=values["labor"],
        passive=values["passive"],
        capital=values["capital"],
        rents=values["rents"],
        investment=values["investment"],
        operating=values["operating"],
        adjustment=values["adjustment"],
        effort=values["effort"],
        burden=values["burden"],
        capacity=values["capacity"],
        ai_unemployment=values["ai_u"],
        trade_unemployment=values["trade_u"],
        trade_adjustment=values["trade_adjustment"],
        labor_state=labor_state,
        jobs_affected=values["jobs_affected"],
        ai_reference_capital=values.get("ai_reference_capital", 0),
        average_wage_factor=values["average_wage"],
        consumer_price_index=values["consumer_price_index"],
        trade_open=values.get("trade_open", False),
        import_share=values.get("import_share", 0),
        export_share=values.get("export_share", 0),
        export_volume=values.get("export_volume", 0),
        relative_producer_price=values.get("relative_producer_price", 1),
        trade_balance_residual=values.get("trade_balance_residual", 0),
    )
