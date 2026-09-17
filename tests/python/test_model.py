"""Economic invariants, funding boundaries and calibrated initial resources."""

from __future__ import annotations

import json
import math
import unittest
from pathlib import Path

from calculator.config import DEFAULT_INPUTS, GROWTH_BASELINE, YEARS, normalize_inputs
from calculator.model import evaluate_profile, solve_model
from calculator.policies import BASELINE_POLICY, PACE_CHOICES, POLICIES, current_policy, make_policy
from calculator.population import CALIBRATION, US_COHORTS, ordered_sum, prepare

FIXTURES = json.loads((Path(__file__).parents[1] / "fixtures" / "typescript-parity.json").read_text())


def policy(**changes):
    return make_policy({**current_policy(), **changes})


def domestic(changes=None, selected=None):
    return evaluate_profile({**DEFAULT_INPUTS, **(changes or {})}, selected or policy(), mode="us-only")


class EconomicModelTests(unittest.TestCase):
    def assert_closed(self, outcome):
        for point in outcome["us"] + outcome.get("foreign", []):
            self.assertAlmostEqual(point["resourceResidual"], 0, places=6)
            self.assertGreaterEqual(point["benefitsPaid"], 0)
            self.assertLessEqual(point["benefitsPaid"], point["benefitsRequired"] + 1e-7)
            self.assertAlmostEqual(
                point["benefitsPaid"] + point["nonTransferSpending"], point["taxRevenue"], places=7
            )

    def assert_numeric_contract(self, actual, expected, path=""):
        if isinstance(expected, dict):
            for key, value in expected.items():
                self.assertIn(key, actual, path)
                self.assert_numeric_contract(actual[key], value, f"{path}.{key}")
        elif isinstance(expected, list):
            self.assertEqual(len(actual), len(expected), path)
            for index, (got, want) in enumerate(zip(actual, expected, strict=True)):
                self.assert_numeric_contract(got, want, f"{path}[{index}]")
        elif isinstance(expected, (int, float)) and not isinstance(expected, bool):
            self.assertTrue(
                math.isclose(actual, expected, rel_tol=1e-12, abs_tol=1e-8), f"{path}: {actual} != {expected}"
            )
        else:
            self.assertEqual(actual, expected, path)

    def test_exact_calibration_and_policy_identifiers(self):
        self.assertEqual(CALIBRATION, FIXTURES["calibration"])
        self.assertEqual(len(POLICIES), 19440)
        self.assertEqual(len({p["id"] for p in POLICIES}), len(POLICIES))
        for policy in POLICIES:
            for key, reference in (
                ("laborTax", CALIBRATION["laborTaxRate"]),
                ("capitalTax", CALIBRATION["capitalTaxRate"]),
            ):
                self.assertTrue(
                    policy[key] == reference or abs(policy[key] * 10 - round(policy[key] * 10)) < 1e-10
                )

    def test_reference_profiles_preserve_initial_resources_and_annual_accounting(self):
        # Historical trajectories intentionally change with the labor-market model;
        # survey calibration, year-zero accounting and funding identities do not.
        for case in FIXTURES["profiles"]:
            if case["mode"] != "us-only":
                continue
            with self.subTest(name=case["name"]):
                old = case["inputs"]
                inputs = {
                    **{key: value for key, value in old.items() if key in DEFAULT_INPUTS},
                    "usAiGrowth": old["usGdpGrowth"],
                    "foreignAiGrowth": old["foreignGdpGrowth"],
                    "jobsAffected": old["displacement"],
                    "jobChange": -old["displacement"],
                    "jobSearch": old["reemployment"],
                }
                actual = evaluate_profile(inputs, case["us"], mode="us-only")
                self.assert_numeric_contract(actual["us"][0], case["outcome"]["us"][0], case["name"])
                self.assertEqual(len(actual["us"]), YEARS + 1)
                self.assertEqual(actual["usAdmissible"], all(p["feasible"] for p in actual["us"]))
                self.assert_closed(actual)

    def test_every_adult_citizen_keeps_fractional_weight(self):
        self.assertEqual(len(CALIBRATION["weights"]), len(US_COHORTS))
        self.assertAlmostEqual(ordered_sum(CALIBRATION["weights"]), 1, places=12)
        self.assertTrue(
            any(abs(weight * 1000 - round(weight * 1000)) > 0.001 for weight in CALIBRATION["weights"])
        )

    def test_baseline_reproduces_observed_resources_then_compounds_without_ai(self):
        result = domestic(selected=BASELINE_POLICY)
        initial = result["us"][0]
        for key in ("jobSlots", "productiveEmployment", "marketWageFactor", "averageWageFactor"):
            self.assertEqual(initial[key], 1, key)
        for key in ("jobsAffected", "retainedWorkers", "jobSeekers", "exitedWorkers", "competitionDisplaced"):
            self.assertEqual(initial[key], 0, key)
        for income, cohort in zip(result["us"][0]["cohortIncome"], US_COHORTS, strict=True):
            self.assertAlmostEqual(income, cohort["disposableIncome"], places=5)
        for point in result["us"]:
            self.assertAlmostEqual(
                point["output"], 100 * (1 + GROWTH_BASELINE["us"]) ** point["year"], places=9
            )
            self.assertEqual(point["capacityFactor"], 1)
            self.assertEqual(point["laborEffort"], 1)
            self.assertEqual(point["unemployment"], 0)
            self.assertTrue(point["feasible"])
        self.assertTrue(result["usAdmissible"])
        self.assert_closed(result)

    def test_normalization_ignores_legacy_population_ratios_and_nonfinite_inputs(self):
        self.assertEqual(normalize_inputs({"workerShare": 0.2, "usAiGrowth": float("nan")}), DEFAULT_INPUTS)
        result = normalize_inputs({"usAiGrowth": 9, "foreignAiGrowth": -1, "jobSearch": True})
        self.assertEqual(result["usAiGrowth"], 0.2)
        self.assertEqual(result["foreignAiGrowth"], 0)
        self.assertEqual(result["jobSearch"], DEFAULT_INPUTS["jobSearch"])

    def test_invalid_population_weights_are_rejected(self):
        for cohorts in [[], [{**US_COHORTS[0], "weight": -1}], [{**US_COHORTS[0], "weight": float("nan")}]]:
            with self.assertRaises(ValueError):
                prepare(cohorts)

    def test_pace_menus_and_invalid_policies(self):
        for pace in PACE_CHOICES:
            model = solve_model(options={"mode": "us-only", "objective": "workers", "pace": pace})
            self.assertTrue(all(p["pace"] == pace for p in model["policies"]))
            self.assertIn(current_policy(pace)["id"], [p["id"] for p in model["policies"]])
        for pace in [-1, 2.01, float("inf"), float("nan")]:
            with self.assertRaises(ValueError):
                domestic(selected=policy(pace=pace))
        with self.assertRaises(ValueError):
            solve_model(options={"mode": "us-only", "objective": "workers", "pace": 0.33})

    def test_employer_retention_and_public_benefits_have_separate_budgets(self):
        assumptions = {"investmentResponse": 0, "jobsAffected": 0.4, "jobChange": -0.4, "jobSearch": 0}
        laid_off = domestic(assumptions, policy(replacement=0))["us"][-1]
        retained = domestic(assumptions, policy(replacement=0.5))["us"][-1]
        self.assertGreater(retained["employerPay"], 0)
        self.assertLess(retained["capitalAfterRetention"], laid_off["capitalAfterRetention"])
        self.assertAlmostEqual(
            laid_off["capitalAfterRetention"] - retained["capitalAfterRetention"],
            retained["employerPay"],
            places=8,
        )
        self.assertEqual(retained["benefitsRequired"], laid_off["benefitsRequired"])

    def test_flat_and_prior_income_formulas_distribute_same_budget(self):
        base = dict(pace=0, laborTax=0.5, capitalTax=0.5, welfareScale=1)
        flat = domestic({"investmentResponse": 0}, policy(**base, benefitFormula="flat"))["us"][-1]
        prior = domestic({"investmentResponse": 0}, policy(**base, benefitFormula="prior-income"))["us"][-1]
        none = domestic({"investmentResponse": 0}, policy(**{**base, "welfareScale": 0}))["us"][-1]
        self.assertEqual(flat["benefitsPaid"], prior["benefitsPaid"])
        for index, cohort in enumerate(US_COHORTS):
            self.assertAlmostEqual(
                flat["cohortIncome"][index] - none["cohortIncome"][index], flat["benefitsPaid"], places=6
            )
            if cohort["disposableIncome"] < 5000:
                self.assertGreater(flat["cohortIncome"][index], prior["cohortIncome"][index])
            if cohort["disposableIncome"] > 150000:
                self.assertGreater(prior["cohortIncome"][index], flat["cohortIncome"][index])

    def test_tax_endpoints_apply_to_all_cohorts(self):
        for tax in [0, 1]:
            point = domestic({"investmentResponse": 0}, policy(pace=0, laborTax=tax, capitalTax=tax))["us"][
                -1
            ]
            self.assertAlmostEqual(point["effectiveLaborTax"], tax, places=10)
            self.assertAlmostEqual(point["effectiveCapitalTax"], tax, places=10)

    def test_zero_taxes_cannot_fund_baseline_services(self):
        result = domestic(selected=policy(laborTax=0, capitalTax=0))
        self.assertFalse(result["usAdmissible"])
        self.assertGreater(result["us"][-1]["governmentFundingGap"], 0)
        self.assertEqual(result["us"][-1]["benefitsPaid"], 0)
        self.assert_closed(result)

    def test_surplus_goes_to_public_spending_not_hidden_dividend(self):
        result = domestic(
            {"investmentResponse": 0}, policy(pace=0, laborTax=1, capitalTax=1, welfareScale=0.5)
        )
        point = result["us"][-1]
        self.assertAlmostEqual(point["benefitsScalePaid"], 0.5, places=9)
        self.assertGreater(point["nonTransferSpending"], CALIBRATION["nonTransferSpending"])
        self.assertAlmostEqual(
            point["consumption"] + point["nonTransferSpending"],
            CALIBRATION["marketIncome"] * (1 + GROWTH_BASELINE["us"]) ** YEARS,
            places=6,
        )
        self.assert_closed(result)

    def test_policy_responses_are_relative_to_current_taxes(self):
        same = domestic(selected=policy(pace=0))["us"][-1]
        higher = domestic(selected=policy(pace=0, laborTax=1, capitalTax=1))["us"][-1]
        lower = domestic(selected=policy(pace=0, laborTax=0, capitalTax=0))["us"][-1]
        reference = 100 * (1 + GROWTH_BASELINE["us"]) ** YEARS
        self.assertAlmostEqual(same["output"], reference, places=10)
        self.assertLess(higher["output"], reference)
        self.assertGreater(lower["output"], reference)

    def test_zero_response_disables_tax_incentive_effects(self):
        low = domestic({"investmentResponse": 0}, policy(laborTax=0, capitalTax=0))
        high = domestic({"investmentResponse": 0}, policy(laborTax=1, capitalTax=1))
        for a, b in zip(low["us"], high["us"], strict=True):
            self.assertEqual(a["output"], b["output"])
            self.assertEqual(a["adoption"], b["adoption"])

    def test_international_rent_flows_conserve_resources(self):
        result = evaluate_profile(DEFAULT_INPUTS, policy(pace=0), policy(pace=1, capitalTax=0.2))
        for us, foreign in zip(result["us"], result["foreign"], strict=True):
            self.assertAlmostEqual(
                us["netRentFlow"] * us["consumerPriceIndex"]
                + DEFAULT_INPUTS["foreignMarketSize"]
                * us["relativeProducerPrice"]
                * foreign["netRentFlow"]
                * foreign["consumerPriceIndex"],
                0,
                places=7,
            )
        self.assert_closed(result)

    def test_foreign_frontier_zero_allows_imports_unless_paused(self):
        inputs = {**DEFAULT_INPUTS, "foreignStrength": 0}
        current = evaluate_profile(inputs, policy(), policy())
        paused = evaluate_profile(inputs, policy(), policy(pace=0))
        self.assertEqual(current["foreign"][-1]["adoption"], 0)
        self.assertGreater(current["foreign"][-1]["exposure"], 0)
        self.assertGreater(current["foreign"][-1]["potentialOutput"], 100)
        self.assertEqual(paused["foreign"][-1]["exposure"], 0)

    def test_light_full_and_foreign_only_agree_on_scores(self):
        for objective in ["workers", "prosperity", "output"]:
            model = solve_model(
                DEFAULT_INPUTS, {"mode": "strategic", "objective": "workers", "foreignObjective": objective}
            )
            a = policy(laborTax=0.4, capitalTax=0.5)
            b = policy(pace=2, laborTax=0.4, capitalTax=0.5, benefitFormula="flat")
            full = model["evaluate"](a, b)
            light = model["evaluateLight"](a, b)
            self.assertEqual(full["usUtilities"], light["usUtilities"])
            self.assertEqual(full["foreignScore"], light["foreignScore"])
            self.assertEqual(full["foreignScore"], model["evaluateForeign"](a, b))

    def test_growth_compounds_at_each_years_exposure(self):
        result = domestic({"investmentResponse": 0})
        expected = 100
        for year, point in enumerate(result["us"][1:], 1):
            expected *= 1 + GROWTH_BASELINE["us"] + DEFAULT_INPUTS["usAiGrowth"] * year / YEARS
            self.assertAlmostEqual(point["output"], expected, places=10)
            self.assertAlmostEqual(
                point["potentialGrowthRate"],
                GROWTH_BASELINE["us"] + DEFAULT_INPUTS["usAiGrowth"] * year / YEARS,
                places=12,
            )
        self.assertLess(
            result["us"][-1]["output"],
            100 * (1 + GROWTH_BASELINE["us"] + DEFAULT_INPUTS["usAiGrowth"]) ** YEARS,
        )

    def test_all_roles_obsolete_does_not_remove_ai_replacement_output(self):
        result = domestic(
            {"usAiGrowth": 0, "investmentResponse": 0, "jobsAffected": 1, "jobChange": -1, "jobSearch": 0}
        )
        point = result["us"][-1]
        self.assertAlmostEqual(point["unemployment"], 1, places=12)
        self.assertAlmostEqual(point["output"], 100 * (1 + GROWTH_BASELINE["us"]) ** YEARS, places=10)
        self.assertAlmostEqual(point["laborIncome"], 0, places=8)
        self.assert_closed(result)

    def test_employer_gain_redistributes_but_does_not_change_gdp(self):
        assumptions = {"investmentResponse": 0, "jobsAffected": 0.7, "jobChange": -0.7, "jobSearch": 0}
        low = domestic({**assumptions, "productivityGain": 0})
        high = domestic({**assumptions, "productivityGain": 1})
        for a, b in zip(low["us"], high["us"], strict=True):
            self.assertEqual(a["output"], b["output"])
        self.assertGreater(high["us"][-1]["capitalIncome"], low["us"][-1]["capitalIncome"])
        self.assertLess(high["us"][-1]["laborIncome"], low["us"][-1]["laborIncome"])

    def test_pause_blocks_ai_displacement_but_not_foreign_competition(self):
        assumptions = {
            **DEFAULT_INPUTS,
            "jobsAffected": 1,
            "jobChange": -1,
            "jobSearch": 0,
            "investmentResponse": 1,
            "tradeIntensity": 1,
            "foreignTradeIntensity": 1,
        }
        for us_paused in [True, False]:
            result = evaluate_profile(
                assumptions, policy(pace=0 if us_paused else 2), policy(pace=2 if us_paused else 0)
            )
            region = result["us"] if us_paused else result["foreign"]
            for point in region:
                for key in [
                    "adoption",
                    "exposure",
                    "jobsAffected",
                    "investmentCost",
                ]:
                    self.assertEqual(point[key], 0)
                if point["year"] > 0:
                    self.assertEqual(
                        point["potentialGrowthRate"], GROWTH_BASELINE["us" if us_paused else "foreign"]
                    )
            self.assertTrue(any(point["netRentFlow"] != 0 for point in region))
            self.assert_closed(result)

    def test_mutual_pause_lasts_all_ten_years(self):
        result = evaluate_profile(
            {
                **DEFAULT_INPUTS,
                "jobsAffected": 1,
                "jobChange": -1,
                "jobSearch": 0,
                "usAiGrowth": 0.2,
                "foreignAiGrowth": 0.2,
            },
            policy(pace=0),
            policy(pace=0),
        )
        for side in ("us", "foreign"):
            for point in result[side]:
                self.assertAlmostEqual(
                    point["potentialOutput"], 100 * (1 + GROWTH_BASELINE[side]) ** point["year"], places=9
                )
                self.assertEqual(point["exposure"], 0)
                self.assertEqual(point["jobsAffected"], 0)
        self.assert_closed(result)

    def test_acceleration_compresses_adoption_into_five_years(self):
        for search_share in [0, 0.2, 0.8]:
            for capital_tax in [0, CALIBRATION["capitalTaxRate"], 1]:
                assumptions = {
                    "jobsAffected": 1,
                    "jobChange": -1,
                    "jobSearch": search_share,
                    "investmentResponse": 1,
                }
                current = domestic(assumptions, policy(capitalTax=capital_tax, replacement=1))
                accelerated = domestic(assumptions, policy(pace=2, capitalTax=capital_tax, replacement=1))
                for year in range(6):
                    self.assertAlmostEqual(
                        accelerated["us"][year]["adoption"], current["us"][year * 2]["adoption"], places=12
                    )
                for point in accelerated["us"][5:]:
                    self.assertEqual(point["adoption"], 1)
                    self.assertEqual(
                        point["potentialGrowthRate"], GROWTH_BASELINE["us"] + DEFAULT_INPUTS["usAiGrowth"]
                    )
                self.assert_closed(accelerated)

    def test_faster_installation_brings_forward_growth_and_costs(self):
        assumptions = {"investmentResponse": 0, "jobsAffected": 1, "jobChange": -1, "jobSearch": 0}
        current = domestic(assumptions)
        accelerated = domestic(assumptions, policy(pace=2))
        self.assertGreater(accelerated["us"][1]["investmentCost"], current["us"][1]["investmentCost"])
        self.assertGreater(accelerated["us"][1]["adjustmentCost"], current["us"][1]["adjustmentCost"])
        self.assertGreater(accelerated["us"][-1]["potentialOutput"], current["us"][-1]["potentialOutput"])
        self.assertTrue(all(point["investmentCost"] == 0 for point in accelerated["us"][6:]))

    def test_searching_cannot_restore_work_when_no_jobs_remain(self):
        result = domestic(
            {"jobsAffected": 1, "jobChange": -1, "jobSearch": 1, "investmentResponse": 1},
            policy(capitalTax=1),
        )
        final = result["us"][-1]
        self.assertEqual(final["adoption"], 1)
        self.assertAlmostEqual(final["unemployment"], 1, places=12)
        self.assertAlmostEqual(final["productiveEmployment"], 0, places=12)
        self.assertAlmostEqual(final["laborIncome"], 0, places=8)
        net_displaced = sum(p["newlyDisplaced"] - p["reemployed"] for p in result["us"])
        self.assertAlmostEqual(net_displaced, final["unemployment"], places=12)

    def test_unfunded_welfare_is_ineligible_even_if_services_are_paid(self):
        result = domestic(selected=policy(pace=0, welfareScale=2))
        self.assertAlmostEqual(result["us"][-1]["governmentFundingGap"], 0, places=6)
        self.assertGreater(result["us"][-1]["welfareFundingGap"], 0)
        self.assertFalse(result["usAdmissible"])
        self.assertFalse(result["feasible"])

    def test_employer_promises_must_also_be_fully_funded(self):
        result = domestic(
            {
                "usAiGrowth": 0,
                "productivityGain": 0,
                "jobsAffected": 1,
                "jobChange": -1,
                "jobSearch": 0,
                "investmentResponse": 0,
            },
            policy(pace=2, replacement=1.25, welfareScale=0, laborTax=1, capitalTax=1),
        )
        self.assertTrue(any(point["employerFundingGap"] > 1e-7 for point in result["us"]))
        self.assertFalse(result["usAdmissible"])
        self.assert_closed(result)

    def test_future_surplus_does_not_fund_an_earlier_shortfall(self):
        result = domestic(
            {"usAiGrowth": 0.2, "investmentResponse": 0, "jobsAffected": 1, "jobChange": -1, "jobSearch": 0},
            policy(welfareScale=1.5),
        )
        self.assertTrue(any(point["welfareFundingGap"] > 1e-7 for point in result["us"]))
        self.assertTrue(result["us"][-1]["feasible"])
        self.assertFalse(result["usAdmissible"])

    def test_funding_agrees_in_full_light_and_foreign_only_modes(self):
        model = solve_model(
            {**DEFAULT_INPUTS, "jobsAffected": 1, "jobChange": -1, "jobSearch": 0},
            {"mode": "strategic", "objective": "workers"},
        )
        for us in [policy(), policy(replacement=1.25, welfareScale=2), policy(laborTax=0, capitalTax=0)]:
            for foreign in [
                policy(pace=0, welfareScale=2),
                policy(pace=0),
                policy(replacement=1.25, welfareScale=2),
            ]:
                full = model["evaluate"](us, foreign)
                light = model["evaluateLight"](us, foreign)
                self.assertEqual(light["usAdmissible"], full["feasible"])
                self.assertEqual(light["foreignAdmissible"], full["foreignFeasible"])
                expected = full["foreignScore"] if full["foreignFeasible"] else float("-inf")
                self.assertEqual(model["evaluateForeign"](us, foreign), expected)
                self.assert_closed(full)

    def test_employer_payment_range_is_ready_for_rendering(self):
        self.assertIsNone(domestic(selected=BASELINE_POLICY)["employerPaymentRange"])
        result = domestic(selected=policy(replacement=0.5))
        ratios = [
            p["employerNetPayRatio"] for p in result["us"] if p["year"] > 0 and p["unemployment"] > 1e-9
        ]
        self.assertEqual(result["employerPaymentRange"], {"low": min(ratios), "high": max(ratios)})


if __name__ == "__main__":
    unittest.main()
