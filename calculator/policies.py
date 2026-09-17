"""Complete policy packages, their stable identifiers, and admissible ranges."""

from __future__ import annotations

import math
from itertools import product
from typing import Any

from .config import clamp
from .population import CALIBRATION
from .types import Policy


def _unique_rates(values: list[float]) -> list[float]:
    result = []
    for value in values:
        value = clamp(value)
        if all(abs(previous - value) >= 1e-12 for previous in result):
            result.append(value)
    return result


def _tax_choices(mean: float) -> list[float]:
    return _unique_rates([0, mean - 0.1, mean, mean + 0.1, mean + 0.3, 1])


LABOR_TAX_CHOICES = _tax_choices(CALIBRATION["laborTaxRate"])
CAPITAL_TAX_CHOICES = _tax_choices(CALIBRATION["capitalTaxRate"])
RETENTION_CHOICES = [0, 0.5, 1, 1.25]
WELFARE_CHOICES = [0, 0.5, 1, 1.5, 2]
BENEFIT_FORMULAS = ["current", "flat", "prior-income"]
PACE_CHOICES = [0, 1, 2]
PACE_LABELS = {0: "Pause AI", 1: "Allow current AI pace", 2: "Accelerate AI"}


def _number(value: float) -> str:
    """Match JavaScript number strings for the policy grid's finite values."""
    if math.isnan(value):
        return "NaN"
    if math.isinf(value):
        return "Infinity" if value > 0 else "-Infinity"
    return str(int(value)) if value == int(value) else repr(value)


def _rounded_percent(value: float, decimals: int = 0) -> str:
    if not math.isfinite(value):
        return _number(value)
    factor = 10**decimals
    return _number(math.floor(value * 100 * factor + 0.5) / factor)


def make_policy(values: dict[str, Any]) -> Policy:
    pace = values["pace"]
    replacement = values["replacement"]
    welfare = values["welfareScale"]
    formula = values["benefitFormula"]
    labor_tax = values["laborTax"]
    capital_tax = values["capitalTax"]
    free_trade = values.get("allowFreeTrade", True)
    if not isinstance(free_trade, bool):
        raise ValueError("allowFreeTrade must be a boolean.")
    identifier = "|".join(
        [
            _number(pace),
            _number(replacement),
            _number(welfare),
            formula,
            _number(labor_tax),
            _number(capital_tax),
        ]
    )
    if not free_trade:
        identifier += "|closed"
    pace_label = PACE_LABELS.get(pace, f"{_number(pace)}× AI pace")
    retention_label = f"Retain at {_rounded_percent(replacement)}%" if replacement else "Allow layoffs"
    label = (
        f"{pace_label} · {retention_label} · benefits {_number(welfare * 100)}% · {formula}"
        f" · noncapital {_rounded_percent(labor_tax, 1)}%"
        f" / investment {_rounded_percent(capital_tax, 1)}% tax"
    )
    if not free_trade:
        label += " · Ban US–world trade"
    return {**values, "allowFreeTrade": free_trade, "id": identifier, "label": label}


POLICIES = [
    make_policy(
        dict(
            zip(
                ["pace", "replacement", "welfareScale", "benefitFormula", "laborTax", "capitalTax"],
                values,
                strict=True,
            )
        )
    )
    for values in product(
        PACE_CHOICES,
        RETENTION_CHOICES,
        WELFARE_CHOICES,
        BENEFIT_FORMULAS,
        LABOR_TAX_CHOICES,
        CAPITAL_TAX_CHOICES,
    )
]
# Domestic calculations retain the original menu. International packages add a
# separate trade vote; open-trade identifiers remain compatible with old links.
INTERNATIONAL_POLICIES = POLICIES + [make_policy({**policy, "allowFreeTrade": False}) for policy in POLICIES]
_POLICIES_BY_MODE = {
    "us-only": {policy["id"]: policy for policy in POLICIES},
    "strategic": {policy["id"]: policy for policy in INTERNATIONAL_POLICIES},
}


BASELINE_POLICY = make_policy(
    {
        "pace": 0,
        "replacement": 0,
        "welfareScale": 1,
        "benefitFormula": "current",
        "laborTax": CALIBRATION["laborTaxRate"],
        "capitalTax": CALIBRATION["capitalTaxRate"],
    }
)


def policies_for_mode(mode: str, pause_unavailable: bool = False) -> list[Policy]:
    """Offer a trade choice only when the other region participates in the game."""
    if mode not in ("us-only", "strategic"):
        raise ValueError("The scenario mode must be us-only or strategic.")
    if not isinstance(pause_unavailable, bool):
        raise ValueError("pauseUnavailable must be a boolean.")
    menu = POLICIES if mode == "us-only" else INTERNATIONAL_POLICIES
    return [policy for policy in menu if not pause_unavailable or policy["pace"] != 0]


def policy_by_id(identifier: str, mode: str, pause_unavailable: bool = False) -> Policy:
    """Validate an identifier against the same menu used in that scenario's vote."""
    if mode not in ("us-only", "strategic"):
        raise ValueError("The scenario mode must be us-only or strategic.")
    if not isinstance(identifier, str):
        raise ValueError("The policy ID must identify a policy on the complete menu.")
    policy = _POLICIES_BY_MODE[mode].get(identifier)
    if policy is None:
        raise ValueError("The policy ID must identify a policy on this scenario's complete menu.")
    if pause_unavailable and policy["pace"] == 0:
        raise ValueError("Pause AI is unavailable in this scenario.")
    return policy


def policies_at_pace(pace: float = 1, mode: str = "us-only") -> list[Policy]:
    if not any(abs(candidate - pace) < 1e-9 for candidate in PACE_CHOICES):
        raise ValueError("AI pace must be 0 (pause), 1 (current) or 2 (accelerated).")
    return [policy for policy in policies_for_mode(mode) if abs(policy["pace"] - pace) < 1e-9]


def current_policy(pace: float = 1) -> Policy:
    return make_policy({**BASELINE_POLICY, "pace": pace})


def checked_policy(policy: Policy) -> None:
    fields = ["pace", "replacement", "welfareScale", "laborTax", "capitalTax"]
    limits = [(0, 2), (0, 1.25), (0, 2), (0, 1), (0, 1)]
    if (
        any(
            isinstance(policy.get(field), bool)
            or not isinstance(policy.get(field), (int, float))
            or not math.isfinite(policy[field])
            or not low <= policy[field] <= high
            for field, (low, high) in zip(fields, limits, strict=True)
        )
        or policy["benefitFormula"] not in BENEFIT_FORMULAS
        or not isinstance(policy.get("allowFreeTrade", True), bool)
    ):
        raise ValueError("Invalid policy.")
