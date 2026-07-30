"""The Reference rules from docs/CircuitModel.md.

Every identifier an operation names must resolve. This is where an unconstrained
`IdentifierRef` is validated: resolution is strictly stronger than a length
check, because a resolved id already satisfied `Identifier` where it was minted.
See the note in shared/schema/circuit.schema.json.
"""

from __future__ import annotations

from collections.abc import Iterator

from ..models import Operation
from ..models.circuit import Circuit, MeasurementOperation
from ..models.spec import ViolationCode
from . import paths
from .violations import Violation


def check(circuit: Circuit) -> Iterator[Violation]:
    qubit_ids = {qubit.id for qubit in circuit.qubits}
    register_sizes = {
        register.id: register.size for register in circuit.classical_registers
    }

    for index, operation in enumerate(circuit.operations):
        yield from _qubit_references(operation, index, qubit_ids)

        if isinstance(operation, MeasurementOperation):
            yield from _classical_target(operation, index, register_sizes)


def _qubit_references(
    operation: Operation, index: int, qubit_ids: set[str]
) -> Iterator[Violation]:
    for qubit_id, path in paths.qubit_references(operation, index):
        if qubit_id not in qubit_ids:
            yield Violation(
                code=ViolationCode.UNKNOWN_QUBIT_REFERENCE,
                message=(
                    f"Operation references qubit '{qubit_id}', which does not exist."
                ),
                path=path,
            )


def _classical_target(
    operation: MeasurementOperation, index: int, register_sizes: dict[str, int]
) -> Iterator[Violation]:
    target = operation.classical_target
    size = register_sizes.get(target.register_)

    if size is None:
        yield Violation(
            code=ViolationCode.UNKNOWN_REGISTER_REFERENCE,
            message=(
                f"Measurement writes to classical register '{target.register_}', "
                "which is not declared."
            ),
            path=f"{paths.operation(index)}.classicalTarget.register",
        )
        # The bit range is meaningless without a register. Reporting both would
        # make one mistake look like two.
        return

    if target.bit >= size:
        yield Violation(
            code=ViolationCode.CLASSICAL_BIT_OUT_OF_RANGE,
            message=(
                f"Bit {target.bit} is outside register '{target.register_}', "
                f"which has size {size} (valid bits 0 to {size - 1})."
            ),
            path=f"{paths.operation(index)}.classicalTarget.bit",
        )
