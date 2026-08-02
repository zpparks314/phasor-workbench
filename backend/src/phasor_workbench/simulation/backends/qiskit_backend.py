"""The Qiskit adapter: the first implementation of the seam.

Everything Qiskit-specific in the project lives in this file. Nothing outside
`simulation/backends/` imports Qiskit, which is the property that makes the
backend swappable and the one worth checking if this file grows.

**Qiskit is an optional dependency**, so importing this module without the
`simulation` extra installed must fail in a way the registry can report rather
than crashing the application at import time. See `_require_qiskit`.

**Bit ordering matches, so nothing is reversed here.** docs/Simulation.md fixes
qubit 0 as the rightmost bit of a basis string, which is Qiskit's own
convention -- verified rather than assumed, by an asymmetric state in the
tests. An adapter for a big-endian simulator would reverse; this one must not,
and a reversal appearing here would be a bug rather than a safeguard.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from ...models.circuit import Circuit, GateName
from ..backend import Capabilities, SampleResult, StatevectorResult
from ..errors import (
    BackendUnavailableError,
    CircuitTooLargeError,
    UnsupportedOperationError,
)

if TYPE_CHECKING:
    from qiskit import QuantumCircuit

__all__ = ["NAME", "QiskitBackend", "qiskit_available"]

NAME = "qiskit"

"""
A statevector is 2^n complex amplitudes: 20 qubits is about 16 MB, 30 would be
16 GB. The limit is the adapter's own, per docs/Simulation.md, and exists to
turn an unresponsive machine into an error message.
"""
MAX_QUBITS = 20

"""
Circuit Model gate name -> the method on Qiskit's QuantumCircuit.

