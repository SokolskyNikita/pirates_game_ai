"""Arithmetic shared by scalar reference and NumPy policy batches.

Economic functions accept either this scalar provider or numpy as ``xp``.
Arrays run independent policies; no economic rule belongs in this adapter.
"""

import math
from typing import Any


class Scalar:
    maximum = staticmethod(max)
    minimum = staticmethod(min)
    exp = staticmethod(math.exp)
    log = staticmethod(math.log)
    all = staticmethod(bool)

    @staticmethod
    def where(condition: bool, yes: Any, no: Any) -> Any:
        return yes if condition else no
