from __future__ import annotations

import base64
import hashlib
import hmac
import unicodedata

from argon2 import PasswordHasher, Type, extract_parameters
from argon2.exceptions import InvalidHashError, VerificationError
from argon2.low_level import ARGON2_VERSION

TIME_COST = 2
MEMORY_COST = 19_456
PARALLELISM = 1
HASH_LENGTH = 32
SALT_LENGTH = 16
DUMMY_PASSWORD_INPUT = "event-roster-dummy-account-v1"


class PasswordKdf:
    def __init__(self, pepper: str) -> None:
        self._pepper = pepper.encode("utf-8")
        self._hasher = PasswordHasher(
            time_cost=TIME_COST,
            memory_cost=MEMORY_COST,
            parallelism=PARALLELISM,
            hash_len=HASH_LENGTH,
            salt_len=SALT_LENGTH,
            type=Type.ID,
        )

    def _prepared(self, password: str) -> str:
        normalized = unicodedata.normalize("NFC", password).encode("utf-8")
        digest = hmac.new(self._pepper, normalized, hashlib.sha256).digest()
        return base64.urlsafe_b64encode(digest).decode("ascii")

    def hash(self, password: str) -> str:
        return self._hasher.hash(self._prepared(password))

    def verify(self, password: str, phc: str) -> bool:
        try:
            return self._hasher.verify(phc, self._prepared(password))
        except (InvalidHashError, VerificationError):
            return False


def is_policy_argon2id_phc(phc: str | None) -> bool:
    if not phc:
        return False
    try:
        parameters = extract_parameters(phc)
    except InvalidHashError:
        return False
    return (
        parameters.type is Type.ID
        and parameters.version == ARGON2_VERSION
        and parameters.time_cost == TIME_COST
        and parameters.memory_cost == MEMORY_COST
        and parameters.parallelism == PARALLELISM
        and parameters.hash_len == HASH_LENGTH
        and parameters.salt_len == SALT_LENGTH
    )
