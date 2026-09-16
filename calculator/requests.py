"""Validation at the API boundary; economic normalization stays in the model."""

from __future__ import annotations

import math
from typing import Any

from .config import INPUT_SPECS, normalize_inputs
from .policies import policy_by_id

MODES = {"us-only", "strategic"}
OBJECTIVES = {"workers", "prosperity", "output"}


def scenario_request(value: Any) -> dict:
    """Validate untrusted JSON without silently accepting nonnumeric assumptions."""
    if not isinstance(value, dict):
        raise ValueError("The request must be a JSON object.")
    mode = value.get("mode", "us-only")
    objective = value.get("foreignObjective", "prosperity")
    if not isinstance(mode, str) or mode not in MODES:
        raise ValueError("Choose US-only or international mode.")
    if not isinstance(objective, str) or objective not in OBJECTIVES:
        raise ValueError("Choose workers' incomes, prosperity or output.")
    pause = value.get("pauseUnavailable", False)
    if not isinstance(pause, bool):
        raise ValueError("pauseUnavailable must be true or false.")
    supplied = value.get("inputs", {})
    if not isinstance(supplied, dict):
        raise ValueError("inputs must be an object.")
    allowed = {spec["key"] for spec in INPUT_SPECS}
    if set(supplied) - allowed:
        raise ValueError("The request contains an unknown assumption.")
    for key, number in supplied.items():
        try:
            finite = (
                not isinstance(number, bool) and isinstance(number, (int, float)) and math.isfinite(number)
            )
        except OverflowError:
            finite = False
        if not finite:
            raise ValueError(f"{key} must be a finite number.")
    identifier = value.get("id", 0)
    if isinstance(identifier, bool) or not isinstance(identifier, int) or abs(identifier) > 2**53 - 1:
        raise ValueError("The request ID must be a safe integer.")
    return {
        "id": identifier,
        "inputs": normalize_inputs(supplied),
        "mode": mode,
        "foreignObjective": objective,
        "pauseUnavailable": pause,
    }


def comparison_request(value: Any) -> dict:
    """Only policies from the published finite menu can be compared."""
    if not isinstance(value, dict):
        raise ValueError("The request must be a JSON object.")
    scenario = scenario_request(value.get("scenario", {}))
    result = {"scenario": scenario}
    for key in ("policyId", "selectedPolicyId"):
        if not isinstance(value.get(key), str) or not value[key] or len(value[key]) > 200:
            raise ValueError(f"{key} must identify an available policy.")
        result[key] = value[key]
    foreign = value.get("foreignPolicyId")
    if foreign is not None:
        if not isinstance(foreign, str) or not foreign or len(foreign) > 200:
            raise ValueError("foreignPolicyId must identify an available policy.")
        result["foreignPolicyId"] = foreign
    if scenario["mode"] == "strategic" and not foreign:
        raise ValueError("An international comparison requires the selected foreign policy.")
    if scenario["mode"] == "us-only" and foreign is not None:
        raise ValueError("A US-only comparison cannot include a foreign policy.")
    for key in ("policyId", "selectedPolicyId", "foreignPolicyId"):
        if key not in result:
            continue
        policy_by_id(result[key], scenario["mode"], scenario["pauseUnavailable"])
    return result
