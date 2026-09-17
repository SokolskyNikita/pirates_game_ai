"""Chunked NumPy evaluation of the same scalar economic model.

Only independent policies are vectorized. Years retain their original order and
weighted cohort totals use sequential accumulation, not a parallel reduction.
NumPy's logarithm may differ from libm by a few ulps. Before an election, every
candidate close to any funded cohort maximum is therefore recomputed by the
scalar reference. Foreign best-response contenders receive the same treatment.
The conservative guard selects recomputation; it never turns unequal scores into
a tie. Funding decisions close to the admissibility boundary are also scalar.

The numerical guard is an engineering bound, tested against the scalar reference
throughout the permitted parameter range. It is not a formal interval-arithmetic
proof. Public trajectories always come from the scalar reference.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from typing import Any

import numpy as np

from .config import DISCOUNT_RATE, GROWTH_BASELINE, UTILITY_OFFSET, YEARS
from .labor_market import initial_labor
from .policies import checked_policy
from .population import PREPARED
from .production import policy_burden_values, production_values
from .trade import baseline_trade, competition_displacement, trade_market, trade_retention_burden
from .types import Policy, Prepared

# These bounds are much larger than measured float64 disagreement. They only
# trigger exact scalar evaluation; final comparisons remain strict equality/ >.
UTILITY_RECHECK_GUARD = 1e-9
FUNDING_RECHECK_GUARD = 1e-8
FUNDING_THRESHOLD = 1e-7
DEFAULT_CHUNK_SIZE = 128


def _sequential_total(values: np.ndarray) -> np.ndarray:
    """Match the scalar loop's cohort order, including its initial zero."""
    return np.cumsum(values, axis=1)[:, -1]


def _policy_arrays(policies: Sequence[Policy]) -> dict[str, np.ndarray]:
    for policy in policies:
        checked_policy(policy)
    return {
        key: np.asarray([p[key] for p in policies], dtype=float)
        for key in ("pace", "replacement", "welfareScale", "laborTax", "capitalTax")
    } | {
        "formula": np.asarray([p["benefitFormula"] for p in policies]),
        "allowFreeTrade": np.asarray([p.get("allowFreeTrade", True) for p in policies], dtype=bool),
    }


def _deployment(target, pace, year, response, burden):
    progress = np.clip(pace * year / YEARS, 0, 1)
    return target * progress * (1 - response * burden * (1 - progress))


def _burden(inputs, policy, other_pace, other_strength, strength, trade, calibration):
    return policy_burden_values(
        inputs, policy, other_pace, other_strength, strength, trade, calibration, xp=np
    )


def _initial_state(count):
    return {
        "u": np.zeros(count),
        "ai_u": np.zeros(count),
        "trade_adjustment": np.zeros(count),
        "consumer_price_index": np.ones(count),
        "exposure": np.zeros(count),
        "adoption": np.zeros(count),
        "growth": np.ones(count),
        "output": np.full(count, 100.0),
        "labor_state": initial_labor(np.zeros(count)),
    }


def _produce(
    inputs,
    policy,
    old,
    adoption,
    other_adoption,
    burden,
    trade,
    year,
    calibration,
    growth_rate,
    trade_adjustment=None,
    baseline_growth=0.02,
):
    return production_values(
        inputs,
        policy,
        old,
        adoption,
        other_adoption,
        burden,
        trade,
        year,
        calibration,
        growth_rate,
        baseline_growth,
        trade_adjustment,
        xp=np,
    )


def _tax_rates(baseline, target, mean):
    baseline = baseline[None, :]
    target = target[:, None]
    lower = np.clip(baseline * target / mean, 0, 1) if mean > 0 else np.zeros_like(target * baseline)
    higher = (
        np.clip(baseline + (1 - baseline) * (target - mean) / (1 - mean), 0, 1)
        if mean < 1
        else np.ones_like(target * baseline)
    )
    return np.where(target <= mean, lower, higher)


def _settlement_arrays(prepared, policy):
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
    fields["capital_rates"] = _tax_rates(fields["capital_rate"], policy["capitalTax"], c["capitalTaxRate"])
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


