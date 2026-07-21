from __future__ import annotations

import json
import math
import os
import secrets
import time
import urllib.error
import urllib.request
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from password_service.kdf import is_policy_argon2id_phc

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
EVIDENCE_DIRECTORY = REPOSITORY_ROOT / "docs" / "superpowers" / "evidence"


def load_probe_configuration() -> tuple[str, str]:
    values: dict[str, str] = {}
    for name in ("CAPABILITY_PROBE_URL", "CAPABILITY_PROBE_TOKEN"):
        value = os.environ.get(name)
        if value is None or not value.strip():
            raise RuntimeError(f"required environment variable is empty: {name}")
        values[name] = value
    parsed_url = urlparse(values["CAPABILITY_PROBE_URL"])
    if (
        parsed_url.scheme != "https"
        or not parsed_url.netloc
        or parsed_url.username is not None
        or parsed_url.password is not None
        or parsed_url.path not in ("", "/")
        or parsed_url.query
        or parsed_url.fragment
    ):
        raise RuntimeError("CAPABILITY_PROBE_URL must be a credential-free HTTPS Worker URL")
    probe_endpoint = parsed_url._replace(path="/probe").geturl()
    return probe_endpoint, values["CAPABILITY_PROBE_TOKEN"]


def percentile_95(values: list[float]) -> float:
    if not values:
        raise ValueError("cannot calculate percentile for an empty sample")
    ordered = sorted(values)
    return ordered[math.ceil(len(ordered) * 0.95) - 1]


def _call_probe(probe_url: str, probe_token: str, operation: dict[str, str]) -> dict[str, Any]:
    started_at = time.monotonic()
    raw_body = json.dumps(operation, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        probe_url,
        data=raw_body,
        method="POST",
        headers={
            "content-type": "application/json",
            "x-er-probe-token": probe_token,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            response_status = response.status
            response_body = response.read()
    except urllib.error.HTTPError as error:
        return {
            "status": error.code,
            "milliseconds": (time.monotonic() - started_at) * 1_000,
            "body": {},
            "transportOk": False,
        }
    except (TimeoutError, urllib.error.URLError):
        return {
            "status": None,
            "milliseconds": (time.monotonic() - started_at) * 1_000,
            "body": {},
            "transportOk": False,
        }
    if response_status != 200:
        return {
            "status": response_status,
            "milliseconds": (time.monotonic() - started_at) * 1_000,
            "body": {},
            "transportOk": False,
        }
    try:
        decoded = json.loads(response_body)
    except (UnicodeDecodeError, json.JSONDecodeError):
        return {
            "status": None,
            "milliseconds": (time.monotonic() - started_at) * 1_000,
            "body": {},
            "transportOk": False,
        }
    if not isinstance(decoded, dict):
        return {
            "status": None,
            "milliseconds": (time.monotonic() - started_at) * 1_000,
            "body": {},
            "transportOk": False,
        }
    status = decoded.get("status")
    milliseconds = decoded.get("milliseconds")
    body = decoded.get("body")
    if (
        isinstance(status, bool)
        or not isinstance(status, int)
        or isinstance(milliseconds, bool)
        or not isinstance(milliseconds, (int, float))
        or milliseconds < 0
        or not isinstance(body, dict)
    ):
        return {
            "status": None,
            "milliseconds": (time.monotonic() - started_at) * 1_000,
            "body": {},
            "transportOk": False,
        }
    return {
        "status": status,
        "milliseconds": float(milliseconds),
        "body": body,
        "transportOk": True,
    }


def _scenario(results: list[dict[str, Any]], expected_semantic: bool) -> dict[str, object]:
    milliseconds = [float(result["milliseconds"]) for result in results]
    semantics = [result["body"].get("verified") is expected_semantic for result in results]
    return {
        "statuses": [result["status"] for result in results],
        "semantics": semantics,
        "milliseconds": milliseconds,
        "p95Ms": percentile_95(milliseconds),
    }


def _repeat_probe(
    count: int, operation: Callable[[], dict[str, Any]]
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    while len(results) < count:
        result = operation()
        results.append(result)
        if result.get("transportOk") is False:
            break
    return results


def run_probe(probe_url: str, probe_token: str) -> dict[str, object]:
    correct_password = secrets.token_urlsafe(24)
    wrong_password = secrets.token_urlsafe(24)
    hash_result = _call_probe(
        probe_url,
        probe_token,
        {"operation": "hash", "password": correct_password},
    )
    hash_body = hash_result["body"]
    phc_value = hash_body.get("phc")
    phc = phc_value if isinstance(phc_value, str) else ""

    correct_results = _repeat_probe(
        50,
        lambda: _call_probe(
            probe_url,
            probe_token,
            {"operation": "verify", "password": correct_password, "phc": phc},
        ),
    )
    wrong_results = _repeat_probe(
        50,
        lambda: _call_probe(
            probe_url,
            probe_token,
            {"operation": "verify", "password": wrong_password, "phc": phc},
        ),
    )
    dummy_results = _repeat_probe(
        50,
        lambda: _call_probe(
            probe_url,
            probe_token,
            {"operation": "verifyDummy", "password": wrong_password},
        ),
    )
    corrupt_result = _call_probe(
        probe_url,
        probe_token,
        {"operation": "corruptSignature", "password": correct_password},
    )
    with ThreadPoolExecutor(max_workers=13) as executor:
        concurrent_results = list(
            executor.map(
                lambda _index: _call_probe(
                    probe_url,
                    probe_token,
                    {"operation": "verify", "password": correct_password, "phc": phc},
                ),
                range(13),
            )
        )

    hash_semantic = (
        hash_result["status"] == 200
        and isinstance(phc_value, str)
        and is_policy_argon2id_phc(phc_value)
    )
    corrupt_semantic = corrupt_result["status"] == 401
    return {
        "runId": str(uuid.uuid4()),
        "timestamp": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "probeUrl": probe_url,
        "scenarios": {
            "hash": {
                "statuses": [hash_result["status"]],
                "semantics": [hash_semantic],
                "milliseconds": [hash_result["milliseconds"]],
                "p95Ms": hash_result["milliseconds"],
            },
            "correct": _scenario(correct_results, True),
            "wrong": _scenario(wrong_results, False),
            "dummy": _scenario(dummy_results, False),
            "corruptSignature": {
                "statuses": [corrupt_result["status"]],
                "semantics": [corrupt_semantic],
                "milliseconds": [corrupt_result["milliseconds"]],
                "p95Ms": corrupt_result["milliseconds"],
            },
            "concurrent": _scenario(concurrent_results, True),
        },
    }


def write_evidence(evidence: dict[str, object]) -> Path:
    run_id = evidence.get("runId")
    if not isinstance(run_id, str):
        raise RuntimeError("probe result has no run ID")
    EVIDENCE_DIRECTORY.mkdir(parents=True, exist_ok=True)
    path = EVIDENCE_DIRECTORY / f"cloud-run-kdf-{run_id}.json"
    path.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    return path


def main() -> None:
    probe_url, probe_token = load_probe_configuration()
    evidence_path = write_evidence(run_probe(probe_url, probe_token))
    print(evidence_path)


if __name__ == "__main__":
    main()
