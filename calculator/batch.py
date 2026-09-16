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

from .config import CAPACITY_RENEWAL_RATE, DISCOUNT_RATE, UTILITY_OFFSET, YEARS
from .policies import checked_policy
from .population import PREPARED
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
    } | {"formula": np.asarray([p["benefitFormula"] for p in policies])}


def _deployment(target, pace, year, response, burden):
    progress = np.clip(pace * year / YEARS, 0, 1)
    return target * progress * (1 - response * burden * (1 - progress))


def _exposure(pace, adoption, other_adoption, trade, progress):
    return np.where(
        pace == 0,
        0,
        np.clip(adoption + trade * np.clip(progress, 0, 1) * other_adoption * (1 - adoption), 0, 1),
    )


def _burden(inputs, policy, other_pace, other_strength, strength, trade, calibration):
    affected = np.zeros_like(policy["pace"])
    previous = np.zeros_like(affected)
    for year in range(1, YEARS + 1):
        own = _deployment(strength, np.where(policy["pace"] == 0, 0, 1), year, 0, 0)
        other = _deployment(other_strength, np.where(other_pace == 0, 0, 1), year, 0, 0)
        exposure = _exposure(policy["pace"], own, other, trade, year / YEARS)
        affected = affected * (1 - inputs["reemployment"]) + inputs["displacement"] * np.maximum(
            0, exposure - previous
        )
        previous = exposure
    retained = np.clip(
        calibration["laborIncome"] * affected * policy["replacement"] / calibration["capitalIncome"], 0, 1
    )
    shift = policy["capitalTax"] - calibration["capitalTaxRate"]
    return np.clip(shift + (1 - np.maximum(0, shift)) * retained, -1, 1)


def _initial_state(count):
    return {
        "u": np.zeros(count),
        "exposure": np.zeros(count),
        "adoption": np.zeros(count),
        "growth": np.ones(count),
        "output": np.full(count, 100.0),
    }


def _produce(inputs, policy, old, adoption, other_adoption, burden, trade, year, calibration, growth_rate):
    exposure = _exposure(policy["pace"], adoption, other_adoption, trade, policy["pace"] * year / YEARS)
    delta = np.maximum(0, exposure - old["exposure"])
    delta_adoption = np.maximum(0, adoption - old["adoption"])
    newly = inputs["displacement"] * delta
    reemployed = old["u"] * inputs["reemployment"]
    unemployment = np.clip(old["u"] - reemployed + newly, 0, 1)
    effort = np.clip(
        1 - inputs["investmentResponse"] * (policy["laborTax"] - calibration["laborTaxRate"]), 0, 1.5
    )
    capacity = np.clip(
        1 - inputs["investmentResponse"] * burden * (1 - (1 - CAPACITY_RENEWAL_RATE) ** year), 0, 1.5
    )
    labor_share = calibration["laborIncome"] / calibration["marketIncome"] * 100
    passive_share = calibration["passiveIncome"] / calibration["marketIncome"] * 100
    growth = old["growth"] * (1 + growth_rate * exposure)
    output = capacity * growth * (100 + labor_share * (1 - unemployment) * (effort - 1))
    raw_claims = (
        100
        + labor_share * (1 - unemployment) * (effort - 1)
        + inputs["productivityGain"] * labor_share * unemployment
    )
    allocation = output / raw_claims
    labor = allocation * labor_share * (1 - unemployment) * effort
    passive = allocation * passive_share
    investment = 12 * delta_adoption + 40 * delta_adoption**2
    adjustment = 0.5 * labor_share * newly
    capital = output - labor - passive - investment - adjustment
    return {
        "allocation": allocation,
        "growth": growth,
        "adoption": adoption,
        "exposure": exposure,
        "u": unemployment,
        "output": output,
        "capital": capital,
        "effort": effort,
        "rents": np.maximum(0, capital - (100 - labor_share - passive_share) * allocation),
    }


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


def _settle(policy, production, flow, prepared, arrays):
    c = prepared.calibration
    capital_before = (production["capital"] + flow) * (c["marketIncome"] / 100)
    required_employer = c["laborIncome"] * production["u"] * policy["replacement"]
    employer_pay = np.minimum(required_employer, np.maximum(0, capital_before))
    denominator = c["laborIncome"] * production["u"]
    employer_ratio = np.divide(
        employer_pay, denominator, out=np.zeros_like(employer_pay), where=denominator > 0
    )
    capital_factor = (capital_before - employer_pay) / c["capitalIncome"]
    allocation = production["allocation"][:, None]
    productive = production["allocation"] * production["effort"]
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


