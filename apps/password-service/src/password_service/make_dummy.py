from __future__ import annotations

import os
import sys

from password_service.kdf import DUMMY_PASSWORD_INPUT, PasswordKdf


def main() -> None:
    pepper = os.environ.get("PASSWORD_PEPPER")
    if pepper is None or not pepper.strip():
        raise RuntimeError("required environment variable is empty: PASSWORD_PEPPER")
    sys.stdout.write(PasswordKdf(pepper).hash(DUMMY_PASSWORD_INPUT))


if __name__ == "__main__":
    main()
