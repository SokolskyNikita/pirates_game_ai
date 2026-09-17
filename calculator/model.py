"""Trajectory orchestration and the public economic evaluation API.

Population calibration, policy construction, production, and annual settlement
are separate modules. This module combines them without making voting choices.
"""

from __future__ import annotations

from typing import Any

from .config import DISCOUNT_RATE, GROWTH_BASELINE, YEARS, normalize_inputs
from .policies import (
    BASELINE_POLICY,
    checked_policy,
    current_policy,
    make_policy,
    policies_at_pace,
    policies_for_mode,
)
from .population import CALIBRATION, PREPARED, US_COHORTS, prepare
from .production import deployment_at_year, policy_burden, produce
from .settlement import settle
from .trade import baseline_trade, competition_displacement, trade_market, trade_retention_burden
from .types import ModelInputs, Policy, Prepared, Production, TrajectoryState


def initial_point(prepared: Prepared) -> dict[str, Any]:
    """Materialize the calibrated pre-AI reference through the same settlement."""
    c = prepared.calibration
    unit = c["marketIncome"] / 100
    policy = make_policy(
        {
            **BASELINE_POLICY,
            "laborTax": c["laborTaxRate"],
            "capitalTax": c["capitalTaxRate"],
        }
    )
    production = Production(
        income_allocation_factor=1,
        growth=1,
        potential_growth_rate=0,
        gdp_growth_rate=0,
        adoption=0,
        exposure=0,
        unemployment=0,
        newly=0,
        reemployed=0,
        output=100,
        labor=c["laborIncome"] / unit,
        passive=c["passiveIncome"] / unit,
        capital=c["capitalIncome"] / unit,
        rents=0,
        investment=0,
        adjustment=0,
        effort=1,
        burden=0,
        capacity=1,
    )
    result = settle(policy, production, 0, 0, prepared, True).point
    assert result is not None
    return result


def _funding_gap(points: list[dict[str, Any]]) -> float:
    # Keep the original accumulation order, including each component separately.
    result = 0.0
    for point in points:
        result = (
            result + point["employerFundingGap"] + point["welfareFundingGap"] + point["governmentFundingGap"]
        )
    return result


