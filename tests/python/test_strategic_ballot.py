"""Compromise and coalition stability with transparent preference tables."""

import itertools
import unittest

from calculator.strategic_ballot import strategic_package_ballot


def candidate(key, utilities, funded=True):
    return {"id": key, "utilities": utilities, "fullyFunded": funded}


class StrategicVotingTests(unittest.TestCase):
    def test_second_choice_compromise_escapes_split_vote_fallback(self):
        menu = [
            candidate("current", [0, 0, 0]),
            candidate("a", [3, 0, 0]),
            candidate("b", [0, 3, 0]),
            candidate("compromise", [2, 2, 1]),
        ]
        result = strategic_package_ballot(menu, [40, 35, 25], "current")
        self.assertEqual(result["enactedPolicyId"], "compromise")
        self.assertEqual(result["topSupportPercent"], 100)
        self.assertEqual(result["coordination"]["sincereEnactedPolicyId"], "current")
        self.assertEqual(result["coordination"]["strategicVoterPercent"], 75)
        self.assertTrue(result["coordination"]["stable"])

    def test_plurality_compromise_can_win_below_half(self):
        menu = [
            candidate("current", [0, 0, 0, 0]),
            candidate("a", [3, 0, 0, 0]),
            candidate("b", [0, 3, 2, 0]),
            candidate("c", [0, 2, 3, 0]),
            candidate("d", [0, 0, 0, 3]),
        ]
        result = strategic_package_ballot(menu, [35, 25, 20, 20], "current", True)
        self.assertEqual(result["winnerId"], "b")
        self.assertEqual(result["topSupportPercent"], 45)
        self.assertEqual(result["coordination"]["strategicVoterPercent"], 20)
        self.assertTrue(result["coordination"]["stable"])

    def test_unfunded_compromise_and_excluded_current_never_receive_votes(self):
        menu = [
            candidate("current", [9, 9, 9]),
            candidate("a", [3, 0, 0]),
            candidate("b", [0, 3, 0]),
            candidate("compromise", [8, 8, 8], False),
        ]
        result = strategic_package_ballot(menu, [40, 35, 25], "current", True)
        self.assertNotIn("compromise", result["voterChoices"])
        self.assertNotIn("current", result["voterChoices"])

    def test_exact_half_cannot_force_a_majority(self):
        menu = [candidate("current", [0, 0, 2]), candidate("a", [3, 1, 0]), candidate("b", [1, 3, 0])]
        result = strategic_package_ballot(menu, [25, 25, 50], "current")
        self.assertEqual(result["enactedPolicyId"], "current")
        self.assertTrue(result["coordination"]["stable"])

    def test_zero_weight_people_cannot_create_a_coalition(self):
        result = strategic_package_ballot(
            [candidate("current", [1, 0]), candidate("a", [0, 100])], [1, 0], "current"
        )
        self.assertEqual(result["winnerId"], "current")

    def test_cycles_and_limits_always_select_a_recorded_funded_outcome(self):
        menu = [
            candidate("current", [0, 0, 0]),
            candidate("a", [3, 1, 2]),
            candidate("b", [2, 3, 1]),
            candidate("c", [1, 2, 3]),
        ]
        result = strategic_package_ballot(menu, [1, 1, 1], "current")
        self.assertFalse(result["coordination"]["stable"])
        self.assertEqual(result["coordination"]["reason"], "cycle")
        self.assertEqual(result["coordination"]["resolution"], "most-supported-recorded-ballot")
        self.assertIn(result["winnerId"], {"a", "b", "c"})
        self.assertGreater(result["topSupportPercent"], 50)
        limited = strategic_package_ballot(menu, [1, 1, 1], "current", max_steps=1)
        self.assertFalse(limited["coordination"]["stable"])
        self.assertEqual(limited["coordination"]["reason"], "step-limit")

    def test_menu_order_does_not_change_the_coordination_agenda(self):
        menu = [
            candidate("current", [0, 0, 0]),
            candidate("a", [3, 1, 1]),
            candidate("b", [1, 3, 1]),
            candidate("c", [1, 1, 3]),
        ]
        outcomes = [
            strategic_package_ballot(order, [40, 35, 25], "current") for order in itertools.permutations(menu)
        ]
        self.assertTrue(all(result == outcomes[0] for result in outcomes))

    def test_scalar_check_restores_strict_near_boundary_preferences(self):
        exact = [
            candidate("current", [1, 1, 1]),
            candidate("a", [2, 0, 0]),
            candidate("b", [0, 2, 0]),
            candidate("compromise", [1 + 1e-12] * 3),
        ]
        approximate = [dict(c) for c in exact]
        approximate[-1] = candidate("compromise", [1 - 1e-12] * 3)
        by_id = {c["id"]: c for c in exact}
        result = strategic_package_ballot(
            approximate, [40, 35, 25], "current", exact_candidate=by_id.__getitem__
        )
        self.assertEqual(result["winnerId"], "compromise")
        self.assertEqual(result["topSupportPercent"], 100)

    def test_no_funded_package_keeps_fallback_without_inventing_votes(self):
        result = strategic_package_ballot([candidate("current", [0], False)], [1], "current")
        self.assertIsNone(result["winnerId"])
        self.assertEqual(result["tallies"], [])
        self.assertTrue(result["coordination"]["stable"])

    def test_stable_results_have_no_profitable_single_package_coalition(self):
        """Check subsets for passing challengers under the disclosed protocol.

        Deliberate vote splitting to trigger fallback is outside this protocol;
        fallback itself is not a passing coalition-backed challenger.
        """
        import random

        rng = random.Random(816)
        weights = [31, 27, 23, 19]
        for plurality in (False, True):
            for _ in range(60):
                menu = [
                    candidate(key, [rng.randrange(6) for _ in weights])
                    for key in ("current", "a", "b", "c", "d")
                ]
                result = strategic_package_ballot(menu, weights, "current", plurality)
                eligible = sorted(c["id"] for c in menu if not (plurality and c["id"] == "current"))
                utilities = {c["id"]: c["utilities"] for c in menu}
                self.assertIn(result["enactedPolicyId"], utilities)
                self.assertAlmostEqual(sum(row["supportPercent"] for row in result["tallies"]), 100)
                if not result["coordination"]["stable"]:
                    continue
                current = result["enactedPolicyId"]
                for challenger in eligible:
                    supporters = [i for i in range(4) if utilities[challenger][i] > utilities[current][i]]
                    # Test every subset, not just the maximal coalition used by the solver.
                    for count in range(1, len(supporters) + 1):
                        for members in itertools.combinations(supporters, count):
                            choices = list(result["voterChoices"])
                            for i in members:
                                choices[i] = challenger
                            tally = {
                                key: sum(weights[i] for i, choice in enumerate(choices) if choice == key)
                                for key in eligible
                            }
                            leader = min(eligible, key=lambda key: (-tally[key], key))
                            outcome = leader if plurality or tally[leader] > 50 else None
                            self.assertFalse(outcome == challenger and challenger != current, (plurality, menu, result, challenger, members, tally))
