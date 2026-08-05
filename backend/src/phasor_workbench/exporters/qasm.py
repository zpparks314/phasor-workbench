"""Circuit Model to OpenQASM 2.0.

The inverse of `importers/qasm/`, and deliberately far smaller: the model's gate
names already follow OpenQASM convention, so this translates names in two cases
and otherwise writes what it is given. `exporters/__init__.py` predicted that
when the directory was reserved in Milestone 1.

**One `qreg`, always.** OpenQASM can declare several quantum registers; the
model has no notion of them, holding a flat indexed list instead. Import already
flattens `qreg q[2]; qreg r[3];` into five qubits and keeps no record of the
split, so writing one `qreg q[n]` here loses nothing that survived the trip in.
Qubit indices are contiguous from zero -- `validation/structure.py` enforces it
with `QUBIT_INDEX_GAP` -- so a qubit's `index` is its position in that register
and no renumbering is needed.

**Classical register names are kept when they can be, and replaced when they
cannot.** Import stores a `creg`'s name as the register's `label`, so writing the
label back is what closes the round trip. But a label is free text: it may be
absent, it may not be a legal QASM identifier, and two registers may share one.
Emitting it unchecked would produce a file this project's own importer rejects,
which is the one outcome an exporter must never have. Illegal or colliding names
fall back to `c0`, `c1`, ... by position, so the output is always readable and
always deterministic. The Circuit Model is unchanged either way -- ADR-0002
makes identifiers arbitrary, and a label is not an identifier.

**Angles are written with `repr`.** A float formatted to fixed precision is a
different angle, and `rx(pi/2)` exported as `1.5708` re-imports as a rotation
that is not the one the user built. `repr` is the shortest string that reads back
as the same double, and the importer's lexer accepts every form it produces,
including the exponent notation it uses for very small values.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from types import MappingProxyType
from typing import Final

from ..models.circuit import (
    BarrierOperation,
    Circuit,
    GateName,
    GateOperation,
    MeasurementOperation,
)
from ..models.spec import GATE_SIGNATURES

#: The model's spellings that `qelib1.inc` does not share, inverting
#: `importers.qasm.gates.ALIASES`. Everything else is written unchanged.
QASM_NAMES: Final[Mapping[GateName, str]] = MappingProxyType(
    {GateName("i"): "id", GateName("p"): "u1"}
)

#: The quantum register every exported circuit declares.
QUBIT_REGISTER: Final[str] = "q"

#: OpenQASM 2.0 identifiers start lowercase and continue alphanumeric.
_IDENTIFIER: Final[re.Pattern[str]] = re.compile(r"[a-z][A-Za-z0-9_]*\Z")


def export_qasm(circuit: Circuit) -> str:
    """Write a circuit as an OpenQASM 2.0 program.

    The circuit is assumed valid: it has come through `load_circuit`, so
    references resolve and indices are contiguous. Nothing here re-validates.
    """
    lines = ["OPENQASM 2.0;", 'include "qelib1.inc";']

    if circuit.qubits:
        lines.append(f"qreg {QUBIT_REGISTER}[{len(circuit.qubits)}];")

    register_names = classical_register_names(circuit)
    for register in circuit.classical_registers:
        lines.append(f"creg {register_names[register.id]}[{register.size}];")

    slots = {qubit.id: qubit.index for qubit in circuit.qubits}
    for operation in circuit.operations:
        lines.append(statement(operation, slots, register_names))

    return "\n".join(lines) + "\n"


def classical_register_names(circuit: Circuit) -> dict[str, str]:
    """A legal, unique QASM name for every classical register, by id.

    Deterministic by position, so exporting the same circuit twice produces the
    same file -- which is what makes the output diffable and the round-trip test
    meaningful.
    """
    names: dict[str, str] = {}
    taken = {QUBIT_REGISTER}

    for position, register in enumerate(circuit.classical_registers):
        label = register.label
        usable = label is not None and _IDENTIFIER.match(label) and label not in taken
        name = label if usable and label is not None else f"c{position}"

        while name in taken:
            name = f"{name}_"

        names[register.id] = name
        taken.add(name)

    return names


def statement(
    operation: GateOperation | MeasurementOperation | BarrierOperation,
    slots: Mapping[str, int],
    register_names: Mapping[str, str],
) -> str:
    """One operation as one OpenQASM statement."""
    match operation:
        case GateOperation():
            return gate_statement(operation, slots)
        case MeasurementOperation():
            qubit = qubit_reference(operation.targets[0], slots)
            target = operation.classical_target
            register = register_names[target.register_]

            return f"measure {qubit} -> {register}[{target.bit}];"
        case BarrierOperation():
            qubits = ",".join(
                qubit_reference(qubit_id, slots) for qubit_id in operation.targets
            )

            return f"barrier {qubits};"


def gate_statement(operation: GateOperation, slots: Mapping[str, int]) -> str:
    """A gate, with controls written before targets.

    That order is `qelib1.inc`'s and the signature's, not this function's
    invention: `cx control, target`. Reading the operand count from
    `GATE_SIGNATURES` rather than the name is the same discipline the importer
    uses, and it is why a gate added to `circuit.spec.json` needs no change here.
    """
    name = QASM_NAMES.get(operation.name, operation.name.value)
    signature = GATE_SIGNATURES[operation.name]

    arguments = ""
    if signature.parameters:
        values = ",".join(
            repr(operation.parameters[parameter]) for parameter in signature.parameters
        )
        arguments = f"({values})"

    operands = ",".join(
        qubit_reference(qubit_id, slots)
        for qubit_id in (*operation.controls, *operation.targets)
    )

    return f"{name}{arguments} {operands};"


def qubit_reference(qubit_id: str, slots: Mapping[str, int]) -> str:
    """A qubit as its slot in the single exported register."""
    return f"{QUBIT_REGISTER}[{slots[qubit_id]}]"