def _settle(policy, production, flow, prepared, arrays, price_index=1):
    c = prepared.calibration
    capital_before = (production["capital"] + flow) * (c["marketIncome"] / 100 / price_index)
    required_employer = c["laborIncome"] * production["retained"] * policy["replacement"]
    employer_pay = np.minimum(required_employer, np.maximum(0, capital_before))
    denominator = c["laborIncome"] * production["u"]
    employer_ratio = np.divide(
        employer_pay, denominator, out=np.zeros_like(employer_pay), where=denominator > 0
    )
    capital_factor = (capital_before - employer_pay) / c["capitalIncome"]
    real_allocation = production["allocation"] / price_index
    allocation = real_allocation[:, None]
    productive = real_allocation * production["average_wage"] * production["effort"]
    work = arrays["labor"] * productive[:, None]
    retained = arrays["labor"] * employer_ratio[:, None]
    passive = arrays["passive"] * allocation
    capital = arrays["capital"] * capital_factor[:, None]
    taxable_passive = arrays["taxable_passive"] * allocation
    tax_e = np.maximum(0, work + taxable_passive) * arrays["labor_rates"]
    tax_u = np.maximum(0, retained + taxable_passive) * arrays["labor_rates"]
    tax_c = np.maximum(0, capital) * arrays["capital_rates"]
    unemployment = production["u"][:, None]
    expected_tax = (1 - unemployment) * tax_e + unemployment * tax_u
    labor_revenue = _sequential_total(arrays["weight"] * expected_tax)
    capital_revenue = _sequential_total(arrays["weight"] * tax_c)
    revenue = labor_revenue + capital_revenue
    services = np.minimum(c["nonTransferSpending"], revenue)
    required_benefits = c["benefits"] * policy["welfareScale"]
    benefits = np.minimum(required_benefits, np.maximum(0, revenue - services))
    gaps = np.stack(
        (
            required_employer - employer_pay,
            required_benefits - benefits,
            np.maximum(0, c["nonTransferSpending"] - services),
        ),
        axis=1,
    )
    admissible = np.all(gaps < FUNDING_THRESHOLD, axis=1)
    funding_distance = np.min(np.abs(gaps - FUNDING_THRESHOLD), axis=1)
    payment = benefits[:, None] * arrays["benefit_share"]
    employed_income = work + passive + capital - tax_e - tax_c + payment
    displaced_income = retained + passive + capital - tax_u - tax_c + payment
    expected = (1 - unemployment) * employed_income + unemployment * displaced_income
    prior = np.maximum(arrays["prior"], 1)
    employed_utility = np.log(
        (np.maximum(0, employed_income) / prior + UTILITY_OFFSET) / (1 + UTILITY_OFFSET)
    )
    displaced_utility = np.log(
        (np.maximum(0, displaced_income) / prior + UTILITY_OFFSET) / (1 + UTILITY_OFFSET)
    )
    utilities = (1 - unemployment) * employed_utility + unemployment * displaced_utility
    worker_income = _sequential_total(np.where(arrays["worker"], arrays["weight"] * expected, 0))
    worker_score = (
        worker_income / prepared.baseline_worker_income - 1
        if prepared.baseline_worker_income > 0
        else np.zeros_like(worker_income)
    )
    prosperity_score = _sequential_total(arrays["weight"] * utilities)
    return (
        utilities,
        worker_score,
        prosperity_score,
        production["output"] / 100 - 1,
        admissible,
        funding_distance,
    )


# Welfare level and its distribution do not affect production, prices or
# investment. Evaluate each distinct production pair once per complete menu,
# then settle every welfare package against that path in bounded cohort chunks.
_PRODUCTION_KEYS = ("pace", "replacement", "laborTax", "capitalTax", "allowFreeTrade")
_SETTLEMENT_FIELDS = ("allocation", "u", "output", "capital", "effort", "average_wage", "retained")


def _production_key(policy):
    return tuple(
        policy.get(key, True) if key == "allowFreeTrade" else policy[key] for key in _PRODUCTION_KEYS
    )


