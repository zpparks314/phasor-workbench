"""Deployment configuration uses the same settings as local development."""

import pytest
from pydantic_settings import SettingsError

from phasor_workbench.config import Settings


@pytest.fixture(autouse=True)
def ignore_local_env_file(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(Settings.model_config, "env_file", None)


def test_cors_defaults_to_local_development(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("QW_CORS_ORIGINS", raising=False)

    assert Settings().cors_origins == ["http://localhost:5173"]


def test_cors_origins_are_read_from_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(
        "QW_CORS_ORIGINS",
        '["https://phasor.zacharyparks.site","http://localhost:5173"]',
    )

    assert Settings().cors_origins == [
        "https://phasor.zacharyparks.site",
        "http://localhost:5173",
    ]


def test_invalid_cors_json_fails_configuration(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("QW_CORS_ORIGINS", "https://phasor.zacharyparks.site")

    with pytest.raises(SettingsError, match="cors_origins"):
        Settings()
