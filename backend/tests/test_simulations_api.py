"""The statevector endpoint: the wire shape, the limits, and the error mapping.

What the numbers *mean* is `test_simulation.py`'s job. This is the formatter --
basis strings, the sparse probability list, and turning typed simulator errors
into the one envelope API.md defines.

The bit-ordering assertion is repeated here rather than left to the adapter
tests, because the basis strings are built in the formatter and a reversal
introduced there would not be caught by any test of the simulator.
"""

from __future__ import annotations

import math
from typing import Any

import pytest
from fastapi.testclient import TestClient

from phasor_workbench.api.routes.simulations import MAX_STATEVECTOR_QUBITS
from phasor_workbench.simulation import available_backends

STATEVECTOR = "/api/v1/simulations/statevector"

pytestmark = pytest.mark.skipif(
    "qiskit" not in available_backends(),
    reason="the simulation extra is not installed",
)


def document(qubits: int = 2, registers: int = 1, **overrides: Any) -> dict[str, Any]:
    return {
        "schemaVersion": "0.1.0",
        "id": "circ_test",
        "qubits": [{"id": f"q_{i}", "index": i} for i in range(qubits)],
        "classicalRegisters": [
            {"id": f"c_{i}", "size": max(qubits, 1)} for i in range(registers)
        ],
        "operations": [],
        **overrides,
    }


def gate(op_id: str, name: str, targets: list[str], **extra: Any) -> dict[str, Any]:
    return {"id": op_id, "kind": "gate", "name": name, "targets": targets, **extra}


BELL_OPERATIONS = [
    gate("op_0", "h", ["q_0"]),
    gate("op_1", "cx", ["q_1"], controls=["q_0"]),
]


class TestResponseShape:
    def test_returns_the_documented_body(self, client: TestClient) -> None:
        """API.md's example, shape for shape."""
        response = client.post(
            STATEVECTOR, json={"circuit": document(operations=BELL_OPERATIONS)}
        )

        assert response.status_code == 200
        body = response.json()
        root_half = 1 / math.sqrt(2)

        assert body["qubitCount"] == 2
        assert [a["basisState"] for a in body["amplitudes"]] == [
            "00",
            "01",
            "10",
            "11",
        ]
        assert body["amplitudes"][0]["real"] == pytest.approx(root_half)
        assert body["amplitudes"][0]["imaginary"] == 0.0
        assert body["amplitudes"][3]["real"] == pytest.approx(root_half)

    def test_lists_only_probabilities_worth_reporting(self, client: TestClient) -> None:
        """Sparse, deliberately.

        Amplitudes are the state and come back in full; probabilities are a
        summary, and a summary listing values indistinguishable from zero
        summarises nothing. A floating-point simulation returns 1e-17 rather
        than 0.0 for a state that is mathematically empty.
        """
        body = client.post(
            STATEVECTOR, json={"circuit": document(operations=BELL_OPERATIONS)}
        ).json()

        assert [p["basisState"] for p in body["probabilities"]] == ["00", "11"]
        assert body["probabilities"][0]["probability"] == pytest.approx(0.5)

    def test_omits_probabilities_when_not_asked_for(self, client: TestClient) -> None:
        body = client.post(
            STATEVECTOR,
            json={
                "circuit": document(operations=BELL_OPERATIONS),
                "options": {"includeProbabilities": False},
            },
        ).json()

        assert "probabilities" not in body

    def test_defaults_to_including_them(self, client: TestClient) -> None:
        body = client.post(
            STATEVECTOR, json={"circuit": document(operations=BELL_OPERATIONS)}
        ).json()

        assert "probabilities" in body

    def test_rejects_an_unknown_option(self, client: TestClient) -> None:
        """`extra="forbid"`: a misspelled option is a mistake, not a no-op."""
        response = client.post(
            STATEVECTOR,
            json={
                "circuit": document(operations=BELL_OPERATIONS),
                "options": {"includeProbabilties": True},
            },
        )

        assert response.status_code == 422


