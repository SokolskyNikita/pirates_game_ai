"""Regression oracle captured from the deployed TypeScript engine before removal."""

import json
import math
import unittest
from pathlib import Path

from calculator.model import evaluate_profile
from calculator.policies import POLICIES
from calculator.population import CALIBRATION
from calculator.simulation import solve_scenario

ORACLE = json.loads((Path(__file__).parents[1] / "fixtures/typescript-parity.json").read_text())


class MigrationParity(unittest.TestCase):
    def assert_structure(self, actual, expected, location="result"):
        if isinstance(expected, dict):
            for key, value in expected.items():
                self.assertIn(key, actual, f"{location}.{key}")
                self.assert_structure(actual[key], value, f"{location}.{key}")
        elif isinstance(expected, list):
            self.assertEqual(len(actual), len(expected), location)
            for index, (left, right) in enumerate(zip(actual, expected, strict=True)):
                self.assert_structure(left, right, f"{location}[{index}]")
        elif isinstance(expected, (int, float)) and not isinstance(expected, bool):
            self.assertTrue(
                math.isclose(actual, expected, rel_tol=1e-11, abs_tol=1e-10),
                f"{location}: {actual} != {expected}",
            )
        else:
            self.assertEqual(actual, expected, location)

    def test_calibration_and_entire_policy_menu(self):
        self.assertEqual(CALIBRATION, ORACLE["calibration"])
        self.assertEqual([policy["id"] for policy in POLICIES], ORACLE["policyIds"])

    def test_economic_trajectories(self):
        for case in ORACLE["profiles"]:
            with self.subTest(case=case["name"]):
                actual = evaluate_profile(case["inputs"], case["us"], case.get("foreign"), case["mode"])
                self.assert_structure(actual, case["outcome"], case["name"])

    def test_all_common_scenario_ballots_and_trajectories(self):
        for case in ORACLE["snapshots"]:
            with self.subTest(request=case["request"]):
                actual = solve_scenario(case["request"])
                expected = case["expected"]
                # Vote allocations, not merely outcomes, are an exact migration contract.
                self.assertEqual(actual["ballot"], expected["ballot"])
                self.assertEqual(actual["selected"]["usPolicy"], expected["selected"]["usPolicy"])
                self.assert_structure(actual, expected)


if __name__ == "__main__":
    unittest.main()
