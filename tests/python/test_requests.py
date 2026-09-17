"""Untrusted API request validation and generated presentation boundaries."""

import itertools
import unittest

from calculator.artifacts import common_scenarios, presentation_config, scenario_key
from calculator.config import DEFAULT_INPUTS, GROWTH_BASELINE, normalize_inputs
from calculator.policies import INTERNATIONAL_POLICIES, POLICIES, current_policy
from calculator.requests import comparison_request, scenario_request


class RequestValidation(unittest.TestCase):
    def test_defaults_and_bounds(self):
        self.assertEqual(scenario_request({})["inputs"], DEFAULT_INPUTS)
        self.assertFalse(scenario_request({})["statusQuoUnavailable"])
        self.assertTrue(scenario_request({"statusQuoUnavailable": True})["statusQuoUnavailable"])
        self.assertEqual(scenario_request({"inputs": {"jobsAffected": 2}})["inputs"]["jobsAffected"], 1)

    def test_job_count_constraint_holds_for_every_published_grid_combination(self):
        for change in (step / 20 for step in range(-20, 21)):
            for affected in (step / 20 for step in range(21)):
                supplied = {"jobChange": change, "jobsAffected": affected}
                direct = normalize_inputs(supplied)
                requested = scenario_request({"inputs": supplied})["inputs"]
                with self.subTest(change=change, affected=affected):
                    self.assertEqual(direct, requested)
                    self.assertEqual(direct["jobChange"], change)
                    self.assertEqual(direct["jobsAffected"], max(affected, -change, 0))
        self.assertEqual(normalize_inputs({"jobChange": -1, "jobsAffected": 0})["jobsAffected"], 1)
        self.assertEqual(normalize_inputs({"jobChange": 1, "jobsAffected": 0})["jobsAffected"], 0)

    def test_precomputed_and_default_inputs_are_canonical_and_physically_possible(self):
        self.assertEqual(DEFAULT_INPUTS["jobChange"], -0.9)
        self.assertEqual(DEFAULT_INPUTS["jobsAffected"], 1)
        self.assertEqual(DEFAULT_INPUTS["jobSearch"], 0.85)
        for _, request in common_scenarios():
            inputs = request["inputs"]
            self.assertEqual(inputs, normalize_inputs(inputs))
            self.assertEqual(set(inputs), set(DEFAULT_INPUTS))
            self.assertGreaterEqual(inputs["jobsAffected"], max(0, -inputs["jobChange"]))
        self.assertEqual(
            scenario_key({"inputs": {"jobChange": -1, "jobsAffected": 0}}),
            scenario_key({"inputs": {"jobChange": -1, "jobsAffected": 1}}),
        )

    def test_old_success_rates_do_not_become_search_preferences(self):
        for old_rate in (0, 0.5, 1):
            request = scenario_request({"inputs": {"reemployment": old_rate}})
            self.assertEqual(request["inputs"]["jobSearch"], DEFAULT_INPUTS["jobSearch"])
            self.assertNotIn("reemployment", request["inputs"])
        old = scenario_request(
            {"inputs": {"displacement": 0.7, "usGdpGrowth": 0.05, "foreignGdpGrowth": 0.05}}
        )["inputs"]
        self.assertEqual(old["jobChange"], -0.7)
        self.assertEqual(old["jobsAffected"], 0.7)
        self.assertAlmostEqual(old["usAiGrowth"], 0.05 - GROWTH_BASELINE["us"])
        self.assertAlmostEqual(old["foreignAiGrowth"], 0.05 - GROWTH_BASELINE["foreign"])
        explicit = scenario_request({"inputs": {"reemployment": 0, "jobSearch": 0.6}})["inputs"]
        self.assertEqual(explicit["jobSearch"], 0.6)

    def test_invalid_values_are_rejected(self):
        invalid = [
            None,
            [],
            3,
            {"mode": []},
            {"foreignObjective": {}},
            {"mode": "other"},
            {"pauseUnavailable": 1},
            {"statusQuoUnavailable": 1},
            {"statusQuoUnavailable": "false"},
            {"statusQuoUnavailable": None},
            {"inputs": []},
            {"inputs": {"unknown": 1}},
            {"inputs": {"jobsAffected": True}},
            {"inputs": {"jobsAffected": float("nan")}},
            {"inputs": {"jobsAffected": float("inf")}},
            {"inputs": {"jobChange": True}},
            {"inputs": {"jobSearch": float("nan")}},
            {"inputs": {"reemployment": True}},
            {"id": True},
            {"id": 2**53},
            {"id": 1.5},
            {"inputs": {"usAiGrowth": 10**400}},
        ]
        for value in invalid:
            with self.subTest(value=value), self.assertRaises(ValueError):
                scenario_request(value)

    def test_comparison_requires_foreign_choice_in_strategic_mode(self):
        value = {
            "scenario": {"mode": "strategic"},
            "policyId": current_policy(1)["id"],
            "selectedPolicyId": current_policy(1)["id"],
        }
        with self.assertRaises(ValueError):
            comparison_request(value)
        self.assertEqual(
            comparison_request({**value, "foreignPolicyId": current_policy(1)["id"]})["foreignPolicyId"],
            current_policy(1)["id"],
        )

    def test_cache_separates_every_relevant_setting(self):
        base = {"inputs": DEFAULT_INPUTS, "mode": "strategic"}
        key = scenario_key(base)
        for name, value in DEFAULT_INPUTS.items():
            self.assertNotEqual(key, scenario_key({**base, "inputs": {**DEFAULT_INPUTS, name: value / 2}}))
        self.assertNotEqual(key, scenario_key({**base, "pauseUnavailable": True}))
        self.assertNotEqual(key, scenario_key({**base, "statusQuoUnavailable": True}))
        self.assertEqual(key, scenario_key({**base, "statusQuoUnavailable": False}))
        self.assertNotEqual(key, scenario_key({**base, "mode": "us-only"}))
        self.assertNotEqual(key, scenario_key({**base, "foreignObjective": "output"}))
        self.assertEqual(
            scenario_key({"mode": "us-only", "foreignObjective": "workers"}),
            scenario_key({"mode": "us-only", "foreignObjective": "output"}),
        )
        self.assertEqual(
            scenario_key({"inputs": {"jobsAffected": 1}}), scenario_key({"inputs": {"jobsAffected": 1.0}})
        )
        self.assertEqual(len({scenario_key(value) for _, value in common_scenarios()}), 32)

    def test_rendered_options_serialize_exactly_the_policy_menu(self):
        options = presentation_config()["policyOptions"]
        axes = ("pace", "replacement", "welfareScale", "benefitFormula", "laborTax", "capitalTax")
        domestic = {
            "|".join(parts)
            for parts in itertools.product(*([option["idPart"] for option in options[axis]] for axis in axes))
        }
        self.assertEqual(domestic, {policy["id"] for policy in POLICIES})
        international = {
            "|".join(part for part in parts if part)
            for parts in itertools.product(
                *([option["idPart"] for option in options[axis]] for axis in (*axes, "allowFreeTrade"))
            )
        }
        self.assertEqual(international, {policy["id"] for policy in INTERNATIONAL_POLICIES})
        self.assertEqual(
            options["allowFreeTrade"],
            [{"value": True, "idPart": ""}, {"value": False, "idPart": "closed"}],
        )

    def test_comparison_validates_trade_choices_for_both_actors(self):
        current = current_policy()["id"]
        closed = current + "|closed"
        request = {
            "scenario": {"mode": "strategic"},
            "policyId": closed,
            "selectedPolicyId": current,
            "foreignPolicyId": closed,
        }
        self.assertEqual(comparison_request(request)["policyId"], closed)
        self.assertEqual(comparison_request(request)["foreignPolicyId"], closed)
        domestic = {key: value for key, value in request.items() if key != "foreignPolicyId"}
        domestic["scenario"] = {"mode": "us-only"}
        with self.assertRaises(ValueError):
            comparison_request(domestic)
        with self.assertRaises(ValueError):
            comparison_request({**request, "policyId": current + "|open"})


if __name__ == "__main__":
    unittest.main()
