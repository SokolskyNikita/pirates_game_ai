"""Assemble a compact, JSON-safe scenario from the economic and voting models."""

from __future__ import annotations

from typing import Any

from .election import solve_package_election
from .model import solve_model
from .policies import BASELINE_POLICY, POLICIES, current_policy


def scenario_settings(request: dict[str, Any]) -> tuple[str, str, bool]:
    """Validate public scenario selectors shared by simulations and comparisons."""
    mode = request.get("mode", "us-only")
    objective = request.get("foreignObjective", "prosperity")
    pause_unavailable = request.get("pauseUnavailable", False)
    if mode not in ("us-only", "strategic"):
        raise ValueError("The scenario mode must be us-only or strategic.")
    if objective not in ("workers", "prosperity", "output"):
        raise ValueError("The foreign objective must be workers, prosperity, or output.")
    if not isinstance(pause_unavailable, bool):
        raise ValueError("pauseUnavailable must be a boolean.")
    return mode, objective, pause_unavailable


def solve_scenario(request: dict[str, Any]) -> dict[str, Any]:
    """Evaluate every permitted package; materialize only displayed trajectories.

    Old links may contain a pace field. It is deliberately ignored: deployment
    belongs on the complete ballot, not in the scenario assumptions.
    """
    mode, foreign_objective, pause_unavailable = scenario_settings(request)
    model = solve_model(
        request.get("inputs", {}),
        {
            "mode": mode,
            "objective": "workers",
            "foreignObjective": foreign_objective,
            "pace": 1,
        },
    )
    policies = [policy for policy in POLICIES if not pause_unavailable or policy["pace"] != 0]
    foreign_policies = [
        policy for policy in model["foreignPolicies"] if not pause_unavailable or policy["pace"] != 0
    ]
    election = solve_package_election(
        {
            **model,
            "policies": policies,
            "foreignPolicies": foreign_policies,
            "currentPolicy": current_policy(1),
        }
    )
    cache: dict[str, dict[str, Any]] = {}

    def materialize(policy: dict[str, Any]) -> dict[str, Any]:
        foreign = election.get("foreignPolicy")
        key = policy["id"] + "::" + (foreign["id"] if foreign else "none")
        if key not in cache:
            cache[key] = model["evaluate"](policy, foreign)
        return cache[key]

    by_id = {policy["id"]: policy for policy in policies}
    ranked = sorted(
        election["ballot"]["tallies"], key=lambda tally: (-tally["supportPercent"], tally["policyId"])
    )
    selected = materialize(election["usPolicy"])
    alternatives = [materialize(by_id[tally["policyId"]]) for tally in ranked[:8]]
    result = {
        "inputs": model["inputs"],
        "mode": model["mode"],
        "foreignObjective": model["foreignObjective"],
        "pauseUnavailable": pause_unavailable,
        "selected": selected,
        "statusQuo": materialize(current_policy(1)),
        "baseline": model["evaluate"](BASELINE_POLICY, BASELINE_POLICY if mode == "strategic" else None),
        "alternatives": alternatives,
        "ballot": election["ballot"],
        "selection": election["selection"],
        "policyCount": len(policies),
        "foreignPolicyCount": len(foreign_policies),
        "evaluations": election["evaluations"],
        "search": election["search"],
    }
    if alternatives:
        result["leading"] = alternatives[0]
    for key in ("foreignBestPolicy", "foreignBestResponseGain"):
        if key in election:
            result[key] = election[key]
    return result
