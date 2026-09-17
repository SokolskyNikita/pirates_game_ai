"""AI tax targets additional after-tax profits and conserves public resources."""

import unittest

from calculator.finance import household_income, public_budget
from calculator.model import evaluate_profile
from calculator.policies import POLICIES, current_policy, make_policy


class AIProfitTaxTests(unittest.TestCase):
    def test_normal_returns_untouched_and_additional_tax_is_capped(self):
        # $150 profit, $100 no-AI profit, 20% ordinary tax: $40 eligible increment.
        h = household_income(0, 0, 0, 150, 0, 0, 0.2, ai_reference=100, ai_rate=1)
        self.assertAlmostEqual(h.capital_tax, 30)
        self.assertAlmostEqual(h.ai_profit_tax, 40)
        self.assertAlmostEqual(h.employed_net, 80)
        for capital in [-20, 0, 80, 100]:
            h = household_income(0, 0, 0, capital, 0, 0, 0.2, ai_reference=100, ai_rate=1)
            self.assertEqual(h.ai_profit_tax, 0)

    def test_all_revenue_option_has_no_benefit_ceiling(self):
        budget = public_budget(1000, 100, 200, 3)
        self.assertEqual(budget.benefits_paid, 900)
        self.assertEqual(budget.nontransfer_spending, 100)
        self.assertEqual(budget.welfare_gap, 0)
        self.assertGreater(public_budget(50, 100, 200, 3).government_gap, 0)

    def test_pause_has_no_ai_tax_and_full_tax_stops_private_adoption(self):
        for pace in [0, 1, 2]:
            policy = make_policy({**current_policy(pace), "aiProfitTax": 1, "welfareScale": 3})
            result = evaluate_profile({}, policy, mode="us-only")
            for year in result["us"][1:]:
                self.assertEqual(year["adoption"], 0)
                self.assertAlmostEqual(year["aiProfitTaxRevenue"], 0, places=6)
                self.assertAlmostEqual(year["resourceResidual"], 0, places=6)
                self.assertAlmostEqual(year["capacityFactor"], 1)

    def test_positive_tax_collects_ai_gains_without_changing_ordinary_rate(self):
        inputs = {"investmentResponse": 0, "jobChange": -1, "jobsAffected": 1, "jobSearch": 0}
        p = make_policy({**current_policy(2), "aiProfitTax": 0.5, "welfareScale": 3})
        result = evaluate_profile(inputs, p, mode="us-only")
        self.assertGreater(result["us"][-1]["aiProfitTaxRevenue"], 0)
        for year in result["us"][1:]:
            self.assertAlmostEqual(year["resourceResidual"], 0, places=6)
        self.assertTrue(all("aiProfitTax" in p and "capitalTax" not in p for p in POLICIES))

    def test_retained_pay_reduces_taxable_profit_and_operating_costs_are_paid(self):
        inputs = {"investmentResponse": 0, "jobChange": -1, "jobsAffected": 1, "jobSearch": 0}
        base = {**current_policy(2), "aiProfitTax": 0.5, "welfareScale": 3}
        layoff = evaluate_profile(inputs, make_policy(base), mode="us-only")["us"][-1]
        retained = evaluate_profile(inputs, make_policy({**base, "replacement": 1}), mode="us-only")["us"][-1]
        self.assertGreater(layoff["aiOperatingCost"], 0)
        self.assertLess(retained["aiProfitTaxRevenue"], layoff["aiProfitTaxRevenue"])
        self.assertAlmostEqual(retained["resourceResidual"], 0, places=6)
        self.assertAlmostEqual(layoff["resourceResidual"], 0, places=6)
