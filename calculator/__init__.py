"""Pure Python economic model and complete-policy voting simulation."""

from .config import DEFAULT_INPUTS, INPUT_SPECS, MODEL_NOTES, normalize_inputs
from .model import evaluate_profile, solve_model
from .policies import BASELINE_POLICY, POLICIES, current_policy, make_policy
from .population import CALIBRATION, US_COHORTS, US_ELECTORATE

__all__ = [
    "BASELINE_POLICY",
    "CALIBRATION",
    "DEFAULT_INPUTS",
    "INPUT_SPECS",
    "MODEL_NOTES",
    "POLICIES",
    "US_COHORTS",
    "US_ELECTORATE",
    "current_policy",
    "evaluate_profile",
    "make_policy",
    "normalize_inputs",
    "solve_model",
]