def simulate(
    inputs: ModelInputs,
    us_policy: Policy,
    foreign_policy: Policy | None,
    foreign_objective: str,
    prepared: Prepared,
    materialize: bool,
    foreign_only: bool = False,
) -> dict[str, Any]:
    """Evaluate a known policy pair over ten years; do not solve the election."""
    checked_policy(us_policy)
    if foreign_policy is not None:
        checked_policy(foreign_policy)
    c = prepared.calibration
    us = [initial_point(prepared)] if materialize else []
    foreign = [initial_point(prepared)] if materialize and foreign_policy is not None else []
    utilities = [0.0] * len(prepared.cells)
    us_score = foreign_score = weight_total = 0.0
    us_admissible = foreign_admissible = True
    state_us = TrajectoryState()
    state_foreign = TrajectoryState()
    opened = (
        foreign_policy is not None
        and us_policy.get("allowFreeTrade", True)
        and foreign_policy.get("allowFreeTrade", True)
    )
    trade = foreign_trade = 0.0
    if foreign_policy is not None:
        baseline_us, baseline_foreign, _ = baseline_trade(inputs)
        trade = baseline_us if opened else 0
        foreign_trade = baseline_foreign if opened else 0
        state_us.import_share = state_us.export_share = baseline_us
        state_foreign.import_share = state_foreign.export_share = baseline_foreign
        state_us.export_volume = 100 * baseline_us
        state_foreign.export_volume = 100 * baseline_foreign
        if materialize:
            for point, baseline in ((us[0], baseline_us), (foreign[0], baseline_foreign)):
                point.update(tradeOpen=True, importShare=baseline, exportShare=baseline)
    burden_us = policy_burden(
        inputs,
        us_policy,
        foreign_policy["pace"] if foreign_policy is not None else 0,
        inputs["foreignStrength"],
        1,
        trade,
        c,
    )
    burden_foreign = (
        policy_burden(
            inputs,
            foreign_policy,
            us_policy["pace"],
            1,
            inputs["foreignStrength"],
            foreign_trade,
            c,
        )
        if foreign_policy is not None
        else 0
    )
    for year in range(1, YEARS + 1):
        annual_burden_us = trade_retention_burden(
            burden_us,
            state_us.labor_state["retained"],
            state_us.labor_state["nominal_slots"],
            state_us.consumer_price_index,
            us_policy["replacement"],
            c,
        )
        annual_burden_foreign = (
            trade_retention_burden(
                burden_foreign,
                state_foreign.labor_state["retained"],
                state_foreign.labor_state["nominal_slots"],
                state_foreign.consumer_price_index,
                foreign_policy["replacement"],
                c,
            )
            if foreign_policy is not None
            else 0
        )
        # Lower investment can delay new installations, not undo existing AI.
        adoption_us = max(
            state_us.adoption,
            deployment_at_year(1, us_policy["pace"], year, inputs["investmentResponse"], annual_burden_us),
        )
        adoption_foreign = (
            max(
                state_foreign.adoption,
                deployment_at_year(
                    inputs["foreignStrength"],
                    foreign_policy["pace"],
                    year,
                    inputs["investmentResponse"],
                    annual_burden_foreign,
                ),
            )
            if foreign_policy is not None
            else 0
        )

        def produce_us(
            adjustment: float | None = None,
            state: TrajectoryState = state_us,
            adoption: float = adoption_us,
            other_adoption: float = adoption_foreign,
            current_year: int = year,
            annual_burden: float = annual_burden_us,
        ) -> Production:
            return produce(
                inputs,
                us_policy,
                state,
                adoption,
                other_adoption,
                annual_burden,
                trade,
                current_year,
                c,
                inputs["usAiGrowth"],
                adjustment,
                GROWTH_BASELINE["us"],
            )

        def produce_foreign(
            adjustment: float | None = None,
            state: TrajectoryState = state_foreign,
            adoption: float = adoption_foreign,
            other_adoption: float = adoption_us,
            current_year: int = year,
            annual_burden: float = annual_burden_foreign,
        ) -> Production:
            assert foreign_policy is not None
            return produce(
                inputs,
                foreign_policy,
                state,
                adoption,
                other_adoption,
                annual_burden,
                foreign_trade,
                current_year,
                c,
                inputs["foreignAiGrowth"],
                adjustment,
                GROWTH_BASELINE["foreign"],
            )

        production_us = produce_us()
        production_foreign = produce_foreign() if foreign_policy is not None else None
        flow = foreign_flow = 0.0
        if production_foreign is not None and foreign_policy is not None:
            # Price first using existing job capacity, then apply this year's
            # trade capacity change and clear the market at actual production.
            first_market = trade_market(inputs, us_policy, foreign_policy, production_us, production_foreign)
            new_us_adjustment = competition_displacement(
                state_us.trade_adjustment,
                first_market["usImportShare"],
                first_market["usExportVolume"],
                state_us.import_share,
                state_us.export_volume,
                state_us.net_output,
                inputs.get("tradableShare", 0.4),
            )
            new_foreign_adjustment = competition_displacement(
                state_foreign.trade_adjustment,
                first_market["foreignImportShare"],
                first_market["foreignExportVolume"],
                state_foreign.import_share,
                state_foreign.export_volume,
                state_foreign.net_output,
                inputs.get("tradableShare", 0.4),
            )
            production_us = produce_us(new_us_adjustment)
            production_foreign = produce_foreign(new_foreign_adjustment)
            market = trade_market(inputs, us_policy, foreign_policy, production_us, production_foreign)
            flow, foreign_flow = market["usFlow"], market["foreignFlow"]
            for production, prefix in ((production_us, "us"), (production_foreign, "foreign")):
                production.consumer_price_index = market[prefix + "PriceIndex"]
                production.trade_open = market["open"]
                production.import_share = market[prefix + "ImportShare"]
                production.export_share = market[prefix + "ExportShare"]
                production.export_volume = market[prefix + "ExportVolume"]
                production.relative_producer_price = market["relativeProducerPrice"]
                production.trade_balance_residual = market["residual"]
        weight = (1 + DISCOUNT_RATE) ** -year
        weight_total += weight
        if not foreign_only:
            result = settle(us_policy, production_us, year, flow, prepared, materialize)
            for index, utility in enumerate(result.utilities):
                utilities[index] += weight * utility
            us_score += weight * result.worker_score
            us_admissible = us_admissible and result.admissible
            if result.point is not None:
                us.append(result.point)
        if production_foreign is not None and foreign_policy is not None:
            result = settle(
                foreign_policy,
                production_foreign,
                year,
                foreign_flow,
                prepared,
                materialize,
            )
            foreign_admissible = foreign_admissible and result.admissible
            if foreign_objective == "workers":
                score = result.worker_score
            elif foreign_objective == "output":
                score = result.output_score
            else:
                score = result.prosperity_score
            foreign_score += weight * score
            if result.point is not None:
                foreign.append(result.point)
            state_foreign = production_foreign.next_state()
        state_us = production_us.next_state()
    utilities = [utility / weight_total for utility in utilities]
    light = {
        "id": us_policy["id"] + "::" + (foreign_policy["id"] if foreign_policy is not None else "none"),
        "usPolicy": us_policy,
        "usUtilities": utilities,
        "usScore": us_score / weight_total,
        "usAdmissible": us_admissible,
    }
    if foreign_policy is not None:
        light.update(
            foreignPolicy=foreign_policy,
            foreignScore=foreign_score / weight_total,
            foreignAdmissible=foreign_admissible,
        )
    if not materialize:
        return light
    employer_ratios = [
        point["employerNetPayRatio"] for point in us if point["year"] > 0 and point["unemployment"] > 1e-9
    ]
    outcome = {
        **light,
        "us": us,
        "feasible": all(point["feasible"] for point in us),
        "fundingGap": _funding_gap(us),
        "employerPaymentRange": {"low": min(employer_ratios), "high": max(employer_ratios)}
        if employer_ratios
        else None,
    }
    if foreign_policy is not None:
        outcome.update(
            foreign=foreign,
            foreignFeasible=all(point["feasible"] for point in foreign),
            foreignFundingGap=_funding_gap(foreign),
        )
    return outcome