Only `i` differs, Qiskit spelling the identity `id`. The map is explicit rather
than `getattr(qc, name)` so that a gate added to circuit.spec.json fails a test
here instead of failing at runtime with an AttributeError -- the same reason
`editor/glyphs.ts` types its table as a total Record.
"""
GATE_METHODS: dict[GateName, str] = {
    GateName.i: "id",
    GateName.h: "h",
    GateName.x: "x",
    GateName.y: "y",
    GateName.z: "z",
    GateName.s: "s",
    GateName.sdg: "sdg",
    GateName.t: "t",
    GateName.tdg: "tdg",
    GateName.rx: "rx",
    GateName.ry: "ry",
    GateName.rz: "rz",
    GateName.p: "p",
    GateName.cx: "cx",
    GateName.cy: "cy",
    GateName.cz: "cz",
    GateName.swap: "swap",
    GateName.ccx: "ccx",
}


def qiskit_available() -> bool:
    """Whether the `simulation` extra is installed.

    The registry asks this instead of catching ImportError at call sites, so
    "Qiskit is absent" stays an answerable question rather than an exception
    that has to be handled everywhere.
    """
    try:
        import qiskit  # noqa: F401
    except ImportError:
        return False
    return True


def _require_qiskit() -> Any:
    """Import Qiskit, or raise the typed error that says it is missing."""
    try:
        import qiskit
    except ImportError as exc:  # pragma: no cover - needs the extra uninstalled
        raise BackendUnavailableError(
            "Qiskit is not installed. Install the simulation extra: "
            'pip install -e ".[dev,simulation]"'
        ) from exc
    return qiskit


class QiskitBackend:
    """Structural implementation of `SimulatorBackend`."""

    def capabilities(self) -> Capabilities:
        return Capabilities(
            name=NAME,
            max_qubits=MAX_QUBITS,
            supported_gates=frozenset(GATE_METHODS),
            supports_statevector=True,
            supports_sampling=True,
        )

    def simulate_statevector(self, circuit: Circuit) -> StatevectorResult:
        """The final state, with measurements omitted from the translation.

        Qiskit's `Statevector` refuses a circuit containing a measurement, and
        that refusal is correct rather than an obstacle: a statevector is the
        deterministic state a measurement samples *from*. Because the model
        defers mid-circuit measurement, every measurement is terminal, so
        omitting them yields exactly the state just before the first one.
        """
        qiskit = _require_qiskit()
        from qiskit.quantum_info import Statevector

        self._check_size(circuit)
        built = self._translate(qiskit, circuit, include_measurements=False)

        # Qiskit raises on a zero-qubit Statevector, so the degenerate circuit
        # is answered here. `(1,)` rather than `()`: a system of no qubits has
        # a one-dimensional state space -- the empty tensor product is the
        # scalar 1 -- so this keeps `len(amplitudes) == 2 ** qubit_count` true
        # for every circuit, which is the invariant that catches real bugs.
        if not circuit.qubits:
            return StatevectorResult(amplitudes=(1 + 0j,), qubit_count=0)

        state = Statevector(built)
        return StatevectorResult(
            amplitudes=tuple(complex(amplitude) for amplitude in state.data),
            qubit_count=len(circuit.qubits),
        )

    def sample(
        self, circuit: Circuit, shots: int, seed: int | None = None
    ) -> SampleResult:
        """Run the circuit and count what the classical registers hold.

        Counts from every declared register are joined into one key, in
        declaration order, so a document with two registers reports one string
        rather than two dictionaries the caller has to correlate.
        """
        if shots < 1:
            raise UnsupportedOperationError(f"shots must be at least 1, got {shots}.")

        qiskit = _require_qiskit()
        from qiskit.primitives import StatevectorSampler

        self._check_size(circuit)
        built = self._translate(qiskit, circuit, include_measurements=True)

        measured = any(
            operation.kind == "measurement" for operation in circuit.operations
        )
        if not measured:
            raise UnsupportedOperationError(
                "Sampling needs at least one measurement; this circuit has none."
            )

        result = StatevectorSampler(seed=seed).run([built], shots=shots).result()
        data = result[0].data

        # One dict per classical register, keyed by register name. Joined in
        # declaration order so the string reads the way the document does.
        per_register = [
            getattr(data, self._register_name(index)).get_counts()
            for index, _ in enumerate(circuit.classical_registers)
        ]

        return SampleResult(counts=_join(per_register, shots), shots=shots)

    def _check_size(self, circuit: Circuit) -> None:
        if len(circuit.qubits) > MAX_QUBITS:
            raise CircuitTooLargeError(len(circuit.qubits), MAX_QUBITS)

    @staticmethod
    def _register_name(index: int) -> str:
        """Qiskit register names are positional, matching the editor's labels.

        Never the register's identifier: ADR-0002 makes those opaque, and a
        UUID would be an unusable key in a sampler result.
        """
        return f"c{index}"

    def _translate(
        self, qiskit: Any, circuit: Circuit, *, include_measurements: bool
    ) -> QuantumCircuit:
        """Circuit Model -> Qiskit, the only place the two representations meet.

        Qubits map by `index`, which the model guarantees is contiguous from 0,
        so position in Qiskit's register *is* the model's index and no lookup
        table is needed. Validation enforces that contiguity; this relies on it
        rather than re-checking it.
        """
        quantum = qiskit.QuantumRegister(len(circuit.qubits), "q")
        classical = [
            qiskit.ClassicalRegister(register.size, self._register_name(index))
            for index, register in enumerate(circuit.classical_registers)
        ]
        built = qiskit.QuantumCircuit(quantum, *classical)

        position = {qubit.id: qubit.index for qubit in circuit.qubits}
        register_position = {
            register.id: index
            for index, register in enumerate(circuit.classical_registers)
        }

        for operation in circuit.operations:
            if operation.kind == "gate":
                self._add_gate(built, quantum, operation, position)
            elif operation.kind == "barrier":
                # Faithful rather than dropped. A barrier constrains scheduling
                # and contributes nothing to the state, so it is inert here --
                # but a translated circuit that omitted it would no longer say
                # what the document says, and this circuit is worth inspecting.
                built.barrier(*[quantum[position[q]] for q in operation.targets])
            elif include_measurements:
                target = operation.classical_target
                built.measure(
                    quantum[position[operation.targets[0]]],
                    classical[register_position[target.register_]][target.bit],
                )

        return built

    def _add_gate(
        self,
        built: QuantumCircuit,
        quantum: Any,
        operation: Any,
        position: dict[str, int],
    ) -> None:
        method_name = GATE_METHODS.get(operation.name)
        if method_name is None:
            raise UnsupportedOperationError(
                f"This backend has no implementation for gate '{operation.name}'."
            )

        # Controls first, then targets: every controlled gate in Qiskit takes
        # its controls as the leading arguments, and the model stores the two
        # separately precisely so this does not depend on document order.
        qubits = [
            quantum[position[q]]
            for q in [*(operation.controls or []), *operation.targets]
        ]
        parameters = list((operation.parameters or {}).values())

        getattr(built, method_name)(*parameters, *qubits)


def _join(per_register: list[dict[str, int]], shots: int) -> dict[str, int]:
    """Combine per-register counts into one bit string per shot outcome.

    Qiskit reports a dict per classical register and does not correlate them,
    so with two registers the only honest join is the trivial one: a single
    register passes through, and anything else would be inventing a
    correlation the sampler did not report.
    """
    if not per_register:
        return {}
    if len(per_register) == 1:
        return dict(per_register[0])

    raise UnsupportedOperationError(
        "Sampling a circuit with more than one classical register is not "
        "supported yet: the sampler reports each register separately and "
        "joining them would invent a correlation it did not measure."
    )
