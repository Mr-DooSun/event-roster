from __future__ import annotations

import base64
import hashlib
import hmac
import time

from fastapi import HTTPException, Request

MAX_REQUEST_BODY_BYTES = 4_096


def _message(method: str, path: str, timestamp: str, body_digest: str) -> bytes:
    return f"v1\n{timestamp}\n{method}\n{path}\n{body_digest}".encode("utf-8")


def _base64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


async def _read_bounded_body(request: Request) -> bytes:
    chunks: list[bytes] = []
    total_length = 0
    async for chunk in request.stream():
        total_length += len(chunk)
        if total_length > MAX_REQUEST_BODY_BYTES:
            raise HTTPException(status_code=413, detail="payload_too_large")
        chunks.append(chunk)
    return b"".join(chunks)


async def require_worker_signature(request: Request, secret: str) -> bytes:
    if request.headers.get("x-er-kdf-key-id") != "v1":
        raise HTTPException(status_code=401, detail="unauthorized")

    claimed_length = request.headers.get("content-length")
    if claimed_length is not None:
        try:
            parsed_length = int(claimed_length)
        except ValueError as error:
            raise HTTPException(status_code=400, detail="invalid_request") from error
        if parsed_length < 0:
            raise HTTPException(status_code=400, detail="invalid_request")
        if parsed_length > MAX_REQUEST_BODY_BYTES:
            raise HTTPException(status_code=413, detail="payload_too_large")

    body = await _read_bounded_body(request)

    timestamp = request.headers.get("x-er-kdf-timestamp", "")
    claimed_digest = request.headers.get("x-er-kdf-body-sha256", "")
    supplied_signature = request.headers.get("x-er-kdf-signature", "")
    try:
        current_time = int(time.time())
        supplied_time = int(timestamp)
    except ValueError as error:
        raise HTTPException(status_code=401, detail="unauthorized") from error

    actual_digest = _base64url(hashlib.sha256(body).digest())
    expected_signature = _base64url(
        hmac.new(
            secret.encode("utf-8"),
            _message(request.method, request.url.path, timestamp, actual_digest),
            hashlib.sha256,
        ).digest()
    )
    if (
        abs(current_time - supplied_time) > 60
        or not hmac.compare_digest(claimed_digest, actual_digest)
        or not hmac.compare_digest(supplied_signature, expected_signature)
    ):
        raise HTTPException(status_code=401, detail="unauthorized")
    return body
