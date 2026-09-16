"""Generate presentation metadata and versioned, exact common-scenario assets.

Python owns both economic calculations and the values offered by the interface.
Asset keys include every assumption, the voting mode, and pause availability.
"""

from __future__ import annotations

import hashlib
import json
import re
import time
from pathlib import Path

from .config import DEFAULT_INPUTS, INPUT_SPECS, MODEL_NOTES, normalize_inputs
from .policies import INTERNATIONAL_POLICIES
from .population import CALIBRATION, PREPARED, US_ELECTORATE

SCHEMA_VERSION = 3
POLICY_AXES = (
    "pace", "replacement", "welfareScale", "benefitFormula", "laborTax", "capitalTax", "allowFreeTrade"
)


def scenario_key(request: dict) -> str:
    """A deterministic key; irrelevant domestic foreign objectives share an asset."""
    mode = request.get("mode", "us-only")
    return json.dumps(
        {
            "inputs": {key: float(value) for key, value in normalize_inputs(request.get("inputs")).items()},
            "mode": mode,
            "foreignObjective": request.get("foreignObjective", "prosperity")
            if mode == "strategic"
            else None,
            "pauseUnavailable": request.get("pauseUnavailable", False),
        },
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )


def presentation_config() -> dict:
    """Export choices and baseline displays, never browser-side formulas."""
    options = {axis: {} for axis in POLICY_AXES}
    for policy in INTERNATIONAL_POLICIES:
        parts = policy["id"].split("|")[:6] + ["" if policy["allowFreeTrade"] else "closed"]
        for axis, part in zip(POLICY_AXES, parts, strict=True):
            options[axis].setdefault(part, {"value": policy[axis], "idPart": part})
    return {
        "defaults": DEFAULT_INPUTS,
        "inputSpecs": INPUT_SPECS,
        "policyOptions": {axis: list(values.values()) for axis, values in options.items()},
        "calibration": CALIBRATION,
        "electorate": US_ELECTORATE,
        "modelNotes": MODEL_NOTES,
        "referenceIncome": PREPARED.baseline_all_income,
    }


def model_fingerprint(root: Path) -> str:
    digest = hashlib.sha256()
    source = root / "calculator"
    files = sorted(
        path
        for path in source.rglob("*")
        if path.suffix in (".py", ".json")
        and path.name != "_generated.py"
        and "__pycache__" not in path.parts
    )
    for path in files:
        digest.update(str(path.relative_to(source)).encode())
        digest.update(path.read_bytes())
    # A dependency change can alter numerical evaluation, so invalidates all assets.
    digest.update((root / "pyproject.toml").read_bytes())
    return digest.hexdigest()[:20]


def common_scenarios():
    cases = (
        ("default", DEFAULT_INPUTS),
        (
            "all-roles-obsolete",
            {**DEFAULT_INPUTS, "productivityGain": 0.5, "displacement": 1, "reemployment": 0},
        ),
    )
    for name, inputs in cases:
        for pause in (False, True):
            for mode in ("us-only", "strategic"):
                for objective in ("workers",) if mode == "us-only" else ("workers", "prosperity", "output"):
                    yield (
                        name,
                        {
                            "id": 0,
                            "inputs": inputs,
                            "mode": mode,
                            "foreignObjective": objective,
                            "pauseUnavailable": pause,
                        },
                    )


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n")


def build_artifacts(root: Path, *, metadata_only: bool = False) -> None:
    """Build the common library; unusual combinations use the same live engine."""
    write_json(root / "src/generated/calculator-config.json", presentation_config())
    if metadata_only:
        return
    from .simulation import solve_scenario

    fingerprint = model_fingerprint(root)
    output = root / "public/precomputed"
    output.mkdir(parents=True, exist_ok=True)
    paths = {}
    live_files = set()
    for name, request in common_scenarios():
        key = scenario_key(request)
        filename = fingerprint + "-" + hashlib.sha256(key.encode()).hexdigest()[:16] + ".json"
        started = time.perf_counter()
        snapshot = solve_scenario(request)
        if scenario_key(snapshot) != key:
            raise ValueError("Precomputed inputs differ from the request.")
        if snapshot["ballot"]["winnerId"] and not snapshot["selected"]["usAdmissible"]:
            raise ValueError("A ballot winner must be fully funded.")
        write_json(
            output / filename,
            {"schemaVersion": SCHEMA_VERSION, "fingerprint": fingerprint, "key": key, "snapshot": snapshot},
        )
        paths[key] = "/precomputed/" + filename
        live_files.add(filename)
        print(
            f"{name}: {request['mode']} / {request['foreignObjective']}, "
            f"pause {'unavailable' if request['pauseUnavailable'] else 'available'}: "
            f"{snapshot['selection']} ({time.perf_counter() - started:.2f}s)",
            flush=True,
        )
    manifest = (
        '"""Generated by scripts/build-precomputed.py; do not edit."""\n'
        f"MODEL_FINGERPRINT = {fingerprint!r}\nPRECOMPUTED_PATHS = {paths!r}\n"
    )
    (root / "calculator/_generated.py").write_text(manifest)
    for path in output.iterdir():
        if re.fullmatch(r"[a-f0-9]+-[a-f0-9]+\.json", path.name) and path.name not in live_files:
            path.unlink()
    print(f"Generated {len(paths)} common scenarios; all other inputs use the Python API.", flush=True)
