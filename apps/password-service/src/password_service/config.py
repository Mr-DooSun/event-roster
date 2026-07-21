from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Settings:
    password_pepper: str
    auth_kdf_shared_secret: str
    dummy_argon2_phc: str

    @classmethod
    def from_environment(cls) -> Settings:
        values: dict[str, str] = {}
        for name in ("PASSWORD_PEPPER", "AUTH_KDF_SHARED_SECRET", "DUMMY_ARGON2_PHC"):
            value = os.environ.get(name)
            if value is None or not value.strip():
                raise RuntimeError(f"required environment variable is empty: {name}")
            values[name] = value
        return cls(
            password_pepper=values["PASSWORD_PEPPER"],
            auth_kdf_shared_secret=values["AUTH_KDF_SHARED_SECRET"],
            dummy_argon2_phc=values["DUMMY_ARGON2_PHC"],
        )
