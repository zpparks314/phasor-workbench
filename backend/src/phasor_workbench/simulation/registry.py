"""Which simulators this installation actually has.

docs/Simulation.md: adding a simulator means adding one adapter and
registering it, and must not require edits elsewhere. This is the "elsewhere",
and it is deliberately the only file a second backend touches outside its own
module.

**Availability is a runtime fact, not a constant.** Qiskit lives in an optional
extra, so a correctly installed application may genuinely have no simulator.
That is why `available_backends` asks each candidate rather than returning a
list written when the file was saved -- and why `/api/v1/capabilities` can
describe the backend that is installed rather than the one that was planned.
"""

from __future__ import annotations

from collections.abc import Callable

from .backend import SimulatorBackend
from .backends import qiskit_backend
from .errors import BackendUnavailableError

__all__ = ["available_backends", "get_backend", "register"]

"""
Candidate adapters: a name, a predicate that reports whether its dependency is
importable, and a factory. The predicate is what keeps an absent optional
dependency from being an exception -- asking is cheaper than catching, and it
lets a caller enumerate what is possible without constructing anything.
"""
_CANDIDATES: dict[str, tuple[Callable[[], bool], Callable[[], SimulatorBackend]]] = {
    qiskit_backend.NAME: (
        qiskit_backend.qiskit_available,
        qiskit_backend.QiskitBackend,
    ),
}


def register(
    name: str,
    available: Callable[[], bool],
    factory: Callable[[], SimulatorBackend],
) -> None:
    """Add an adapter. Exists so a backend outside this package can join."""
    _CANDIDATES[name] = (available, factory)


def available_backends() -> tuple[str, ...]:
    """Names of every adapter whose dependencies are importable, in order."""
    return tuple(name for name, (available, _) in _CANDIDATES.items() if available())


def get_backend(name: str | None = None) -> SimulatorBackend:
    """The named adapter, or the first available one.

    Defaulting to "first available" rather than hard-coding Qiskit is what
    keeps the choice of simulator out of every caller. The error names what is
    actually installed, because "backend 'cirq' is unknown" is a much longer
    debugging session than "backend 'cirq' is unknown; available: qiskit".
    """
    available = available_backends()

    if name is None:
        if not available:
            raise BackendUnavailableError(
                "No simulator backend is installed. Install the simulation "
                'extra: pip install -e ".[dev,simulation]"'
            )
        name = available[0]

    candidate = _CANDIDATES.get(name)
    if candidate is None:
        known = ", ".join(_CANDIDATES) or "none"
        raise BackendUnavailableError(
            f"Unknown simulator backend '{name}'. Registered: {known}."
        )

    is_available, factory = candidate
    if not is_available():
        raise BackendUnavailableError(
            f"Simulator backend '{name}' is registered but its dependencies "
            f"are not installed. Available: {', '.join(available) or 'none'}."
        )

    return factory()
