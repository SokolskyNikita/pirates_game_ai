"""Internal records used by the calculation pipeline.

Wire results use camelCase dictionaries to match the public JSON contract. These
records only describe intermediate quantities and never cross that boundary.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .labor_market import initial_labor

Policy = dict[str, Any]
ModelInputs = dict[str, float]
Calibration = dict[str, Any]


@dataclass(slots=True)
class Cell:
    source: dict[str, Any]
    weight: float
    labor: float
    capital: float
    passive: float
    taxable_passive: float
    benefit: float
    prior: float
    labor_rate: float
    capital_rate: float
    has_labor: bool


@dataclass(slots=True)
class Prepared:
    cells: list[Cell]
    calibration: Calibration
    baseline_income: list[float]
    baseline_worker_income: float
    baseline_owner_income: float
    baseline_all_income: float


@dataclass(slots=True)
class Production:
    income_allocation_factor: float
    growth: float
    potential_growth_rate: float
    gdp_growth_rate: float
    adoption: float
    exposure: float
    unemployment: float
    newly: float
    reemployed: float
    output: float
    labor: float
    passive: float
    capital: float
    rents: float
    investment: float
    adjustment: float
    effort: float
    burden: float
    capacity: float

    labor_state: dict[str, Any] = field(default_factory=initial_labor)
    jobs_affected: float = 0
    average_wage_factor: float = 1
    ai_unemployment: float = 0
    trade_unemployment: float = 0
    trade_adjustment: float = 0
    consumer_price_index: float = 1
    trade_open: bool = False
    import_share: float = 0
    export_share: float = 0
    export_volume: float = 0
    relative_producer_price: float = 1
    trade_balance_residual: float = 0


@dataclass(slots=True)
class Settlement:
    point: dict[str, Any] | None
    utilities: list[float]
    worker_score: float
    prosperity_score: float
    output_score: float
    admissible: bool
