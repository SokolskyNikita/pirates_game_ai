"""Trade-price, worker-adjustment and purchasing-power regression tests."""

from __future__ import annotations

import unittest

from calculator.config import DEFAULT_INPUTS, GROWTH_BASELINE, YEARS
from calculator.model import evaluate_profile
from calculator.policies import current_policy, make_policy
from calculator.trade import baseline_trade, competition_displacement, trade_market


def policy(**changes):
    return make_policy({**current_policy(), **changes})


def production(output=100):
    return dict(output=output, investment=0, adjustment=0, rents=0, adoption=0, burden=0)


class TradeModelTests(unittest.TestCase):
    def test_baseline_clears_at_reference_prices_and_balanced_trade(self):
        inputs = {**DEFAULT_INPUTS, "capitalMobility": 0}
        market = trade_market(inputs, policy(), policy(), production(), production())
        us_share, foreign_share, _ = baseline_trade(inputs)
        self.assertAlmostEqual(market["relativeProducerPrice"], 1, places=11)
        self.assertAlmostEqual(market["usPriceIndex"], 1, places=11)
        self.assertAlmostEqual(market["foreignPriceIndex"], 1, places=11)
        self.assertAlmostEqual(market["usImportShare"], us_share, places=11)
        self.assertAlmostEqual(market["foreignImportShare"], foreign_share, places=11)
        self.assertAlmostEqual(market["residual"], 0, places=9)

    def test_foreign_productivity_cheapens_imports_without_destroying_export_volume(self):
        inputs = {**DEFAULT_INPUTS, "capitalMobility": 0}
        baseline = trade_market(inputs, policy(), policy(), production(), production())
        grown = trade_market(inputs, policy(), policy(), production(), production(150))
        self.assertLess(grown["relativeProducerPrice"], baseline["relativeProducerPrice"])
        self.assertLess(grown["usPriceIndex"], baseline["usPriceIndex"])
        self.assertGreater(grown["usImportShare"], baseline["usImportShare"])
        self.assertGreater(grown["foreignExportVolume"], baseline["foreignExportVolume"])
        # A smaller export/GDP share alone cannot count as a lost export job.
        self.assertLess(grown["foreignExportShare"], baseline["foreignExportShare"])
        displacement = competition_displacement(
            0,
            grown["foreignImportShare"],
            grown["foreignExportVolume"],
            baseline["foreignImportShare"],
            baseline["foreignExportVolume"],
            100,
            0.4,
        )
        self.assertEqual(displacement, 0)

    def test_either_veto_closes_trade_and_imported_ai(self):
        inputs = {**DEFAULT_INPUTS, "foreignStrength": 0}
        outcomes = [
            evaluate_profile(inputs, policy(allowFreeTrade=False), policy()),
            evaluate_profile(inputs, policy(), policy(allowFreeTrade=False)),
        ]
        for outcome in outcomes:
            for region in [outcome["us"], outcome["foreign"]]:
                for point in region[1:]:
                    self.assertFalse(point["tradeOpen"])
                    self.assertEqual(point["importShare"], 0)
                    self.assertEqual(point["exportShare"], 0)
                    self.assertEqual(point["netRentFlow"], 0)
                    self.assertGreater(point["consumerPriceIndex"], 1)
            self.assertEqual(outcome["foreign"][-1]["exposure"], 0)
        for side in ["us", "foreign"]:
            self.assertEqual(outcomes[0][side], outcomes[1][side])

    def test_us_pause_can_lose_trade_jobs_with_faster_foreign_ai(self):
        outcome = evaluate_profile(
            {**DEFAULT_INPUTS, "foreignAiGrowth": 0.2, "jobSearch": 0},
            policy(pace=0),
            policy(pace=2),
        )
        final = outcome["us"][-1]
        self.assertEqual(final["jobsAffected"], 0)
        self.assertEqual(final["exposure"], 0)
        self.assertGreater(final["tradeUnemployment"], 0)
        self.assertLess(final["consumerPriceIndex"], 1)
        self.assertLess(final["output"], 100 * (1 + GROWTH_BASELINE["us"]) ** YEARS)

    def test_trade_closure_isolates_us_from_foreign_growth_assumption(self):
        common = {**DEFAULT_INPUTS, "investmentResponse": 0}
        a = evaluate_profile({**common, "foreignAiGrowth": 0}, policy(allowFreeTrade=False), policy())
        b = evaluate_profile({**common, "foreignAiGrowth": 0.2}, policy(allowFreeTrade=False), policy())
        self.assertEqual(a["us"], b["us"])

    def test_zero_tradable_share_disables_trade_and_imported_ai(self):
        outcome = evaluate_profile(
            {**DEFAULT_INPUTS, "tradableShare": 0, "foreignStrength": 0},
            policy(),
            policy(),
        )
        for side in ["us", "foreign"]:
            for point in outcome[side]:
                self.assertEqual(point["consumerPriceIndex"], 1)
                self.assertEqual(point["tradeUnemployment"], 0)
                self.assertEqual(point["importShare"], 0)
        self.assertEqual(outcome["foreign"][-1]["exposure"], 0)

    def test_joint_unemployment_transitions_and_real_resource_ledgers_close(self):
        inputs = {
            **DEFAULT_INPUTS,
            "jobSearch": 0.2,
            "jobsAffected": 0.7,
            "jobChange": -0.7,
            "foreignAiGrowth": 0.2,
        }
        outcome = evaluate_profile(inputs, policy(), policy(pace=2))
        for side in ["us", "foreign"]:
            previous = 0
            for point in outcome[side]:
                self.assertAlmostEqual(
                    point["aiUnemployment"] + point["tradeUnemployment"],
                    point["unemployment"],
                    places=12,
                )
                self.assertAlmostEqual(
                    previous + point["newlyDisplaced"] - point["reemployed"],
                    point["unemployment"],
                    places=12,
                )
                self.assertAlmostEqual(point["resourceResidual"], 0, places=6)
                self.assertAlmostEqual(point["tradeBalanceResidual"], 0, places=8)
                self.assertLessEqual(point["tradeUnemployment"], inputs["tradableShare"])
                previous = point["unemployment"]
        for us, foreign in zip(outcome["us"], outcome["foreign"], strict=True):
            us_nominal = us["netRentFlow"] * us["consumerPriceIndex"]
            foreign_nominal = foreign["netRentFlow"] * foreign["consumerPriceIndex"]
            self.assertAlmostEqual(
                us_nominal + inputs["foreignMarketSize"] * us["relativeProducerPrice"] * foreign_nominal,
                0,
                places=7,
            )

    def test_trade_retention_costs_reduce_next_year_investment_capacity(self):
        inputs = {**DEFAULT_INPUTS, "foreignAiGrowth": 0.2, "investmentResponse": 0.7, "jobSearch": 0}
        laid_off = evaluate_profile(inputs, policy(pace=1), policy(pace=2))
        retained = evaluate_profile(inputs, policy(pace=1, replacement=1), policy(pace=2))
        self.assertEqual(retained["us"][0]["capacityFactor"], laid_off["us"][0]["capacityFactor"])
        self.assertLess(retained["us"][2]["capacityFactor"], retained["us"][1]["capacityFactor"])
        self.assertLess(retained["us"][2]["capacityFactor"], laid_off["us"][2]["capacityFactor"])
        self.assertGreater(retained["us"][1]["employerPay"], 0)

    def test_trade_retention_investment_shock_cannot_uninstall_ai(self):
        inputs = {
            **DEFAULT_INPUTS,
            "jobsAffected": 1,
            "jobChange": 0,
            "jobSearch": 0,
            "investmentResponse": 1,
            "usAiGrowth": 0,
            "foreignAiGrowth": 0.2,
            "capitalMobility": 1,
            "tradableShare": 1,
            "tradeIntensity": 1,
            "foreignTradeIntensity": 0.5,
            "foreignMarketSize": 3,
            "productivityGain": 1,
        }
        # Foreign competition creates an actual retained-payroll burden after
        # year one. The new burden would imply less installed AI without the
        # irreversible-installation constraint, so deployment must plateau.
        result = evaluate_profile(inputs, policy(replacement=1.25), policy(pace=2, capitalTax=0))
        installed = [point["adoption"] for point in result["us"]]
        self.assertGreater(result["us"][1]["retainedWorkers"], 0)
        self.assertGreater(result["us"][2]["investmentBurden"], 0.625)
        self.assertEqual(installed, sorted(installed))
        self.assertEqual(installed[1], installed[2])
        self.assertEqual(installed[-1], 1)

    def test_closure_keeps_real_benefit_promise_and_checks_real_funding(self):
        outcome = evaluate_profile(
            DEFAULT_INPUTS,
            policy(pace=0, allowFreeTrade=False),
            policy(pace=0),
        )
        before, after = outcome["us"][0], outcome["us"][1]
        self.assertEqual(after["benefitsRequired"], before["benefitsRequired"])
        self.assertGreater(after["consumerPriceIndex"], 1)
        self.assertGreater(after["welfareFundingGap"], 0)
        self.assertFalse(outcome["usAdmissible"])


if __name__ == "__main__":
    unittest.main()
