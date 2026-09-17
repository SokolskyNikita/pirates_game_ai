"""Reproducible local sensitivity report; does not alter published assumptions."""

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from calculator.artifacts import model_fingerprint  # noqa: E402
from calculator.preferences import assumptions  # noqa: E402
from calculator.simulation import solve_scenario  # noqa: E402

cases = [
    ("default", {}, {}),
    ("50-career-resolution", {}, {"career_paths": 50}),
    ("200-career-resolution", {}, {"career_paths": 200}),
    ("linear-income", {}, {"curvature": 0}),
    ("zero-discount", {}, {"discount": 0}),
    ("ten-percent-discount", {}, {"discount": 0.1}),
    ("twenty-year-horizon", {}, {"horizon": 20}),
    ("international-workers", {"mode": "strategic", "foreignObjective": "workers"}, {}),
    ("international-prosperity", {"mode": "strategic", "foreignObjective": "prosperity"}, {}),
    ("international-output", {"mode": "strategic", "foreignObjective": "output"}, {}),
]
fingerprint = model_fingerprint(ROOT)
results = []
for name, request, preference in cases:
    start = time.monotonic()
    with assumptions(**preference):
        result = solve_scenario(request)
    results.append(
        {
            "name": name,
            "preferences": preference,
            "seconds": time.monotonic() - start,
            "usPolicy": result["selected"]["usPolicy"],
            "foreignPolicy": result["selected"].get("foreignPolicy"),
            "selection": result["selection"],
            "support": result["ballot"]["topSupportPercent"],
            "coordination": {k: v for k, v in result["ballot"]["coordination"].items() if k != "history"},
            "foreignBestResponseGain": result.get("foreignBestResponseGain"),
            "yearTen": {
                k: result["selected"]["us"][-1][k]
                for k in ["output", "workerIncomeIndex", "allIncomeIndex", "resourceResidual"]
            },
        }
    )
    print(name, round(time.monotonic() - start, 1), result["selected"]["usPolicy"]["label"], flush=True)
    if model_fingerprint(ROOT) != fingerprint:
        raise RuntimeError("Model source changed during the audit; rerun against one version.")
    (ROOT / "model-audit.json").write_text(
        json.dumps({"fingerprint": fingerprint, "cases": results}, indent=2) + "\n"
    )