def _evaluate_chunk(inputs, us_policies, foreign_policies, foreign_objective, prepared, foreign_only=False):
    count = len(us_policies)
    up = _policy_arrays(us_policies)
    fp = _policy_arrays(foreign_policies) if foreign_policies is not None else None
    c = prepared.calibration
    trade = inputs["tradeIntensity"] if fp is not None else 0
    bus = _burden(
        inputs, up, fp["pace"] if fp is not None else np.zeros(count), inputs["foreignStrength"], 1, trade, c
    )
    bf = (
        _burden(inputs, fp, up["pace"], 1, inputs["foreignStrength"], inputs["foreignTradeIntensity"], c)
        if fp is not None
        else None
    )
    us_arrays = _settlement_arrays(prepared, up) if not foreign_only else None
    foreign_arrays = _settlement_arrays(prepared, fp) if fp is not None else None
    us_state, foreign_state = _initial_state(count), _initial_state(count)
    utilities = np.zeros((count, len(prepared.cells)))
    us_score, foreign_score = np.zeros(count), np.zeros(count)
    us_funded, foreign_funded = np.ones(count, dtype=bool), np.ones(count, dtype=bool)
    us_boundary, foreign_boundary = np.full(count, np.inf), np.full(count, np.inf)
    weight_total = 0
    # math.exp matches the scalar reference exactly and is only called once per
    # policy. The expensive yearly/cohort work remains vectorized.
    own_attractiveness = np.asarray([math.exp(-4 * inputs["capitalMobility"] * value) for value in bus])
    foreign_attractiveness = (
        np.asarray([math.exp(-4 * inputs["capitalMobility"] * value) for value in bf])
        if fp is not None
        else None
    )
    for year in range(1, YEARS + 1):
        adopt_us = _deployment(1, up["pace"], year, inputs["investmentResponse"], bus)
        adopt_foreign = (
            _deployment(inputs["foreignStrength"], fp["pace"], year, inputs["investmentResponse"], bf)
            if fp is not None
            else np.zeros(count)
        )
        us = _produce(
            inputs, up, us_state, adopt_us, adopt_foreign, bus, trade, year, c, inputs["usGdpGrowth"]
        )
        foreign = (
            _produce(
                inputs,
                fp,
                foreign_state,
                adopt_foreign,
                adopt_us,
                bf,
                inputs["foreignTradeIntensity"],
                year,
                c,
                inputs["foreignGdpGrowth"],
            )
            if fp is not None
            else None
        )
        flow = np.zeros(count)
        if foreign is not None:
            mobile = 0.6 * inputs["capitalMobility"] * inputs["foreignStrength"]
            total = mobile * (us["rents"] + inputs["foreignMarketSize"] * foreign["rents"])
            own = (0.15 + adopt_us) * own_attractiveness
            other = (
                inputs["foreignMarketSize"]
                * inputs["foreignStrength"]
                * (0.15 + adopt_foreign)
                * foreign_attractiveness
            )
            flow = total * own / (own + other) - mobile * us["rents"]
        weight = (1 + DISCOUNT_RATE) ** -year
        weight_total += weight
        if not foreign_only:
            result = _settle(up, us, flow, prepared, us_arrays)
            utilities += weight * result[0]
            us_score += weight * result[1]
            us_funded &= result[4]
            us_boundary = np.minimum(us_boundary, result[5])
        if foreign is not None:
            result = _settle(fp, foreign, -flow / inputs["foreignMarketSize"], prepared, foreign_arrays)
            score = result[1 if foreign_objective == "workers" else 3 if foreign_objective == "output" else 2]
            foreign_score += weight * score
            foreign_funded &= result[4]
            foreign_boundary = np.minimum(foreign_boundary, result[5])
            foreign_state = foreign
        us_state = us
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
            "usUtilities": utilities[index].tolist(),
            "usScore": float(us_score[index]),
            "usAdmissible": bool(us_funded[index]),
        }
        if foreign_policies is not None:
            profile.update(
                foreignPolicy=foreign_policies[index],
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
    for start in range(0, len(policies), chunk_size):
        chunk = policies[start : start + chunk_size]
        values, boundaries, _ = _evaluate_chunk(
            inputs,
            chunk,
            [foreign] * len(chunk) if foreign is not None else None,
            foreign_objective,
            prepared,
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
    for start in range(0, len(policies), chunk_size):
        chunk = policies[start : start + chunk_size]
        profiles, _, boundaries = _evaluate_chunk(
            inputs, [us] * len(chunk), chunk, foreign_objective, prepared, True
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
