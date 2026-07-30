"""Measurement terminates a qubit.

The Semantic group in docs/CircuitModel.md. Its other rule -- a gate name outside
the known set -- is enforced by the schema's enum and reported as SHAPE_INVALID.

While mid-circuit measurement is deferred, measurement ends a qubit's usable
life. **Barriers are exempt**, and that exemption is load-bearing rather than a
convenience: without it, a full-width barrier placed after measurement would be
invalid, and an importer expanding OpenQASM's bare `barrier;` to every qubit
would turn valid input into invalid circuits.

Lifting the restriction is an execution-semantics change and warrants its own
ADR, since it is the prerequisite for classical control.
"""

from __future__ import annotations

from collections.abc import Iterator

from ..models import Operation
from ..models.circuit import BarrierOperation, Circuit, MeasurementOperation
from ..models.spec import ViolationCode
from . import paths
from .violations import Violation


def check(circuit: Circuit) -> Iterator[Violation]:
    measured: dict[str, str] = {}

    for index, operation in enumerate(circuit.operations):
        if isinstance(operation, BarrierOperation):
            continue

        touched = sorted(
            {
                qubit_id
                for qubit_id, _ in paths.qubit_references(operation, index)
                if qubit_id in measured
            }
        )

        if touched:
            yield Violation(
                code=ViolationCode.OPERATION_AFTER_MEASUREMENT,
                message=_message(operation, touched, measured),
                path=paths.operation(index),
            )

        if isinstance(operation, MeasurementOperation):
            for qubit_id, _ in paths.qubit_references(operation, index):
                measured.setdefault(qubit_id, operation.id)


def _message(
    operation: Operation,
    touched: list[str],
    measured: dict[str, str],
) -> str:
    wires = ", ".join(f"'{qubit_id}'" for qubit_id in touched)
    by = ", ".join(f"'{measured[qubit_id]}'" for qubit_id in touched)
    subject = (
        "Measuring" if isinstance(operation, MeasurementOperation) else "Acting on"
    )
    return (
        f"{subject} {wires} is not allowed: already measured by {by}. "
        "A measured qubit is terminal while mid-circuit measurement is deferred."
    )
