"""Small, transparent strategic games verify ballot and search orchestration."""

import math
import unittest

from calculator.election import solve_package_election

BASE = {
    "pace": 1,
    "replacement": 0,
    "welfareScale": 1,
    "benefitFormula": "current",
    "laborTax": 0.2,
    "capitalTax": 0.2,
}
CURRENT = {**BASE, "id": "current"}
PAUSE = {**BASE, "id": "pause", "pace": 0}
ACCELERATE = {**BASE, "id": "accelerate", "pace": 2}
OTHER = {**BASE, "id": "other", "replacement": 1}


def fixture(
    utilities,
    *,
    policies=None,
    foreign=None,
    weights=None,
    score=lambda us, foreign: 0,
    funded=lambda us, foreign: True,
    foreign_funded=lambda us, foreign: True,
):
    def evaluate(us, foreign_policy=None):
        result = {"usUtilities": utilities(us, foreign_policy), "usAdmissible": funded(us, foreign_policy)}
        if foreign_policy is not None:
            result.update(
                foreignScore=score(us, foreign_policy), foreignAdmissible=foreign_funded(us, foreign_policy)
            )
        return result

    return {
        "mode": "strategic" if foreign is not None else "us-only",
        "policies": policies or [CURRENT, PAUSE, ACCELERATE],
        "foreignPolicies": foreign or [],
        "currentPolicy": CURRENT,
        "weights": weights or [1],
        "evaluateLight": evaluate,
        "evaluateForeign": lambda us, other: score(us, other) if foreign_funded(us, other) else -math.inf,
    }


def split_preferences(us, _foreign):
    return {"current": [0, 0, 0], "pause": [3, 1, 1], "accelerate": [1, 3, 1], "other": [1, 1, 3]}[us["id"]]