def evaluate_profile(
    values: dict[str, Any],
    us_policy: Policy,
    foreign_policy: Policy | None = None,
    mode: str = "strategic",
    objective: str = "workers",
    foreign_objective: str = "prosperity",
    cohorts: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Materialize the full time series for a counterfactual policy pair."""
    prepared = PREPARED if cohorts is None or cohorts is US_COHORTS else prepare(cohorts)
    return simulate(
        normalize_inputs(values),
        us_policy,
        foreign_policy if mode == "strategic" else None,
        foreign_objective,
        prepared,
        True,
    )


simulate_profile = evaluate_profile


def solve_model(
    values: dict[str, Any] | None = None, options: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Bind normalized assumptions to evaluators used by the election solver."""
    inputs = normalize_inputs(values)
    options = options or {"mode": "us-only", "objective": "workers"}
    mode = options["mode"]
    pace = options.get("pace", 1)
    foreign_objective = options.get("foreignObjective", "prosperity")

    def evaluate(us: Policy, foreign: Policy | None = None) -> dict[str, Any]:
        return simulate(
            inputs, us, foreign if mode == "strategic" else None, foreign_objective, PREPARED, True
        )

    def evaluate_light(us: Policy, foreign: Policy | None = None) -> dict[str, Any]:
        return simulate(
            inputs, us, foreign if mode == "strategic" else None, foreign_objective, PREPARED, False
        )

    def evaluate_foreign(us: Policy, foreign: Policy) -> float:
        result = simulate(inputs, us, foreign, foreign_objective, PREPARED, False, True)
        return result["foreignScore"] if result["foreignAdmissible"] else float("-inf")

    def evaluate_light_batch(policies: list[Policy], foreign: Policy | None = None) -> list[dict[str, Any]]:
        from .batch import evaluate_us_menu

        return evaluate_us_menu(
            inputs, policies, foreign if mode == "strategic" else None, foreign_objective, evaluate_light
        )

    def evaluate_foreign_batch(us: Policy, policies: list[Policy]) -> list[float]:
        from .batch import evaluate_foreign_menu

        return evaluate_foreign_menu(inputs, us, policies, foreign_objective, evaluate_foreign)

    return {
        "inputs": inputs,
        "mode": mode,
        "effectiveMode": mode,
        "pace": pace,
        "objective": options["objective"],
        "foreignObjective": foreign_objective,
        "policies": policies_at_pace(pace, mode),
        "foreignPolicies": policies_for_mode(mode) if mode == "strategic" else [],
        "baselinePolicy": BASELINE_POLICY,
        "currentPolicy": current_policy(pace),
        "weights": list(CALIBRATION["weights"]),
        "evaluate": evaluate,
        "evaluateLight": evaluate_light,
        "evaluateForeign": evaluate_foreign,
        "evaluateLightBatch": evaluate_light_batch,
        "evaluateForeignBatch": evaluate_foreign_batch,
    }
