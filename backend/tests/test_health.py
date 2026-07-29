"""Foundation smoke tests.

These assert that the application assembles and serves its documented
contract -- not that any quantum feature works, since none exist yet.
"""

from fastapi.testclient import TestClient

from quantum_workbench import __version__


def test_health_reports_ok(client: TestClient) -> None:
    response = client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": __version__}


def test_health_is_versioned_under_the_api_prefix(client: TestClient) -> None:
    """The version prefix is part of the contract, not an implementation detail."""
    assert client.get("/health").status_code == 404


def test_openapi_schema_is_served(client: TestClient) -> None:
    response = client.get("/api/v1/openapi.json")

    assert response.status_code == 200
    assert "/api/v1/health" in response.json()["paths"]