class ElectionTests(unittest.TestCase):
    def test_domestic_single_ballot_is_not_pairwise_majority_amendments(self):
        result = solve_package_election(
            fixture(split_preferences, policies=[CURRENT, PAUSE, ACCELERATE, OTHER], weights=[40, 35, 25])
        )
        self.assertEqual(result["ballot"]["topSupportPercent"], 40)
        self.assertEqual(result["usPolicy"], CURRENT)
        self.assertEqual(result["selection"], "domestic-ballot")
        self.assertEqual(result["evaluations"], 4)
        self.assertEqual(result["search"]["ballotsEvaluated"], 1)

    def test_funding_excludes_attractive_packages_before_personal_choice(self):
        result = solve_package_election(
            fixture(
                lambda us, _: [{"accelerate": 100, "pause": 2, "current": 0}[us["id"]]],
                funded=lambda us, _: us != ACCELERATE,
            )
        )
        self.assertEqual(result["usPolicy"], PAUSE)
        self.assertEqual(result["ballot"]["eligibleCandidateCount"], 2)

    def test_foreign_response_uses_enacted_status_quo_not_plurality_leader(self):
        result = solve_package_election(
            fixture(
                split_preferences,
                policies=[CURRENT, PAUSE, ACCELERATE, OTHER],
                foreign=[CURRENT, PAUSE, ACCELERATE],
                weights=[40, 35, 25],
                score=lambda us, foreign: 3 if foreign == (ACCELERATE if us == CURRENT else PAUSE) else 0,
            )
        )
        self.assertEqual(result["ballot"]["leadingPolicyId"], "pause")
        self.assertEqual(result["usPolicy"], CURRENT)
        self.assertEqual(result["foreignPolicy"], ACCELERATE)
        self.assertEqual(result["selection"], "verified-consistent")
        self.assertEqual(result["foreignBestResponseGain"], 0)

    def test_complete_response_checks_certify_a_fixed_point(self):
        result = solve_package_election(
            fixture(
                lambda us, foreign: [2 if us == (PAUSE if foreign == ACCELERATE else ACCELERATE) else 0],
                foreign=[CURRENT, PAUSE, ACCELERATE],
                score=lambda us, foreign: 3 if foreign == ACCELERATE else 0,
            )
        )
        self.assertEqual(result["usPolicy"], PAUSE)
        self.assertEqual(result["foreignPolicy"], ACCELERATE)
        self.assertEqual(result["search"]["consistentPairsFound"], 1)
        self.assertEqual(result["search"]["ballotsEvaluated"], 3)
        self.assertEqual(result["search"]["foreignResponsesEvaluated"], 2)

    def test_cycles_are_reported_without_claiming_no_equilibrium_exists(self):
        model = fixture(
            lambda us, foreign: [int(us == foreign)],
            policies=[CURRENT, PAUSE],
            foreign=[CURRENT, PAUSE],
            score=lambda us, foreign: int(us != foreign),
        )
        result = solve_package_election(model)
        self.assertEqual(result["selection"], "search-incomplete")
        self.assertEqual(result["search"]["consistentPairsFound"], 0)
        self.assertEqual(result["search"]["cycleCount"], 2)
        self.assertEqual(result["foreignBestResponseGain"], 1)
        self.assertIn("not an equilibrium", result["search"]["reason"])
        limited = solve_package_election(model, {"maxRounds": 1, "foreignSeeds": [CURRENT]})
        self.assertEqual(limited["search"]["cycleCount"], 0)
        self.assertEqual(limited["search"]["exhaustedStarts"], 1)

    def test_foreign_indifference_preserves_consistency(self):
        result = solve_package_election(
            fixture(
                lambda us, foreign: [0], foreign=[CURRENT, PAUSE, ACCELERATE], score=lambda us, foreign: 2
            )
        )
        self.assertEqual(result["foreignPolicy"], CURRENT)
        self.assertEqual(result["foreignBestPolicy"], CURRENT)
        self.assertEqual(result["search"]["consistentPairsFound"], 3)
        self.assertEqual(result["search"]["cycleCount"], 0)

    def test_foreign_exact_ties_are_canonical_and_order_independent(self):
        model = fixture(
            lambda us, foreign: [0],
            foreign=[PAUSE, CURRENT, ACCELERATE],
            score=lambda us, foreign: int(foreign != CURRENT),
        )
        first = solve_package_election(model, {"foreignSeeds": [CURRENT]})
        second = solve_package_election(
            {**model, "foreignPolicies": list(reversed(model["foreignPolicies"]))},
            {"foreignSeeds": [CURRENT]},
        )
        self.assertEqual(first["foreignPolicy"], ACCELERATE)
        self.assertEqual(second["foreignPolicy"], ACCELERATE)

    def test_no_funded_foreign_response_does_not_certify_fallback(self):
        result = solve_package_election(
            fixture(
                lambda us, foreign: [0], foreign=[CURRENT, PAUSE], foreign_funded=lambda us, foreign: False
            )
        )
        self.assertEqual(result["selection"], "search-incomplete")
        self.assertNotIn("foreignBestPolicy", result)
        self.assertNotIn("foreignBestResponseGain", result)
        self.assertIn("no fully funded foreign response", result["search"]["reason"])

    def test_underfunded_foreign_maximum_is_excluded(self):
        result = solve_package_election(
            fixture(
                lambda us, foreign: [0],
                foreign=[CURRENT, PAUSE, ACCELERATE],
                score=lambda us, foreign: {"current": 0, "pause": 2, "accelerate": 100}[foreign["id"]],
                foreign_funded=lambda us, foreign: foreign != ACCELERATE,
            ),
            {"foreignSeeds": [CURRENT]},
        )
        self.assertEqual(result["foreignPolicy"], PAUSE)
        self.assertEqual(result["selection"], "verified-consistent")

    def test_batch_hooks_preserve_the_scalar_ballot_and_foreign_search(self):
        model = fixture(
            lambda us, foreign: [int(us == foreign)],
            foreign=[CURRENT, PAUSE, ACCELERATE],
            score=lambda us, foreign: int(foreign == ACCELERATE),
        )
        scalar = solve_package_election(model)
        batches = {"us": 0, "foreign": 0}

        def batch_light(policies, foreign):
            batches["us"] += 1
            return [model["evaluateLight"](policy, foreign) for policy in policies]

        def batch_foreign(us, policies):
            batches["foreign"] += 1
            return [model["evaluateForeign"](us, policy) for policy in policies]

        batched = solve_package_election(
            {
                **model,
                "evaluateLightBatch": batch_light,
                "evaluateForeignBatch": batch_foreign,
            }
        )
        self.assertEqual(batched, scalar)
        self.assertEqual(batches["us"], scalar["search"]["ballotsEvaluated"])
        self.assertEqual(batches["foreign"], scalar["search"]["foreignResponsesEvaluated"])

    def test_incomplete_batch_results_are_rejected(self):
        model = fixture(lambda us, foreign: [0], foreign=[CURRENT, PAUSE])
        for changes in (
            {"evaluateLightBatch": lambda policies, foreign: []},
            {"evaluateForeignBatch": lambda us, policies: []},
        ):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                solve_package_election({**model, **changes})

    def test_search_seeds_include_both_trade_choices_at_every_available_pace(self):
        open_choices = [{**policy, "allowFreeTrade": True} for policy in (CURRENT, PAUSE, ACCELERATE)]
        closed_choices = [
            {**policy, "id": policy["id"] + "|closed", "allowFreeTrade": False}
            for policy in open_choices
        ]
        choices = open_choices + closed_choices
        model = fixture(lambda us, foreign: [0], policies=choices, foreign=choices)
        result = solve_package_election(model)
        self.assertEqual(result["search"]["startsTried"], 6)
        self.assertEqual(result["search"]["consistentPairsFound"], 6)
        restricted = [policy for policy in choices if policy["pace"] != 0]
        result = solve_package_election({**model, "policies": restricted, "foreignPolicies": restricted})
        self.assertEqual(result["search"]["startsTried"], 4)
        self.assertEqual(result["search"]["consistentPairsFound"], 4)

    def test_closed_trade_package_is_on_both_actors_complete_best_response_menus(self):
        opened = {**CURRENT, "allowFreeTrade": True}
        closed = {**opened, "id": "current|closed", "allowFreeTrade": False}
        choices = [opened, closed]
        result = solve_package_election(
            fixture(
                lambda us, foreign: [0 if us["allowFreeTrade"] else 1],
                policies=choices,
                foreign=choices,
                score=lambda us, foreign: 0 if foreign["allowFreeTrade"] else 2,
            )
        )
        self.assertFalse(result["usPolicy"]["allowFreeTrade"])
        self.assertFalse(result["foreignPolicy"]["allowFreeTrade"])
        self.assertFalse(result["foreignBestPolicy"]["allowFreeTrade"])
        self.assertEqual(result["ballot"]["topSupportPercent"], 100)
        self.assertEqual(result["selection"], "verified-consistent")
        self.assertEqual(result["search"]["startsTried"], 2)

    def test_invalid_menus_and_search_limits_are_rejected(self):
        model = fixture(lambda us, foreign: [0], foreign=[CURRENT, PAUSE])
        for changes in (
            {"policies": [PAUSE]},
            {"foreignPolicies": [PAUSE]},
            {"policies": [CURRENT, CURRENT]},
        ):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                solve_package_election({**model, **changes})
        for options in (
            {"foreignSeeds": []},
            {"foreignSeeds": [OTHER]},
            {"maxRounds": 0},
            {"maxRounds": True},
        ):
            with self.subTest(options=options), self.assertRaises(ValueError):
                solve_package_election(model, options)


if __name__ == "__main__":
    unittest.main()
