"""The published assumption grid must be complete, valid and losslessly packed."""

import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
from static_grid import CHOICES, lookup_key, requests  # noqa: E402

from calculator.artifacts import scenario_key  # noqa: E402
from calculator.model import evaluate_profile  # noqa: E402
from calculator.policies import current_policy  # noqa: E402

spec = importlib.util.spec_from_file_location("static_builder", ROOT / "scripts/build-static-library.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class StaticLibraryTests(unittest.TestCase):
    def test_grid_has_exactly_one_entry_per_valid_combination(self):
        scenarios = list(requests())
        self.assertEqual(len(scenarios), 768)
        self.assertEqual(len({lookup_key(r) for r in scenarios}), 768)
        self.assertEqual(len({scenario_key(r) for r in scenarios}), 768)
        for request in scenarios:
            inputs = request["inputs"]
            self.assertGreaterEqual(inputs["jobsAffected"], max(0, -inputs["jobChange"]))
            for key, choices in CHOICES.items():
                self.assertIn(inputs[key], choices)
        self.assertEqual(
            {r["foreignObjective"] for r in scenarios if r["mode"] == "strategic"},
            {"workers", "prosperity", "output"},
        )
        self.assertEqual(
            {(r["pauseUnavailable"], r["statusQuoUnavailable"]) for r in scenarios},
            {(False, False), (True, False), (False, True), (True, True)},
        )

    def test_profile_deduplication_is_exact_and_comparison_is_precalculated(self):
        request = next(requests())
        profile = evaluate_profile(request["inputs"], current_policy(), mode="us-only")
        original = {
            **request,
            "selected": profile,
            "statusQuo": profile,
            "baseline": profile,
            "leading": profile,
            "alternatives": [profile],
        }
        packed = builder.pack({"fingerprint": "test", "key": scenario_key(request), "snapshot": original})
        self.assertEqual(len(packed["profiles"]), 1)
        restored = dict(packed["snapshot"])
        for key in ("selected", "statusQuo", "baseline", "leading"):
            restored[key] = packed["profiles"][restored[key]]
        restored["alternatives"] = [packed["profiles"][index] for index in restored["alternatives"]]
        self.assertEqual(restored, original)
        self.assertEqual(packed["comparisonVotes"], {current_policy()["id"]: 0})
