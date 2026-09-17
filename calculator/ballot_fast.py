"""Vectorized sincere intentions with the same tie and majority rules."""

import math

import numpy as np

from .ballot import package_has_majority, tally_package_ballot


def sincere_ballot(menu, weights, current, plurality=False):
    # Reuse schema/eligibility validation and metadata from the scalar contract.
    result = tally_package_ballot([{**c, "utilities": [0.0]} for c in menu], [1.0], current, plurality)
    w = np.asarray(weights, dtype=float)
    total = 0.0
    for weight in weights:
        total += weight
    if (
        w.ndim != 1
        or not len(w)
        or not np.all(np.isfinite(w))
        or np.any(w < 0)
        or not math.isfinite(total)
        or total <= 0
    ):
        raise ValueError("Invalid population weights.")
    ordered = sorted(menu, key=lambda c: (c["id"] != current, c["id"]))
    maximum = np.full(len(w), -np.inf)
    choices = np.full(len(w), -1, dtype=int)
    for index, candidate in enumerate(ordered):
        u = np.asarray(candidate["utilities"], dtype=float)
        if u.shape != w.shape or not np.all(np.isfinite(u)):
            raise ValueError("Every candidate needs finite utilities for the same voters.")
        if candidate["fullyFunded"] and not (plurality and candidate["id"] == current):
            better = u > maximum
            maximum[better] = u[better]
            choices[better] = index
    selected = [ordered[i]["id"] if i >= 0 else None for i in choices]
    counts = {row["policyId"]: [0.0, 0.0] for row in result["tallies"]}
    for weight, key in zip(weights, selected, strict=True):
        if key is not None:
            counts[key][0] += weight
            counts[key][1] += weight / total * 100
    tallies = [
        {"policyId": k, "populationWeight": v[0], "supportPercent": min(100, v[1])} for k, v in counts.items()
    ]
    leader = max(tallies, key=lambda r: r["supportPercent"], default=None)
    winner = (
        leader["policyId"]
        if leader and (plurality or package_has_majority(leader["supportPercent"]))
        else None
    )
    result.update(
        tallies=tallies,
        voterChoices=selected,
        totalPopulationWeight=total,
        leadingPolicyId=leader["policyId"] if leader else None,
        topSupportPercent=leader["supportPercent"] if leader else 0,
        winnerId=winner,
        enactedPolicyId=winner or current,
        statusQuoReason="no-eligible-policies"
        if not leader
        else "no-majority"
        if winner is None
        else "status-quo-majority"
        if winner == current
        else None,
    )
    return result
