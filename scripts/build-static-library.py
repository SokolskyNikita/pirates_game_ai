"""Export only displayed results; enforce the complete library's 3.5 MB budget."""
import gzip
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from static_grid import CHOICES, VARIABLE_KEYS, lookup_key, requests  # noqa: E402

from calculator.artifacts import model_fingerprint, presentation_config, scenario_key  # noqa: E402

LIMIT = 3_500_000
YEAR_FIELDS = """year adoption output gdpGrowthRate workerIncomeIndex allIncomeIndex
employedIncomeIndex displacedIncomeIndex unemployment productiveEmployment retainedWorkers
consumerPriceIndex tradeOpen employerNetPayRatio benefitsRequired benefitsPaid benefitsScalePaid
baselineBenefits aiProfitTaxRevenue effectiveLaborTax effectiveCapitalTax capacityFactor""".split()


def encode(value):
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()


def display_year(year):
    # Only reporting values are rounded, after every vote and funding decision.
    # Preserve membership fractions exactly: tiny groups control chart gaps.
    exact = {"productiveEmployment", "retainedWorkers", "unemployment"}
    return {k: year[k] if k in exact or not isinstance(year[k], float) else round(year[k], 4)
            for k in YEAR_FIELDS}


def pack(artifact):
    original = artifact["snapshot"]
    snapshot = {k: v for k, v in original.items() if k not in {
        "selected", "statusQuo", "baseline", "alternatives", "leading",
        "foreignBestPolicy"}}
    source = original["selected"]
    selected = {k: source[k] for k in ("usPolicy", "usAdmissible", "employerPaymentRange")}
    selected["us"] = [display_year(year) for year in source["us"]]
    if source.get("foreignPolicy"):
        selected["foreignPolicy"] = source["foreignPolicy"]
        selected["foreignAdmissible"] = source["foreignAdmissible"]
        # Foreign UI only displays year ten.
        selected["foreign"] = [display_year(source["foreign"][-1])]
    snapshot["selected"] = selected
    if original.get("leading"):
        snapshot["leading"] = {"usPolicy": original["leading"]["usPolicy"]}
    snapshot["ballot"] = {k: v for k, v in original["ballot"].items()
                          if k not in {"tallies", "voterChoices"}}
    if "coordination" in snapshot["ballot"]:
        snapshot["ballot"]["coordination"] = {k: v for k, v in snapshot["ballot"]["coordination"].items() if k != "history"}
    return {"schema": 2, "fingerprint": artifact["fingerprint"], "snapshot": snapshot}


def main():
    fingerprint = model_fingerprint(ROOT)
    generated = ROOT / "src/generated"
    stored = generated / "results.json.gz"
    scenarios = list(requests())
    if "--import" in sys.argv:
        source = ROOT / (sys.argv[sys.argv.index("--source") + 1] if "--source" in sys.argv else ".precompute") / fingerprint
        results = {}
        for request in scenarios:
            canonical = scenario_key(request)
            name = hashlib.sha256(canonical.encode()).hexdigest() + ".json"
            artifact = json.loads((source / name).read_bytes())
            if (artifact["fingerprint"] != fingerprint or artifact["key"] != canonical
                    or scenario_key(artifact["snapshot"]) != canonical):
                raise ValueError("Mismatched saved scenario")
            results[lookup_key(request)] = pack(artifact)
        compressed = gzip.compress(encode(results), compresslevel=9, mtime=0)
        if len(compressed) >= LIMIT:
            raise ValueError(f"Export exceeds 3.5 MB: {len(compressed):,} bytes")
        stored.write_bytes(compressed)
    raw = gzip.decompress(stored.read_bytes())
    results = json.loads(raw)
    if len(results) != len(scenarios):
        raise ValueError("Incomplete library")
    for request in scenarios:
        value = results[lookup_key(request)]
        if (value["schema"] != 2 or value["fingerprint"] != fingerprint
                or scenario_key(value["snapshot"]) != scenario_key(request)):
            raise ValueError("Stale or mismatched scenario")
    compressed_bytes = len(gzip.compress(raw, compresslevel=9, mtime=0))
    if compressed_bytes >= LIMIT:
        raise ValueError("Inline library exceeds 3.5 MB")
    (generated / "static-grid.json").write_bytes(encode({"choices": CHOICES, "variableKeys": VARIABLE_KEYS, "scenarioCount": len(scenarios)}))
    (generated / "static-library.json").write_bytes(encode({"fingerprint": fingerprint, "inline": True, "gzipBytes": compressed_bytes, "scenarioCount": len(results)}))
    (generated / "static-inline.json").write_bytes(raw)
    (generated / "calculator-config.json").write_bytes(encode(presentation_config()))
    print(f"Complete: {len(results)} scenarios; gzip {compressed_bytes:,} bytes; inline=True", flush=True)


if __name__ == "__main__":
    main()
