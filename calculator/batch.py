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

from .batch_settlement import prepare_settlement_arrays, settle_batch
from .careers import RETAINED, Careers
from .policies import checked_policy
from .population import PREPARED
from .preferences import preferences
from .trajectory import production_trajectory
from .types import Policy, Prepared

# These bounds are much larger than measured float64 disagreement. They only
# trigger exact scalar evaluation; final comparisons remain strict equality/ >.
UTILITY_RECHECK_GUARD = 1e-9
FUNDING_RECHECK_GUARD = 1e-8
DEFAULT_CHUNK_SIZE = 128


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
    """Keep only settlement fields from the shared production/trade iterator."""
    us = _policy_arrays(us_policies)
    foreign = _policy_arrays(foreign_policies) if foreign_policies is not None else None
    zero = np.zeros(len(us_policies))
    paths = []
    uc, fc = Careers(len(us_policies)), Careers(len(us_policies))
    for step in production_trajectory(inputs, us, foreign, prepared.calibration, xp=np, zero=zero):
        u = {key: step.us[key] for key in _SETTLEMENT_FIELDS}
        u["career_states"] = uc.advance(step.us["labor_state"])
        f = None
        if step.foreign is not None:
            f = {key: step.foreign[key] for key in _SETTLEMENT_FIELDS}
            f["career_states"] = fc.advance(step.foreign["labor_state"])
        paths.append(
            (
                u,
                f,
                step.us_flow,
                step.foreign_flow,
                step.us["consumer_price_index"],
                step.foreign["consumer_price_index"] if f is not None else zero + 1,
            )
        )
    return paths


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
    us_arrays = prepare_settlement_arrays(prepared, up) if not foreign_only else None
    foreign_arrays = prepare_settlement_arrays(prepared, fp) if fp is not None and not us_only else None
    if paths is None:
        paths = _production_paths(inputs, us_policies, foreign_policies, prepared)
    # Accumulate small per-year income matrices; contract them with known
    # career histories once, instead of allocating a full voter matrix yearly.
    base_utilities = np.zeros((count, len(prepared.cells)))
    career_deltas, career_masks = [], []
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
        weight = (1 + preferences().discount) ** -year
        weight_total += weight
        if not foreign_only:
            result = settle_batch(up, us, flow, prepared, us_arrays, us_price)
            base_utilities += weight * result.obsolete_utility
            career_deltas.append(weight * (result.employed_utility - result.obsolete_utility))
            career_masks.append(us["career_states"] < RETAINED)
            us_score += weight * result.worker_score
            us_funded &= result.admissible
            us_boundary = np.minimum(us_boundary, result.funding_distance)
        if foreign is not None and not us_only:
            result = settle_batch(fp, foreign, foreign_flow, prepared, foreign_arrays, foreign_price)
            score = (
                result.worker_score
                if foreign_objective == "workers"
                else result.output_score
                if foreign_objective == "output"
                else result.prosperity_score
            )
            foreign_score += weight * score
            foreign_funded &= result.admissible
            foreign_boundary = np.minimum(foreign_boundary, result.funding_distance)
    if foreign_only:
        utilities = np.empty((count, 0))
    else:
        utilities = (
            base_utilities[:, :, None]
            + np.einsum(
                "ncy,nry->ncr",
                np.stack(career_deltas, axis=2),
                np.stack(career_masks, axis=2),
            )
        ).reshape(count, -1) / weight_total
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
    if isinstance(chunk_size, bool) or not isinstance(chunk_size, int) or chunk_size < 1:
        raise ValueError("Batch size must be a positive integer.")
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
    if isinstance(chunk_size, bool) or not isinstance(chunk_size, int) or chunk_size < 1:
        raise ValueError("Batch size must be a positive integer.")
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
