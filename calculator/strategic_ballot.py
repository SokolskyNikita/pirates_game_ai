"""Pre-ballot compromise through strictly improving, single-package coalitions.

This is an explicit coordination protocol, not a unique Nash prediction. Start
from sincere intentions; everyone strictly preferring a funded challenger to the
anticipated outcome may coordinate on that challenger. Nonmembers keep their
intentions. Only enactable switches are accepted. One final ballot is cast.
Cycles and limits use an explicit most-supported-recorded-ballot selection rule.
A rule-selected outcome is not certified as a stable equilibrium.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Sequence
from typing import Any

import numpy as np

from .ballot import BALLOT_SUM_TOLERANCE, BallotCandidate, package_has_majority, tally_package_ballot

# Engineering guard only selects scalar rechecks; it never declares a utility tie.
UTILITY_GUARD = 1e-9
MAX_COORDINATION_STEPS = 64


def strategic_package_ballot(
    candidates: Iterable[BallotCandidate],
    weights: Sequence[float],
    status_quo_id: str,
    status_quo_unavailable: bool = False,
    *,
    exact_candidate: Callable[[str], BallotCandidate] | None = None,
    max_steps: int = MAX_COORDINATION_STEPS,
) -> dict[str, Any]:
    """Select a ballot under the disclosed coordination and resolution rules.

    A cohort denotes identical preferences, not one super-voter. Every member of
    a strictly benefiting cohort can join; votes retain their population weights.
    Candidate-ID order is the explicit proposal priority, independent of input
    order. Scalar checks cover comparisons near a numerical boundary.
    """
    menu = list(candidates)
    sincere = tally_package_ballot(menu, weights, status_quo_id, status_quo_unavailable)
    if isinstance(max_steps, bool) or not isinstance(max_steps, int) or max_steps < 1:
        raise ValueError("Coordination steps must be a positive integer.")
    by_id = {c["id"]: c for c in menu}
    eligible = sorted(row["policyId"] for row in sincere["tallies"])
    ids = sorted(by_id)
    indexes = {key: index for index, key in enumerate(ids)}
    matrix = np.asarray([by_id[key]["utilities"] for key in ids], dtype=float)
    funded = np.asarray([by_id[key]["fullyFunded"] for key in ids], dtype=bool)
    w = np.asarray(weights, dtype=float)
    w = w / w.sum() * 100
    choices = np.asarray([indexes[key] if key is not None else -1 for key in sincere["voterChoices"]])
    eligible_indexes = np.asarray([indexes[key] for key in eligible], dtype=int)
    checked: set[int] = set()
    history: list[dict[str, Any]] = []
    recorded = [choices.copy()]
    seen = {tuple(choices)}
    outcome_id = sincere["enactedPolicyId"]

    def certify(index):
        if exact_candidate is not None and index not in checked:
            candidate = exact_candidate(ids[index])
            if candidate["id"] != ids[index]:
                raise ValueError("Scalar certification returned the wrong policy.")
            values = np.asarray(candidate["utilities"], dtype=float)
            if values.shape != w.shape or not np.all(np.isfinite(values)):
                raise ValueError("Invalid scalar utilities.")
            if candidate["fullyFunded"] != bool(funded[index]):
                raise ValueError("Scalar and batch funding disagree.")
            matrix[index] = values
            checked.add(index)

    def passing_targets(better):
        # A challenger retains votes already pledged to it, even when those
        # voters do not join this new coalition. All other votes remain fixed.
        own = np.sum((better | (choices[None, :] == eligible_indexes[:, None])) * w, axis=1)
        if not status_quo_unavailable:
            return own > 50 + BALLOT_SUM_TOLERANCE
        passes = np.ones(len(eligible_indexes), dtype=bool)
        for rival in np.unique(choices):
            if rival < 0:
                continue
            members = choices == rival
            remaining = np.sum((~better[:, members]) * w[members], axis=1)
            passes &= (
                (eligible_indexes == rival)
                | (own > remaining)
                | ((own == remaining) & (eligible_indexes < rival))
            )
        return passes

    stable = False
    reason = "step-limit"
    for _ in range(max_steps + 1):
        current = indexes[outcome_id]
        certify(current)
        delta = matrix[eligible_indexes] - matrix[current]
        # Optimistic membership cannot exclude an actually profitable switch.
        # Adding strictly benefiting voters to a challenger cannot hurt its tally.
        optimistic = delta > (-UTILITY_GUARD if exact_candidate is not None else 0)
        possible = passing_targets(optimistic)
        possible &= eligible_indexes != current
        moved = False
        for position in np.flatnonzero(possible):
            challenger = int(eligible_indexes[position])
            certify(challenger)
            supporters = matrix[challenger] > matrix[current]
            if not np.any(supporters & (w > 0)):
                continue
            updated = np.where(supporters, challenger, choices)
            counts = np.bincount(updated[updated >= 0], weights=w[updated >= 0], minlength=len(ids))
            leader = min(eligible_indexes, key=lambda i: (-counts[i], ids[i]))
            enacted = (
                int(leader)
                if status_quo_unavailable or package_has_majority(float(counts[leader]))
                else indexes[status_quo_id]
            )
            if enacted != challenger:
                continue
            if len(history) >= max_steps:
                break
            history.append(
                {"from": outcome_id, "to": ids[challenger], "coalitionPercent": float(w[supporters].sum())}
            )
            choices = updated
            recorded.append(choices.copy())
            outcome_id = ids[challenger]
            moved = True
            if tuple(choices) in seen:
                reason = "cycle"
            seen.add(tuple(choices))
            break
        else:
            stable = True
            reason = "stable"
        if stable or not moved or reason == "cycle":
            break

    if not stable:
        # Resolve a repeated/limited coordination path with an explicit agenda
        # convention, not whichever state happened to be visited last. Prefer
        # a funded passing package, then the strongest recorded ballot support;
        # canonical policy/vote order resolves exact ties. No votes are invented.
        def selection_rank(ballots):
            counts = np.bincount(ballots[ballots >= 0], weights=w[ballots >= 0], minlength=len(ids))
            leader = min(eligible_indexes, key=lambda i: (-counts[i], ids[i]))
            passes = status_quo_unavailable or package_has_majority(float(counts[leader]))
            return (not passes, -float(counts[leader]), ids[leader], tuple(ballots))

        choices = min(recorded, key=selection_rank)

    result = dict(sincere)
    counts = np.bincount(choices[choices >= 0], weights=w[choices >= 0], minlength=len(ids))
    tallies = [
        {
            "policyId": key,
            "populationWeight": float(counts[indexes[key]] / 100 * sum(weights)),
            "supportPercent": min(100, float(counts[indexes[key]])),
        }
        for key in eligible
    ]
    leading = max(tallies, key=lambda row: row["supportPercent"], default=None)
    winner = (
        leading["policyId"]
        if leading and (status_quo_unavailable or package_has_majority(leading["supportPercent"]))
        else None
    )
    result.update(
        tallies=tallies,
        voterChoices=[ids[i] if i >= 0 else None for i in choices],
        leadingPolicyId=leading["policyId"] if leading else None,
        topSupportPercent=leading["supportPercent"] if leading else 0,
        winnerId=winner,
        enactedPolicyId=winner or status_quo_id,
        statusQuoReason=(
            "no-eligible-policies"
            if leading is None
            else "no-majority"
            if winner is None
            else "status-quo-majority"
            if winner == status_quo_id
            else None
        ),
    )
    result["coordination"] = {
        "method": "strictly-improving-coalitions",
        "stable": stable,
        "reason": reason,
        "steps": len(history),
        "resolution": "coalition-stable" if stable else "most-supported-recorded-ballot",
        "sincereEnactedPolicyId": sincere["enactedPolicyId"],
        "sincereTopSupportPercent": sincere["topSupportPercent"],
        "changedOutcome": result["enactedPolicyId"] != sincere["enactedPolicyId"],
        "strategicVoterPercent": float(
            sum(w[i] for i, key in enumerate(result["voterChoices"]) if key != sincere["voterChoices"][i])
        ),
        "history": history,
    }
    return result
