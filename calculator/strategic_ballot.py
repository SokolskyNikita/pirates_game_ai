"""Pre-ballot compromise through strictly improving, single-package coalitions.

This is an explicit coordination protocol, not a unique Nash prediction. Start
from sincere intentions; everyone strictly preferring a funded challenger to the
anticipated outcome may coordinate on that challenger. Nonmembers keep their
intentions. Only enactable switches are accepted. One final ballot is cast.
Cycles and limits select the least-vulnerable funded recorded ballot.
A rule-selected outcome is not certified as a stable equilibrium.
"""

from __future__ import annotations

import hashlib
from collections.abc import Callable, Iterable, Sequence
from typing import Any

import numpy as np

from .ballot import BALLOT_SUM_TOLERANCE, BallotCandidate, package_has_majority
from .ballot_fast import sincere_ballot

# Engineering guard only selects scalar rechecks; it never declares a utility tie.
UTILITY_GUARD = 1e-9
MAX_COORDINATION_STEPS = 64


def _package_ballot(
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
    Utility-based priority is independent of policy names and input order. Scalar checks cover comparisons near a numerical boundary.
    """
    menu = list(candidates)
    sincere = sincere_ballot(menu, weights, status_quo_id, status_quo_unavailable)
    if isinstance(max_steps, bool) or not isinstance(max_steps, int) or max_steps < 1:
        raise ValueError("Coordination steps must be a positive integer.")
    by_id = {c["id"]: c for c in menu if c["fullyFunded"] or c["id"] == status_quo_id}
    eligible = sorted(row["policyId"] for row in sincere["tallies"])
    ids = eligible + ([status_quo_id] if status_quo_id not in eligible else [])
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
    vulnerability = []
    withdrawals = 0
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
        own = np.einsum("ij,j->i", better | (choices[None, :] == eligible_indexes[:, None]), w)
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
        # Optimistic membership cannot exclude an actually profitable switch.
        # Adding strictly benefiting voters to a challenger cannot hurt its tally.
        optimistic = matrix[: len(eligible_indexes)] > matrix[current] - (
            UTILITY_GUARD if exact_candidate is not None else 0
        )
        vulnerability.append(float(np.max(np.einsum("ij,j->i", optimistic, w), initial=0)))
        # A voter can withdraw a compromise vote to restore the fallback.
        # Abstention is a strategic action, but never counts as support and
        # never reduces the majority denominator (all adult citizens).
        if not status_quo_unavailable and outcome_id != status_quo_id:
            certify(indexes[status_quo_id])
            withdraw = (choices == current) & (matrix[indexes[status_quo_id]] > matrix[current])
            after = choices.copy()
            after[withdraw] = -1
            tally = np.bincount(after[after >= 0], weights=w[after >= 0], minlength=len(ids))
            if np.any(withdraw) and np.max(tally, initial=0) <= 50 + BALLOT_SUM_TOLERANCE:
                history.append(
                    {"from": outcome_id, "to": status_quo_id, "coalitionPercent": float(w[withdraw].sum())}
                )
                choices = after
                outcome_id = status_quo_id
                withdrawals += 1
                recorded.append(choices.copy())
                if tuple(choices) in seen:
                    reason = "cycle"
                    break
                seen.add(tuple(choices))
                if len(history) >= max_steps:
                    break
                continue
        possible = passing_targets(optimistic)
        possible &= eligible_indexes != current
        moved = False
        # Rank by a conservative support estimate, excluding the numerical
        # guard band in both scalar and batched paths. Membership is then
        # verified with strict comparisons; the guard never changes a vote.
        strength = np.einsum("ij,j->i", matrix[: len(eligible_indexes)] > matrix[current] + UTILITY_GUARD, w)
        positions = sorted(
            np.flatnonzero(possible), key=lambda pos: (-strength[pos], ids[eligible_indexes[pos]])
        )
        for position in positions:
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
        # a funded passing package, then its weakest majority opposition and ballot support;
        # canonical policy/vote order resolves exact ties. No votes are invented.
        def selection_rank(ballots):
            counts = np.bincount(ballots[ballots >= 0], weights=w[ballots >= 0], minlength=len(ids))
            leader = min(eligible_indexes, key=lambda i: (-counts[i], ids[i]))
            passes = status_quo_unavailable or package_has_majority(float(counts[leader]))
            outcome = int(leader) if passes else indexes[status_quo_id]
            opposition = np.einsum("ij,j->i", matrix[: len(eligible_indexes)] > matrix[outcome], w)
            return (
                not passes,
                float(np.max(opposition, initial=0)),
                -float(counts[leader]),
                ids[leader],
                tuple(ballots),
            )

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
        "resolution": "coalition-stable" if stable else "least-vulnerable-recorded-ballot",
        "sincereEnactedPolicyId": sincere["enactedPolicyId"],
        "sincereTopSupportPercent": sincere["topSupportPercent"],
        "changedOutcome": result["enactedPolicyId"] != sincere["enactedPolicyId"],
        "strategicVoterPercent": float(
            sum(w[i] for i, key in enumerate(result["voterChoices"]) if key != sincere["voterChoices"][i])
        ),
        "history": history,
        "withdrawals": withdrawals,
        "abstentionPercent": float(w[choices < 0].sum()),
        "maxChallengerSupportPercent": float(
            np.max(
                np.sum(
                    (matrix[: len(eligible_indexes)] > matrix[indexes[result["enactedPolicyId"]]]) * w, axis=1
                ),
                initial=0,
            )
        ),
        "tieRule": "policy-terms hash; current policy on personal indifference",
    }
    return result


def strategic_package_ballot(
    candidates,
    weights,
    status_quo_id,
    status_quo_unavailable=False,
    *,
    exact_candidate=None,
    max_steps=MAX_COORDINATION_STEPS,
):
    """Name-neutral strongest-coalition protocol with a transparent cycle rule.

    Policy-term hashes resolve exact support ties. Changing input order or
    renaming policies cannot privilege Pause or another policy lever. Identical
    policy terms are equivalent; their IDs only break that tie.
    This is a specified bargaining protocol, not a proof of unique Nash play.
    """
    menu = list(candidates)
    mapping = {
        c["id"]: c.get(
            "tieKey",
            hashlib.sha256(np.round(np.asarray(c["utilities"], dtype="<f8"), 8).tobytes()).hexdigest(),
        )
        + ":"
        + c["id"]
        for c in menu
    }
    reverse = {v: k for k, v in mapping.items()}
    normalized = [{**c, "id": mapping[c["id"]]} for c in menu]

    def exact(key):
        candidate = exact_candidate(reverse[key])
        return {**candidate, "id": key, "utilities": candidate["utilities"]}

    result = _package_ballot(
        normalized,
        weights,
        mapping[status_quo_id],
        status_quo_unavailable,
        exact_candidate=exact if exact_candidate else None,
        max_steps=max_steps,
    )

    def restore(value):
        if isinstance(value, str):
            return reverse.get(value, value)
        if isinstance(value, list):
            return [restore(v) for v in value]
        if isinstance(value, dict):
            return {k: restore(v) for k, v in value.items()}
        return value

    result = restore(result)
    return result
