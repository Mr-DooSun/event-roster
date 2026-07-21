from __future__ import annotations

from copy import deepcopy

import pytest

from password_service.kdf import PasswordKdf
from scripts.assert_evidence import EvidenceValidationError, validate_evidence
from scripts.run_remote_probe import _call_probe, load_probe_configuration, percentile_95, run_probe


def valid_evidence() -> dict[str, object]:
    return {
        "runId": "00000000-0000-4000-8000-000000000000",
        "timestamp": "2026-07-21T00:00:00Z",
        "probeUrl": "https://probe.example/probe",
        "scenarios": {
            "hash": {
                "statuses": [200],
                "semantics": [True],
                "milliseconds": [100.0],
                "p95Ms": 100.0,
            },
            "correct": {
                "statuses": [200] * 50,
                "semantics": [True] * 50,
                "milliseconds": [100.0] * 50,
                "p95Ms": 100.0,
            },
            "wrong": {
                "statuses": [200] * 50,
                "semantics": [False] * 50,
                "milliseconds": [100.0] * 50,
                "p95Ms": 100.0,
            },
            "dummy": {
                "statuses": [200] * 50,
                "semantics": [False] * 50,
                "milliseconds": [100.0] * 50,
                "p95Ms": 100.0,
            },
            "corruptSignature": {
                "statuses": [401],
                "semantics": [True],
                "milliseconds": [10.0],
                "p95Ms": 10.0,
            },
            "concurrent": {
                "statuses": [200] * 13,
                "semantics": [True] * 13,
                "milliseconds": [200.0] * 13,
                "p95Ms": 200.0,
            },
        },
    }


def test_probe_configuration_fails_closed_without_both_values(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("CAPABILITY_PROBE_URL", raising=False)
    monkeypatch.setenv("CAPABILITY_PROBE_TOKEN", "configured-test-token")
    with pytest.raises(RuntimeError, match="CAPABILITY_PROBE_URL"):
        load_probe_configuration()


def test_probe_configuration_rejects_a_url_that_could_persist_a_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("CAPABILITY_PROBE_URL", "https://probe.example/probe?token=redacted")
    monkeypatch.setenv("CAPABILITY_PROBE_TOKEN", "configured-test-token")
    with pytest.raises(RuntimeError, match="CAPABILITY_PROBE_URL"):
        load_probe_configuration()


def test_probe_configuration_targets_the_worker_probe_route(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("CAPABILITY_PROBE_URL", "https://probe.example")
    monkeypatch.setenv("CAPABILITY_PROBE_TOKEN", "configured-test-token")
    probe_url, _token = load_probe_configuration()
    assert probe_url == "https://probe.example/probe"


def test_percentile_95_uses_nearest_rank() -> None:
    assert percentile_95([float(value) for value in range(1, 21)]) == 19.0


def test_probe_timeout_returns_a_status_only_failure_record(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def timeout(*_args: object, **_kwargs: object) -> None:
        raise TimeoutError

    monkeypatch.setattr("urllib.request.urlopen", timeout)
    result = _call_probe(
        "https://probe.example/probe",
        "configured-test-token",
        {"operation": "hash", "password": "temporary-test-input"},
    )
    assert result["status"] is None
    assert result["body"] == {}
    assert result["transportOk"] is False
    assert result["milliseconds"] >= 0


def test_remote_run_preserves_only_factual_attempts_after_transport_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    call_count = 0

    def failed_call(*_args: object, **_kwargs: object) -> dict[str, object]:
        nonlocal call_count
        call_count += 1
        return {"status": None, "milliseconds": 1.0, "body": {}, "transportOk": False}

    monkeypatch.setattr("scripts.run_remote_probe._call_probe", failed_call)
    evidence = run_probe("https://probe.example/probe", "configured-test-token")
    scenarios = evidence["scenarios"]
    assert isinstance(scenarios, dict)
    assert scenarios["correct"]["statuses"] == [None]
    assert scenarios["wrong"]["statuses"] == [None]
    assert scenarios["dummy"]["statuses"] == [None]
    assert len(scenarios["concurrent"]["statuses"]) == 13
    assert call_count == 18


def test_remote_hash_requires_the_exact_argon2id_policy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    out_of_policy_phc = PasswordKdf("test-pepper").hash("temporary-test-input").replace(
        "m=19456", "m=19457"
    )

    def successful_call(
        _probe_url: str, _probe_token: str, operation: dict[str, str]
    ) -> dict[str, object]:
        if operation["operation"] == "hash":
            body: dict[str, object] = {"phc": out_of_policy_phc}
        elif operation["operation"] == "corruptSignature":
            return {"status": 401, "milliseconds": 1.0, "body": {}, "transportOk": True}
        else:
            body = {"verified": False}
        return {"status": 200, "milliseconds": 1.0, "body": body, "transportOk": True}

    monkeypatch.setattr("scripts.run_remote_probe._call_probe", successful_call)

    evidence = run_probe("https://probe.example/probe", "configured-test-token")
    scenarios = evidence["scenarios"]
    assert isinstance(scenarios, dict)
    hash_scenario = scenarios["hash"]
    assert isinstance(hash_scenario, dict)
    assert hash_scenario["semantics"] == [False]


def test_complete_status_only_evidence_is_accepted() -> None:
    validate_evidence(valid_evidence())


def test_evidence_rejects_any_unapproved_field() -> None:
    evidence = deepcopy(valid_evidence())
    evidence["password"] = "redacted"
    with pytest.raises(EvidenceValidationError, match="fields"):
        validate_evidence(evidence)


def test_evidence_rejects_incomplete_semantics() -> None:
    evidence = deepcopy(valid_evidence())
    scenarios = evidence["scenarios"]
    assert isinstance(scenarios, dict)
    correct = scenarios["correct"]
    assert isinstance(correct, dict)
    correct["semantics"] = [True] * 49
    with pytest.raises(EvidenceValidationError, match="correct"):
        validate_evidence(evidence)