def _production_paths(inputs, us_policies, foreign_policies, prepared):
    """Calculate ten years for independent, already-deduplicated policy pairs."""
    count = len(us_policies)
    up = _policy_arrays(us_policies)
    fp = _policy_arrays(foreign_policies) if foreign_policies is not None else None
    c = prepared.calibration
    baseline_us, baseline_foreign, tradable_share = baseline_trade(inputs)
    trade_open = up["allowFreeTrade"] & fp["allowFreeTrade"] if fp is not None else False
    trade = baseline_us * trade_open if fp is not None else 0
    foreign_trade = baseline_foreign * trade_open if fp is not None else 0
    bus = _burden(
        inputs, up, fp["pace"] if fp is not None else np.zeros(count), inputs["foreignStrength"], 1, trade, c
    )
    bf = (
        _burden(inputs, fp, up["pace"], 1, inputs["foreignStrength"], foreign_trade, c)
        if fp is not None
        else None
    )
    us_state, foreign_state = _initial_state(count), _initial_state(count)
    if fp is not None:
        for state, reference in ((us_state, baseline_us), (foreign_state, baseline_foreign)):
            state["import_share"] = np.full(count, reference)
            state["export_volume"] = np.full(count, reference * 100)
            state["net_output"] = np.full(count, 100.0)
    years = []
    for year in range(1, YEARS + 1):
        annual_bus = trade_retention_burden(
            bus,
            us_state["labor_state"]["retained"],
            us_state["labor_state"]["nominal_slots"],
            us_state["consumer_price_index"],
            up["replacement"],
            c,
            xp=np,
        )
        annual_bf = (
            trade_retention_burden(
                bf,
                foreign_state["labor_state"]["retained"],
                foreign_state["labor_state"]["nominal_slots"],
                foreign_state["consumer_price_index"],
                fp["replacement"],
                c,
                xp=np,
            )
            if fp is not None
            else None
        )
        adopt_us = np.maximum(
            us_state["adoption"],
            _deployment(1, up["pace"], year, inputs["investmentResponse"], annual_bus),
        )
        adopt_foreign = (
            np.maximum(
                foreign_state["adoption"],
                _deployment(
                    inputs["foreignStrength"], fp["pace"], year, inputs["investmentResponse"], annual_bf
                ),
            )
            if fp is not None
            else np.zeros(count)
        )
        us = _produce(
            inputs,
            up,
            us_state,
            adopt_us,
            adopt_foreign,
            annual_bus,
            trade,
            year,
            c,
            inputs["usAiGrowth"],
            baseline_growth=GROWTH_BASELINE["us"],
        )
        foreign = (
            _produce(
                inputs,
                fp,
                foreign_state,
                adopt_foreign,
                adopt_us,
                annual_bf,
                foreign_trade,
                year,
                c,
                inputs["foreignAiGrowth"],
                baseline_growth=GROWTH_BASELINE["foreign"],
            )
            if fp is not None
            else None
        )
        flow = foreign_flow = np.zeros(count)
        us_price = foreign_price = np.ones(count)
        if foreign is not None:
            first_market = trade_market(inputs, up, fp, us, foreign, xp=np)
            us_adjustment = competition_displacement(
                us_state["trade_adjustment"],
                first_market["usImportShare"],
                first_market["usExportVolume"],
                us_state["import_share"],
                us_state["export_volume"],
                us_state["net_output"],
                tradable_share,
                xp=np,
            )
            foreign_adjustment = competition_displacement(
                foreign_state["trade_adjustment"],
                first_market["foreignImportShare"],
                first_market["foreignExportVolume"],
                foreign_state["import_share"],
                foreign_state["export_volume"],
                foreign_state["net_output"],
                tradable_share,
                xp=np,
            )
            us = _produce(
                inputs,
                up,
                us_state,
                adopt_us,
                adopt_foreign,
                annual_bus,
                trade,
                year,
                c,
                inputs["usAiGrowth"],
                us_adjustment,
                GROWTH_BASELINE["us"],
            )
            foreign = _produce(
                inputs,
                fp,
                foreign_state,
                adopt_foreign,
                adopt_us,
                annual_bf,
                foreign_trade,
                year,
                c,
                inputs["foreignAiGrowth"],
                foreign_adjustment,
                GROWTH_BASELINE["foreign"],
            )
            market = trade_market(inputs, up, fp, us, foreign, xp=np)
            flow, foreign_flow = market["usFlow"], market["foreignFlow"]
            us_price, foreign_price = market["usPriceIndex"], market["foreignPriceIndex"]
            us["consumer_price_index"] = us_price
            foreign["consumer_price_index"] = foreign_price
            us["import_share"], us["export_volume"] = market["usImportShare"], market["usExportVolume"]
            us["net_output"] = us["output"] - us["investment"] - us["adjustment"]
            foreign["import_share"], foreign["export_volume"] = (
                market["foreignImportShare"],
                market["foreignExportVolume"],
            )
            foreign["net_output"] = foreign["output"] - foreign["investment"] - foreign["adjustment"]
        us.setdefault("consumer_price_index", us_price)
        years.append(
            (
                {key: us[key] for key in _SETTLEMENT_FIELDS},
                {key: foreign[key] for key in _SETTLEMENT_FIELDS} if foreign is not None else None,
                flow,
                foreign_flow,
                us_price,
                foreign_price,
            )
        )
        if foreign is not None:
            foreign_state = foreign
        us_state = us
    return years


