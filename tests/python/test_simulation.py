"""Scenario wiring, pause restrictions, and comparison boundaries."""

import json
import math
import unittest
from unittest.mock import patch

from calculator import simulation
from calculator.comparison import compare_policy, count_votes
from calculator.config import EQUILIBRIUM_TOLERANCE
from calculator.policies import BASELINE_POLICY, current_policy
from calculator.population import CALIBRATION

CURRENT = current_policy(1)
PAUSE = BASELINE_POLICY
ACCELERATE = current_policy(2)
MENU = [CURRENT, PAUSE, ACCELERATE]


def fake_model(values, options):
    def evaluate(us, foreign=None):
        profile = {
            "id": us["id"] + "::" + (foreign["id"] if foreign else "none"),
            "usPolicy": us,
            "usUtilities": [3 if us["pace"] == 0 else 2 if us["pace"] == 2 else 1],
            "usAdmissible": True,
            "us": [{"year": 0, "allIncomeIndex": 100}],
        }
        if foreign is not None:
            profile.update(foreignPolicy=foreign, foreignScore=foreign["pace"], foreignAdmissible=True)
        return profile

    return {
        "inputs": values,
        "mode": options["mode"],
        "foreignObjective": options["foreignObjective"],
        "policies": [CURRENT],
        "foreignPolicies": MENU if options["mode"] == "strategic" else [],
        "weights": [1],
        "evaluate": evaluate,
        "evaluateLight": evaluate,
        "evaluateForeign": lambda us, foreign: foreign["pace"],
    }


class ScenarioTests(unittest.TestCase):
    def solve(self, **changes):
        with (
            patch.object(simulation, "solve_model", side_effect=fake_model),
            patch.object(simulation, "POLICIES", MENU),
        ):
            return simulation.solve_scenario(
                {"inputs": {}, "mode": "us-only", "foreignObjective": "workers", **changes}
            )

    def test_snapshot_uses_full_menu_and_exact_reference_policies(self):
        result = self.solve()
        self.assertEqual(result["policyCount"], 3)
        self.assertEqual(result["ballot"]["candidateCount"], 3)
        self.assertFalse(result["pauseUnavailable"])
        self.assertEqual(result["selected"]["usPolicy"], PAUSE)
        self.assertEqual(result["statusQuo"]["usPolicy"], CURRENT)
        self.assertEqual(result["baseline"]["usPolicy"], BASELINE_POLICY)
        self.assertEqual(result["leading"]["usPolicy"]["id"], result["ballot"]["leadingPolicyId"])
        self.assertEqual(result["selection"], "domestic-ballot")
        self.assertNotIn("treaty", result)
        self.assertEqual(json.loads(json.dumps(result)), result)

    def test_pause_unavailable_removes_both_actors_pause_but_keeps_diagnostic_baseline(self):
        result = self.solve(mode="strategic", pauseUnavailable=True)
        self.assertTrue(result["pauseUnavailable"])
        self.assertEqual(result["policyCount"], 2)
        self.assertEqual(result["foreignPolicyCount"], 2)
        self.assertNotEqual(result["selected"]["usPolicy"]["pace"], 0)
        self.assertNotEqual(result["selected"]["foreignPolicy"]["pace"], 0)
        self.assertNotEqual(result["foreignBestPolicy"]["pace"], 0)
        self.assertEqual(result["baseline"]["usPolicy"]["pace"], 0)
        self.assertEqual(result["baseline"]["foreignPolicy"]["pace"], 0)
        for alternative in result["alternatives"]:
            self.assertNotEqual(alternative["usPolicy"]["pace"], 0)
            self.assertNotEqual(alternative["foreignPolicy"]["pace"], 0)

    def test_old_pace_constraints_do_not_restrict_election(self):
        self.assertEqual(self.solve(pace=0), self.solve(pace=1))
        self.assertEqual(self.solve(pauseUnavailable=False), self.solve())

    def test_only_top_eight_profiles_are_materialized(self):
        menu = [{**CURRENT, "id": f"choice-{i:02d}"} for i in range(12)] + [CURRENT]
        with (
            patch.object(simulation, "solve_model", side_effect=fake_model),
            patch.object(simulation, "POLICIES", menu),
        ):
            result = simulation.solve_scenario({"inputs": {}, "mode": "us-only"})
        self.assertEqual(result["policyCount"], 13)
        self.assertEqual(len(result["alternatives"]), 8)
        self.assertEqual(result["selected"]["usPolicy"], CURRENT)

    def test_invalid_settings_do_not_silently_change_the_game(self):
        for changes in ({"mode": "invalid"}, {"foreignObjective": "invalid"}, {"pauseUnavailable": "false"}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.solve(**changes)


class ComparisonTests(unittest.TestCase):
    def request(self, **changes):
        return {
            "scenario": {"inputs": {}, "mode": "us-only"},
            "policyId": CURRENT["id"],
            "selectedPolicyId": CURRENT["id"],
            **changes,
        }

    def test_pairwise_preferences_use_population_weights_and_preserve_indifference(self):
        self.assertEqual(count_votes([2, 0], [0, 0], [3, 1]), 75)
        self.assertEqual(count_votes([2, 0], [0, 0], [300, 100]), 75)
        self.assertEqual(count_votes([0, 0], [0, 0], [3, 1]), 0)
        self.assertEqual(count_votes([1 + EQUILIBRIUM_TOLERANCE / 2], [1], [1]), 0)

    def test_comparison_returns_profile_and_separate_pairwise_share(self):
        def evaluate(values, policy, foreign, mode, objective, foreign_objective):
            return {
                "usPolicy": policy,
                "usUtilities": [1] * len(CALIBRATION["weights"]),
                "usAdmissible": False,
            }

        with patch("calculator.comparison.evaluate_profile", side_effect=evaluate):
            result = compare_policy(self.request())
        self.assertEqual(result["voteShare"], 0)
        self.assertFalse(result["profile"]["usAdmissible"])

    def test_invalid_or_unavailable_policy_ids_are_rejected(self):
        for request in (
            self.request(policyId="nonexistent"),
            self.request(selectedPolicyId="nonexistent"),
            self.request(scenario={"mode": "us-only", "pauseUnavailable": True}, policyId=PAUSE["id"]),
            self.request(
                scenario={"mode": "us-only", "pauseUnavailable": True}, selectedPolicyId=PAUSE["id"]
            ),
            self.request(scenario={"mode": "strategic"}),
            self.request(foreignPolicyId=CURRENT["id"]),
            self.request(
                scenario={"mode": "strategic", "pauseUnavailable": True}, foreignPolicyId=PAUSE["id"]
            ),
        ):
            with self.subTest(request=request), self.assertRaises(ValueError):
                compare_policy(request)

    def test_pairwise_invalid_numbers_or_population_shapes_fail_closed(self):
        for challenger, incumbent, weights in (
            ([0], [0], []),
            ([0], [0], [0]),
            ([0], [0], [-1]),
            ([math.inf], [0], [1]),
            ([0], [math.nan], [1]),
            ([0, 0], [0], [1]),
            ([0], [0], [math.inf]),
        ):
            with self.assertRaises(ValueError):
                count_votes(challenger, incumbent, weights)


if __name__ == "__main__":
    unittest.main()
