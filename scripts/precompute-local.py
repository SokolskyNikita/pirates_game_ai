"""Resumable local process-pool precomputation for an explicit scenario manifest.

This does not claim that a manifest covers the full interactive assumption grid.
No production files or deployment are changed. Each task evaluates the complete
policy menu using the published Python model and its declared numerical resolution.
"""

import argparse
import gzip
import hashlib
import json
import math
import multiprocessing
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
# Separate policy workers should not each start their own BLAS thread pool.
for variable in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS", "VECLIB_MAXIMUM_THREADS"):
    os.environ[variable] = "1"

from static_grid import requests as supported_requests  # noqa: E402

from calculator.artifacts import (  # noqa: E402
    SCHEMA_VERSION,
    model_fingerprint,
    scenario_key,
)
from calculator.config import DEFAULT_INPUTS, INPUT_SPECS  # noqa: E402
from calculator.policies import current_policy  # noqa: E402
from calculator.requests import scenario_request  # noqa: E402


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()


def atomic_write(path, data):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(data)
    temporary.replace(path)


def grid_report():
    axes = {}
    for spec in INPUT_SPECS:
        start, stop, step = (Decimal(str(spec[k])) for k in ("min", "max", "step"))
        values = {start + i * step for i in range(int((stop - start) / step) + 1)}
        values.add(Decimal(str(DEFAULT_INPUTS[spec["key"]])))
        axes[spec["key"]] = values
    pairs = sum(a >= max(0, -j) for j in axes["jobChange"] for a in axes["jobsAffected"])
    domestic = {"usAiGrowth", "productivityGain", "jobSearch", "investmentResponse"}
    count = 4 * pairs * math.prod(len(axes[key]) for key in domestic)
    foreign = set(axes) - domestic - {"jobChange", "jobsAffected", "foreignPopulationRatio"}
    return {
        "axisSizesIncludingReferences": {key: len(values) for key, values in axes.items()},
        "validJobPairs": pairs,
        "domesticScenarios": count,
        "internationalScenariosIgnoringUnusedPopulation": count
        * 3
        * math.prod(len(axes[key]) for key in foreign),
        "note": "Discrete UI grid only; arbitrary legacy URL values add further cases. Population is currently display-only.",
    }


def validate(artifact, key, fingerprint):
    if (
        artifact.get("schemaVersion") != SCHEMA_VERSION
        or artifact.get("fingerprint") != fingerprint
        or artifact.get("key") != key
    ):
        raise ValueError("Saved artifact version or scenario differs.")
    snapshot = artifact["snapshot"]
    if scenario_key(snapshot) != key:
        raise ValueError("Saved assumptions differ from requested assumptions.")
    ballot = snapshot["ballot"]
    if ballot["winnerId"] and not snapshot["selected"]["usAdmissible"]:
        raise ValueError("Unfunded ballot winner.")
    if snapshot["statusQuoUnavailable"] and (
        not ballot["winnerId"] or snapshot["selected"]["usPolicy"]["id"] == current_policy()["id"]
    ):
        raise ValueError("Plurality requires a funded alternative to current policy.")


def calculate(task):
    request, fingerprint, destination = task
    from calculator.simulation import solve_scenario

    started = time.perf_counter()
    key = scenario_key(request)
    artifact = {
        "schemaVersion": SCHEMA_VERSION,
        "fingerprint": fingerprint,
        "key": key,
        "snapshot": solve_scenario(request),
    }
    validate(artifact, key, fingerprint)
    atomic_write(Path(destination), encode(artifact))
    return time.perf_counter() - started


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--requests",
        type=Path,
        help="JSON array of explicit scenario requests; defaults to the complete supported UI grid",
    )
    parser.add_argument("--workers", type=int, default=max(1, min(12, (os.cpu_count() or 2) - 2)))
    parser.add_argument("--output", type=Path, default=ROOT / ".precompute")
    parser.add_argument(
        "--plan", action="store_true", help="Report the full discrete grid without calculating it"
    )
    args = parser.parse_args()
    if args.workers < 1:
        parser.error("workers must be positive")
    if args.plan:
        print(json.dumps(grid_report(), indent=2))
        return
    requests = json.loads(args.requests.read_text()) if args.requests else list(supported_requests())
    if not isinstance(requests, list) or not requests:
        parser.error("requests must be a nonempty JSON array")
    requests = {scenario_key(request): request for request in map(scenario_request, requests)}
    fingerprint = model_fingerprint(ROOT)
    folder = args.output / fingerprint
    folder.mkdir(parents=True, exist_ok=True)
    jobs, paths = [], {}
    for key, request in requests.items():
        path = folder / (hashlib.sha256(key.encode()).hexdigest() + ".json")
        paths[key] = path
        if path.exists():
            try:
                validate(json.loads(path.read_bytes()), key, fingerprint)
                continue
            except (ValueError, KeyError, TypeError):
                pass
        jobs.append((request, fingerprint, str(path)))
    # Remove an earlier completion marker before doing work. Incomplete runs
    # retain valid per-scenario checkpoints, never advertise a complete library.
    manifest = folder / "manifest.json"
    manifest.unlink(missing_ok=True)
    started = time.perf_counter()
    print(
        f"{len(requests)} requested scenarios; {len(jobs)} to calculate; {args.workers} processes", flush=True
    )
    with ProcessPoolExecutor(
        max_workers=args.workers, mp_context=multiprocessing.get_context("spawn")
    ) as pool:
        futures = [pool.submit(calculate, job) for job in jobs]
        for i, future in enumerate(as_completed(futures), 1):
            duration = future.result()
            print(f"Completed {i}/{len(jobs)} ({duration:.2f}s in worker)", flush=True)
    artifacts = []
    for key, path in paths.items():
        artifact = json.loads(path.read_bytes())
        validate(artifact, key, fingerprint)
        artifacts.append(artifact)
    raw = encode(artifacts)
    compressed = gzip.compress(raw, compresslevel=9, mtime=0)
    atomic_write(folder / "bundle.json", raw)
    atomic_write(folder / "bundle.json.gz", compressed)
    report = {
        "fingerprint": fingerprint,
        "completeForManifest": True,
        "exhaustiveInteractiveGrid": set(requests)
        == {scenario_key(request) for request in supported_requests()},
        "scenarioCount": len(artifacts),
        "workers": args.workers,
        "elapsedSeconds": time.perf_counter() - started,
        "jsonBytes": len(raw),
        "gzipBytes": len(compressed),
        "belowInlineThreshold": len(compressed) < 3_500_000,
        "files": {key: path.name for key, path in paths.items()},
    }
    atomic_write(manifest, encode(report))
    print(json.dumps({key: value for key, value in report.items() if key != "files"}, indent=2), flush=True)
    print(f"Saved {folder}", flush=True)


if __name__ == "__main__":
    main()
