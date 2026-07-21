from __future__ import annotations

import asyncio
import time
from collections.abc import Callable

import pytest
from fastapi import HTTPException, Request
from fastapi.testclient import TestClient

from conftest import KdfSpy
from password_service.signature import require_worker_signature


def test_rejects_bad_signature_before_running_argon2(
    client: TestClient, kdf_spy: KdfSpy
) -> None:
    response = client.post(
        "/internal/v1/password/hash",
        content=b'{"password":"temporary-password-123"}',
        headers={"content-type": "application/json", "x-er-kdf-timestamp": "0"},
    )
    assert response.status_code == 401
    assert kdf_spy.hash_calls == 0


def test_rejects_unknown_key_id_before_running_argon2(
    client: TestClient,
    kdf_spy: KdfSpy,
    signed_headers: Callable[[str, str, bytes], dict[str, str]],
) -> None:
    body = b'{"password":"temporary-password-123"}'
    headers = signed_headers("POST", "/internal/v1/password/hash", body)
    headers["x-er-kdf-key-id"] = "v2"
    response = client.post("/internal/v1/password/hash", content=body, headers=headers)
    assert response.status_code == 401
    assert kdf_spy.hash_calls == 0


def test_rejects_stale_signature_before_running_argon2(
    client: TestClient,
    kdf_spy: KdfSpy,
    signed_headers: Callable[[str, str, bytes], dict[str, str]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    body = b'{"password":"temporary-password-123"}'
    headers = signed_headers("POST", "/internal/v1/password/hash", body)
    signed_at = int(time.time())
    monkeypatch.setattr("password_service.signature.time.time", lambda: signed_at + 61)
    response = client.post("/internal/v1/password/hash", content=body, headers=headers)
    assert response.status_code == 401
    assert kdf_spy.hash_calls == 0


def test_rejects_body_digest_mismatch_before_running_argon2(
    client: TestClient,
    kdf_spy: KdfSpy,
    signed_headers: Callable[[str, str, bytes], dict[str, str]],
) -> None:
    signed_body = b'{"password":"temporary-password-123"}'
    actual_body = b'{"password":"different-password-123"}'
    headers = signed_headers("POST", "/internal/v1/password/hash", signed_body)
    response = client.post("/internal/v1/password/hash", content=actual_body, headers=headers)
    assert response.status_code == 401
    assert kdf_spy.hash_calls == 0


def test_rejects_body_above_four_kibibytes_before_running_argon2(
    client: TestClient,
    kdf_spy: KdfSpy,
    signed_headers: Callable[[str, str, bytes], dict[str, str]],
) -> None:
    body = b"{" + (b" " * 4_096) + b"}"
    headers = signed_headers("POST", "/internal/v1/password/hash", body)
    response = client.post("/internal/v1/password/hash", content=body, headers=headers)
    assert response.status_code == 413
    assert kdf_spy.hash_calls == 0


def test_stops_reading_chunked_body_as_soon_as_four_kibibytes_are_exceeded() -> None:
    chunks = [
        {"type": "http.request", "body": b"a" * 3_000, "more_body": True},
        {"type": "http.request", "body": b"b" * 2_000, "more_body": True},
        {"type": "http.request", "body": b"c" * 3_000, "more_body": False},
    ]
    receive_calls = 0

    async def receive() -> dict[str, object]:
        nonlocal receive_calls
        message = chunks[receive_calls]
        receive_calls += 1
        return message

    request = Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "POST",
            "scheme": "https",
            "path": "/internal/v1/password/hash",
            "raw_path": b"/internal/v1/password/hash",
            "query_string": b"",
            "headers": [(b"x-er-kdf-key-id", b"v1")],
            "client": ("127.0.0.1", 1),
            "server": ("testserver", 443),
        },
        receive,
    )
    with pytest.raises(HTTPException) as raised:
        asyncio.run(require_worker_signature(request, "test-shared-secret"))
    assert raised.value.status_code == 413
    assert receive_calls == 2
