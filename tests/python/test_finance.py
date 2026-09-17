"""Analytical resource checks independent of the trajectory implementation."""

import copy
import unittest

import numpy as np

from calculator.batch import evaluate_foreign_menu, evaluate_us_menu
from calculator.config import normalize_inputs
from calculator.finance import employer_budget, household_income, positive_ratio, public_budget, tax_rate
from calculator.policies import checked_policy, current_policy
from calculator.population import US_COHORTS, prepare


class FinanceTests(unittest.TestCase):
    def test_retention_cannot_spend_more_than_employer_resources(self):
        budget = employer_budget(100, 0.5, 1.25, 40, 0.8)
        self.assertEqual(budget.required, 62.5)
        self.assertEqual(budget.paid, 40)
        self.assertEqual(budget.capital_after, 0)
        self.assertEqual(budget.gap, 22.5)
        self.assertEqual(budget.nonproductive_wage_ratio, 0.5)

    def test_public_services_and_benefits_share_one_budget(self):
        for revenue, benefits, services, welfare_gap, government_gap in (
            (20, 0, 20, 50, 10),
            (60, 30, 30, 20, 0),
            (100, 50, 50, 0, 0),
        ):
            budget = public_budget(revenue, 30, 50, 1)
            self.assertEqual(budget.benefits_paid, benefits)
            self.assertEqual(budget.nontransfer_spending, services)
            self.assertEqual(budget.welfare_gap, welfare_gap)
            self.assertEqual(budget.government_gap, government_gap)
            self.assertEqual(budget.benefits_paid + budget.nontransfer_spending, revenue)

    def test_investment_losses_remain_in_income_without_negative_tax(self):
        income = household_income(100, 20, 10, -40, 10, 0.2, 1)
        self.assertEqual(income.capital_tax, 0)
        self.assertEqual(income.employed_net, 48)
        self.assertEqual(income.nonproductive_net, -16)

    def test_scalar_and_array_zero_bases_and_tax_endpoints(self):
        with np.errstate(all="raise"):
            np.testing.assert_array_equal(
                positive_ratio(np.array([1.0, 4.0]), np.array([0.0, 2.0]), xp=np), [0, 2]
            )
            self.assertEqual(positive_ratio(1, 0), 0)
            for mean in (0, 0.2, 1):
                baseline = np.array([0.0, 0.2, 1.0])
                for target in (0, mean, 1):
                    np.testing.assert_array_equal(
                        tax_rate(baseline, target, mean, xp=np),
                        [tax_rate(value, target, mean) for value in baseline],
                    )


class ValidationTests(unittest.TestCase):
    def test_calibration_rejects_invalid_tax_bases(self):
        for field in ("capitalTaxBase", "noncapitalTaxBase"):
            for value in (float("nan"), float("inf"), -1):
                with self.subTest(field=field, value=value):
                    cohorts = copy.deepcopy(US_COHORTS)
                    cohorts[0][field] = value
                    with self.assertRaises(ValueError):
                        prepare(cohorts)
        cohorts = copy.deepcopy(US_COHORTS)
        for cohort in cohorts:
            cohort["noncapitalTaxBase"] = 0
        with self.assertRaisesRegex(ValueError, "positive non-capital tax base"):
            prepare(cohorts)

    def test_policy_rejects_boolean_and_nonnumeric_rates(self):
        for field in ("pace", "replacement", "welfareScale", "laborTax", "aiProfitTax"):
            for value in (True, "0.5", None, float("nan")):
                with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                    checked_policy({**current_policy(), field: value})

    def test_batch_rejects_invalid_chunk_sizes_before_work(self):
        for size in (0, -1, True, 1.5, "2"):
            with self.subTest(size=size):
                with self.assertRaises(ValueError):
                    evaluate_us_menu(normalize_inputs(), [], None, "workers", None, chunk_size=size)
                with self.assertRaises(ValueError):
                    evaluate_foreign_menu(
                        normalize_inputs(), current_policy(), [], "workers", None, chunk_size=size
                    )
