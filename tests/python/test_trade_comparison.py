"""Manual comparisons share the election's domestic/international trade menus."""

import unittest
from unittest.mock import patch

from calculator.careers import voter_weights
from calculator.comparison import compare_policy
from calculator.policies import current_policy
from calculator.population import CALIBRATION


class TradeComparisonTests(unittest.TestCase):
    def test_international_comparison_passes_both_trade_choices_to_the_engine(self):
        opened = current_policy()["id"]
        closed = opened + "|closed"
        seen = []

        def evaluate(values, policy, foreign, mode, objective, foreign_objective):
            seen.append((policy["allowFreeTrade"], foreign["allowFreeTrade"]))
            return {
                "usPolicy": policy,
                "foreignPolicy": foreign,
                "usUtilities": [int(not policy["allowFreeTrade"])]
                * len(voter_weights(CALIBRATION["weights"])),
                "usAdmissible": True,
            }

        request = {
            "scenario": {"mode": "strategic"},
            "policyId": closed,
            "selectedPolicyId": opened,
            "foreignPolicyId": closed,
        }
        with patch("calculator.comparison.evaluate_profile", side_effect=evaluate):
            result = compare_policy(request)
        self.assertEqual(seen, [(False, False), (True, False)])
        self.assertAlmostEqual(result["voteShare"], 100)

    def test_closed_trade_cannot_be_compared_in_domestic_mode(self):
        opened = current_policy()["id"]
        for changed in ("policyId", "selectedPolicyId"):
            request = {
                "scenario": {"mode": "us-only"},
                "policyId": opened,
                "selectedPolicyId": opened,
                changed: opened + "|closed",
            }
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                compare_policy(request)


if __name__ == "__main__":
    unittest.main()
