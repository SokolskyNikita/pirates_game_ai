"""Preserve calibration and verify revised elections against scalar evaluation.

The archived TypeScript fixture supplies regression scenarios and the unchanged
initial economy. Its post-AI trajectories are superseded by scarce job slots,
sticky wage contracts and baseline-plus-AI growth.
"""

import json
import math
import unittest
from pathlib import Path

from calculator.ballot import tally_package_ballot
from calculator.config import DEFAULT_INPUTS
from calculator.model import evaluate_profile, solve_model
from calculator.policies import POLICIES, current_policy, policies_for_mode
from calculator.population import CALIBRATION
from calculator.simulation import solve_scenario

ORACLE = json.loads((Path(__file__).parents[1] / "fixtures/typescript-parity.json").read_text())


def revised_inputs(old):
    """Translate old scenario intent explicitly, without relying on URL aliases."""
    return {
        **{key: value for key, value in old.items() if key in DEFAULT_INPUTS},
        "usAiGrowth": old["usGdpGrowth"],
        "foreignAiGrowth": old["foreignGdpGrowth"],
        "jobsAffected": old["displacement"],
        "jobChange": -old["displacement"],
        "jobSearch": old["reemployment"],
    }


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

    def test_domestic_initial_economy_and_materialized_scalar_utilities(self):
        for case in ORACLE["profiles"]:
            if case["mode"] != "us-only":
                continue
            with self.subTest(case=case["name"]):
                inputs = revised_inputs(case["inputs"])
                actual = evaluate_profile(inputs, case["us"], mode="us-only")
                self.assert_structure(actual["us"][0], case["outcome"]["us"][0], case["name"])
                scalar = solve_model(inputs, {"mode": "us-only", "objective": "workers"})
                light = scalar["evaluateLight"](case["us"])
                self.assertEqual(actual["usUtilities"], light["usUtilities"])
                self.assertEqual(actual["usAdmissible"], light["usAdmissible"])
                self.assertEqual(actual["usScore"], light["usScore"])

    def test_domestic_common_ballots_match_full_scalar_menu(self):
        for case in ORACLE["snapshots"]:
            if case["request"]["mode"] != "us-only":
                continue
            request = {**case["request"], "inputs": revised_inputs(case["request"]["inputs"])}
            with self.subTest(request=request):
                actual = solve_scenario(request)
                model = solve_model(request["inputs"], {"mode": "us-only", "objective": "workers"})
                menu = policies_for_mode("us-only", request.get("pauseUnavailable", False))
                profiles = [model["evaluateLight"](policy) for policy in menu]
                expected = tally_package_ballot(
                    [
                        {
                            "id": p["usPolicy"]["id"],
                            "utilities": p["usUtilities"],
                            "fullyFunded": p["usAdmissible"],
                        }
                        for p in profiles
                    ],
                    CALIBRATION["weights"],
                    current_policy()["id"],
                )
                # Exact vote allocations and funding eligibility, not merely the winner.
                self.assertEqual(actual["ballot"], expected)
                self.assertEqual(actual["selected"]["usPolicy"]["id"], expected["enactedPolicyId"])
                selected = model["evaluate"](actual["selected"]["usPolicy"])
                self.assertEqual(actual["selected"]["us"], selected["us"])
                self.assertEqual(actual["selected"]["usUtilities"], selected["usUtilities"])


if __name__ == "__main__":
    unittest.main()