def _menu_production_paths(inputs, us_policies, foreign_policies, prepared):
    """Map all ballot rows to their shared economic trajectory."""
    unique_us, unique_foreign, indices, by_pair = [], [], [], {}
    for index, us in enumerate(us_policies):
        foreign = foreign_policies[index] if foreign_policies is not None else None
        key = (_production_key(us), _production_key(foreign) if foreign is not None else None)
        if key not in by_pair:
            by_pair[key] = len(unique_us)
            unique_us.append(us)
            if foreign is not None:
                unique_foreign.append(foreign)
        indices.append(by_pair[key])
    paths = _production_paths(
        inputs, unique_us, unique_foreign if foreign_policies is not None else None, prepared
    )
    return paths, np.asarray(indices, dtype=np.intp)


def _evaluate_chunk(
    inputs,
    us_policies,
    foreign_policies,
    foreign_objective,
    prepared,
    foreign_only=False,
    *,
    us_only=False,
    paths=None,
    rows=None,
):
    """Settle a bounded cohort matrix using reused or directly calculated paths."""
    count = len(us_policies)
    up = _policy_arrays(us_policies)
    fp = _policy_arrays(foreign_policies) if foreign_policies is not None else None
    us_arrays = _settlement_arrays(prepared, up) if not foreign_only else None
    foreign_arrays = _settlement_arrays(prepared, fp) if fp is not None and not us_only else None
    if paths is None:
        paths = _production_paths(inputs, us_policies, foreign_policies, prepared)
    utilities = np.zeros((count, len(prepared.cells)))
    us_score, foreign_score = np.zeros(count), np.zeros(count)
    us_funded, foreign_funded = np.ones(count, dtype=bool), np.ones(count, dtype=bool)
    us_boundary, foreign_boundary = np.full(count, np.inf), np.full(count, np.inf)
    weight_total = 0
    for year, path in enumerate(paths, start=1):
        us, foreign, flow, foreign_flow, us_price, foreign_price = path
        if rows is not None:
            us = {key: values[rows] for key, values in us.items()}
            foreign = {key: values[rows] for key, values in foreign.items()} if foreign is not None else None
            flow, foreign_flow, us_price, foreign_price = (
                values[rows] for values in (flow, foreign_flow, us_price, foreign_price)
            )
        weight = (1 + DISCOUNT_RATE) ** -year
        weight_total += weight
        if not foreign_only:
            result = _settle(up, us, flow, prepared, us_arrays, us_price)
            utilities += weight * result[0]
            us_score += weight * result[1]
            us_funded &= result[4]
            us_boundary = np.minimum(us_boundary, result[5])
        if foreign is not None and not us_only:
            result = _settle(fp, foreign, foreign_flow, prepared, foreign_arrays, foreign_price)
            score = result[1 if foreign_objective == "workers" else 3 if foreign_objective == "output" else 2]
            foreign_score += weight * score
            foreign_funded &= result[4]
            foreign_boundary = np.minimum(foreign_boundary, result[5])
    utilities /= weight_total
    us_score /= weight_total
    foreign_score /= weight_total
    profiles = []
    for index, policy in enumerate(us_policies):
        profile = {
            "id": policy["id"]
            + "::"
            + (foreign_policies[index]["id"] if foreign_policies is not None else "none"),
            "usPolicy": policy,
            # Internal ballot evaluation retains compact numeric row views.
            # Public trajectories are scalar-materialized before JSON encoding.
            "usUtilities": utilities[index],
            "usScore": float(us_score[index]),
            "usAdmissible": bool(us_funded[index]),
        }
        if foreign_policies is not None:
            profile["foreignPolicy"] = foreign_policies[index]
            if not us_only:
                profile.update(
                    foreignScore=float(foreign_score[index]),
                    foreignAdmissible=bool(foreign_funded[index]),
                )
        profiles.append(profile)
    return profiles, us_boundary, foreign_boundary


