from __future__ import annotations

import base64
import hashlib
import hmac
import time
from collections.abc import Callable, Iterator

import pytest
from fastapi.testclient import TestClient

from password_service.config import Settings
from password_service.kdf import PasswordKdf
from password_service.main import create_app


class KdfSpy:
    def __init__(self, dummy_phc: str) -> None:
        self.hash_calls = 0
        self.verify_calls = 0
        self.dummy_verify_calls = 0
        self.verify_result = False
        self._dummy_phc = dummy_phc
        self._hash_result = PasswordKdf("test-pepper").hash("test-hash-result-input")

    def hash(self, password: str) -> str:
        del password
        self.hash_calls += 1
        return self._hash_result

    def verify(self, password: str, phc: str) -> bool:
        del password
        self.verify_calls += 1
        if hmac.compare_digest(phc, self._dummy_phc):
            self.dummy_verify_calls += 1
        return self.verify_result


@pytest.fixture
def settings() -> Settings:
    dummy_phc = PasswordKdf("test-pepper").hash("event-roster-dummy-account-v1")
    return Settings(
        password_pepper="test-pepper",
        auth_kdf_shared_secret="test-shared-secret",
        dummy_argon2_phc=dummy_phc,
    )


@pytest.fixture
def kdf_spy(settings: Settings) -> KdfSpy:
    return KdfSpy(settings.dummy_argon2_phc)


@pytest.fixture
def client(settings: Settings, kdf_spy: KdfSpy) -> Iterator[TestClient]:
    with TestClient(create_app(settings=settings, kdf=kdf_spy)) as test_client:
        yield test_client


@pytest.fixture
def kdf() -> PasswordKdf:
    return PasswordKdf("test-pepper")


@pytest.fixture
def signed_headers(settings: Settings) -> Callable[[str, str, bytes], dict[str, str]]:
    def build(method: str, path: str, body: bytes) -> dict[str, str]:
        timestamp = str(int(time.time()))
        digest = base64.urlsafe_b64encode(hashlib.sha256(body).digest()).rstrip(b"=").decode()
        message = f"v1\n{timestamp}\n{method}\n{path}\n{digest}".encode()
        signature = base64.urlsafe_b64encode(
            hmac.new(
                settings.auth_kdf_shared_secret.encode(),
                message,
                hashlib.sha256,
            ).digest()
        ).rstrip(b"=").decode()
        return {
            "content-type": "application/json",
            "x-er-kdf-key-id": "v1",
            "x-er-kdf-timestamp": timestamp,
            "x-er-kdf-body-sha256": digest,
            "x-er-kdf-signature": signature,
        }

    return build
