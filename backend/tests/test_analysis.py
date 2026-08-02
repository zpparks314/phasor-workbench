"""Static analysis: the counts, and depth agreeing with the shared fixtures.

The depth test is the point of the whole exercise. `analyze_circuit` does not
compute depth -- it asks `derive_cycles`, the component both languages already
implement and both already agree on across every fixture. Asserting against each
fixture's *declared* depth here means analysis inherits that agreement rather
than opening a second, unverified opinion about what depth means.

A failing fixture is never repaired by editing the fixture. See tests/README.md.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from phasor_workbench.analysis import analyze_circuit
from phasor_workbench.models.circuit import Circuit, GateName

FIXTURES = Path(__file__).resolve().parents[2] / "shared" / "fixtures"
DECOMPOSITION = sorted((FIXTURES / "decomposition").glob("*.json"))


def load(path: Path) -> dict[str, Any]:
    fixture: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    return fixture


def circuit(**overrides: Any) -> Circuit:
    document: dict[str, Any] = {
        "schemaVersion": "0.1.0",
        "id": "circ_test",
        "qubits": [{"id": "q_0", "index": 0}, {"id": "q_1", "index": 1}],
        "classicalRegisters": [{"id": "c_0", "size": 2}],
        "operations": [],
        **overrides,
    }
    return Circuit.model_validate(document)


def gate(op_id: str, name: str, targets: list[str], **extra: Any) -> dict[str, Any]:
    return {"id": op_id, "kind": "gate", "name": name, "targets": targets, **extra}


class TestCounts:
    def test_counts_an_empty_circuit_as_zero_everywhere(self) -> None:
        analysis = analyze_circuit(circuit())

        assert analysis.qubit_count == 2
        assert analysis.gate_count == 0
        assert analysis.measurement_count == 0
        assert analysis.depth == 0
        assert analysis.gate_breakdown == {}

    def test_counts_gates_by_name(self) -> None:
        analysis = analyze_circuit(
            circuit(
                operations=[
                    gate("op_0", "h", ["q_0"]),
                    gate("op_1", "h", ["q_1"]),
                    gate("op_2", "cx", ["q_1"], controls=["q_0"]),
                ]
            )
        )

        assert analysis.gate_count == 3
        assert analysis.gate_breakdown == {GateName.h: 2, GateName.cx: 1}

    def test_omits_gates_that_do_not_appear(self) -> None:
        analysis = analyze_circuit(circuit(operations=[gate("op_0", "x", ["q_0"])]))

        assert analysis.gate_breakdown == {GateName.x: 1}

    def test_counts_measurements_separately_from_gates(self) -> None:
        analysis = analyze_circuit(
            circuit(
                operations=[
                    gate("op_0", "h", ["q_0"]),
                    {
                        "id": "op_1",
                        "kind": "measurement",
                        "targets": ["q_0"],
                        "classicalTarget": {"register": "c_0", "bit": 0},
                    },
                ]
            )
        )

        assert analysis.gate_count == 1
        assert analysis.measurement_count == 1

    def test_counts_a_barrier_as_neither(self) -> None:
        """A barrier is an authoring constraint, not something the circuit does.

        So the two counts deliberately do not sum to the operation count -- and
        this asserts that, because quietly counting barriers as gates would
        inflate every gate count in a circuit that uses them for scheduling.
        """
        analyzed = circuit(
            operations=[
                gate("op_0", "h", ["q_0"]),
                {"id": "op_1", "kind": "barrier", "targets": ["q_0", "q_1"]},
            ]
        )
        analysis = analyze_circuit(analyzed)

        assert analysis.gate_count == 1
        assert analysis.measurement_count == 0
        assert len(analyzed.operations) == 2


class TestDepth:
    @pytest.mark.parametrize("path", DECOMPOSITION, ids=lambda p: p.stem)
    def test_matches_the_depth_the_fixture_declares(self, path: Path) -> None:
        fixture = load(path)
        analysis = analyze_circuit(Circuit.model_validate(fixture["circuit"]))

        assert analysis.depth == fixture["decomposition"]["depth"]

    def test_a_barrier_can_raise_depth(self) -> None:
        """Levelling an unequal frontier costs a cycle, without occupying one.

        The counterexample to the earlier claim that annotating a circuit never
        changes its depth -- recorded in Roadmap.md and pinned by a fixture. It
        is here as well because it is the reason depth is asked of
        `derive_cycles` rather than counted from the operation list, which is a
        tempting and wrong simplification.
        """
        without = analyze_circuit(
            circuit(
                operations=[
                    gate("op_0", "h", ["q_0"]),
                    gate("op_1", "h", ["q_0"]),
                    gate("op_2", "x", ["q_1"]),
                ]
            )
        )
        with_barrier = analyze_circuit(
            circuit(
                operations=[
                    gate("op_0", "h", ["q_0"]),
                    gate("op_1", "h", ["q_0"]),
                    {"id": "op_b", "kind": "barrier", "targets": ["q_0", "q_1"]},
                    gate("op_2", "x", ["q_1"]),
                ]
            )
        )

        assert without.depth == 2
        assert with_barrier.depth == 3
