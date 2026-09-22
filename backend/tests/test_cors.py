"""Exercise browser preflight and response headers across the HTTP boundary."""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from phasor_workbench.config import Settings
from phasor_workbench.main import create_app

PRODUCTION_ORIGIN = "https://phasor.zacharyparks.site"


@pytest.fixture(autouse=True)
def ignore_local_env_file(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(Settings.model_config, "env_file", None)


@pytest.fixture
def cors_client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("QW_CORS_ORIGINS", f'["{PRODUCTION_ORIGIN}"]')
    monkeypatch.setattr("phasor_workbench.main.settings", Settings())
    with TestClient(create_app()) as client:
        yield client


def test_production_origin_receives_cors_headers(cors_client: TestClient) -> None:
    response = cors_client.get("/api/v1/health", headers={"Origin": PRODUCTION_ORIGIN})

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == PRODUCTION_ORIGIN
    assert "access-control-allow-credentials" not in response.headers


def test_json_post_preflight_is_allowed(cors_client: TestClient) -> None:
    response = cors_client.options(
        "/api/v1/simulations/sample",
        headers={
            "Origin": PRODUCTION_ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == PRODUCTION_ORIGIN
    assert "POST" in response.headers["access-control-allow-methods"]
    assert "content-type" in response.headers["access-control-allow-headers"].lower()


@pytest.mark.parametrize(
    "origin", ["https://unlisted.example", "http://localhost:5173"]
)
def test_production_allowlist_rejects_other_origins(
    cors_client: TestClient, origin: str
) -> None:
    response = cors_client.options(
        "/api/v1/simulations/sample",
        headers={"Origin": origin, "Access-Control-Request-Method": "POST"},
    )

    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers

    response = cors_client.get("/api/v1/health", headers={"Origin": origin})
    assert "access-control-allow-origin" not in response.headers


def test_local_development_origin_is_allowed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("QW_CORS_ORIGINS", raising=False)
    monkeypatch.setattr("phasor_workbench.main.settings", Settings())
    with TestClient(create_app()) as client:
        response = client.get(
            "/api/v1/health", headers={"Origin": "http://localhost:5173"}
        )

    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
