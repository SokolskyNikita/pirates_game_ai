"""Vectorization must preserve funded menus and exact scalar voting choices."""

import math
import random
import unittest
from unittest.mock import patch

import numpy as np

from calculator.ballot import tally_package_ballot
from calculator.batch import (
    FUNDING_RECHECK_GUARD,
    UTILITY_RECHECK_GUARD,
    _evaluate_chunk,
    evaluate_foreign_menu,
    evaluate_us_menu,
)
from calculator.config import INPUT_SPECS, normalize_inputs
from calculator.model import solve_model
from calculator.policies import POLICIES, current_policy
from calculator.population import PREPARED


def ballot(profiles):
    return tally_package_ballot(
        [
            {"id": p["usPolicy"]["id"], "utilities": p["usUtilities"], "fullyFunded": p["usAdmissible"]}
            for p in profiles
        ],
        PREPARED.calibration["weights"],
        current_policy()["id"],
    )


def reduced_menu():
    # All policy dimensions, exact baseline and both deployment endpoints.
    return list(
        {
            policy["id"]: policy
            for policy in [
                *POLICIES[::67],
                current_policy(0),
                current_policy(1),
                current_policy(2),
                POLICIES[-1],
                POLICIES[0],
            ]
        }.values()
    )


class BatchTests(unittest.TestCase):
    def test_raw_profiles_match_scalar_throughout_parameter_bounds(self):
        rng = random.Random(417)
        scenarios = [
            normalize_inputs(),
            normalize_inputs({"jobsAffected": 1, "jobChange": -1, "jobSearch": 0}),
            normalize_inputs({s["key"]: s["min"] for s in INPUT_SPECS}),
            normalize_inputs({s["key"]: s["max"] for s in INPUT_SPECS}),
        ]
        scenarios.extend(
            normalize_inputs({s["key"]: rng.uniform(s["min"], s["max"]) for s in INPUT_SPECS})
            for _ in range(8)
        )
        menu = reduced_menu()
        max_utility_error = max_score_error = 0
        for index, inputs in enumerate(scenarios):
            foreign = current_policy(index % 3) if index % 4 else None
            objective = ("workers", "prosperity", "output")[index % 3]
            model = solve_model(
                inputs,
                {
                    "mode": "strategic" if foreign else "us-only",
                    "objective": "workers",
                    "foreignObjective": objective,
                },
            )
            actual, _, _ = _evaluate_chunk(
                inputs, menu, [foreign] * len(menu) if foreign else None, objective, PREPARED
            )
            for policy, profile in zip(menu, actual, strict=True):
                with self.subTest(case=index, policy=policy["id"]):
                    expected = model["evaluateLight"](policy, foreign)
                    self.assertEqual(profile["usAdmissible"], expected["usAdmissible"])
                    error = np.max(np.abs(np.asarray(profile["usUtilities"]) - expected["usUtilities"]))
                    max_utility_error = max(max_utility_error, error)
                    if foreign:
                        self.assertEqual(profile["foreignAdmissible"], expected["foreignAdmissible"])
                        max_score_error = max(
                            max_score_error, abs(profile["foreignScore"] - expected["foreignScore"])
                        )
        # NumPy and scalar libm rounding differ across supported platforms.
        # Keep raw errors at least 100 times below the scalar-recheck guard;
        # the separate certification tests still require exactly equal ballots.
        raw_error_limit = UTILITY_RECHECK_GUARD / 100
        self.assertLess(max_utility_error, raw_error_limit)
        self.assertLess(max_score_error, raw_error_limit)

    def test_certified_full_domestic_ballot_exactly_matches_scalar(self):
        inputs = normalize_inputs(
            {"productivityGain": 0.5, "jobsAffected": 1, "jobChange": -1, "jobSearch": 0}
        )
        model = solve_model(inputs, {"mode": "us-only", "objective": "workers"})
        expected = [model["evaluateLight"](policy) for policy in POLICIES]
        actual = evaluate_us_menu(inputs, POLICIES, None, "prosperity", model["evaluateLight"])
        self.assertEqual(ballot(actual), ballot(expected))
        self.assertEqual([p["usAdmissible"] for p in actual], [p["usAdmissible"] for p in expected])

    def test_chunk_size_and_policy_order_do_not_change_exact_ballot(self):
        inputs = normalize_inputs()
        model = solve_model(inputs, {"mode": "strategic", "objective": "workers"})
        menu = reduced_menu()
        foreign = current_policy(2)
        expected = ballot([model["evaluateLight"](policy, foreign) for policy in menu])
        for size in (1, 31, 256):
            actual = evaluate_us_menu(
                inputs, list(reversed(menu)), foreign, "prosperity", model["evaluateLight"], chunk_size=size
            )
            self.assertEqual(ballot(actual), expected)

    def test_foreign_best_responses_have_exact_scalar_scores_and_funding(self):
        inputs = normalize_inputs(
            {
                "jobsAffected": 1,
                "jobChange": -1,
                "jobSearch": 0,
                "capitalMobility": 1,
                "investmentResponse": 1,
            }
        )
        for objective in ("workers", "prosperity", "output"):
            model = solve_model(
                inputs, {"mode": "strategic", "objective": "workers", "foreignObjective": objective}
            )
            us, menu = current_policy(), reduced_menu()
            expected = [model["evaluateForeign"](us, policy) for policy in menu]
            actual = evaluate_foreign_menu(inputs, us, menu, objective, model["evaluateForeign"])
            self.assertEqual(
                [math.isfinite(score) for score in actual], [math.isfinite(score) for score in expected]
            )
            self.assertEqual(max(actual), max(expected))
            self.assertEqual(
                [p["id"] for p, score in zip(menu, actual, strict=True) if score == max(actual)],
                [p["id"] for p, score in zip(menu, expected, strict=True) if score == max(expected)],
            )

    def test_numerical_guard_recomputes_contenders_without_changing_tie_rule(self):
        policies = [current_policy(0), current_policy(1), current_policy(2)]
        # Deliberately invert a narrow real preference in the approximate pass.
        exact_scores = [1 + 3e-12, 1 + 2e-12, -1]
        profiles = [
            {
                "usPolicy": p,
                "usUtilities": [1 + (1e-12 if i == 1 else 0)] if i < 2 else [-1],
                "usAdmissible": True,
            }
            for i, p in enumerate(policies)
        ]
        calls = []

        def scalar(policy, foreign):
            calls.append(policy["id"])
            return {
                "usPolicy": policy,
                "usUtilities": [exact_scores[policies.index(policy)]],
                "usAdmissible": True,
            }

        with (
            patch("calculator.batch._production_paths", return_value=[]),
            patch("calculator.batch._evaluate_chunk", return_value=(profiles, np.ones(3), np.ones(3))),
        ):
            actual = evaluate_us_menu({}, policies, None, "workers", scalar)
        self.assertEqual(calls, [p["id"] for p in policies[:2]])
        self.assertGreater(actual[0]["usUtilities"][0], actual[1]["usUtilities"][0])

    def test_funding_guard_checks_both_sides_of_boundary(self):
        policies = [current_policy(0), current_policy(1), current_policy(2)]
        profiles = [
            {"usPolicy": p, "usUtilities": [10 if i == 0 else 0], "usAdmissible": i == 0}
            for i, p in enumerate(policies)
        ]

        def scalar(policy, foreign):
            return {"usPolicy": policy, "usUtilities": [0], "usAdmissible": policy == policies[1]}

        boundary = np.array([FUNDING_RECHECK_GUARD / 2, FUNDING_RECHECK_GUARD / 2, 1])
        with (
            patch("calculator.batch._production_paths", return_value=[]),
            patch("calculator.batch._evaluate_chunk", return_value=(profiles, boundary, boundary)),
        ):
            actual = evaluate_us_menu({}, policies, None, "workers", scalar)
        self.assertEqual([p["usAdmissible"] for p in actual], [False, True, False])


if __name__ == "__main__":
    unittest.main()
