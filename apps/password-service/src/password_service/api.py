from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Protocol, cast

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from password_service.config import Settings
from password_service.kdf import is_policy_argon2id_phc
from password_service.signature import require_worker_signature

router = APIRouter()


class Kdf(Protocol):
    def hash(self, password: str) -> str: ...

    def verify(self, password: str, phc: str) -> bool: ...


class InvalidPayloadError(Exception):
    pass


@dataclass(frozen=True, slots=True)
class PasswordPayload:
    password: str


@dataclass(frozen=True, slots=True)
class VerifyPayload:
    password: str
    phc: str | None


class HashResponse(BaseModel):
    kdfVersion: int
    phc: str


class VerifyResponse(BaseModel):
    verified: bool


def get_settings(request: Request) -> Settings:
    return cast(Settings, request.app.state.settings)


def get_kdf(request: Request) -> Kdf:
    return cast(Kdf, request.app.state.kdf)


def _decode_mapping(raw: bytes, allowed_keys: set[str]) -> dict[str, object]:
    try:
        decoded = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise InvalidPayloadError from error
    if not isinstance(decoded, dict) or not set(decoded).issubset(allowed_keys):
        raise InvalidPayloadError
    return cast(dict[str, object], decoded)


def _validated_password(value: object) -> str:
    if not isinstance(value, str) or not 12 <= len(value) <= 128:
        raise InvalidPayloadError
    return value


def decode_password_payload(raw: bytes) -> PasswordPayload:
    decoded = _decode_mapping(raw, {"password"})
    return PasswordPayload(password=_validated_password(decoded.get("password")))


def decode_verify_payload(raw: bytes) -> VerifyPayload:
    decoded = _decode_mapping(raw, {"password", "phc"})
    phc = decoded.get("phc")
    return VerifyPayload(
        password=_validated_password(decoded.get("password")),
        phc=phc if isinstance(phc, str) else None,
    )


@router.post("/internal/v1/password/hash", response_model=HashResponse)
async def hash_password(
    request: Request,
    settings: Settings = Depends(get_settings),
    kdf: Kdf = Depends(get_kdf),
) -> HashResponse:
    raw = await require_worker_signature(request, settings.auth_kdf_shared_secret)
    payload = decode_password_payload(raw)
    return HashResponse(kdfVersion=1, phc=kdf.hash(payload.password))


@router.post("/internal/v1/password/verify", response_model=VerifyResponse)
async def verify_password(
    request: Request,
    settings: Settings = Depends(get_settings),
    kdf: Kdf = Depends(get_kdf),
) -> VerifyResponse:
    raw = await require_worker_signature(request, settings.auth_kdf_shared_secret)
    payload = decode_verify_payload(raw)
    has_valid_phc = is_policy_argon2id_phc(payload.phc)
    selected_phc = payload.phc if has_valid_phc else settings.dummy_argon2_phc
    verified = kdf.verify(payload.password, selected_phc)
    return VerifyResponse(verified=has_valid_phc and verified)
