"""Explicit research assumptions, separate from rationality and policy levers.

Public scenarios use defaults. The context manager supports reproducible local
sensitivity runs without mutating globals or changing a running calculation.
"""

import math
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, replace


@dataclass(frozen=True)
class Preferences:
    horizon: int = 10
    discount: float = 0.03
    curvature: float = 1
    career_paths: int = 100


_DEFAULT = Preferences()
_CURRENT = ContextVar("preferences", default=None)


def preferences():
    return _CURRENT.get() or _DEFAULT


@contextmanager
def assumptions(**changes):
    value = replace(preferences(), **changes)
    if (
        not isinstance(value.horizon, int)
        or isinstance(value.horizon, bool)
        or not 1 <= value.horizon <= 50
        or not isinstance(value.career_paths, int)
        or isinstance(value.career_paths, bool)
        or not 2 <= value.career_paths <= 1000
        or not math.isfinite(value.discount)
        or not 0 <= value.discount <= 0.5
        or not math.isfinite(value.curvature)
        or not 0 <= value.curvature <= 3
    ):
        raise ValueError("Invalid preference or career-resolution assumption.")
    token = _CURRENT.set(value)
    try:
        yield value
    finally:
        _CURRENT.reset(token)
