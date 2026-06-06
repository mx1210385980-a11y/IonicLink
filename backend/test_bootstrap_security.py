import pytest
from pathlib import Path

from security import DEFAULT_ADMIN_PASSWORD, validate_bootstrap_admin_password


def test_bootstrap_admin_password_requires_explicit_environment_value() -> None:
    with pytest.raises(RuntimeError, match="IONICLINK_ADMIN_PASSWORD"):
        validate_bootstrap_admin_password(None)


def test_bootstrap_admin_password_rejects_documented_example() -> None:
    with pytest.raises(RuntimeError, match="IONICLINK_ADMIN_PASSWORD"):
        validate_bootstrap_admin_password("ChangeMe123!")


def test_bootstrap_admin_password_accepts_custom_value() -> None:
    validate_bootstrap_admin_password("custom-admin-password-2026")


def test_bootstrap_admin_password_has_no_example_runtime_default() -> None:
    assert DEFAULT_ADMIN_PASSWORD != "ChangeMe123!"


def test_bootstrap_rotates_existing_example_admin_password() -> None:
    source = Path("backend/database.py").read_text(encoding="utf-8")

    assert "verify_password(EXAMPLE_ADMIN_PASSWORD, admin.password_hash)" in source
    assert "admin.password_hash = hash_password(DEFAULT_ADMIN_PASSWORD)" in source
