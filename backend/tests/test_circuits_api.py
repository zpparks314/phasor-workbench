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


IMPORT_QASM = "/api/v1/circuits/import/qasm"

QASM_BELL = """OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
h q[0];
cx q[0],q[1];
measure q -> c;
"""


class TestQasmImport:
    """The import endpoint's transport.

    What the parser understands is `test_qasm.py`'s job. What matters here is
    that the two kinds of failure stay distinguishable from outside, because a
    client has to tell "your file is broken" from "your circuit is".
    """

    def test_returns_a_circuit_the_other_endpoints_accept(
        self, client: TestClient
    ) -> None:
        response = client.post(IMPORT_QASM, json={"source": QASM_BELL})
        assert response.status_code == 200

        # The real assertion: what came back is a circuit document, so it can
        # go straight into another endpoint without a translation step.
        imported = response.json()["circuit"]
        analysis = client.post(ANALYZE, json={"circuit": imported})

        assert analysis.status_code == 200
        assert analysis.json()["qubitCount"] == 2
        assert analysis.json()["gateCount"] == 2

    def test_source_that_cannot_be_read_is_malformed_not_invalid(
        self, client: TestClient
    ) -> None:
        response = client.post(IMPORT_QASM, json={"source": "qreg q[1];"})

        assert response.status_code == 400
        assert response.json()["error"]["code"] == "REQUEST_MALFORMED"

    def test_a_readable_file_describing_an_illegal_circuit_is_invalid(
        self, client: TestClient
    ) -> None:
        # Parses perfectly; the circuit is what is wrong. Different code,
        # different status, and the model's own violation in the details.
        source = (
            'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[1];\ncreg c[1];\n'
            "measure q[0] -> c[0];\nh q[0];\n"
        )
        response = client.post(IMPORT_QASM, json={"source": source})

        assert response.status_code == 422
        assert response.json()["error"]["code"] == "CIRCUIT_INVALID"
        assert [detail["code"] for detail in response.json()["error"]["details"]] == [
            "OPERATION_AFTER_MEASUREMENT"
        ]

    def test_details_carry_a_line_and_column(self, client: TestClient) -> None:
        source = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[1];\nu3(0,0,0) q[0];\n'
        response = client.post(IMPORT_QASM, json={"source": source})
        detail = response.json()["error"]["details"][0]

        assert detail["code"] == "UNKNOWN_GATE_NAME"
        assert detail["path"] == "line 4, column 1"

    def test_reports_every_problem_at_once(self, client: TestClient) -> None:
        source = (
            'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[1];\n'
            "u3(0,0,0) q[0];\nh z[0];\n"
        )
        response = client.post(IMPORT_QASM, json={"source": source})

        assert len(response.json()["error"]["details"]) == 2

    def test_refuses_source_past_the_limit(self, client: TestClient) -> None:
        from phasor_workbench.config import settings

        oversized = "/" * (settings.max_qasm_characters + 1)
        response = client.post(IMPORT_QASM, json={"source": oversized})

        assert response.status_code == 413
        assert response.json()["error"]["code"] == "LIMIT_EXCEEDED"

    def test_rejects_an_unknown_field(self, client: TestClient) -> None:
        response = client.post(
            IMPORT_QASM, json={"source": QASM_BELL, "dialect": "qasm3"}
        )

        assert response.status_code == 422


EXPORT_QASM = "/api/v1/circuits/export/qasm"


class TestQasmExport:
    """The export endpoint's transport.

    What the writer produces is `test_qasm_export.py`'s job, including the
    round trip. What matters here is that an invalid document never reaches it.
    """

    def test_returns_source_the_import_endpoint_accepts(
        self, client: TestClient
    ) -> None:
        """The two endpoints are each other's inverse, asserted across the wire."""
        imported = client.post(IMPORT_QASM, json={"source": QASM_BELL})
        circuit = imported.json()["circuit"]

        exported = client.post(EXPORT_QASM, json={"circuit": circuit})
        assert exported.status_code == 200

        source = exported.json()["source"]
        assert source.startswith("OPENQASM 2.0;")

        again = client.post(IMPORT_QASM, json={"source": source})
        assert again.status_code == 200
        assert again.json()["circuit"]["operations"] == circuit["operations"]

    def test_refuses_an_invalid_circuit(self, client: TestClient) -> None:
        """A document the model rejects has no OpenQASM form worth writing."""
        response = client.post(
            EXPORT_QASM,
            json={
                "circuit": {
                    "schemaVersion": "0.1.0",
                    "id": "circ_1",
                    "qubits": [{"id": "q_0", "index": 0}],
                    "classicalRegisters": [],
                    "operations": [
                        {
                            "id": "op_0",
                            "kind": "gate",
                            "name": "h",
                            "targets": ["q_missing"],
                        }
                    ],
                }
            },
        )

        assert response.status_code == 422
        assert "UNKNOWN_QUBIT_REFERENCE" in codes(response)

    def test_refuses_an_unsupported_schema_version(self, client: TestClient) -> None:
        response = client.post(
            EXPORT_QASM,
            json={
                "circuit": {
                    "schemaVersion": "99.0.0",
                    "id": "circ_1",
                    "qubits": [],
                    "classicalRegisters": [],
                    "operations": [],
                }
            },
        )

        assert response.status_code == 422
        assert "SCHEMA_VERSION_UNSUPPORTED" in codes(response)

    def test_rejects_an_unknown_field(self, client: TestClient) -> None:
        response = client.post(EXPORT_QASM, json={"circuit": {}, "dialect": "qasm3"})

        assert response.status_code == 422
