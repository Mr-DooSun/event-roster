from __future__ import annotations

import argparse
import json
import math
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
EVIDENCE_DIRECTORY = REPOSITORY_ROOT / "docs" / "superpowers" / "evidence"
ROOT_FIELDS = {"runId", "timestamp", "probeUrl", "scenarios"}
SCENARIO_FIELDS = {"statuses", "semantics", "milliseconds", "p95Ms"}


class EvidenceValidationError(ValueError):
    pass


def _p95(values: list[float]) -> float:
    ordered = sorted(values)
    return ordered[math.ceil(len(ordered) * 0.95) - 1]


def _validate_scenario(
    name: str,
    value: object,
    *,
    count: int,
    expected_status: int,
    expected_semantic: bool,
    p95_limit: float | None,
) -> None:
    if not isinstance(value, dict) or set(value) != SCENARIO_FIELDS:
        raise EvidenceValidationError(f"{name}: unexpected scenario fields")
    statuses = value["statuses"]
    semantics = value["semantics"]
    milliseconds = value["milliseconds"]
    p95_ms = value["p95Ms"]
    if (
        not isinstance(statuses, list)
        or len(statuses) != count
        or any(status != expected_status for status in statuses)
    ):
        raise EvidenceValidationError(f"{name}: unexpected statuses")
    if (
        not isinstance(semantics, list)
        or len(semantics) != count
        or any(semantic is not expected_semantic for semantic in semantics)
    ):
        raise EvidenceValidationError(f"{name}: unexpected semantics")
    if (
        not isinstance(milliseconds, list)
        or len(milliseconds) != count
        or any(
            isinstance(duration, bool)
            or not isinstance(duration, (int, float))
            or not math.isfinite(duration)
            or duration < 0
            for duration in milliseconds
        )
    ):
        raise EvidenceValidationError(f"{name}: invalid milliseconds")
    durations = [float(duration) for duration in milliseconds]
    if (
        isinstance(p95_ms, bool)
        or not isinstance(p95_ms, (int, float))
        or not math.isclose(float(p95_ms), _p95(durations), abs_tol=0.001)
    ):
        raise EvidenceValidationError(f"{name}: invalid P95")
    if p95_limit is not None and float(p95_ms) > p95_limit:
        raise EvidenceValidationError(f"{name}: P95 exceeds the gate")


def validate_evidence(evidence: object) -> None:
    if not isinstance(evidence, dict) or set(evidence) != ROOT_FIELDS:
        raise EvidenceValidationError("unexpected root fields")
    try:
        uuid.UUID(str(evidence["runId"]))
        datetime.fromisoformat(str(evidence["timestamp"]).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        raise EvidenceValidationError("invalid run metadata") from None
    parsed_url = urlparse(str(evidence["probeUrl"]))
    if (
        parsed_url.scheme != "https"
        or not parsed_url.netloc
        or parsed_url.username is not None
        or parsed_url.password is not None
        or parsed_url.query
        or parsed_url.fragment
    ):
        raise EvidenceValidationError("invalid probe URL")
    scenarios = evidence["scenarios"]
    expected_names = {
        "hash",
        "correct",
        "wrong",
        "dummy",
        "corruptSignature",
        "concurrent",
    }
    if not isinstance(scenarios, dict) or set(scenarios) != expected_names:
        raise EvidenceValidationError("unexpected scenario fields")
    contracts: dict[str, tuple[int, int, bool, float | None]] = {
        "hash": (1, 200, True, None),
        "correct": (50, 200, True, 1_500),
        "wrong": (50, 200, False, 1_500),
        "dummy": (50, 200, False, 1_500),
        "corruptSignature": (1, 401, True, None),
        "concurrent": (13, 200, True, 8_000),
    }
    for name, (count, status, semantic, p95_limit) in contracts.items():
        _validate_scenario(
            name,
            scenarios[name],
            count=count,
            expected_status=status,
            expected_semantic=semantic,
            p95_limit=p95_limit,
        )


def _latest_evidence() -> Path:
    candidates = list(EVIDENCE_DIRECTORY.glob("cloud-run-kdf-*.json"))
    if not candidates:
        raise EvidenceValidationError("no Cloud Run KDF evidence found")
    return max(candidates, key=lambda path: path.stat().st_mtime_ns)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("path", nargs="?", type=Path)
    parser.add_argument("--latest", action="store_true")
    arguments = parser.parse_args()
    if arguments.latest == (arguments.path is not None):
        parser.error("provide exactly one evidence path or --latest")
    evidence_path = _latest_evidence() if arguments.latest else arguments.path
    assert isinstance(evidence_path, Path)
    try:
        evidence: Any = json.loads(evidence_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        raise EvidenceValidationError("unable to read evidence") from None
    validate_evidence(evidence)
    print(evidence_path)


if __name__ == "__main__":
    main()
