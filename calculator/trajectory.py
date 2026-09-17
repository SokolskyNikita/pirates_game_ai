"""One annual production/trade loop for both scalar and batched evaluation.

Sequence: choose installation from last year's state; produce using existing
trade capacity; estimate this year's trade pressure; produce again from the
same starting state; clear final prices. Reproduction never applies layoffs or
compounds growth twice. Fiscal settlement and voting happen downstream.
"""

from collections.abc import Iterator
from dataclasses import dataclass
from functools import partial
from typing import Any

from .arithmetic import Scalar
from .config import GROWTH_BASELINE
from .labor_market import initial_labor
from .preferences import preferences
from .production import deployment_at_year, policy_burden_values, production_values
from .trade import baseline_trade, competition_displacement, trade_market, trade_retention_burden
from .types import Calibration, ModelInputs, Policy


@dataclass(slots=True)
class ProductionYear:
    year: int
    us: dict[str, Any]
    foreign: dict[str, Any] | None
    us_flow: Any
    foreign_flow: Any


def initial_state(zero=0.0, import_share=0.0) -> dict[str, Any]:
    """Prices and trade volumes describe the economy before either new policy."""
    return {
        "adoption": zero,
        "growth": zero + 1,
        "output": zero + 100,
        "trade_adjustment": zero,
        "consumer_price_index": zero + 1,
        "import_share": zero + import_share,
        "export_volume": zero + 100 * import_share,
        "net_output": zero + 100,
        "labor_state": initial_labor(zero),
    }


def _annual_burden(reference, state, policy, calibration, xp):
    return trade_retention_burden(
        reference,
        state["labor_state"]["retained"],
        state["labor_state"]["nominal_slots"],
        state["consumer_price_index"],
        policy["replacement"],
        calibration,
        xp=xp,
    )


def _attach_market(production, market, prefix):
    production.update(
        consumer_price_index=market[prefix + "PriceIndex"],
        trade_open=market["open"],
        import_share=market[prefix + "ImportShare"],
        export_share=market[prefix + "ExportShare"],
        export_volume=market[prefix + "ExportVolume"],
        relative_producer_price=market["relativeProducerPrice"],
        trade_balance_residual=market["residual"],
    )


def production_trajectory(
    inputs: ModelInputs,
    us_policy: Policy,
    foreign_policy: Policy | None,
    calibration: Calibration,
    *,
    xp=None,
    zero=0.0,
) -> Iterator[ProductionYear]:
    """Yield independent year records; ``zero`` selects scalar or batch shape.

    Policies may contain policy-axis arrays for NumPy. All years remain
    sequential. Neither the policies nor previous years are mutated.
    """
    xp = xp or Scalar
    baseline_us, baseline_foreign, tradable_share = baseline_trade(inputs)
    international = foreign_policy is not None
    opened = (
        us_policy.get("allowFreeTrade", True) & foreign_policy.get("allowFreeTrade", True)
        if international
        else False
    )
    trade_us = baseline_us * opened if international else 0
    trade_foreign = baseline_foreign * opened if international else 0
    state_us = initial_state(zero, baseline_us if international else 0)
    state_foreign = initial_state(zero, baseline_foreign if international else 0)
    burden_us = policy_burden_values(
        inputs,
        us_policy,
        foreign_policy["pace"] if international else zero,
        inputs["foreignStrength"],
        1,
        trade_us,
        calibration,
        xp=xp,
    )
    burden_foreign = (
        policy_burden_values(
            inputs,
            foreign_policy,
            us_policy["pace"],
            1,
            inputs["foreignStrength"],
            trade_foreign,
            calibration,
            xp=xp,
        )
        if international
        else zero
    )
    for year in range(1, preferences().horizon + 1):
        annual_us = _annual_burden(burden_us, state_us, us_policy, calibration, xp)
        annual_foreign = (
            _annual_burden(burden_foreign, state_foreign, foreign_policy, calibration, xp)
            if international
            else zero
        )
        adoption_us = xp.maximum(
            state_us["adoption"],
            deployment_at_year(
                1,
                us_policy["pace"],
                year,
                inputs["investmentResponse"],
                annual_us,
                xp=xp,
            ),
        )
        adoption_foreign = (
            xp.maximum(
                state_foreign["adoption"],
                deployment_at_year(
                    inputs["foreignStrength"],
                    foreign_policy["pace"],
                    year,
                    inputs["investmentResponse"],
                    annual_foreign,
                    xp=xp,
                ),
            )
            if international
            else zero
        )

        produce_us = partial(
            production_values,
            inputs,
            us_policy,
            state_us,
            adoption_us,
            adoption_foreign,
            annual_us,
            trade_us,
            year,
            calibration,
            inputs["usAiGrowth"],
            GROWTH_BASELINE["us"],
            xp=xp,
        )
        produce_foreign = (
            partial(
                production_values,
                inputs,
                foreign_policy,
                state_foreign,
                adoption_foreign,
                adoption_us,
                annual_foreign,
                trade_foreign,
                year,
                calibration,
                inputs["foreignAiGrowth"],
                GROWTH_BASELINE["foreign"],
                xp=xp,
            )
            if international
            else None
        )
        us = produce_us()
        foreign = produce_foreign() if produce_foreign is not None else None
        flow_us = flow_foreign = zero
        if international:
            first_market = trade_market(inputs, us_policy, foreign_policy, us, foreign, xp=xp)
            adjusted = []
            for region, state, produce in (
                ("us", state_us, produce_us),
                ("foreign", state_foreign, produce_foreign),
            ):
                adjustment = competition_displacement(
                    state["trade_adjustment"],
                    first_market[region + "ImportShare"],
                    first_market[region + "ExportVolume"],
                    state["import_share"],
                    state["export_volume"],
                    state["net_output"],
                    tradable_share,
                    xp=xp,
                )
                adjusted.append(produce(trade_adjustment=adjustment))
            us, foreign = adjusted
            market = trade_market(inputs, us_policy, foreign_policy, us, foreign, xp=xp)
            flow_us, flow_foreign = market["usFlow"], market["foreignFlow"]
            _attach_market(us, market, "us")
            _attach_market(foreign, market, "foreign")
        for production in (us, foreign):
            if production is not None:
                production.setdefault("consumer_price_index", zero + 1)
                production["net_output"] = (
                    production["output"] - production["investment"] - production["adjustment"]
                )
        yield ProductionYear(year, us, foreign, flow_us, flow_foreign)
        state_us = us
        if foreign is not None:
            state_foreign = foreign
