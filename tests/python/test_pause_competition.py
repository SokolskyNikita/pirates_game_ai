"""Hold policy terms fixed to isolate foreign AI's effect on a paused US."""
import unittest

from calculator.config import DEFAULT_INPUTS, GROWTH_BASELINE
from calculator.model import evaluate_profile
from calculator.policies import current_policy, make_policy


class PauseCompetitionTests(unittest.TestCase):
    def compare(self, growth, opened):
        inputs = {**DEFAULT_INPUTS, "usAiGrowth": growth, "foreignAiGrowth": growth,
                  "productivityGain": 0, "jobSearch": 0}
        us = make_policy({**current_policy(0), "allowFreeTrade": opened})
        return [evaluate_profile(inputs, us, current_policy(pace)) for pace in (0, 1, 2)]

    def test_foreign_ai_affects_paused_us_via_trade_not_domestic_adoption(self):
        for growth in (0, 0.05):
            paused, current, accelerated = self.compare(growth, True)
            for result in (current, accelerated):
                for year in result["us"][1:]:
                    self.assertEqual(year["adoption"], 0)
                    self.assertEqual(year["exposure"], 0)
                    self.assertEqual(year["potentialGrowthRate"], GROWTH_BASELINE["us"])
                final, baseline = result["us"][-1], paused["us"][-1]
                self.assertLess(final["productiveEmployment"], baseline["productiveEmployment"])
                self.assertLess(final["output"], baseline["output"])
                self.assertLess(final["consumerPriceIndex"], baseline["consumerPriceIndex"])
                self.assertGreater(final["importShare"], baseline["importShare"])
                self.assertNotEqual(final["allIncomeIndex"], baseline["allIncomeIndex"])
            self.assertLess(accelerated["us"][-1]["productiveEmployment"], current["us"][-1]["productiveEmployment"])

    def test_trade_veto_removes_foreign_pace_spillovers(self):
        for growth in (0, 0.05):
            outcomes = self.compare(growth, False)
            self.assertEqual(outcomes[0]["us"], outcomes[1]["us"])
            self.assertEqual(outcomes[0]["us"], outcomes[2]["us"])
            self.assertTrue(all(y["netRentFlow"] == 0 for y in outcomes[2]["us"]))
