"""One vote per citizen for their favorite fully funded policy package.

These rules specify sincere voting. Perfect rationality alone does not imply
that sincere voting is the unique strategic equilibrium.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Sequence
from typing import Any, TypedDict

BALLOT_MAJORITY_PERCENT = 50
# Percentage-point tolerance for population sums; never used for utility ties.
BALLOT_SUM_TOLERANCE = 1e-10


class NoFundedPoliciesError(ValueError):
    """The required plurality election has no admissible package to enact."""


class BallotCandidate(TypedDict):
    id: str
    utilities: Sequence[float]
    fullyFunded: bool


def package_has_majority(support_percent: float) -> bool:
    """Require strictly more than half the entire electorate."""
    return support_percent > BALLOT_MAJORITY_PERCENT + BALLOT_SUM_TOLERANCE


def tally_package_ballot(
    candidates: Iterable[BallotCandidate],
    weights: Sequence[float],
    status_quo_id: str,
    status_quo_unavailable: bool = False,
) -> dict[str, Any]:
    """Stream the full menu while retaining only each cell's best choice.

    Exact utility ties prefer the current policy, then the lowest policy ID.
    Epsilon comparisons here would make the result depend on candidate order.
    Underfunded current policy is ineligible for votes. By default it remains
    the fallback; with no fallback, the exact current package is excluded
    and the funded plurality leader is enacted.
    Exact aggregate-support ties choose the lowest canonical policy ID.
    """
    if not isinstance(status_quo_unavailable, bool):
        raise ValueError("statusQuoUnavailable must be a boolean.")
    if not len(weights):
        raise ValueError("A ballot needs at least one population cell.")
    total_population_weight = 0.0
    for weight in weights:
        if not math.isfinite(weight) or weight < 0:
            raise ValueError("Population weights must be finite and nonnegative.")
        total_population_weight += weight
    if not math.isfinite(total_population_weight) or total_population_weight <= 0:
        raise ValueError("The electorate needs a finite positive total population.")

    maxima = [-math.inf] * len(weights)
    voter_choices: list[str | None] = [None] * len(weights)
    ids: set[str] = set()
    eligible_ids: set[str] = set()
    excluded_ids: set[str] = set()
    status_quo_fully_funded = False
    for candidate in candidates:
        policy_id = candidate.get("id")
        if not isinstance(policy_id, str) or not policy_id or policy_id in ids:
            raise ValueError("Every candidate needs a unique nonempty policy ID.")
        ids.add(policy_id)
        fully_funded = candidate.get("fullyFunded")
        if not isinstance(fully_funded, bool):
            raise ValueError("Every candidate needs an explicit fullyFunded boolean.")
        if policy_id == status_quo_id:
            status_quo_fully_funded = fully_funded
        excluded = status_quo_unavailable and policy_id == status_quo_id
        if excluded:
            excluded_ids.add(policy_id)
        elif fully_funded:
            eligible_ids.add(policy_id)
        utilities = candidate["utilities"]
        if len(utilities) != len(weights):
            raise ValueError("Every candidate must represent the same population cells.")
        for cell, utility in enumerate(utilities):
            if not math.isfinite(utility):
                raise ValueError("Every candidate utility must be finite.")
            if not fully_funded or excluded:
                continue
            previous = voter_choices[cell]
            tie_preferred = (
                utility == maxima[cell]
                and previous != status_quo_id
                and (policy_id == status_quo_id or previous is None or policy_id < previous)
            )
            if utility > maxima[cell] or tie_preferred:
                maxima[cell] = utility
                voter_choices[cell] = policy_id
    if status_quo_id not in ids:
        raise ValueError("The exact current-policy package must appear on the ballot.")

    support = {policy_id: [0.0, 0.0] for policy_id in sorted(eligible_ids)}
    for cell, choice in enumerate(voter_choices):
        if choice is not None:
            support[choice][0] += weights[cell]
            support[choice][1] += weights[cell] / total_population_weight * 100
    tallies = [
        {"policyId": policy_id, "populationWeight": weight, "supportPercent": min(100, percent)}
        for policy_id, (weight, percent) in support.items()
    ]
    # max preserves canonical order when leading shares are exactly equal.
    leading = max(tallies, key=lambda tally: tally["supportPercent"], default=None)
    if leading is None and status_quo_unavailable:
        raise NoFundedPoliciesError(
            "No alternative policy is fully funded under these assumptions. A plurality election cannot "
            "enact an underfunded package or fall back to current policy. Change the assumptions "
            "or allow the status-quo fallback."
        )
    winner_id = (
        leading["policyId"]
        if leading and (status_quo_unavailable or package_has_majority(leading["supportPercent"]))
        else None
    )
    if leading is None:
        status_quo_reason = "no-eligible-policies"
    elif winner_id is None:
        status_quo_reason = "no-majority"
    elif winner_id == status_quo_id:
        status_quo_reason = "status-quo-majority"
    else:
        status_quo_reason = None
    return {
        "votingRule": "plurality" if status_quo_unavailable else "majority",
        "tallies": tallies,
        "leadingPolicyId": leading["policyId"] if leading else None,
        "topSupportPercent": leading["supportPercent"] if leading else 0,
        "winnerId": winner_id,
        "enactedPolicyId": winner_id or status_quo_id,
        "statusQuoReason": status_quo_reason,
        "statusQuoFullyFunded": status_quo_fully_funded,
        "statusQuoExcluded": status_quo_unavailable,
        "voterChoices": voter_choices,
        "totalPopulationWeight": total_population_weight,
        "candidateCount": len(ids),
        "eligibleCandidateCount": len(eligible_ids),
        "unfundedCandidateCount": len(ids) - len(eligible_ids) - len(excluded_ids),
        "excludedCandidateCount": len(excluded_ids),
    }
