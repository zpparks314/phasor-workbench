"""Static circuit analysis: gate counts, depth, and breakdown.

Cheap enough to run on every edit, which is why it is separate from
simulation. See docs/API.md.

**Every number here is counted or derived, never stored.** Depth in particular
comes from `derive_cycles`, the same component the editor draws its columns
from, so a circuit's depth cannot mean one thing on the canvas and another in
this response. That is ADR-0001's rule, and it is why this endpoint was the
cheapest possible proof of the API round trip: nothing new had to be computed,
and the two languages already agreed on every fixture.

Pure, and no HTTP. `api/routes/circuits.py` turns a request into a `Circuit` and
this result into a response body; neither half knows about the other.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass

from ..cycles import derive_cycles
from ..models.circuit import Circuit, GateName

__all__ = ["Analysis", "analyze_circuit"]


@dataclass(frozen=True, slots=True)
class Analysis:
    """What can be said about a circuit without running it."""

    qubit_count: int
    gate_count: int
    measurement_count: int
    depth: int
    gate_breakdown: dict[GateName, int]
    """Occurrences per gate name. A gate that does not appear is absent."""


def analyze_circuit(circuit: Circuit) -> Analysis:
    """Count a circuit's contents and derive its depth.

    A barrier is counted as neither a gate nor a measurement. It is still an
    operation, so `gate_count + measurement_count` is deliberately not
    `len(circuit.operations)` -- a barrier is an authoring constraint rather
    than something the circuit does. See ADR-0003.

    A barrier can nonetheless raise depth by levelling an unequal frontier,
    which is not a contradiction: it occupies no cycle of its own while changing
    which cycle other operations land in. `derive_cycles` already accounts for
    that, and it is the second reason depth is taken from there rather than
    recomputed here.
    """
    breakdown = Counter(
        operation.name for operation in circuit.operations if operation.kind == "gate"
    )

    return Analysis(
        qubit_count=len(circuit.qubits),
        gate_count=sum(breakdown.values()),
        measurement_count=sum(
            1 for operation in circuit.operations if operation.kind == "measurement"
        ),
        depth=derive_cycles(circuit).depth,
        gate_breakdown=dict(breakdown),
    )