def evaluate_us_menu(
    inputs: dict,
    policies: Sequence[Policy],
    foreign: Policy | None,
    foreign_objective: str,
    scalar: Callable,
    *,
    prepared: Prepared = PREPARED,
    chunk_size: int = DEFAULT_CHUNK_SIZE,
) -> list[dict[str, Any]]:
    """Evaluate a full ballot and scalar-certify all possible favorite choices."""
    if chunk_size < 1:
        raise ValueError("Batch size must be positive.")
    profiles, checked = [], set()
    foreign_menu = [foreign] * len(policies) if foreign is not None else None
    paths, rows = _menu_production_paths(inputs, policies, foreign_menu, prepared)
    for start in range(0, len(policies), chunk_size):
        chunk = policies[start : start + chunk_size]
        values, boundaries, _ = _evaluate_chunk(
            inputs,
            chunk,
            [foreign] * len(chunk) if foreign is not None else None,
            foreign_objective,
            prepared,
            paths=paths,
            rows=rows[start : start + len(chunk)],
            us_only=True,
        )
        for offset, boundary in enumerate(boundaries):
            if boundary <= FUNDING_RECHECK_GUARD:
                values[offset] = scalar(chunk[offset], foreign)
                checked.add(start + offset)
        profiles.extend(values)
    eligible = [index for index, profile in enumerate(profiles) if profile["usAdmissible"]]
    if eligible:
        matrix = np.asarray([profiles[index]["usUtilities"] for index in eligible])
        maxima = np.max(matrix, axis=0)
        contenders = np.any(matrix >= maxima - UTILITY_RECHECK_GUARD, axis=1)
        for index in (eligible[position] for position in np.flatnonzero(contenders)):
            if index not in checked:
                profiles[index] = scalar(policies[index], foreign)
    return profiles


def evaluate_foreign_menu(
    inputs: dict,
    us: Policy,
    policies: Sequence[Policy],
    foreign_objective: str,
    scalar: Callable,
    *,
    prepared: Prepared = PREPARED,
    chunk_size: int = DEFAULT_CHUNK_SIZE,
) -> list[float]:
    """Evaluate foreign choices, certifying every possible best response."""
    if chunk_size < 1:
        raise ValueError("Batch size must be positive.")
    scores, checked = [], set()
    paths, rows = _menu_production_paths(inputs, [us] * len(policies), policies, prepared)
    for start in range(0, len(policies), chunk_size):
        chunk = policies[start : start + chunk_size]
        profiles, _, boundaries = _evaluate_chunk(
            inputs,
            [us] * len(chunk),
            chunk,
            foreign_objective,
            prepared,
            True,
            paths=paths,
            rows=rows[start : start + len(chunk)],
        )
        for offset, profile in enumerate(profiles):
            score = profile["foreignScore"] if profile["foreignAdmissible"] else -math.inf
            if boundaries[offset] <= FUNDING_RECHECK_GUARD:
                score = scalar(us, chunk[offset])
                checked.add(start + offset)
            scores.append(score)
    maximum = max(scores, default=-math.inf)
    if math.isfinite(maximum):
        for index, score in enumerate(scores):
            if score >= maximum - UTILITY_RECHECK_GUARD and index not in checked:
                scores[index] = scalar(us, policies[index])
    return scores
