"""Cycle derivation: the decomposition specified in ADR-0003.

Groups a circuit's flat operation list into concurrent cycles by
as-soon-as-possible packing over a per-resource frontier, evaluated in canonical
list order. The result is never stored -- ADR-0001 makes the operation list
canonical and this a derived view, so analysis, simulation, and rendering each
call this and discard the result.

Implemented once per language and held to `frontend/src/cycles/` by the fixtures
in shared/fixtures/decomposition/. A disagreement between the two is a bug in one
of them or an ADR-0003 revision, never a fixture to regenerate.

**Assumes a valid circuit.** This is not a validation pass; run
`phasor_workbench.validation` first. Given an invalid circuit it does not raise --
an unresolvable qubit id is still a usable frontier key -- so it will happily
decompose a circuit that should not exist. That is a deliberate non-goal rather
than robustness.

ADR-0003 states seven guaranteed properties and is explicit that they are
property *tests*, not runtime checks. They are asserted over every fixture in
`backend/tests/test_cycles.py` and nothing here re-checks them at runtime.
"""

from ..models import Operation
from ..models.circuit import (
    BarrierOperation,
    Circuit,
    GateOperation,
    MeasurementOperation,
)
from .decomposition import BarrierPlacement, Decomposition

__all__ = ["BarrierPlacement", "Decomposition", "derive_cycles"]

# Qubits and classical bits are separate maps rather than one keyed by a composed
# string. Identifiers are opaque and unrestricted, so a qubit legitimately named
# "c_0#0" would collide with register "c_0" bit 0 under any naive delimiter
# scheme. Two maps remove the question instead of answering it.
QubitFrontier = dict[str, int]
BitFrontier = dict[tuple[str, int], int]


def derive_cycles(circuit: Circuit) -> Decomposition:
    """Pack every operation as early as its resources allow."""
    qubit_frontier: QubitFrontier = {}
    bit_frontier: BitFrontier = {}
    cycles: list[list[str]] = []
    barriers: list[BarrierPlacement] = []

    for operation in circuit.operations:
        if isinstance(operation, BarrierOperation):
            barriers.append(_place_barrier(operation, qubit_frontier))
            continue

        qubits = _qubit_resources(operation)
        bits = _bit_resources(operation)

        index = max(
            [
                *(qubit_frontier.get(qubit, 0) for qubit in qubits),
                *(bit_frontier.get(bit, 0) for bit in bits),
            ],
            # ADR-0003: max over an empty set is 0. Unreachable, because the
            # schema gives every operation at least one target.
            default=0,
        )

        # Property 3 makes growth by more than one impossible, so this is a loop
        # for honesty rather than because an index can skip.
        while len(cycles) <= index:
            cycles.append([])
        cycles[index].append(operation.id)

        for qubit in qubits:
            qubit_frontier[qubit] = index + 1
        for bit in bits:
            bit_frontier[bit] = index + 1

    return Decomposition(
        cycles=tuple(tuple(cycle) for cycle in cycles),
        barriers=tuple(barriers),
    )


def _place_barrier(
    operation: BarrierOperation, qubit_frontier: QubitFrontier
) -> BarrierPlacement:
    """Level the target frontier to its collective maximum without advancing it.

    Levelling is what makes every earlier operation on those qubits land in a
    strictly earlier cycle than every later one. Not advancing is what keeps a
    barrier out of the depth: annotating a circuit must never change a metric
    that optimization passes compare against.
    """
    level = max(qubit_frontier.get(qubit, 0) for qubit in operation.targets)

    for qubit in operation.targets:
        qubit_frontier[qubit] = level

    return BarrierPlacement(
        operation_id=operation.id,
        before_cycle=level,
        qubits=tuple(operation.targets),
    )


def _qubit_resources(operation: Operation) -> tuple[str, ...]:
    if isinstance(operation, GateOperation):
        return (*operation.targets, *operation.controls)
    return tuple(operation.targets)


def _bit_resources(operation: Operation) -> tuple[tuple[str, int], ...]:
    """Contention is tracked per bit, not per register.

    Per-register granularity would serialize independent measurements and
    overstate depth for the common case of measuring every qubit into one
    register.
    """
    if isinstance(operation, MeasurementOperation):
        target = operation.classical_target
        return ((target.register_, target.bit),)
    return ()
