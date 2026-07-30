"""Locating a problem within the submitted document.

Paths use the format documented in docs/API.md -- `operations[4].targets[0]` --
and are built from **wire** field names, not Python attribute names. The
generated models rename `classicalTarget` to `classical_target` and alias it
back on the wire; a path naming the Python attribute would point at a field the
client never sent.
"""

from __future__ import annotations

from collections.abc import Iterator

from ..models import Operation
from ..models.circuit import GateOperation


def operation(index: int) -> str:
    return f"operations[{index}]"


def qubit(index: int, field: str) -> str:
    return f"qubits[{index}].{field}"


def register(index: int, field: str) -> str:
    return f"classicalRegisters[{index}].{field}"


def qubit_references(op: Operation, index: int) -> Iterator[tuple[str, str]]:
    """Yield `(qubit id, path)` for every qubit an operation names.

    Targets first, then controls, in document order. Only gates have controls;
    the schema forbids them on measurements and barriers, so a parsed operation
    of either kind has none to yield.
    """
    for position, target in enumerate(op.targets):
        yield target, f"{operation(index)}.targets[{position}]"

    if isinstance(op, GateOperation):
        for position, control in enumerate(op.controls):
            yield control, f"{operation(index)}.controls[{position}]"
