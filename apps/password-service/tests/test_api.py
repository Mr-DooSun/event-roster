from __future__ import annotations

from collections.abc import Callable
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from conftest import KdfSpy
from argon2 import PasswordHasher, Type
from password_service.config import Settings
from password_service.kdf import (
    DUMMY_PASSWORD_INPUT,
    HASH_LENGTH,
    MEMORY_COST,
    PARALLELISM,
    SALT_LENGTH,
    TIME_COST,
    PasswordKdf,
)
from password_service.main import create_app


def test_healthz_does_not_run_kdf(client: TestClient, kdf_spy: KdfSpy) -> None:
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert kdf_spy.hash_calls == 0
    assert kdf_spy.verify_calls == 0


def test_validation_error_never_echoes_password(
    client: TestClient,
    signed_headers: Callable[[str, str, bytes], dict[str, str]],
) -> None:
    body = b'{"password":"short"}'
    response = client.post(
        "/internal/v1/password/hash",
        content=body,
        headers=signed_headers("POST", "/internal/v1/password/hash", body),
    )
    assert response.status_code == 422
    assert response.json() == {"code": "VALIDATION_FAILED"}
    assert "short" not in response.text


def test_signed_malformed_json_returns_generic_validation_error(
    client: TestClient,
    signed_headers: Callable[[str, str, bytes], dict[str, str]],
) -> None:
    body = b'{"password":'
    response = client.post(
        "/internal/v1/password/hash",
        content=body,
        headers=signed_headers("POST", "/internal/v1/password/hash", body),
    )
    assert response.status_code == 422
    assert response.json() == {"code": "VALIDATION_FAILED"}


def test_hash_runs_once_after_signature_and_validation(
    client: TestClient,
    kdf_spy: KdfSpy,
    signed_headers: Callable[[str, str, bytes], dict[str, str]],
) -> None:
    body = b'{"password":"temporary-password-123"}'
    response = client.post(
        "/internal/v1/password/hash",
        content=body,
        headers=signed_headers("POST", "/internal/v1/password/hash", body),
    )
    assert response.status_code == 200
    assert response.json()["kdfVersion"] == 1
    assert response.json()["phc"].startswith("$argon2id$")
    assert kdf_spy.hash_calls == 1


@pytest.mark.parametrize("phc_fragment", [b"", b',"phc":"not-a-valid-phc"'])
def test_verify_uses_dummy_for_missing_or_invalid_phc_and_always_returns_false(
    phc_fragment: bytes,
    client: TestClient,
    kdf_spy: KdfSpy,
    signed_headers: Callable[[str, str, bytes], dict[str, str]],
) -> None:
    kdf_spy.verify_result = True
    body = b'{"password":"temporary-password-123"' + phc_fragment + b"}"
    response = client.post(
        "/internal/v1/password/verify",
        content=body,
        headers=signed_headers("POST", "/internal/v1/password/verify", body),
    )
    assert response.status_code == 200
    assert response.json() == {"verified": False}
    assert kdf_spy.verify_calls == 1
    assert kdf_spy.dummy_verify_calls == 1


def test_verify_returns_underlying_result_for_valid_argon2id_phc(
    client: TestClient,
    kdf_spy: KdfSpy,
    signed_headers: Callable[[str, str, bytes], dict[str, str]],
) -> None:
    kdf_spy.verify_result = True
    candidate_phc = PasswordKdf("another-test-pepper").hash("another-test-input")
    body = (
        '{"password":"temporary-password-123","phc":"' + candidate_phc + '"}'
    ).encode()
    response = client.post(
        "/internal/v1/password/verify",
        content=body,
        headers=signed_headers("POST", "/internal/v1/password/verify", body),
    )
    assert response.status_code == 200
    assert response.json() == {"verified": True}
    assert kdf_spy.verify_calls == 1
    assert kdf_spy.dummy_verify_calls == 0


def test_verify_uses_dummy_for_argon2id_phc_outside_the_fixed_cost_policy(
    client: TestClient,
    kdf_spy: KdfSpy,
    signed_headers: Callable[[str, str, bytes], dict[str, str]],
) -> None:
    kdf_spy.verify_result = True
    candidate_phc = PasswordKdf("another-test-pepper").hash("another-test-input")
    out_of_policy_phc = candidate_phc.replace("m=19456", "m=19457")
    body = (
        '{"password":"temporary-password-123","phc":"' + out_of_policy_phc + '"}'
    ).encode()
    response = client.post(
        "/internal/v1/password/verify",
        content=body,
        headers=signed_headers("POST", "/internal/v1/password/verify", body),
    )
    assert response.status_code == 200
    assert response.json() == {"verified": False}
    assert kdf_spy.verify_calls == 1
    assert kdf_spy.dummy_verify_calls == 1


@pytest.mark.parametrize("missing_name", ["PASSWORD_PEPPER", "AUTH_KDF_SHARED_SECRET", "DUMMY_ARGON2_PHC"])
def test_settings_reject_missing_or_empty_secret(monkeypatch: pytest.MonkeyPatch, missing_name: str) -> None:
    for name in ("PASSWORD_PEPPER", "AUTH_KDF_SHARED_SECRET", "DUMMY_ARGON2_PHC"):
        monkeypatch.setenv(name, "configured-test-value")
    monkeypatch.setenv(missing_name, "  ")
    with pytest.raises(RuntimeError, match=missing_name):
        Settings.from_environment()


def test_startup_rejects_dummy_phc_that_does_not_verify_with_current_pepper(
    settings: Settings,
) -> None:
    invalid_settings = replace(settings, dummy_argon2_phc=settings.dummy_argon2_phc + "\n")
    with pytest.raises(RuntimeError, match="DUMMY_ARGON2_PHC"):
        with TestClient(create_app(settings=invalid_settings)):
            pass


def test_startup_rejects_dummy_phc_that_verifies_but_uses_a_weaker_policy() -> None:
    configured_kdf = PasswordKdf("test-pepper")
    weaker_phc = PasswordHasher(
        time_cost=TIME_COST - 1,
        memory_cost=MEMORY_COST,
        parallelism=PARALLELISM,
        hash_len=HASH_LENGTH,
        salt_len=SALT_LENGTH,
        type=Type.ID,
    ).hash(configured_kdf._prepared(DUMMY_PASSWORD_INPUT))
    invalid_settings = Settings(
        password_pepper="test-pepper",
        auth_kdf_shared_secret="test-shared-secret",
        dummy_argon2_phc=weaker_phc,
    )

    with pytest.raises(RuntimeError, match="DUMMY_ARGON2_PHC"):
        with TestClient(create_app(settings=invalid_settings)):
            pass
