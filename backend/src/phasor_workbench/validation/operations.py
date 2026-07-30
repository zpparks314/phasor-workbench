"""The Operational rules from docs/CircuitModel.md.

Arity, qubit reuse, and parameters. Gate arity and parameter names come from the
generated signatures in shared/spec/circuit.spec.json, never from a table here
-- that duplication is what ADR-0005 exists to remove.
"""

from __future__ import annotations

import math
from collections.abc import Iterator

from ..models import Operation
from ..models.circuit import Circuit, GateOperation
from ..models.spec import GATE_SIGNATURES, ViolationCode
from . import paths
from .violations import Violation


def check(circuit: Circuit) -> Iterator[Violation]:
    for index, operation in enumerate(circuit.operations):
        yield from _repeated_qubits(operation, index)

        if isinstance(operation, GateOperation):
            yield from _arity(operation, index)
            yield from _parameters(operation, index)


def _repeated_qubits(operation: Operation, index: int) -> Iterator[Violation]:
    """No qubit may appear twice in one operation, across targets and controls.

    Covers a barrier naming the same wire twice as well as a controlled gate
    whose control is also its target.
    """
    seen: set[str] = set()
    for qubit_id, path in paths.qubit_references(operation, index):
        if qubit_id in seen:
            yield Violation(
                code=ViolationCode.QUBIT_REUSED_IN_OPERATION,
                message=(
                    f"Operation '{operation.id}' names qubit '{qubit_id}' "
                    "more than once."
                ),
                path=path,
            )
        seen.add(qubit_id)


def _arity(operation: GateOperation, index: int) -> Iterator[Violation]:
    signature = GATE_SIGNATURES[operation.name]

    if len(operation.targets) != signature.targets:
        yield Violation(
            code=ViolationCode.GATE_ARITY_MISMATCH,
            message=(
                f"Gate '{operation.name.value}' takes {signature.targets} "
                f"target(s), but {len(operation.targets)} were given."
            ),
            path=f"{paths.operation(index)}.targets",
        )

    if len(operation.controls) != signature.controls:
        yield Violation(
            code=ViolationCode.GATE_ARITY_MISMATCH,
            message=(
                f"Gate '{operation.name.value}' takes {signature.controls} "
                f"control(s), but {len(operation.controls)} were given."
            ),
            path=f"{paths.operation(index)}.controls",
        )


def _parameters(operation: GateOperation, index: int) -> Iterator[Violation]:
    required = set(GATE_SIGNATURES[operation.name].parameters)
    supplied = set(operation.parameters)

    for name in sorted(required - supplied):
        yield Violation(
            code=ViolationCode.PARAMETER_MISSING,
            message=(
                f"Gate '{operation.name.value}' requires parameter '{name}', "
                "which is absent."
            ),
            path=f"{paths.operation(index)}.parameters",
        )

    for name in sorted(supplied - required):
        yield Violation(
            code=ViolationCode.PARAMETER_UNKNOWN,
            message=(
                f"Gate '{operation.name.value}' does not take a parameter "
                f"named '{name}'."
            ),
            path=f"{paths.operation(index)}.parameters.{name}",
        )

    # Only recognized parameters, so a single bad field reports one defect
    # rather than both "unknown" and "not finite".
    for name in sorted(required & supplied):
        value = operation.parameters[name]
        if not math.isfinite(value):
            yield Violation(
                code=ViolationCode.PARAMETER_NOT_FINITE,
                message=f"Parameter '{name}' must be a finite number, got {value}.",
                path=f"{paths.operation(index)}.parameters.{name}",
            )
