"""Simulation pipeline.

Dispatches a validated circuit to a backend adapter and returns typed results.
The seam that makes a second simulator possible is `./backend.py`; the adapters
live in `./backends/`, and `./registry.py` is the only file a new one touches
outside its own module.

    get_backend().simulate_statevector(circuit) -> StatevectorResult
    get_backend().sample(circuit, shots, seed)  -> SampleResult

**The Circuit Model is the internal representation.** docs/Simulation.md
describes an intermediate structure between validation and the backend, and
this deliberately does not build one: the Circuit Model is already
simulator-agnostic, and a second description of the same circuit would be
another thing to keep in step with the schema. The seam's actual job -- keeping
Qiskit out of the API layer -- is served by the port being typed in terms of
`Circuit`. See the note in docs/Simulation.md under *Why an Internal
Representation*.

Nothing here imports Qiskit. Only `./backends/qiskit_backend.py` does, and it
is importable without the optional extra installed.
"""

from .backend import (
    Capabilities,
    SampleResult,
    SimulatorBackend,
    StatevectorResult,
)
from .errors import (
    BackendUnavailableError,
    CircuitTooLargeError,
    SimulationError,
    UnsupportedOperationError,
)
from .registry import available_backends, get_backend, register

__all__ = [
    "BackendUnavailableError",
    "Capabilities",
    "CircuitTooLargeError",
    "SampleResult",
    "SimulationError",
    "SimulatorBackend",
    "StatevectorResult",
    "UnsupportedOperationError",
    "available_backends",
    "get_backend",
    "register",
]
