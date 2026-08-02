"""The analysis endpoint: the first route to take a circuit document.

These test the *transport* -- the wire shape, the status codes, and the error
envelope. What the numbers mean is `test_analysis.py`'s job, and duplicating it
here would give two places to update when a count changes.

The load-then-validate order is asserted rather than assumed, because the two
rejections look identical from outside (both 422, both CIRCUIT_INVALID) and
only the codes in `details` say which stage refused.
"""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

ANALYZE = "/api/v1/circuits/analyze"


def document(**overrides: Any) -> dict[str, Any]:
    return {
        "schemaVersion": "0.1.0",
        "id": "circ_test",
        "qubits": [{"id": "q_0", "index": 0}, {"id": "q_1", "index": 1}],
        "classicalRegisters": [{"id": "c_0", "size": 2}],
        "operations": [],
        **overrides,
    }


BELL = document(
    operations=[
        {"id": "op_0", "kind": "gate", "name": "h", "targets": ["q_0"]},
        {
            "id": "op_1",
            "kind": "gate",
            "name": "cx",
            "targets": ["q_1"],
            "controls": ["q_0"],
        },
        {
            "id": "op_2",
            "kind": "measurement",
            "targets": ["q_0"],
            "classicalTarget": {"register": "c_0", "bit": 0},
        },
        {
            "id": "op_3",
            "kind": "measurement",
            "targets": ["q_1"],
            "classicalTarget": {"register": "c_0", "bit": 1},
        },
    ]
)


def codes(response: Any) -> list[str]:
    return [detail["code"] for detail in response.json()["error"]["details"]]


class TestAnalyze:
    def test_returns_the_documented_body(self, client: TestClient) -> None:
        """Exactly docs/API.md's example, camelCase and all."""
        response = client.post(ANALYZE, json={"circuit": BELL})

        assert response.status_code == 200
        assert response.json() == {
            "qubitCount": 2,
            "gateCount": 2,
            "measurementCount": 2,
            "depth": 3,
            "gateBreakdown": {"h": 1, "cx": 1},
        }

    def test_analyzes_an_empty_circuit(self, client: TestClient) -> None:
        response = client.post(ANALYZE, json={"circuit": document()})

        assert response.status_code == 200
        assert response.json()["depth"] == 0
        assert response.json()["gateBreakdown"] == {}


class TestRejection:
    def test_reports_a_semantic_violation_with_its_code(
        self, client: TestClient
    ) -> None:
        """The code crosses the wire unchanged.

        It comes from the shared spec, and the frontend already renders these
        in the problems strip -- rephrasing them at the boundary would be a
        second vocabulary to keep in step with the first.
        """
        broken = document(
            operations=[
                {"id": "op_0", "kind": "gate", "name": "h", "targets": ["q_missing"]}
            ]
        )

        response = client.post(ANALYZE, json={"circuit": broken})

        assert response.status_code == 422
        assert response.json()["error"]["code"] == "CIRCUIT_INVALID"
        assert "UNKNOWN_QUBIT_REFERENCE" in codes(response)

    def test_reports_every_violation_rather_than_the_first(
        self, client: TestClient
    ) -> None:
        """Fixing a circuit should not take one round trip per defect."""
        broken = document(
            operations=[
                {"id": "op_0", "kind": "gate", "name": "h", "targets": ["q_missing"]},
                {"id": "op_1", "kind": "gate", "name": "x", "targets": ["q_absent"]},
            ]
        )

        response = client.post(ANALYZE, json={"circuit": broken})

        assert codes(response).count("UNKNOWN_QUBIT_REFERENCE") == 2

    def test_refuses_a_shape_invalid_document_at_the_loader(
        self, client: TestClient
    ) -> None:
        """Load first, validate second, and the codes say which stage refused."""
        response = client.post(ANALYZE, json={"circuit": {"schemaVersion": "0.1.0"}})

        assert response.status_code == 422
        assert "SHAPE_INVALID" in codes(response)

    def test_refuses_an_unsupported_schema_version(self, client: TestClient) -> None:
        """The version decision happens because the loader is in the path.

        Binding the body straight to `Circuit` would skip it, and a document
        from a future major would be read as though this build understood it.
        """
        response = client.post(
            ANALYZE, json={"circuit": document(schemaVersion="99.0.0")}
        )

        assert response.status_code == 422
        assert "SCHEMA_VERSION_UNSUPPORTED" in codes(response)

    def test_refuses_a_body_without_a_circuit(self, client: TestClient) -> None:
        response = client.post(ANALYZE, json={})

        assert response.status_code == 422
