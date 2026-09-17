"""Cloudflare HTTP adapter for the Python calculator and Astro static pages."""

from __future__ import annotations

import json
import logging
from urllib.parse import urlsplit, urlunsplit

from workers import Request, Response, WorkerEntrypoint

from calculator._generated import MODEL_FINGERPRINT, PRECOMPUTED_PATHS
from calculator.artifacts import scenario_key
from calculator.ballot import NoFundedPoliciesError
from calculator.comparison import compare_policy
from calculator.requests import comparison_request, scenario_request
from calculator.simulation import solve_scenario

CANONICAL_HOST = "ai-pirates-game.com"
MAX_BODY_BYTES = 16 * 1024
API_HEADERS = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}
logger = logging.getLogger(__name__)


class RequestError(ValueError):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def json_response(value: dict, status: int = 200, **headers: str):
    return Response.from_json(value, status=status, headers={**API_HEADERS, **headers})


async def read_json(request: Request) -> dict:
    """Bound streaming body reads, including requests with no Content-Length."""
    content_type = request.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
    if content_type != "application/json":
        raise RequestError("Send the request as application/json.", 415)
    content_length = request.headers.get("Content-Length")
    if content_length is not None:
        try:
            size = int(content_length)
        except ValueError as exc:
            raise RequestError("Invalid Content-Length.") from exc
        if size < 0:
            raise RequestError("Invalid Content-Length.")
        if size > MAX_BODY_BYTES:
            raise RequestError("The request is too large.", 413)
    if not request.body:
        raise RequestError("The request must contain JSON.")
    reader = request.body.getReader()
    body = bytearray()
    try:
        while True:
            chunk = await reader.read()
            if chunk.done:
                break
            if len(body) + chunk.value.byteLength > MAX_BODY_BYTES:
                raise RequestError("The request is too large.", 413)
            body.extend(chunk.value.to_bytes())
    finally:
        reader.releaseLock()
    try:

        def reject_constant(value: str):
            raise ValueError(f"Invalid JSON constant: {value}")

        value = json.loads(body.decode("utf-8"), parse_constant=reject_constant)
    except (UnicodeDecodeError, ValueError, RecursionError) as exc:
        raise RequestError("The request must contain valid JSON.") from exc
    if not isinstance(value, dict):
        raise RequestError("The request must be a JSON object.")
    return value


async def precomputed_snapshot(env, url: str, scenario: dict):
    """Read a matching artifact from this deployment's own static assets."""
    key = scenario_key(scenario)
    path = PRECOMPUTED_PATHS.get(key)
    if not path:
        return None
    parsed = urlsplit(url)
    asset_url = urlunsplit((parsed.scheme, parsed.netloc, path, "", ""))
    try:
        response = await env.ASSETS.fetch(Request(asset_url))
        if response.status != 200:
            return None
        artifact = await response.json()
        if (
            not isinstance(artifact, dict)
            or artifact.get("schemaVersion") != 4
            or artifact.get("fingerprint") != MODEL_FINGERPRINT
            or artifact.get("key") != key
            or not isinstance(artifact.get("snapshot"), dict)
        ):
            return None
        snapshot = artifact["snapshot"]
        # The domestic cache key intentionally ignores the unused foreign goal.
        snapshot["foreignObjective"] = scenario["foreignObjective"]
        return snapshot
    except Exception:
        logger.warning("Precomputed scenario could not be read; calculating it instead.", exc_info=True)
        return None


class Default(WorkerEntrypoint):
    async def fetch(self, request: Request):
        parsed = urlsplit(request.url)
        if parsed.hostname in (CANONICAL_HOST, f"www.{CANONICAL_HOST}") and (
            parsed.scheme != "https" or parsed.hostname != CANONICAL_HOST
        ):
            destination = urlunsplit(("https", CANONICAL_HOST, parsed.path, parsed.query, ""))
            return Response.redirect(destination, 308)
        if not parsed.path.startswith("/api/"):
            return await self.env.ASSETS.fetch(request)
        if parsed.path == "/api/health":
            if request.method != "GET":
                return json_response({"error": "Use GET for this endpoint."}, 405, Allow="GET")
            return json_response({"status": "ok", "engine": "python", "version": MODEL_FINGERPRINT})
        if parsed.path not in ("/api/simulate", "/api/compare"):
            return json_response({"error": "API endpoint not found."}, 404)
        if request.method != "POST":
            return json_response({"error": "Use POST for this endpoint."}, 405, Allow="POST")
        origin = request.headers.get("Origin")
        if origin and origin != f"{parsed.scheme}://{parsed.netloc}":
            return json_response({"error": "Use this site's API from the same origin."}, 403)
        try:
            payload = await read_json(request)
            try:
                validated = (
                    comparison_request(payload)
                    if parsed.path == "/api/compare"
                    else scenario_request(payload)
                )
            except ValueError as exc:
                raise RequestError(str(exc)) from exc
            if parsed.path == "/api/compare":
                return json_response(compare_policy(validated))
            scenario = validated
            snapshot = await precomputed_snapshot(self.env, request.url, scenario)
            source = "precomputed" if snapshot is not None else "calculated"
            if snapshot is None:
                snapshot = solve_scenario(scenario)
            return json_response({"id": scenario["id"], "snapshot": snapshot, "source": source})
        except NoFundedPoliciesError as exc:
            return json_response({"error": str(exc)}, 422)
        except RequestError as exc:
            return json_response({"error": str(exc)}, exc.status)
        except Exception:
            logger.exception("Calculator request failed.")
            return json_response({"error": "The calculation could not be completed. Please try again."}, 500)