class TestBitOrdering:
    """docs/Simulation.md: qubit 0 is the rightmost bit.

    Asserted here as well as in the adapter tests, because the basis strings
    are built by the formatter -- a reversal introduced there would pass every
    test of the simulator.
    """

    def test_x_on_qubit_zero_is_the_rightmost_bit(self, client: TestClient) -> None:
        body = client.post(
            STATEVECTOR,
            json={"circuit": document(3, operations=[gate("op_0", "x", ["q_0"])])},
        ).json()

        assert body["probabilities"] == [{"basisState": "001", "probability": 1.0}]

    def test_x_on_the_last_qubit_is_the_leftmost_bit(self, client: TestClient) -> None:
        body = client.post(
            STATEVECTOR,
            json={"circuit": document(3, operations=[gate("op_0", "x", ["q_2"])])},
        ).json()

        assert body["probabilities"] == [{"basisState": "100", "probability": 1.0}]


class TestMeasurements:
    """Ignored, returning the state a measurement samples *from*.

    API.md said these circuits were rejected "unless mid-circuit measurement
    support is settled" -- and it is settled: deferred, so every measurement is
    terminal and the state with them omitted is exactly the state just before
    the first. Rejecting would make the editor's ordinary output unusable here.
    """

    def test_accepts_a_circuit_containing_measurements(
        self, client: TestClient
    ) -> None:
        measured = document(
            operations=[
                *BELL_OPERATIONS,
                {
                    "id": "op_2",
                    "kind": "measurement",
                    "targets": ["q_0"],
                    "classicalTarget": {"register": "c_0", "bit": 0},
                },
            ]
        )

        response = client.post(STATEVECTOR, json={"circuit": measured})

        assert response.status_code == 200

    def test_gives_the_same_state_as_the_circuit_without_them(
        self, client: TestClient
    ) -> None:
        measured = document(
            operations=[
                *BELL_OPERATIONS,
                {
                    "id": "op_2",
                    "kind": "measurement",
                    "targets": ["q_0"],
                    "classicalTarget": {"register": "c_0", "bit": 0},
                },
            ]
        )
        plain = document(operations=BELL_OPERATIONS)

        assert (
            client.post(STATEVECTOR, json={"circuit": measured}).json()
            == client.post(STATEVECTOR, json={"circuit": plain}).json()
        )


class TestLimits:
    def test_refuses_a_circuit_past_the_response_limit(
        self, client: TestClient
    ) -> None:
        response = client.post(
            STATEVECTOR,
            json={"circuit": document(MAX_STATEVECTOR_QUBITS + 1, registers=0)},
        )

        assert response.status_code == 413
        assert response.json()["error"]["code"] == "LIMIT_EXCEEDED"

    def test_says_which_limit_was_hit(self, client: TestClient) -> None:
        """The endpoint's cap is response size; the adapter's is simulation
        cost. They differ, so the message has to say which one refused."""
        message = (
            client.post(
                STATEVECTOR,
                json={"circuit": document(MAX_STATEVECTOR_QUBITS + 1, registers=0)},
            )
            .json()["error"]["message"]
            .lower()
        )

        assert "response-size limit" in message

    def test_allows_a_circuit_at_the_limit(self, client: TestClient) -> None:
        response = client.post(
            STATEVECTOR, json={"circuit": document(MAX_STATEVECTOR_QUBITS, registers=0)}
        )

        assert response.status_code == 200
        assert len(response.json()["amplitudes"]) == 2**MAX_STATEVECTOR_QUBITS


class TestRejection:
    def test_reports_an_invalid_circuit_with_its_violation_codes(
        self, client: TestClient
    ) -> None:
        broken = document(operations=[gate("op_0", "h", ["q_missing"])])

        response = client.post(STATEVECTOR, json={"circuit": broken})

        assert response.status_code == 422
        assert response.json()["error"]["code"] == "CIRCUIT_INVALID"
        assert [d["code"] for d in response.json()["error"]["details"]] == [
            "UNKNOWN_QUBIT_REFERENCE"
        ]

    def test_refuses_a_body_without_a_circuit(self, client: TestClient) -> None:
        assert client.post(STATEVECTOR, json={}).status_code == 422

    def test_answers_a_circuit_with_no_qubits(self, client: TestClient) -> None:
        """One amplitude for the empty state space, with an empty basis string
        -- there are no bits to name."""
        body = client.post(
            STATEVECTOR, json={"circuit": document(0, registers=0)}
        ).json()

        assert body["qubitCount"] == 0
        assert body["amplitudes"] == [{"basisState": "", "real": 1.0, "imaginary": 0.0}]
