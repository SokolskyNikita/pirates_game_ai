"""A complete US ballot and a bounded search for consistent foreign choices.

Search iterations are numerical checks, not repeated elections. Every certified
pair passes the complete US ballot and the complete foreign best-response menu.
"""

from __future__ import annotations

import math
from typing import Any

from .ballot import NoFundedPoliciesError, tally_package_ballot

Policy = dict[str, Any]


def solve_package_election(model: dict[str, Any], options: dict[str, Any] | None = None) -> dict[str, Any]:
    """Select the domestic result or certify a mutually consistent policy pair."""
    options = options or {}
    policies = {policy["id"]: policy for policy in model["policies"]}
    status_quo_unavailable = model.get("statusQuoUnavailable", False)
    if not isinstance(status_quo_unavailable, bool):
        raise ValueError("statusQuoUnavailable must be a boolean.")
    current = model["currentPolicy"]
    current_id = current["id"]
    if len(policies) != len(model["policies"]) or current_id not in policies:
        raise ValueError("The complete ballot must contain unique policies and the exact status quo.")
    search = {
        "startsTried": 0,
        "iterations": 0,
        "ballotsEvaluated": 0,
        "foreignResponsesEvaluated": 0,
        "consistentPairsFound": 0,
        "cycleCount": 0,
        "exhaustedStarts": 0,
        "ineligibleBallots": 0,
        "reason": "",
    }
    evaluations = 0
    ballots: dict[str, dict[str, Any]] = {}
    ineligible_ballots: set[str] = set()
    responses: dict[str, dict[str, Any]] = {}

    def ballot_at(foreign: Policy | None = None) -> dict[str, Any]:
        key = foreign["id"] if foreign else "domestic"
        if key in ballots:
            return ballots[key]
        if key in ineligible_ballots:
            raise NoFundedPoliciesError("No funded US package at this foreign choice.")

        def candidates():
            nonlocal evaluations
            ballot_policies = model["policies"]
            if status_quo_unavailable:
                # Certify possible favorites over alternatives only: an excluded
                # current-policy utility must not mask their numerical ties.
                ballot_policies = [policy for policy in ballot_policies if policy["id"] != current_id]
                reference = model["evaluateLight"](current, foreign)
                evaluations += 1
                yield {
                    "id": current_id,
                    "utilities": reference["usUtilities"],
                    "fullyFunded": reference["usAdmissible"],
                }
            batch_evaluator = model.get("evaluateLightBatch")
            if batch_evaluator is not None and ballot_policies:
                profiles = batch_evaluator(ballot_policies, foreign)
                if len(profiles) != len(ballot_policies):
                    raise ValueError("The batched ballot must evaluate every policy exactly once.")
            else:
                profiles = (model["evaluateLight"](policy, foreign) for policy in ballot_policies)
            for policy, profile in zip(ballot_policies, profiles, strict=True):
                evaluations += 1
                yield {
                    "id": policy["id"],
                    "utilities": profile["usUtilities"],
                    "fullyFunded": profile["usAdmissible"],
                }

        try:
            ballot = tally_package_ballot(candidates(), model["weights"], current_id, status_quo_unavailable)
        except NoFundedPoliciesError:
            ineligible_ballots.add(key)
            search["ineligibleBallots"] += 1
            search["ballotsEvaluated"] += 1
            raise
        ballots[key] = ballot
        search["ballotsEvaluated"] += 1
        return ballot

    if model["mode"] == "us-only":
        ballot = ballot_at()
        search["reason"] = (
            "Every full US package was evaluated. Each citizen casts one vote for their personal "
            "favorite funded package; "
            + (
                "the largest vote share wins, with no majority threshold or status-quo fallback. "
                "The exact current-policy package is excluded from US voting."
                if status_quo_unavailable
                else "a strict majority is required to change current policy."
            )
        )
        return {
            "usPolicy": policies[ballot["enactedPolicyId"]],
            "ballot": ballot,
            "selection": "domestic-ballot",
            "evaluations": evaluations,
            "search": search,
        }

    foreign_policies = {policy["id"]: policy for policy in model["foreignPolicies"]}
    if (
        not foreign_policies
        or len(foreign_policies) != len(model["foreignPolicies"])
        or current_id not in foreign_policies
    ):
        raise ValueError("The foreign menu must contain unique policies and the exact status quo.")

    def best_response_at(us: Policy) -> dict[str, Any]:
        nonlocal evaluations
        if us["id"] in responses:
            return responses[us["id"]]
        best: dict[str, Any] = {"score": -math.inf}
        batch_evaluator = model.get("evaluateForeignBatch")
        if batch_evaluator is not None:
            scores = batch_evaluator(us, model["foreignPolicies"])
            if len(scores) != len(model["foreignPolicies"]):
                raise ValueError("The batched foreign response must evaluate every policy exactly once.")
        else:
            scores = (model["evaluateForeign"](us, foreign) for foreign in model["foreignPolicies"])
        for foreign, score in zip(model["foreignPolicies"], scores, strict=True):
            evaluations += 1
            if score == -math.inf:
                continue
            if not math.isfinite(score):
                raise ValueError("A foreign utility must be finite or an ineligible -Infinity.")
            previous = best.get("policy")
            tie_preferred = (
                score == best["score"]
                and (previous is None or previous["id"] != current_id)
                and (foreign["id"] == current_id or previous is None or foreign["id"] < previous["id"])
            )
            if score > best["score"] or tie_preferred:
                best = {"policy": foreign, "score": score}
        responses[us["id"]] = best
        search["foreignResponsesEvaluated"] += 1
        return best

    def same_fiscal_policy(policy: Policy) -> bool:
        return all(
            policy[key] == current[key]
            for key in ("replacement", "welfareScale", "benefitFormula", "laborTax", "capitalTax")
        )

    # A ban by either party closes the border. Explore both access regimes at
    # every available AI pace; starting only from open trade can miss a distinct
    # closed-border fixed point. Legacy/test policies without the flag are open.
    default_seeds = [foreign_policies[current_id]]
    for free_trade in (True, False):
        for pace in (1, 0, 2):
            seed = next(
                (
                    policy
                    for policy in model["foreignPolicies"]
                    if policy["pace"] == pace
                    and policy.get("allowFreeTrade", True) == free_trade
                    and same_fiscal_policy(policy)
                ),
                None,
            )
            if seed is not None:
                default_seeds.append(seed)
    seeds = list({policy["id"]: policy for policy in options.get("foreignSeeds", default_seeds)}.values())
    if not seeds or any(seed["id"] not in foreign_policies for seed in seeds):
        raise ValueError("Search seeds must belong to the foreign menu.")
    max_rounds = options.get("maxRounds", 8)
    if isinstance(max_rounds, bool) or not isinstance(max_rounds, int) or max_rounds < 1:
        raise ValueError("Search rounds must be a positive integer.")

    consistent: dict[str, dict[str, Any]] = {}
    diagnostic: dict[str, Any] | None = None
    no_funded_response = False
    for seed in seeds:
        search["startsTried"] += 1
        foreign = foreign_policies[seed["id"]]
        seen: set[str] = set()
        stopped = False
        for _ in range(max_rounds):
            if foreign["id"] in seen:
                search["cycleCount"] += 1
                stopped = True
                break
            seen.add(foreign["id"])
            search["iterations"] += 1
            try:
                ballot = ballot_at(foreign)
            except NoFundedPoliciesError:
                # This foreign choice has no admissible US outcome. Another
                # seed may still lead to a funded, mutually consistent pair.
                stopped = True
                break
            us = policies[ballot["enactedPolicyId"]]
            best = best_response_at(us)
            profile = model["evaluateLight"](us, foreign)
            evaluations += 1
            foreign_score = profile.get("foreignScore")
            gain = (
                max(0, best["score"] - foreign_score)
                if best.get("policy") and foreign_score is not None and math.isfinite(foreign_score)
                else math.inf
            )
            pair = {"usPolicy": us, "foreignPolicy": foreign, "ballot": ballot, "best": best, "gain": gain}
            if diagnostic is None:
                diagnostic = pair
            if not best.get("policy"):
                no_funded_response = True
                stopped = True
                break
            if profile.get("foreignAdmissible") and gain == 0:
                consistent[us["id"] + "::" + foreign["id"]] = pair
                stopped = True
                break
            foreign = best["policy"]
        if not stopped:
            search["exhaustedStarts"] += 1

    search["consistentPairsFound"] = len(consistent)
    selected = next(iter(consistent.values()), diagnostic)
    if selected is None:
        raise NoFundedPoliciesError(
            "No fully funded US package was available at any foreign choice reached by the search. "
            "No plurality outcome could be calculated; change the assumptions or allow the "
            "status-quo fallback. The bounded search does not prove no funded pair exists."
        )
    selection = "verified-consistent" if consistent else "search-incomplete"
    if consistent:
        count = len(consistent)
        search["reason"] = (
            f"Verified {count} mutually consistent policy pair{'s' if count != 1 else ''} "
            f"from {search['startsTried']} starting choices. The displayed pair passes a complete US ballot "
            "and a complete funded foreign best-response check. Other consistent pairs may exist."
        )
    else:
        funding_note = (
            "; at least one enacted US policy had no fully funded foreign response"
            if no_funded_response
            else ""
        )
        search["reason"] = (
            f"The bounded search did not verify mutually consistent choices{funding_note}. "
            "The displayed ballot is conditional on the displayed foreign policy, not an equilibrium. "
            "This does not prove that no consistent pair exists."
        )
    if search["ineligibleBallots"]:
        search["reason"] += (
            f" {search['ineligibleBallots']} foreign choice(s) had no funded US package "
            "and were excluded from the search."
        )
    result = {
        "usPolicy": selected["usPolicy"],
        "foreignPolicy": selected["foreignPolicy"],
        "ballot": selected["ballot"],
        "selection": selection,
        "evaluations": evaluations,
        "search": search,
    }
    if selected["best"].get("policy"):
        result["foreignBestPolicy"] = selected["best"]["policy"]
    if math.isfinite(selected["gain"]):
        result["foreignBestResponseGain"] = selected["gain"]
    return result
