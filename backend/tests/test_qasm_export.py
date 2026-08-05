"""OpenQASM export, and the round trip through the importer.

Milestone 5's exit criterion is that every circuit in `shared/fixtures/valid/`
exports to OpenQASM and re-imports with the same operation sequence and the same
`derive_cycles` output. That is asserted here.

**Equality is structural, and it has to be.** Import names the qubits it creates
after the register it read them from, so `q_0` returns as `q_q_0`. ADR-0002 makes
identifiers arbitrary, so comparing documents would fail on a difference the
model says carries no meaning. Everything below compares qubits by *index* and
operations by *position*, which is what "the same circuit" means when the names
are not part of the circuit.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from phasor_workbench.api.documents import read_circuit
from phasor_workbench.cycles import derive_cycles
from phasor_workbench.exporters.qasm import export_qasm
from phasor_workbench.importers.qasm import parse_qasm
from phasor_workbench.models.circuit import (
    BarrierOperation,
    Circuit,
    GateOperation,
    MeasurementOperation,
)

FIXTURES = Path(__file__).resolve().parents[2] / "shared" / "fixtures" / "valid"

VALID_FIXTURES = sorted(FIXTURES.glob("*.json"))


def load(path: Path) -> Circuit:
    return read_circuit(json.loads(path.read_text(encoding="utf-8"))["circuit"])


def reimport(circuit: Circuit) -> Circuit:
    """Export, parse, and load -- the whole trip, asserting it stays readable."""
    result = parse_qasm(export_qasm(circuit))

    assert not result.problems, f"exported QASM did not re-import: {result.problems}"

    return read_circuit(result.document)


def canonical_operations(circuit: Circuit) -> list[tuple[Any, ...]]:
    """Operations with every identifier replaced by a position."""
    slots = {qubit.id: qubit.index for qubit in circuit.qubits}
    registers = {
        register.id: position
        for position, register in enumerate(circuit.classical_registers)
    }
    canonical: list[tuple[Any, ...]] = []

    for operation in circuit.operations:
        match operation:
            case GateOperation():
                canonical.append(
                    (
                        "gate",
                        operation.name.value,
                        tuple(slots[qubit_id] for qubit_id in operation.controls),
                        tuple(slots[qubit_id] for qubit_id in operation.targets),
                        tuple(sorted(operation.parameters.items())),
                    )
                )
            case MeasurementOperation():
                target = operation.classical_target
                canonical.append(
                    (
                        "measurement",
                        slots[operation.targets[0]],
                        registers[target.register_],
                        target.bit,
                    )
                )
            case BarrierOperation():
                canonical.append(
                    (
                        "barrier",
                        tuple(slots[qubit_id] for qubit_id in operation.targets),
                    )
                )

    return canonical


def canonical_cycles(circuit: Circuit) -> tuple[Any, ...]:
    """A decomposition with operation ids and qubit ids replaced by positions."""
    slots = {qubit.id: qubit.index for qubit in circuit.qubits}
    positions = {
        operation.id: position for position, operation in enumerate(circuit.operations)
    }
    decomposition = derive_cycles(circuit)

    cycles = tuple(
        tuple(positions[operation_id] for operation_id in cycle)
        for cycle in decomposition.cycles
    )
    barriers = tuple(
        (
            positions[barrier.operation_id],
            barrier.before_cycle,
            tuple(slots[qubit_id] for qubit_id in barrier.qubits),
        )
        for barrier in decomposition.barriers
    )

    return (cycles, barriers)


def test_valid_fixtures_are_present() -> None:
    """The round trip is parametrized over a glob, and a glob can return nothing.

    Without this the suite passes loudly while asserting against an empty set --
    the vacuity failure this project has already been bitten by once.
    """
    assert len(VALID_FIXTURES) >= 5


@pytest.mark.parametrize("path", VALID_FIXTURES, ids=lambda path: path.stem)
def test_round_trip_preserves_the_operation_sequence(path: Path) -> None:
    circuit = load(path)

    assert canonical_operations(reimport(circuit)) == canonical_operations(circuit)


@pytest.mark.parametrize("path", VALID_FIXTURES, ids=lambda path: path.stem)
def test_round_trip_preserves_the_cycle_decomposition(path: Path) -> None:
    circuit = load(path)

    assert canonical_cycles(reimport(circuit)) == canonical_cycles(circuit)


@pytest.mark.parametrize("path", VALID_FIXTURES, ids=lambda path: path.stem)
def test_export_is_deterministic(path: Path) -> None:
    """Same circuit, same bytes -- what makes the output diffable."""
    circuit = load(path)

    assert export_qasm(circuit) == export_qasm(circuit)


def circuit(**overrides: Any) -> Circuit:
    document: dict[str, Any] = {
        "schemaVersion": "0.1.0",
        "id": "circ_1",
        "qubits": [{"id": "q_0", "index": 0}, {"id": "q_1", "index": 1}],
        "classicalRegisters": [],
        "operations": [],
    }

    return read_circuit(document | overrides)


def test_declares_the_header_and_one_quantum_register() -> None:
    source = export_qasm(circuit())

    assert source.startswith('OPENQASM 2.0;\ninclude "qelib1.inc";\n')
    assert "qreg q[2];" in source


def test_a_circuit_with_no_qubits_declares_no_register() -> None:
    """`qreg q[0];` is not a legal declaration, so it must not be written."""
    source = export_qasm(circuit(qubits=[]))

    assert "qreg" not in source
    assert not parse_qasm(source).problems


def gate(name: str, targets: list[str], **rest: Any) -> dict[str, Any]:
    return {"id": "op_0", "kind": "gate", "name": name, "targets": targets, **rest}


@pytest.mark.parametrize(
    ("model_name", "qasm_name"),
    [("i", "id"), ("p", "u1"), ("h", "h"), ("sdg", "sdg")],
)
def test_gate_names_that_qelib_spells_differently(
    model_name: str, qasm_name: str
) -> None:
    parameters = {"lambda": 0.5} if model_name == "p" else {}
    source = export_qasm(
        circuit(operations=[gate(model_name, ["q_0"], parameters=parameters)])
    )

    assert f"\n{qasm_name}" in source


def test_controls_are_written_before_targets() -> None:
    source = export_qasm(circuit(operations=[gate("cx", ["q_1"], controls=["q_0"])]))

    assert "cx q[0],q[1];" in source


def test_an_angle_survives_at_full_precision() -> None:
    """A rounded angle is a different rotation, so `repr` is the format."""
    theta = 0.7853981633974483
    exported = export_qasm(
        circuit(operations=[gate("rx", ["q_0"], parameters={"theta": theta})])
    )
    operation = read_circuit(parse_qasm(exported).document).operations[0]

    assert isinstance(operation, GateOperation)
    assert operation.parameters["theta"] == theta


def test_a_classical_register_keeps_a_usable_label() -> None:
    source = export_qasm(
        circuit(classicalRegisters=[{"id": "c_0", "size": 2, "label": "result"}])
    )

    assert "creg result[2];" in source


@pytest.mark.parametrize("label", ["Result", "0bad", "has space", "", None])
def test_a_label_qasm_cannot_spell_falls_back_to_position(label: str | None) -> None:
    """An illegal name would produce a file this project's own importer rejects."""
    register: dict[str, Any] = {"id": "c_0", "size": 1}
    if label is not None:
        register["label"] = label

    source = export_qasm(circuit(classicalRegisters=[register]))

    assert "creg c0[1];" in source
    assert not parse_qasm(source).problems


def test_duplicate_labels_are_separated() -> None:
    source = export_qasm(
        circuit(
            classicalRegisters=[
                {"id": "c_0", "size": 1, "label": "bits"},
                {"id": "c_1", "size": 1, "label": "bits"},
            ]
        )
    )

    assert "creg bits[1];" in source
    assert "creg c1[1];" in source
    assert not parse_qasm(source).problems


def test_a_label_colliding_with_the_quantum_register_is_replaced() -> None:
    """`creg q[1];` beside `qreg q[2];` is a redeclaration, and refused on import."""
    source = export_qasm(
        circuit(classicalRegisters=[{"id": "c_0", "size": 1, "label": "q"}])
    )

    assert "creg q[" not in source
    assert not parse_qasm(source).problems
