"""Labor stocks, sticky replacement, and production must agree in both evaluators."""

import random
import unittest

import numpy as np

from calculator.config import GROWTH_BASELINE
from calculator.labor_market import advance_labor, initial_labor
from calculator.model import evaluate_profile
from calculator.policies import current_policy, make_policy


def trajectory(change=-0.9, affected=1, search=0.85, replacement=0):
    state = initial_labor()
    years = []
    for year in range(1, 11):
        state = advance_labor(state, affected * year / 10, change, year / 10, search, replacement)
        years.append(state)
    return years


class LaborMarketTests(unittest.TestCase):
    def test_population_slots_and_wage_bill_are_conserved_with_trade_reversals(self):
        rng = random.Random(9017)
        for _ in range(120):
            change = rng.uniform(-1, 1)
            affected = rng.uniform(max(0, -change), 1)
            search = rng.random()
            replacement = rng.choice([0, 0.5, 1, 1.25])
            state = initial_labor()
            exited = 0
            for year in range(1, 11):
                state = advance_labor(
                    state,
                    affected * year / 10,
                    change,
                    year / 10,
                    search,
                    replacement,
                    rng.uniform(0, 0.4),
                )
                self.assertAlmostEqual(
                    state["employment"] + state["retained"] + state["searching"] + state["exited"], 1
                )
                self.assertLessEqual(state["employment"], min(1, state["slots"]) + 1e-12)
                self.assertLessEqual(state["wage_bill"], state["employment"] + 1e-12)
                self.assertGreaterEqual(state["exited"], exited - 1e-12)
                for key in ("employment", "retained", "searching", "exited", "wage_bill"):
                    self.assertGreaterEqual(state[key], -1e-12)
                exited = state["exited"]

    def test_search_never_recreates_eliminated_jobs(self):
        for search in (0, 0.5, 1):
            last = trajectory(change=-1, search=search)[-1]
            self.assertEqual(last["slots"], 0)
            self.assertEqual(last["employment"], 0)
            self.assertEqual(last["wage_bill"], 0)
            self.assertEqual(last["market_wage"], 0)
            self.assertAlmostEqual(last["searching"] + last["exited"], 1)

    def test_all_roles_can_change_without_reducing_job_count(self):
        for state in trajectory(change=0, search=1):
            self.assertAlmostEqual(state["slots"], 1)
            self.assertAlmostEqual(state["employment"], 1)
            self.assertAlmostEqual(state["wage_bill"], 1)
        absent = trajectory(change=0, search=0)[-1]
        self.assertEqual(absent["slots"], 1)
        self.assertAlmostEqual(absent["employment"], 0)
        self.assertAlmostEqual(absent["exited"], 1)

    def test_competition_changes_only_replaced_contracts_and_preserves_job_count(self):
        no_search = advance_labor(initial_labor(), 0.1, -1, 0.1, 0, 0)
        search = advance_labor(initial_labor(), 0.1, -1, 0.1, 1, 0)
        self.assertAlmostEqual(no_search["employment"], 0.9)
        self.assertAlmostEqual(search["employment"], 0.9)
        self.assertAlmostEqual(search["market_wage"], 0.9)
        self.assertAlmostEqual(search["competitive_displacement"], 0.1)
        # Eight-tenths retain a wage of one; one-tenth are hired at 0.9.
        self.assertAlmostEqual(search["wage_bill"], 0.8 + 0.1 * 0.9)
        self.assertAlmostEqual(no_search["average_wage"], 1)
        self.assertGreater(search["average_wage"], search["market_wage"])
        self.assertLess(search["average_wage"], 1)

    def test_one_replacement_round_is_finite_and_each_layoff_can_exit(self):
        state = advance_labor(initial_labor(), 0.5, -1, 0.5, 0.5, 0)
        self.assertAlmostEqual(state["employment"], 0.5)
        self.assertAlmostEqual(state["competitive_displacement"], 0.25)
        self.assertAlmostEqual(state["searching"], 0.125)
        self.assertAlmostEqual(state["exited"], 0.375)
        self.assertLessEqual(state["competitive_displacement"], state["employment"])

    def test_retention_blocks_firing_and_redeploys_without_double_pay(self):
        state = advance_labor(initial_labor(), 0.5, -1, 0.5, 1, 1)
        self.assertAlmostEqual(state["employment"], 0.5)
        self.assertAlmostEqual(state["retained"], 0.5)
        self.assertEqual(state["competitive_displacement"], 0)
        self.assertEqual(state["searching"], 0)
        self.assertAlmostEqual(state["average_wage"], 1)
        redeployed = trajectory(change=0, search=0, replacement=1)[-1]
        self.assertAlmostEqual(redeployed["employment"], 1)
        self.assertAlmostEqual(redeployed["retained"], 0)
        self.assertAlmostEqual(redeployed["wage_bill"], 1)

    def test_nonsearchers_do_not_return_when_trade_capacity_recovers(self):
        first = advance_labor(initial_labor(), 0, 0, 0, 0, 0, 0.25)
        second = advance_labor(first, 0, 0, 0, 0, 0, 0)
        self.assertEqual(second["slots"], 1)
        self.assertEqual(second["employment"], 0.75)
        self.assertEqual(second["exited"], 0.25)
        self.assertEqual(second["hired"], 0)

    def test_scalar_and_numpy_labor_states_match_without_mutating_old_state(self):
        replacements = np.array([0, 0.5, 1, 1.25])
        states = [initial_labor() for _ in replacements]
        vector = initial_labor(np.zeros(len(replacements)))
        for year in range(1, 11):
            previous = {key: value.copy() for key, value in vector.items()}
            trade = 0.2 if year % 3 else 0.05
            actual = advance_labor(vector, year / 10, -0.65, year / 10, 0.85, replacements, trade, xp=np)
            for index, replacement in enumerate(replacements):
                states[index] = advance_labor(
                    states[index], year / 10, -0.65, year / 10, 0.85, replacement, trade
                )
                for key, expected in states[index].items():
                    self.assertAlmostEqual(
                        np.broadcast_to(actual[key], replacements.shape)[index], expected, places=13, msg=key
                    )
            for key in previous:
                np.testing.assert_array_equal(vector[key], previous[key])
            vector = actual

    def test_extra_unfilled_jobs_do_not_destroy_existing_output_or_create_workers(self):
        inputs = {"jobsAffected": 0, "jobChange": 1, "usAiGrowth": 0, "investmentResponse": 0}
        point = evaluate_profile(inputs, current_policy(), mode="us-only")["us"][-1]
        self.assertEqual(point["jobSlots"], 2)
        self.assertEqual(point["productiveEmployment"], 1)
        self.assertEqual(point["averageWageFactor"], 1)
        self.assertAlmostEqual(point["output"], 100 * (1 + GROWTH_BASELINE["us"]) ** 10)
        self.assertAlmostEqual(point["resourceResidual"], 0, places=8)

    def test_adverse_policy_can_shrink_gdp_despite_positive_ai_growth(self):
        policy = make_policy({**current_policy(), "aiProfitTax": 1, "laborTax": 1})
        points = evaluate_profile({"usAiGrowth": 0.05, "investmentResponse": 1}, policy, mode="us-only")["us"]
        self.assertTrue(any(p["gdpGrowthRate"] < 0 and p["potentialGrowthRate"] > 0 for p in points[1:]))

    def test_settlement_retention_and_competition_keep_resource_accounts_balanced(self):
        for retention in (0, 0.5, 1, 1.25):
            policy = make_policy({**current_policy(), "replacement": retention})
            points = evaluate_profile(
                {"jobChange": -0.9, "jobsAffected": 1, "jobSearch": 0.85}, policy, mode="us-only"
            )["us"]
            for point in points:
                self.assertAlmostEqual(point["resourceResidual"], 0, places=8)
                self.assertAlmostEqual(
                    point["productiveEmployment"]
                    + point["retainedWorkers"]
                    + point["jobSeekers"]
                    + point["exitedWorkers"],
                    1,
                )
            if retention:
                self.assertEqual(points[-1]["competitionDisplaced"], 0)


if __name__ == "__main__":
    unittest.main()
