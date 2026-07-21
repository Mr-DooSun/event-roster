from __future__ import annotations

import pytest

from password_service.kdf import PasswordKdf
from password_service.make_dummy import main as make_dummy


def test_argon2id_uses_nfc_and_only_verifies_the_original_password(kdf: PasswordKdf) -> None:
    phc = kdf.hash("cafe\u0301-password-123")
    assert phc.startswith("$argon2id$")
    assert kdf.verify("café-password-123", phc) is True
    assert kdf.verify("different-password-123", phc) is False


def test_invalid_phc_returns_false_without_exposing_input(kdf: PasswordKdf) -> None:
    assert kdf.verify("temporary-password-123", "not-a-valid-phc") is False


def test_make_dummy_writes_only_one_argon2id_phc(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setenv("PASSWORD_PEPPER", "non-production-test-pepper")
    make_dummy()
    captured = capsys.readouterr()
    assert captured.err == ""
    assert len(captured.out.splitlines()) == 1
    assert not captured.out.endswith("\n")
    assert captured.out.startswith("$argon2id$")
    assert "event-roster-dummy-account-v1" not in captured.out
    assert PasswordKdf("non-production-test-pepper").verify(
        "event-roster-dummy-account-v1", captured.out
    )
