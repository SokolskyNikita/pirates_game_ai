"""Known career histories, sampled from a deterministic continuum allocation.

Each income cell is crossed with fixed career ranks, not employment lotteries.
Deterministic priority allocates removals, search, hiring and replacement in order.
Annual largest-remainder rounding bounds state-stock error to one career.
One hundred fixed careers approximate the continuum; budgets integrate the
continuum, not the samples. Identity is shared across counterfactual policies.
"""

import numpy as np

from .preferences import preferences

ORIGINAL, NEW, RETAINED, SEARCHING, EXITED = range(5)
PENDING, HIRED_ORIGINAL, HIRED_NEW = 5, 6, 7


class Careers:
    def __init__(self, count=1, paths=None):
        paths = paths or preferences().career_paths
        self.paths = paths
        self.state = np.zeros((count, paths), dtype=np.int8)

    def move(self, source, amount, target):
        # Allocate whole representative careers, with deterministic priority.
        # Annual stock reconciliation below bounds sampling error to one path.
        count = np.maximum(0, np.floor(np.atleast_1d(amount) * self.paths + 0.5)).astype(int)[:, None]
        pool = self.state == source
        chosen = pool & (np.cumsum(pool, axis=1) <= count)
        self.state[chosen] = target
        return chosen

    def advance(self, new):
        previous_exit_mask = self.state == EXITED
        previous_exits = np.sum(previous_exit_mask, axis=1)
        # Temporary labels keep this year's hires out of the replacement pool.
        for source, name in ((ORIGINAL, "original"), (NEW, "new")):
            self.move(source, new[name + "_removed"], PENDING)
        self.move(PENDING, new["protected_removed"], RETAINED)
        self.move(PENDING, new["search_layoffs"], SEARCHING)
        self.state[self.state == PENDING] = EXITED
        self.move(RETAINED, new["original_redeploy"], HIRED_ORIGINAL)
        self.move(RETAINED, new["new_redeploy"], HIRED_NEW)
        self.move(SEARCHING, new["original_hires"], HIRED_ORIGINAL)
        self.move(SEARCHING, new["new_hires"], HIRED_NEW)
        self.move(ORIGINAL, new["swap_original"], PENDING)
        self.move(NEW, new["swap_new"], PENDING)
        self.move(SEARCHING, new["swap_original"], HIRED_ORIGINAL)
        self.move(SEARCHING, new["swap_new"], HIRED_NEW)
        self.move(PENDING, new["search_swaps"], SEARCHING)
        self.state[self.state == PENDING] = EXITED
        self.state[self.state == HIRED_ORIGINAL] = ORIGINAL
        self.state[self.state == HIRED_NEW] = NEW
        # Largest-remainder apportionment matches aggregate state stocks to
        # within one representative, without ever reviving a previous exit.
        shares = np.stack(
            [
                np.atleast_1d(new[key])
                for key in ("original_filled", "new_filled", "retained", "searching", "exited")
            ],
            axis=1,
        )
        ideal = shares * self.paths
        target = np.floor(ideal + 1e-10).astype(int)
        target[:, EXITED] = np.maximum(target[:, EXITED], previous_exits)
        remainder = self.paths - target.sum(axis=1)
        priorities = np.argsort(-(ideal - target), axis=1, kind="stable")
        for position in range(5):
            rows = np.flatnonzero(remainder > position)
            target[rows, priorities[rows, position]] += 1
        for code in range(5):
            pool = self.state == code
            excess = np.maximum(0, pool.sum(axis=1) - target[:, code])
            # Previous exits are already bounded by the target and only newly
            # added exits may be adjusted for whole-person rounding.
            if code == EXITED:
                pool &= ~previous_exit_mask
            chosen = pool & (np.cumsum(pool, axis=1) <= excess[:, None])
            self.state[chosen] = PENDING
        for code in range(5):
            missing = target[:, code] - np.sum(self.state == code, axis=1)
            pool = self.state == PENDING
            self.state[pool & (np.cumsum(pool, axis=1) <= missing[:, None])] = code
        if np.any(self.state == PENDING):
            raise ArithmeticError("Career allocation did not conserve representatives.")
        return self.state.copy()


def voter_weights(weights):
    return np.repeat(np.asarray(weights) / preferences().career_paths, preferences().career_paths).tolist()
