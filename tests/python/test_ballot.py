"""Hand-calculated ballot fixtures independent of the economic implementation."""

import itertools
import math
import unittest

from calculator.ballot import package_has_majority, tally_package_ballot


def candidate(policy_id, utilities, funded=True):
    return {"id": policy_id, "utilities": utilities, "fullyFunded": funded}


class BallotTests(unittest.TestCase):
    def test_each_citizen_has_one_favorite_and_majority_enacts(self):
        result = tally_package_ballot(
            [
                candidate("current", [0, 0, 0]),
                candidate("protect", [3, 3, 0]),
                candidate("dividend", [0, 1, 2]),
            ],
            [30, 25, 45],
            "current",
        )
        self.assertEqual(result["voterChoices"], ["protect", "protect", "dividend"])
        self.assertEqual(result["winnerId"], "protect")
        self.assertEqual(result["topSupportPercent"], 55)
        self.assertEqual(sum(row["supportPercent"] for row in result["tallies"]), 100)
        self.assertEqual(result["totalPopulationWeight"], 100)

    def test_split_or_exact_half_retains_exact_current_policy(self):
        for weights in ([40, 35, 25], [50, 25, 25]):
            result = tally_package_ballot(
                [
                    candidate("current", [0, 0, 0]),
                    candidate("a", [2, 0, 0]),
                    candidate("b", [0, 2, 0]),
                    candidate("c", [0, 0, 2]),
                ],
                weights,
                "current",
            )
            self.assertIsNone(result["winnerId"])
            self.assertEqual(result["enactedPolicyId"], "current")
            self.assertEqual(result["statusQuoReason"], "no-majority")

    def test_exact_ties_prefer_current_then_canonical_id_in_any_order(self):
        menu = [candidate("current", [1, 0]), candidate("z", [1, 2]), candidate("a", [1, 2])]
        results = [tally_package_ballot(order, [1, 1], "current") for order in itertools.permutations(menu)]
        self.assertTrue(all(result == results[0] for result in results))
        self.assertEqual(results[0]["voterChoices"], ["current", "a"])
        self.assertEqual(results[0]["leadingPolicyId"], "a")

    def test_arbitrarily_small_utility_advantage_is_not_a_tie(self):
        result = tally_package_ballot(
            [
                candidate("current", [1]),
                candidate("a", [1 + 1e-14]),
            ],
            [1],
            "current",
        )
        self.assertEqual(result["winnerId"], "a")

    def test_funding_is_required_even_for_most_attractive_current_policy(self):
        result = tally_package_ballot(
            [
                candidate("current", [100, 100], False),
                candidate("a", [2, 0]),
                candidate("b", [0, 2]),
            ],
            [1, 1],
            "current",
        )
        self.assertFalse(result["statusQuoFullyFunded"])
        self.assertEqual(result["voterChoices"], ["a", "b"])
        self.assertEqual(result["enactedPolicyId"], "current")
        self.assertEqual(result["unfundedCandidateCount"], 1)
        self.assertEqual(result["eligibleCandidateCount"], 2)
        self.assertEqual(result["candidateCount"], 3)

    def test_no_funded_menu_has_no_votes_and_reports_fallback(self):
        result = tally_package_ballot([candidate("current", [0], False)], [1], "current")
        self.assertEqual(result["tallies"], [])
        self.assertEqual(result["voterChoices"], [None])
        self.assertIsNone(result["leadingPolicyId"])
        self.assertEqual(result["statusQuoReason"], "no-eligible-policies")
        self.assertEqual(result["enactedPolicyId"], "current")

    def test_weights_are_population_not_income_and_scale_does_not_change_vote(self):
        menu = [candidate("current", [0, 2]), candidate("a", [1, 0])]
        small = tally_package_ballot(iter(menu), [0.6, 0.4], "current")
        large = tally_package_ballot(iter(menu), [6e8, 4e8], "current")
        self.assertEqual(small["winnerId"], large["winnerId"])
        self.assertEqual(small["topSupportPercent"], large["topSupportPercent"])

    def test_bad_weights_fail_closed(self):
        for weights in ([], [0], [-1], [math.inf], [math.nan]):
            with self.subTest(weights=weights), self.assertRaises(ValueError):
                tally_package_ballot([candidate("current", [0])], weights, "current")

    def test_invalid_candidates_are_rejected_even_when_underfunded(self):
        bad_menus = [
            [candidate("current", [0]), candidate("current", [0])],
            [candidate("", [0])],
            [candidate("other", [0])],
            [{"id": "current", "utilities": [0]}],
            [candidate("current", [0, 1])],
            [candidate("current", [math.nan], False)],
            [candidate("current", [math.inf], False)],
        ]
        for menu in bad_menus:
            with self.subTest(menu=menu), self.assertRaises(ValueError):
                tally_package_ballot(menu, [1], "current")

    def test_majority_tolerance_only_absorbs_population_roundoff(self):
        self.assertFalse(package_has_majority(50))
        self.assertFalse(package_has_majority(50 + 1e-12))
        self.assertTrue(package_has_majority(50 + 1e-8))


if __name__ == "__main__":
    unittest.main()
