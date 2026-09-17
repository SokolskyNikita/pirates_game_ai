"""Counterfactual profiles and pairwise preference shares for the results view."""

from __future__ import annotations

import math
from collections.abc import Sequence
from typing import Any

from .model import evaluate_profile
from .policies import policy_by_id
from .population import CALIBRATION
from .simulation import scenario_settings


def count_votes(
    challenger: Sequence[float],
    incumbent: Sequence[float],
    weights: Sequence[float] | None = None,
) -> float:
    """Return the adult population share strictly preferring the challenger.

    This pairwise diagnostic is not the first-choice share in the full ballot.
    Income never changes voting weight; indifference favors the incumbent.
    """
    if weights is None:
        weights = CALIBRATION["weights"]
    if not len(weights):
        raise ValueError("An electorate needs at least one population cell.")
    total = 0.0
    for weight in weights:
        if not math.isfinite(weight) or weight < 0:
            raise ValueError("Population weights must be finite and nonnegative.")
        total += weight
    if not math.isfinite(total) or total <= 0:
        raise ValueError("The electorate needs a finite, positive total population.")
    if len(challenger) != len(weights) or len(incumbent) != len(weights):
        raise ValueError("Every policy must retain the same population cells.")
    votes = 0.0
    for candidate, current, weight in zip(challenger, incumbent, weights, strict=True):
        if not math.isfinite(candidate) or not math.isfinite(current):
            raise ValueError("Every voter utility must be finite.")
        if candidate > current:
            votes += weight / total * 100
    return min(100, max(0, votes))


def compare_policy(request: dict[str, Any]) -> dict[str, Any]:
    """Evaluate one manual package against the selected package at fixed foreign policy.

    An underfunded manual package may be inspected, with funding status returned
    in its profile. Inspection does not make that package eligible for a vote.
    """
    scenario = request.get("scenario")
    if not isinstance(scenario, dict):
        raise ValueError("A comparison needs its scenario settings.")
    mode, foreign_objective, pause_unavailable = scenario_settings(scenario)

    def policy_for(key: str) -> dict[str, Any]:
        return policy_by_id(request.get(key), mode, pause_unavailable)

    policy = policy_for("policyId")
    selected = policy_for("selectedPolicyId")
    if mode == "strategic":
        foreign = policy_for("foreignPolicyId")
    else:
        if request.get("foreignPolicyId") is not None:
            raise ValueError("A US-only comparison cannot include a foreign policy.")
        foreign = None
    inputs = scenario.get("inputs", {})
    profile = evaluate_profile(inputs, policy, foreign, mode, "workers", foreign_objective)
    reference = (
        profile
        if policy["id"] == selected["id"]
        else evaluate_profile(inputs, selected, foreign, mode, "workers", foreign_objective)
    )
    return {
        "profile": profile,
        "voteShare": count_votes(profile["usUtilities"], reference["usUtilities"]),
    }
