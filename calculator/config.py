"""Public model assumptions and presentation metadata.

Calculation constants live here; the browser receives metadata without evaluating
any economic formulas.
"""

from __future__ import annotations

import math
from typing import Any

from .explanations import MODEL_NOTES as MODEL_NOTES

YEARS = 10
DISCOUNT_RATE = 0.03
UTILITY_OFFSET = 0.01
CAPACITY_RENEWAL_RATE = 0.05
GROWTH_BASELINE = {"us": 0.02, "foreign": 0.03}
LEGACY_INPUT_KEYS = {"usGdpGrowth", "foreignGdpGrowth", "displacement", "reemployment"}

DEFAULT_INPUTS = {
    "usAiGrowth": 0.05,
    "foreignAiGrowth": 0.05,
    "productivityGain": 0.4,
    "jobChange": -0.9,
    "jobsAffected": 1,
    "jobSearch": 0.85,
    "capitalMobility": 0.5,
    "investmentResponse": 0.35,
    "foreignStrength": 1,
    "tradeIntensity": 0.14175546,
    "foreignMarketSize": 2.8463217399,
    "foreignPopulationRatio": 23.0368311373,
    "foreignTradeIntensity": 0.03916185,
    "tradableShare": 0.4,
    "tradeElasticity": 4,
}

INPUT_SPECS = [
    {
        "key": "usAiGrowth",
        "label": "Extra US GDP growth from AI",
        "min": 0,
        "max": 0.2,
        "step": 0.05,
        "description": "Additional percentage points of annual real growth at full AI exposure, above the 2% "
        "background trend. Investment, labor-market and trade effects can still make actual "
        "output shrink.",
    },
    {
        "key": "foreignAiGrowth",
        "label": "Extra foreign GDP growth from AI",
        "min": 0,
        "max": 0.2,
        "step": 0.05,
        "description": "Additional percentage points of annual real growth at full AI exposure, above the 3% "
        "background trend. Investment, labor-market and trade effects can still make actual "
        "output shrink.",
    },
    {
        "key": "productivityGain",
        "label": "Employer gain from AI",
        "min": 0,
        "max": 1,
        "step": 0.05,
        "description": "Extra employer return per automated role. At 50%, a $100,000 role yields $150,000 "
        "from AI or $50,000 after keeping its $100,000 wage, before GDP scaling, taxes and "
        "costs.",
    },
    {
        "key": "jobChange",
        "label": "Change in number of jobs post-AI",
        "min": -1,
        "max": 1,
        "step": 0.05,
        "description": "Change in productive job positions at full AI exposure, relative to today. Negative "
        "values remove jobs; positive values create positions. Employer-retained payroll jobs "
        "are counted separately. New positions can remain vacant.",
    },
    {
        "key": "jobsAffected",
        "label": "Percentage of current jobs affected eventually",
        "min": 0,
        "max": 1,
        "step": 0.05,
        "description": "Current roles replaced or transformed at full AI exposure. This must be at least the "
        "percentage reduction in jobs. All current roles can change while the total number of "
        "jobs stays the same.",
    },
    {
        "key": "jobSearch",
        "label": "Laid-off workers who try to find another job",
        "min": 0,
        "max": 1,
        "step": 0.05,
        "description": "Share who enter job search after each layoff. They compete for available jobs and may "
        "replace higher-paid incumbents; searching does not guarantee a job. Default 85% "
        "approximates the 86.9% of displaced US workers employed or seeking work in January "
        "2026.",
    },
    {
        "key": "investmentResponse",
        "label": "Response to policy changes",
        "min": 0,
        "max": 1,
        "step": 0.05,
        "description": "Strength of investment and labor responses to policy changes relative to current "
        "taxes. An assumption, not an estimated elasticity.",
    },
    {
        "key": "capitalMobility",
        "label": "Mobile AI rents",
        "min": 0,
        "max": 1,
        "step": 0.05,
        "description": "Response of mobile AI returns to international differences in adoption and policy "
        "burdens.",
    },
    {
        "key": "foreignStrength",
        "label": "Foreign frontier capability",
        "min": 0,
        "max": 1,
        "step": 0.05,
        "description": "Foreign frontier adoption relative to the US. At zero, the foreign economy can still "
        "import AI.",
    },
    {
        "key": "tradeIntensity",
        "label": "US import exposure",
        "min": 0,
        "max": 1,
        "step": 0.05,
        "description": "2025 US imports / GDP. Together with exports, this anchors the modeled trade basket; "
        "imported-AI diffusion is an additional assumption.",
    },
    {
        "key": "foreignMarketSize",
        "label": "Rest-of-world GDP / US GDP",
        "min": 0.25,
        "max": 8,
        "step": 0.25,
        "description": "2025 nominal GDP ratio, used for bilateral demand, relative prices and AI-return "
        "accounting.",
    },
    {
        "key": "foreignPopulationRatio",
        "label": "Rest-of-world population / US population",
        "min": 0.25,
        "max": 40,
        "step": 0.25,
        "description": "Population reference; separate from the GDP weight.",
    },
    {
        "key": "foreignTradeIntensity",
        "label": "Foreign exposure to US exports",
        "min": 0,
        "max": 1,
        "step": 0.05,
        "description": "2025 US exports / rest-of-world GDP. Trade within the foreign bloc is internal.",
    },
    {
        "key": "tradableShare",
        "label": "Share exposed to international competition",
        "min": 0,
        "max": 1,
        "step": 0.05,
        "description": "Assumed share of spending and remaining jobs in goods or services that can be "
        "purchased abroad. Includes tradable services. The 40% default is illustrative, not a "
        "measured share of today's US economy.",
    },
    {
        "key": "tradeElasticity",
        "label": "Response to relative import prices",
        "min": 1,
        "max": 8,
        "step": 1,
        "description": "How strongly buyers switch between domestic and foreign products as prices change. "
        "Four is a research-based reference; the same value applies to both blocs.",
    },
]


def clamp(value: float, minimum: float = 0, maximum: float = 1) -> float:
    """Restrict a finite value to the requested closed interval."""
    return max(minimum, min(maximum, value))


def normalize_inputs(values: dict[str, Any] | None = None) -> dict[str, float]:
    """Normalize current and old links, including the physical job-count constraint."""
    values = dict(values or {})

    def finite(value: Any) -> bool:
        try:
            return isinstance(value, (float, int)) and not isinstance(value, bool) and math.isfinite(value)
        except OverflowError:
            return False

    for old, new, region in (
        ("usGdpGrowth", "usAiGrowth", "us"),
        ("foreignGdpGrowth", "foreignAiGrowth", "foreign"),
    ):
        if new not in values and finite(values.get(old)):
            values[new] = max(0, float(f"{values[old] - GROWTH_BASELINE[region]:.12g}"))
    if finite(values.get("displacement")):
        values.setdefault("jobsAffected", values["displacement"])
        values.setdefault("jobChange", -clamp(values["displacement"]))
    # An old success-rate assumption cannot be interpreted as a search decision.
    result = DEFAULT_INPUTS.copy()
    for spec in INPUT_SPECS:
        value = values.get(spec["key"])
        if finite(value):
            result[spec["key"]] = clamp(value, spec["min"], spec["max"])
    result["jobsAffected"] = max(result["jobsAffected"], -result["jobChange"], 0)
    return result
