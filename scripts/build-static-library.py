"""Package every declared scenario; refuse partial or stale static libraries."""

import gzip
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from static_grid import CHOICES, VARIABLE_KEYS, lookup_key, requests  # noqa: E402

from calculator.artifacts import model_fingerprint, presentation_config, scenario_key  # noqa: E402
from calculator.comparison import count_votes  # noqa: E402
from calculator.population import CALIBRATION  # noqa: E402


def encode(value):
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()


def pack(artifact):
    snapshot = dict(artifact["snapshot"])
    profiles, indexes = [], {}

    def reference(profile):
        key = encode(profile)
        if key not in indexes:
            indexes[key] = len(profiles)
            profiles.append(profile)
        return indexes[key]

    candidates = {
        p["usPolicy"]["id"]: p
        for p in [snapshot["selected"], snapshot["statusQuo"], *snapshot["alternatives"]]
    }
    votes = {
        key: count_votes(profile["usUtilities"], snapshot["selected"]["usUtilities"], CALIBRATION["weights"])
        for key, profile in candidates.items()
    }
    for key in ("selected", "statusQuo", "baseline", "leading"):
        if key in snapshot:
            snapshot[key] = reference(snapshot[key])
    snapshot["alternatives"] = [reference(p) for p in snapshot["alternatives"]]
    return {
        "schema": 1,
        "fingerprint": artifact["fingerprint"],
        "key": artifact["key"],
        "snapshot": snapshot,
        "profiles": profiles,
        "comparisonVotes": votes,
    }


def main():
    fingerprint = model_fingerprint(ROOT)
    packaging = hashlib.sha256(
        Path(__file__).read_bytes() + (ROOT / "scripts/static_grid.py").read_bytes()
    ).hexdigest()[:12]
    source = ROOT / ".precompute" / fingerprint
    target = ROOT / "public/static-library" / fingerprint
    importing = "--import" in sys.argv
    scenarios = list(requests())
    paths, wire_bytes = {}, 0
    bundle_path = ROOT / ".build/static-bundle.json.gz"
    bundle_path.parent.mkdir(parents=True, exist_ok=True)
    # Stream the whole-library measurement: CI need not hold hundreds of
    # megabytes of decoded cohort records and another JSON copy in memory.
    with gzip.GzipFile(filename=str(bundle_path), mode="wb", compresslevel=9, mtime=0) as bundle:
        bundle.write(b"{")
        for index, request in enumerate(scenarios):
            canonical = scenario_key(request)
            name = hashlib.sha256(canonical.encode()).hexdigest()
            destination = target / (name + ".json.gz")
            if importing:
                artifact = json.loads((source / (name + ".json")).read_bytes())
                if (
                    artifact["fingerprint"] != fingerprint
                    or artifact["key"] != canonical
                    or scenario_key(artifact["snapshot"]) != canonical
                ):
                    raise ValueError("Mismatched saved scenario")
                payload = pack(artifact)
                target.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(gzip.compress(encode(payload), compresslevel=9, mtime=0))
            payload = json.loads(gzip.decompress(destination.read_bytes()))
            if payload["schema"] != 1 or payload["fingerprint"] != fingerprint or payload["key"] != canonical:
                raise ValueError("Stale or mismatched static scenario")
            key = lookup_key(request)
            if key in paths:
                raise ValueError("Duplicate grid key")
            paths[key] = "/static-library/" + fingerprint + "/" + destination.name + "?v=" + packaging
            if index:
                bundle.write(b",")
            bundle.write(encode(key) + b":" + encode(payload))
            wire_bytes += destination.stat().st_size
        bundle.write(b"}")
    compressed_bytes = bundle_path.stat().st_size
    inline = compressed_bytes < 3_500_000
    generated = ROOT / "src/generated"
    generated.mkdir(parents=True, exist_ok=True)
    (generated / "static-grid.json").write_bytes(
        encode({"choices": CHOICES, "variableKeys": VARIABLE_KEYS, "scenarioCount": len(scenarios)})
    )
    (generated / "static-library.json").write_bytes(
        encode(
            {
                "fingerprint": fingerprint,
                "paths": paths,
                "inline": inline,
                "gzipBytes": compressed_bytes,
                "individualGzipBytes": wire_bytes,
                "scenarioCount": len(paths),
            }
        )
    )
    (generated / "static-inline.json").write_bytes(
        gzip.decompress(bundle_path.read_bytes()) if inline else b"null"
    )
    (generated / "calculator-config.json").write_bytes(encode(presentation_config()))
    print(
        f"Complete: {len(paths)} scenarios; whole-library gzip {compressed_bytes:,} bytes; individual gzip files {wire_bytes:,} bytes; inline={inline}",
        flush=True,
    )


if __name__ == "__main__":
    main()
