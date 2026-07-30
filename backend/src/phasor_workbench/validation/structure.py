"""The Structural rules from docs/CircuitModel.md.

Identifier uniqueness and qubit index integrity. Length bounds, negative
indices, and register sizes are enforced by the schema and reported as
SHAPE_INVALID, so nothing here re-checks them.
"""

from __future__ import annotations

from collections.abc import Iterator

from ..models.circuit import Circuit
from ..models.spec import ViolationCode
from . import paths
from .violations import Violation


def check(circuit: Circuit) -> Iterator[Violation]:
    yield from _duplicate_qubit_ids(circuit)
    yield from _duplicate_register_ids(circuit)
    yield from _duplicate_operation_ids(circuit)
    yield from _qubit_indices(circuit)


def _duplicate_qubit_ids(circuit: Circuit) -> Iterator[Violation]:
    seen: set[str] = set()
    for index, qubit in enumerate(circuit.qubits):
        if qubit.id in seen:
            yield Violation(
                code=ViolationCode.DUPLICATE_IDENTIFIER,
                message=f"Qubit id '{qubit.id}' is declared more than once.",
                path=paths.qubit(index, "id"),
            )
        seen.add(qubit.id)


def _duplicate_register_ids(circuit: Circuit) -> Iterator[Violation]:
    seen: set[str] = set()
    for index, register in enumerate(circuit.classical_registers):
        if register.id in seen:
            yield Violation(
                code=ViolationCode.DUPLICATE_IDENTIFIER,
                message=(
                    f"Classical register id '{register.id}' is declared more than once."
                ),
                path=paths.register(index, "id"),
            )
        seen.add(register.id)


def _duplicate_operation_ids(circuit: Circuit) -> Iterator[Violation]:
    seen: set[str] = set()
    for index, operation in enumerate(circuit.operations):
        if operation.id in seen:
            yield Violation(
                code=ViolationCode.DUPLICATE_IDENTIFIER,
                message=f"Operation id '{operation.id}' is declared more than once.",
                path=f"{paths.operation(index)}.id",
            )
        seen.add(operation.id)


def _qubit_indices(circuit: Circuit) -> Iterator[Violation]:
    """Indices must be a contiguous run from 0, in any declaration order.

    Order is not required because `index` carries the position on the wire
    stack; the array's own order is incidental. A duplicate necessarily implies
    a gap, so a duplicate is reported alone to keep one defect to one violation.
    """
    seen: dict[int, int] = {}
    duplicated = False

    for position, qubit in enumerate(circuit.qubits):
        if qubit.index in seen:
            duplicated = True
            yield Violation(
                code=ViolationCode.DUPLICATE_QUBIT_INDEX,
                message=(
                    f"Qubit index {qubit.index} is used by both "
                    f"'{circuit.qubits[seen[qubit.index]].id}' and '{qubit.id}'."
                ),
                path=paths.qubit(position, "index"),
            )
        else:
            seen[qubit.index] = position

    if duplicated:
        return

    expected = set(range(len(circuit.qubits)))
    missing = sorted(expected - set(seen))
    if missing:
        yield Violation(
            code=ViolationCode.QUBIT_INDEX_GAP,
            message=(
                "Qubit indices must run contiguously from 0. "
                f"Missing: {', '.join(str(index) for index in missing)}."
            ),
            path="qubits",
        )
