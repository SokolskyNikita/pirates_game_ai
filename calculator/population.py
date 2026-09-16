"""Survey-weighted adult-citizen cohorts and baseline fiscal calibration."""

from __future__ import annotations

import json
import math
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from .types import Cell, Prepared

_DATA_PATH = Path(__file__).parent / "data" / "us-electorate-data.json"
_DATA = json.loads(_DATA_PATH.read_text())
US_COHORTS = _DATA["cohorts"]
US_ELECTORATE = _DATA["metadata"]
BASELINE_LABOR_TAX_RATE = US_ELECTORATE["baselineLaborTaxRate"]
BASELINE_CAPITAL_TAX_RATE = US_ELECTORATE["baselineCapitalTaxRate"]


def ordered_sum(values: Iterable[float]) -> float:
    """Accumulate left to right, matching the original binary64 contract."""
    result = 0.0
    for value in values:
        result += value
    return result


def prepare(cohorts: list[dict[str, Any]]) -> Prepared:
    """Normalize citizen weights and close the observed baseline budget.

    Negative baseline taxes are benefits, not negative levies. Private pension
    and other resources remain separate from productive labor and investment.
    """
    total_weight = ordered_sum(c["weight"] for c in cohorts)
    if (
        not cohorts
        or not math.isfinite(total_weight)
        or total_weight <= 0
        or any(not math.isfinite(c["weight"]) or c["weight"] < 0 for c in cohorts)
    ):
        raise ValueError("Cohorts need finite nonnegative citizen weights with a positive total.")
    calibration = dict.fromkeys(
        [
            "marketIncome",
            "laborIncome",
            "capitalIncome",
            "passiveIncome",
            "benefits",
            "cashAndInKindBenefits",
            "refundableCredits",
            "tax",
            "nonTransferSpending",
            "laborTaxRate",
            "capitalTaxRate",
            "laborTaxBase",
            "capitalTaxBase",
            "workerShare",
        ],
        0.0,
    )
    calibration["weights"] = []
    labor_tax = capital_tax = 0.0
    cells = []
    for cohort in cohorts:
        fields = [
            "laborIncome",
            "capitalIncome",
            "pensionIncome",
            "otherIncome",
            "benefits",
            "laborTaxBaseline",
            "capitalTaxBaseline",
        ]
        if any(not math.isfinite(cohort[field]) for field in fields):
            raise ValueError("Cohort income and tax values must be finite.")
        weight = cohort["weight"] / total_weight
        labor = max(0, cohort["laborIncome"])
        capital = max(0, cohort["capitalTaxBase"])
        passive = (
            cohort["pensionIncome"]
            + cohort["otherIncome"]
            + min(0, cohort["laborIncome"])
            + cohort["capitalIncome"]
            - capital
        )
        credit = max(0, -cohort["laborTaxBaseline"]) + max(0, -cohort["capitalTaxBaseline"])
        benefit = max(0, cohort["benefits"]) + credit
        lt = max(0, cohort["laborTaxBaseline"])
        ct = max(0, cohort["capitalTaxBaseline"])
        prior = max(0, labor + capital + passive + benefit - lt - ct)
        calibration["marketIncome"] += weight * (labor + capital + passive)
        calibration["laborIncome"] += weight * labor
        calibration["capitalIncome"] += weight * capital
        calibration["passiveIncome"] += weight * passive
        calibration["benefits"] += weight * benefit
        calibration["cashAndInKindBenefits"] += weight * max(0, cohort["benefits"])
        calibration["refundableCredits"] += weight * credit
        calibration["tax"] += weight * (lt + ct)
        calibration["laborTaxBase"] += weight * cohort["noncapitalTaxBase"]
        calibration["capitalTaxBase"] += weight * capital
        labor_tax += weight * lt
        capital_tax += weight * ct
        calibration["weights"].append(weight)
        if cohort["group"] == "work":
            calibration["workerShare"] += weight
        cells.append(
            Cell(
                source=cohort,
                weight=weight,
                labor=labor,
                capital=capital,
                passive=passive,
                taxable_passive=cohort["noncapitalTaxBase"] - labor,
                benefit=benefit,
                prior=prior,
                labor_rate=lt / cohort["noncapitalTaxBase"] if cohort["noncapitalTaxBase"] > 0 else 0,
                capital_rate=ct / capital if capital > 0 else 0,
                has_labor=labor > 0,
            )
        )
    if calibration["marketIncome"] <= 0 or calibration["capitalIncome"] <= 0:
        raise ValueError("Calibration requires positive market resources and investment income.")
    calibration["laborTaxRate"] = labor_tax / calibration["laborTaxBase"]
    calibration["capitalTaxRate"] = capital_tax / calibration["capitalTaxBase"]
    if calibration["tax"] + 1e-7 < calibration["benefits"]:
        raise ValueError(
            "Baseline benefits exceed modeled taxes; an explicit baseline funding source is required."
        )
    calibration["nonTransferSpending"] = max(0, calibration["tax"] - calibration["benefits"])
    return Prepared(
        cells=cells,
        calibration=calibration,
        baseline_income=[c.prior for c in cells],
        baseline_worker_income=ordered_sum(c.weight * c.prior for c in cells if c.source["group"] == "work"),
        baseline_owner_income=ordered_sum(
            c.weight * c.prior for c in cells if c.source["group"] == "capital"
        ),
        baseline_all_income=ordered_sum(c.weight * c.prior for c in cells),
    )


PREPARED = prepare(US_COHORTS)
CALIBRATION = PREPARED.calibration
