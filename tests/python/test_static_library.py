"""The published assumption grid must be complete, valid and losslessly packed."""

import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
from static_grid import CHOICES, lookup_key, requests  # noqa: E402

from calculator.artifacts import model_fingerprint, scenario_key  # noqa: E402
from calculator.model import evaluate_profile  # noqa: E402
from calculator.policies import current_policy  # noqa: E402

spec = importlib.util.spec_from_file_location("static_builder", ROOT / "scripts/build-static-library.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class StaticLibraryTests(unittest.TestCase):
    def test_grid_has_exactly_one_entry_per_valid_combination(self):
        scenarios = list(requests())
        self.assertEqual(len(scenarios), 384)
        self.assertEqual(len({lookup_key(r) for r in scenarios}), 384)
        self.assertEqual(len({scenario_key(r) for r in scenarios}), 384)
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
            {(False, False), (True, False)},
        )

    def test_compact_export_preserves_decisions_and_discards_diagnostics(self):
        request = next(requests())
        profile = evaluate_profile(request["inputs"], current_policy(), mode="us-only")
        original = {
            **request, "selected": profile, "statusQuo": profile,
            "baseline": profile, "leading": profile, "alternatives": [profile],
            "ballot": {"tallies": [1], "voterChoices": [2], "winnerId": "exact",
                       "topSupportPercent": 50.000000001},
        }
        packed = builder.pack({"fingerprint": "test", "snapshot": original})
        snapshot = packed["snapshot"]
        self.assertEqual(snapshot["selected"]["usPolicy"], profile["usPolicy"])
        self.assertEqual(snapshot["ballot"], {"winnerId": "exact", "topSupportPercent": 50.000000001})
        self.assertNotIn("alternatives", snapshot)
        self.assertNotIn("usUtilities", snapshot["selected"])
        self.assertNotIn("cohortIncome", snapshot["selected"]["us"][0])
        self.assertEqual(len(snapshot["selected"]["us"]), 11)
        for before, after in zip(profile["us"], snapshot["selected"]["us"], strict=True):
            self.assertEqual(before["productiveEmployment"], after["productiveEmployment"])
            self.assertAlmostEqual(before["allIncomeIndex"], after["allIncomeIndex"], delta=.000051)
        self.assertIn("cohortIncome", profile["us"][0])  # never mutate the full local record

    def test_complete_embedded_library_is_under_budget(self):
        import gzip
        import json
        compressed = (ROOT / "src/generated/results.json.gz").read_bytes()
        self.assertLess(len(compressed), 3_500_000)
        library = json.loads(gzip.decompress(compressed))
        self.assertEqual(set(library), {lookup_key(r) for r in requests()})
        for request in requests():
            result = library[lookup_key(request)]
            self.assertEqual(result["schema"], 2)
            self.assertEqual(scenario_key(result["snapshot"]), scenario_key(request))
            self.assertEqual(len(result["snapshot"]["selected"]["us"]), 11)

    def test_every_supported_scenario_has_a_valid_selected_outcome(self):
        import gzip
        import json
        library = json.loads(gzip.decompress((ROOT / "src/generated/results.json.gz").read_bytes()))
        fingerprint = model_fingerprint(ROOT)
        for result in library.values():
            self.assertEqual(result["fingerprint"], fingerprint)
            snapshot = result["snapshot"]
            for region in ("usPolicy", "foreignPolicy"):
                policy = snapshot["selected"].get(region)
                if policy and policy["pace"] == 0:
                    self.assertEqual(policy["replacement"], 0)
            ballot = snapshot["ballot"]
            selected = snapshot["selected"]
            self.assertIn(snapshot["selection"], {"domestic-ballot", "verified-consistent", "selected-by-rule"})
            self.assertEqual(selected["usPolicy"]["id"], ballot["enactedPolicyId"])
            self.assertNotIn("history", ballot["coordination"])
            self.assertGreaterEqual(ballot["topSupportPercent"], 0)
            self.assertLessEqual(ballot["topSupportPercent"], 100)
            if ballot["winnerId"]:
                self.assertTrue(selected["usAdmissible"])
                if not snapshot["statusQuoUnavailable"]:
                    self.assertGreater(ballot["topSupportPercent"], 50)
            else:
                self.assertFalse(snapshot["statusQuoUnavailable"])
                self.assertEqual(selected["usPolicy"]["id"], current_policy()["id"])
            if snapshot["mode"] == "strategic":
                self.assertTrue(selected["foreignAdmissible"])
            if not ballot["coordination"]["stable"]:
                self.assertEqual(snapshot["selection"], "selected-by-rule")
