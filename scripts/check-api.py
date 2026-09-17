"""Check a running Python API against native results: python scripts/check-api.py URL."""

import json
import sys
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from calculator.config import DEFAULT_INPUTS  # noqa: E402
from calculator.policies import current_policy, make_policy  # noqa: E402
from calculator.simulation import solve_scenario  # noqa: E402


def check_api(base: str) -> None:
    def request(path: str, value=None, expected_status=200):
        body = json.dumps(value).encode() if value is not None else None
        req = Request(
            base.rstrip("/") + path,
            data=body,
            headers={"Content-Type": "application/json", "User-Agent": "AI-Pirates-Game-API-Check/1.0"},
        )
        try:
            response = urlopen(req, timeout=180)
        except HTTPError as error:
            response = error
        with response:
            assert response.status == expected_status, (path, response.status, response.read().decode()[:200])
            return json.load(response)

    assert request("/api/health")["engine"] == "python"
    for mode, objective, plurality in (
        ("us-only", "workers", False),
        ("strategic", "workers", False),
        ("strategic", "output", False),
        ("us-only", "workers", True),
        ("strategic", "output", True),
    ):
        scenario = {
            "id": 73,
            "inputs": {**DEFAULT_INPUTS, "productivityGain": 0.45, "jobsAffected": 0.4, "jobChange": -0.35},
            "mode": mode,
            "foreignObjective": objective,
            "pauseUnavailable": False,
            "statusQuoUnavailable": plurality,
        }
        response = request("/api/simulate", scenario)
        assert response["id"] == scenario["id"] and response["source"] == "calculated"
        actual, expected = response["snapshot"], solve_scenario(scenario)
        for key in ("ballot", "selection", "search", "foreignBestPolicy"):
            assert actual.get(key) == expected.get(key), f"{mode}/{objective}: {key} differs"
        assert actual["selected"]["id"] == expected["selected"]["id"]
        assert actual["statusQuoUnavailable"] == plurality
        assert actual["ballot"]["votingRule"] == ("plurality" if plurality else "majority")
        if plurality:
            assert actual["ballot"]["winnerId"] == actual["ballot"]["leadingPolicyId"]
            assert actual["selected"]["usAdmissible"]
            assert actual["ballot"]["winnerId"] != current_policy()["id"]
            assert actual["ballot"]["excludedCandidateCount"] == 1
        selected = actual["selected"]
        comparison = {
            "scenario": scenario,
            "policyId": selected["usPolicy"]["id"],
            "selectedPolicyId": selected["usPolicy"]["id"],
        }
        if "foreignPolicy" in selected:
            comparison["foreignPolicyId"] = selected["foreignPolicy"]["id"]
        assert request("/api/compare", comparison)["voteShare"] == 0
        if mode == "strategic":
            closed = make_policy({**current_policy(), "allowFreeTrade": False})
            closed_result = request("/api/compare", {**comparison, "policyId": closed["id"]})["profile"]
            for region in ("us", "foreign"):
                assert all(not p["tradeOpen"] and p["importShare"] == 0 for p in closed_result[region][1:])
            assert actual["policyCount"] == 12960 and actual["search"]["startsTried"] == 6
        else:
            assert actual["policyCount"] == 6480
        print(f"Passed native/runtime ballot parity and manual comparison: {mode}/{objective}/plurality={plurality}", flush=True)
    for payload in (
        {"inputs": {"usAiGrowth": 10**400}}, {"pauseUnavailable": 1},
        {"statusQuoUnavailable": "true"}, {"mode": []},
    ):
        assert "error" in request("/api/simulate", payload, 400)
    assert "error" in request("/api/compare", {"policyId": "unknown", "selectedPolicyId": "unknown"}, 400)
    print("API validation passed.", flush=True)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python scripts/check-api.py http://localhost:8787")
    check_api(sys.argv[1])
