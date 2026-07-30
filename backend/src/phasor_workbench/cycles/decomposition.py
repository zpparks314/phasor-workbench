"""What the derivation returns.

Specified in ADR-0003. Never stored and never serialized as part of a circuit --
ADR-0001 makes the operation list canonical and this a derived view, so every
consumer computes it on demand and discards it.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class BarrierPlacement:
    """Where a barrier sits, for a renderer drawing on a column boundary.

    `before_cycle` may equal `depth`, meaning the trailing edge of the circuit.
    A barrier occupies no cycle of its own and does not contribute to depth.
    """

    operation_id: str
    before_cycle: int
    qubits: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class Decomposition:
    """Operations grouped into cycles, plus where the barriers fell.

    Cycle indices run from 0 to `depth - 1` with no gaps and no empty cycles.
    Barriers appear only in `barriers`, never inside a cycle.
    """

    cycles: tuple[tuple[str, ...], ...]
    barriers: tuple[BarrierPlacement, ...]

    @property
    def depth(self) -> int:
        """Derived rather than stored, so it cannot disagree with `cycles`."""
        return len(self.cycles)

    def sorted_cycles(self) -> list[list[str]]:
        """Each cycle's ids sorted, for comparison against a fixture.

        ADR-0003 property 5 states that consumers must not depend on the order of
        operation ids within a cycle. A fixture asserting the order rules happen
        to produce would therefore be asserting something outside the contract,
        and a legitimate reordering would break it.
        """
        return [sorted(cycle) for cycle in self.cycles]
