"""Trade access is a policy choice only in the international game."""

import unittest

from calculator.policies import (
    BASELINE_POLICY,
    INTERNATIONAL_POLICIES,
    POLICIES,
    checked_policy,
    current_policy,
    make_policy,
    policies_at_pace,
    policies_for_mode,
    policy_by_id,
)


class PolicyMenuTests(unittest.TestCase):
    def test_current_and_baseline_allow_trade_with_legacy_identifiers(self):
        for policy in (BASELINE_POLICY, current_policy(1), current_policy(2)):
            self.assertTrue(policy["allowFreeTrade"])
            self.assertEqual(len(policy["id"].split("|")), 6)
            self.assertIs(policy_by_id(policy["id"], "us-only")["allowFreeTrade"], True)

    def test_international_menu_has_both_trade_choices_for_every_domestic_package(self):
        self.assertEqual(len(POLICIES), 21384)
        self.assertEqual(len(INTERNATIONAL_POLICIES), 42768)
        self.assertEqual(len({p["id"] for p in INTERNATIONAL_POLICIES}), 42768)
        for opened in POLICIES:
            closed = policy_by_id(opened["id"] + "|closed", "strategic")
            self.assertTrue(opened["allowFreeTrade"])
            self.assertFalse(closed["allowFreeTrade"])
            for axis in ("pace", "replacement", "welfareScale", "benefitFormula", "laborTax", "aiProfitTax"):
                self.assertEqual(opened[axis], closed[axis])

    def test_mode_and_pause_filtering_retain_complete_available_menus(self):
        for mode, count in (("us-only", 21384), ("strategic", 42768)):
            menu = policies_for_mode(mode)
            restricted = policies_for_mode(mode, True)
            self.assertEqual(len(menu), count)
            self.assertEqual(len(restricted), count * 8 // 9)
            self.assertTrue(all(p["pace"] != 0 for p in restricted))
            for pace in (0, 1, 2):
                choices = policies_at_pace(pace, mode)
                self.assertEqual(len(choices), count // 9 * (1 if pace == 0 else 4))
                self.assertTrue(all(p["pace"] == pace for p in choices))

    def test_closed_policy_is_ineligible_domestically_and_pause_restriction_applies(self):
        for mode, identifier, pause in (
            ("us-only", current_policy()["id"] + "|closed", False),
            ("strategic", current_policy(0)["id"] + "|closed", True),
            ("strategic", current_policy(0)["id"], True),
            ("invalid", current_policy()["id"], False),
        ):
            with self.subTest(mode=mode, identifier=identifier), self.assertRaises(ValueError):
                policy_by_id(identifier, mode, pause)

    def test_flag_is_strictly_boolean_and_old_policies_default_to_open(self):
        legacy = {key: value for key, value in current_policy().items() if key != "allowFreeTrade"}
        checked_policy(legacy)
        self.assertTrue(make_policy(legacy)["allowFreeTrade"])
        for value in (None, 0, 1, "false", []):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    make_policy({**legacy, "allowFreeTrade": value})
                with self.assertRaises(ValueError):
                    checked_policy({**legacy, "allowFreeTrade": value})

    def test_opening_a_closed_package_restores_legacy_identifier(self):
        opened = current_policy()
        closed = make_policy({**opened, "allowFreeTrade": False})
        self.assertEqual(closed["id"], opened["id"] + "|closed")
        self.assertEqual(make_policy({**closed, "allowFreeTrade": True}), opened)


class PauseRetentionTests(unittest.TestCase):
    def test_pause_retention_is_excluded_and_rejected(self):
        for mode in ("us-only", "strategic"):
            self.assertTrue(all(p["replacement"] == 0 for p in policies_at_pace(0, mode)))
            for replacement in (0.5, 1, 1.25):
                invalid = {**current_policy(0), "replacement": replacement}
                with self.assertRaises(ValueError):
                    make_policy(invalid)
                with self.assertRaises(ValueError):
                    checked_policy(invalid)
                old_id = current_policy(0)["id"].split("|")
                old_id[1] = str(replacement)
                with self.assertRaises(ValueError):
                    policy_by_id("|".join(old_id), mode)


if __name__ == "__main__":
    unittest.main()
