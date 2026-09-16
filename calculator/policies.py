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
    pace_label = PACE_LABELS.get(pace, f"{_number(pace)}× AI pace")
    retention_label = f"Retain at {_rounded_percent(replacement)}%" if replacement else "Allow layoffs"
    label = (
        f"{pace_label} · {retention_label} · benefits {_number(welfare * 100)}% · {formula}"
        f" · noncapital {_rounded_percent(labor_tax, 1)}%"
        f" / investment {_rounded_percent(capital_tax, 1)}% tax"
    )
    return {**values, "id": identifier, "label": label}


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


def policies_at_pace(pace: float = 1) -> list[Policy]:
    if not any(abs(candidate - pace) < 1e-9 for candidate in PACE_CHOICES):
        raise ValueError("AI pace must be 0 (pause), 1 (current) or 2 (accelerated).")
    return [policy for policy in POLICIES if abs(policy["pace"] - pace) < 1e-9]


def current_policy(pace: float = 1) -> Policy:
    return make_policy({**BASELINE_POLICY, "pace": pace})


def checked_policy(policy: Policy) -> None:
    fields = ["pace", "replacement", "welfareScale", "laborTax", "capitalTax"]
    limits = [(0, 2), (0, 1.25), (0, 2), (0, 1), (0, 1)]
    if (
        any(
            not math.isfinite(policy[field]) or not low <= policy[field] <= high
            for field, (low, high) in zip(fields, limits, strict=True)
        )
        or policy["benefitFormula"] not in BENEFIT_FORMULAS
    ):
        raise ValueError("Invalid policy.")
