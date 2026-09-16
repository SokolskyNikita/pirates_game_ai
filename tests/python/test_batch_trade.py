"""Trade choices must give the same funded ballot in both execution paths."""

import math
import unittest

import numpy as np

from calculator.ballot import tally_package_ballot
from calculator.batch import _evaluate_chunk, _menu_production_paths, evaluate_foreign_menu, evaluate_us_menu
from calculator.config import normalize_inputs
from calculator.model import solve_model
from calculator.policies import current_policy, make_policy
from calculator.population import PREPARED


def trade_menu():
    return [
        make_policy({**current_policy(pace), **policy, "allowFreeTrade": trade})
        for pace in (0, 1, 2)
        for trade in (False, True)
        for policy in (
            {},
            {"replacement": 0.5, "welfareScale": 1.5, "benefitFormula": "flat", "capitalTax": 0.5},
            {"replacement": 1.25, "welfareScale": 2, "laborTax": 0, "capitalTax": 1},
        )
    ]


def ballot(profiles):
    return tally_package_ballot(
        [
            {"id": p["usPolicy"]["id"], "utilities": p["usUtilities"], "fullyFunded": p["usAdmissible"]}
            for p in profiles
        ],
        PREPARED.calibration["weights"],
        current_policy()["id"],
    )


class TradeBatchTests(unittest.TestCase):
    def test_open_closed_and_paused_profiles_match_scalar(self):
        menu = trade_menu()
        cases = (
            ({}, current_policy(2)),
            ({}, make_policy({**current_policy(2), "allowFreeTrade": False})),
            ({"displacement": 1, "reemployment": 0}, current_policy(2)),
            ({"tradeIntensity": 0, "foreignTradeIntensity": 0}, current_policy(2)),
            ({"foreignGdpGrowth": 0.2, "usGdpGrowth": 0, "capitalMobility": 1}, current_policy(2)),
            ({"tradableShare": 0, "tradeElasticity": 2}, current_policy(1)),
            ({"tradableShare": 1, "tradeElasticity": 8, "investmentResponse": 1}, current_policy(0)),
        )
        for values, foreign in cases:
            inputs = normalize_inputs(values)
            model = solve_model(
                inputs, {"mode": "strategic", "objective": "workers", "foreignObjective": "prosperity"}
            )
            actual, _, _ = _evaluate_chunk(inputs, menu, [foreign] * len(menu), "prosperity", PREPARED)
            for policy, profile in zip(menu, actual, strict=True):
                with self.subTest(values=values, policy=policy["id"], foreign=foreign["id"]):
                    expected = model["evaluateLight"](policy, foreign)
                    self.assertEqual(profile["usAdmissible"], expected["usAdmissible"])
                    self.assertEqual(profile["foreignAdmissible"], expected["foreignAdmissible"])
                    np.testing.assert_allclose(
                        profile["usUtilities"], expected["usUtilities"], atol=1e-12, rtol=0
                    )
                    self.assertAlmostEqual(profile["usScore"], expected["usScore"], places=12)
                    self.assertAlmostEqual(profile["foreignScore"], expected["foreignScore"], places=12)

    def test_reused_production_paths_preserve_all_welfare_variants(self):
        inputs = normalize_inputs({"reemployment": 0, "foreignGdpGrowth": 0.15})
        menu = [
            make_policy({**policy, "welfareScale": welfare, "benefitFormula": formula})
            for policy in trade_menu()[::3]
            for welfare in (0, 1, 2)
            for formula in ("current", "flat", "prior-income")
        ]
        for foreign_menu in (None, [current_policy(2)] * len(menu), list(reversed(menu))):
            paths, rows = _menu_production_paths(inputs, menu, foreign_menu, PREPARED)
            self.assertLess(len(paths[0][0]["u"]), len(menu))
            expected, eb_us, eb_foreign = _evaluate_chunk(inputs, menu, foreign_menu, "prosperity", PREPARED)
            actual, ab_us, ab_foreign = _evaluate_chunk(
                inputs,
                menu,
                foreign_menu,
                "prosperity",
                PREPARED,
                paths=paths,
                rows=rows,
            )
            np.testing.assert_array_equal(ab_us, eb_us)
            np.testing.assert_array_equal(ab_foreign, eb_foreign)
            for a, e in zip(actual, expected, strict=True):
                np.testing.assert_array_equal(a["usUtilities"], e["usUtilities"])
                self.assertEqual(a["usAdmissible"], e["usAdmissible"])
                self.assertEqual(a["usScore"], e["usScore"])
                if foreign_menu is not None:
                    self.assertEqual(a["foreignScore"], e["foreignScore"])
                    self.assertEqual(a["foreignAdmissible"], e["foreignAdmissible"])
            if foreign_menu is not None:
                us_only, _, _ = _evaluate_chunk(
                    inputs,
                    menu,
                    foreign_menu,
                    "prosperity",
                    PREPARED,
                    us_only=True,
                    paths=paths,
                    rows=rows,
                )
                for a, e in zip(us_only, expected, strict=True):
                    np.testing.assert_array_equal(a["usUtilities"], e["usUtilities"])
                    self.assertEqual(a["usAdmissible"], e["usAdmissible"])
                    self.assertNotIn("foreignScore", a)
                    self.assertNotIn("foreignAdmissible", a)

    def test_certified_ballot_agrees_including_both_trade_positions(self):
        inputs = normalize_inputs({"foreignGdpGrowth": 0.15, "usGdpGrowth": 0, "reemployment": 0})
        menu, foreign = trade_menu(), current_policy(2)
        model = solve_model(
            inputs, {"mode": "strategic", "objective": "workers", "foreignObjective": "workers"}
        )
        expected = [model["evaluateLight"](policy, foreign) for policy in menu]
        for chunk_size in (1, 7, 128):
            actual = evaluate_us_menu(
                inputs, menu, foreign, "workers", model["evaluateLight"], chunk_size=chunk_size
            )
            self.assertEqual(ballot(actual), ballot(expected))

    def test_foreign_optimum_agrees_for_every_objective_and_trade_position(self):
        inputs = normalize_inputs({"displacement": 1, "reemployment": 0})
        menu = trade_menu()
        for open_trade in (False, True):
            us = make_policy({**current_policy(0), "allowFreeTrade": open_trade})
            for objective in ("workers", "prosperity", "output"):
                model = solve_model(
                    inputs, {"mode": "strategic", "objective": "workers", "foreignObjective": objective}
                )
                expected = [model["evaluateForeign"](us, policy) for policy in menu]
                actual = evaluate_foreign_menu(inputs, us, menu, objective, model["evaluateForeign"])
                self.assertEqual([math.isfinite(s) for s in actual], [math.isfinite(s) for s in expected])
                self.assertEqual(max(actual), max(expected))
                self.assertEqual(
                    [p["id"] for p, score in zip(menu, actual, strict=True) if score == max(actual)],
                    [p["id"] for p, score in zip(menu, expected, strict=True) if score == max(expected)],
                )


if __name__ == "__main__":
    unittest.main()
