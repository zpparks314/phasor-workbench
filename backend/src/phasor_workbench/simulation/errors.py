"""What a simulator adapter is allowed to raise.

docs/Simulation.md: an adapter raises typed errors, never simulator-specific
exceptions. That rule is what keeps a backend swap invisible -- a caller that
caught `QiskitError` would break the day a second backend arrived, and a caller
that catches these does not.

These carry no HTTP status and no error envelope. Mapping them onto
`api.errors` is the API layer's job, and this module must not know that layer
exists.
"""

from __future__ import annotations

__all__ = [
    "BackendUnavailableError",
    "CircuitTooLargeError",
    "SimulationError",
    "UnsupportedOperationError",
]


class SimulationError(Exception):
    """Base for every failure a simulator adapter reports."""


class BackendUnavailableError(SimulationError):
    """The named simulator is not installed, or could not be imported.

    A real condition rather than a defensive one: Qiskit lives in an optional
    `simulation` extra, so a backend that is absent is an ordinary state of a
    correctly installed application, not a broken deployment.
    """


class CircuitTooLargeError(SimulationError):
    """More qubits than the adapter is willing to simulate.

    Raised *before* allocating anything. A statevector is 2^n amplitudes, so
    the difference between refusing 30 qubits and attempting them is the
    difference between an error message and an unresponsive machine.
    """

    def __init__(self, qubits: int, limit: int) -> None:
        super().__init__(
            f"Circuit has {qubits} qubits; this backend simulates at most {limit}."
        )
        self.qubits = qubits
        self.limit = limit


class UnsupportedOperationError(SimulationError):
    """The circuit contains something this adapter cannot express.

    Distinct from an invalid circuit. The document may be perfectly valid and
    still name a gate a particular backend does not implement, which is why
    adapters declare their own capabilities rather than having them imposed.
    """
