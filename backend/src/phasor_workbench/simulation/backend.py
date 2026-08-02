"""The seam: what every simulator adapter looks like from outside.

docs/Simulation.md calls this the thing that makes a second backend possible,
and ADR-0001's single-source-of-truth rule is why it takes a `Circuit` rather
than some pre-digested structure -- the Circuit Model *is* the internal
representation, and inventing a second one would be a second description of the
same circuit to keep in step.

A `Protocol` rather than a base class, deliberately. An adapter is defined by
what it can do, not by what it inherits, and structural typing means a backend
in another package needs no import from here to satisfy it. `runtime_checkable`
is not used: it checks only that method *names* exist, which is a guarantee weak
enough to be misleading.

Nothing here imports Qiskit, or any simulator. This module is the description;
`./backends/` holds the implementations.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from ..models.circuit import Circuit, GateName

__all__ = ["Capabilities", "SampleResult", "SimulatorBackend", "StatevectorResult"]


@dataclass(frozen=True, slots=True)
class Capabilities:
    """What a backend can do, declared by the backend itself.

    `docs/Simulation.md`: an adapter declares its own limits rather than having
    them imposed. A caller asks rather than assuming, which is what lets
    `/api/v1/capabilities` describe the backend that is actually installed
    instead of a constant written months earlier.
    """

    name: str
    max_qubits: int
    supported_gates: frozenset[GateName]
    supports_statevector: bool
    supports_sampling: bool


@dataclass(frozen=True, slots=True)
class StatevectorResult:
    """Amplitudes of the final state, in the project's bit order.

    `amplitudes[i]` is the amplitude of the basis state whose binary
    representation is `i` **with qubit 0 as the rightmost bit** -- the
    convention docs/Simulation.md fixes, and the one thing in this module most
    likely to be silently wrong. An adapter whose simulator disagrees reverses
    before returning, and owes a test over an asymmetric state.
    """

    amplitudes: tuple[complex, ...]
    qubit_count: int

    def __post_init__(self) -> None:
        expected = 2**self.qubit_count
        if len(self.amplitudes) != expected:
            raise ValueError(
                f"{self.qubit_count} qubits needs {expected} amplitudes, "
                f"got {len(self.amplitudes)}."
            )


@dataclass(frozen=True, slots=True)
class SampleResult:
    """Measurement counts, keyed by classical bit string.

    Keys use the same bit order as `StatevectorResult`, and cover only the bits
    a measurement wrote to. `shots` is carried rather than recomputed from the
    counts so a caller can tell a seeded run from a coincidence.
    """

    counts: dict[str, int]
    shots: int


class SimulatorBackend(Protocol):
    """One simulator, behind the seam.

    The three operations docs/Simulation.md specifies. An implementation must
    raise only `simulation.errors` types, must not format a response, and must
    not import from the API layer.
    """

    def capabilities(self) -> Capabilities:
        """What this backend supports. Cheap enough to call per request."""
        ...

    def simulate_statevector(self, circuit: Circuit) -> StatevectorResult:
        """The final state, with measurement ignored.

        Measurement is not part of this mode -- it is the deterministic state a
        measurement would then sample from. Since the model defers mid-circuit
        measurement, every measurement is terminal, so "ignore them" and "the
        state just before the first one" describe the same vector.
        """
        ...

    def sample(
        self, circuit: Circuit, shots: int, seed: int | None = None
    ) -> SampleResult:
        """Run the circuit `shots` times and count what the registers hold."""
        ...
