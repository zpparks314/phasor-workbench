"""The simulator seam and the Qiskit adapter.

Two things here are worth more than the rest.

**Bit ordering.** docs/Simulation.md calls inconsistent bit ordering the most
common source of silent wrongness in quantum tooling, and asks for a test over
a known asymmetric state. That is `TestBitOrdering`, and it is asymmetric on
purpose: every symmetric state agrees under both conventions, so a symmetric
test would pass against a backend that had it exactly backwards.

**Gate coverage.** The adapter's gate table is checked against the generated
spec rather than a hand-written list, so a gate added to circuit.spec.json
fails here instead of at runtime.
"""

from __future__ import annotations

import math
from typing import Any

import pytest

from phasor_workbench.models.circuit import Circuit, GateName
from phasor_workbench.models.spec import GATE_SIGNATURES
from phasor_workbench.simulation import (
    CircuitTooLargeError,
    UnsupportedOperationError,
    available_backends,
    get_backend,
)
from phasor_workbench.simulation.backends.qiskit_backend import (
    GATE_METHODS,
    MAX_QUBITS,
    QiskitBackend,
)
from phasor_workbench.simulation.errors import BackendUnavailableError
from phasor_workbench.simulation.registry import register

pytestmark = pytest.mark.skipif(
    "qiskit" not in available_backends(),
    reason="the simulation extra is not installed",
)


def circuit(qubits: int = 2, registers: int = 1, **overrides: Any) -> Circuit:
    document: dict[str, Any] = {
        "schemaVersion": "0.1.0",
        "id": "circ_test",
        "qubits": [{"id": f"q_{i}", "index": i} for i in range(qubits)],
        "classicalRegisters": [
            {"id": f"c_{i}", "size": max(qubits, 1)} for i in range(registers)
        ],
        "operations": [],
        **overrides,
    }
    return Circuit.model_validate(document)


def gate(op_id: str, name: str, targets: list[str], **extra: Any) -> dict[str, Any]:
    return {"id": op_id, "kind": "gate", "name": name, "targets": targets, **extra}


def measure(op_id: str, qubit: str, bit: int, register: str = "c_0") -> dict[str, Any]:
    return {
        "id": op_id,
        "kind": "measurement",
        "targets": [qubit],
        "classicalTarget": {"register": register, "bit": bit},
    }


def peak(amplitudes: tuple[complex, ...]) -> int:
    """Index of the basis state carrying (essentially) all the amplitude."""
    return max(range(len(amplitudes)), key=lambda i: abs(amplitudes[i]))


class TestBitOrdering:
    """docs/Simulation.md: qubit 0 is the rightmost bit of a basis string."""

    def test_x_on_qubit_zero_is_the_rightmost_bit(self) -> None:
        state = get_backend().simulate_statevector(
            circuit(3, operations=[gate("op_0", "x", ["q_0"])])
        )

        assert format(peak(state.amplitudes), "03b") == "001"

    def test_x_on_the_last_qubit_is_the_leftmost_bit(self) -> None:
        """The other end of the same claim.

        Together these two pin the direction. Either alone is satisfied by a
        backend that indexes from the wrong end in a 1-qubit-set circuit.
        """
        state = get_backend().simulate_statevector(
            circuit(3, operations=[gate("op_0", "x", ["q_2"])])
        )

        assert format(peak(state.amplitudes), "03b") == "100"

    def test_sampling_agrees_with_the_statevector(self) -> None:
        """The formatter and the simulator must not disagree about direction.

        A reversal applied in one path and not the other is exactly the silent
        wrongness the ordering rule exists to prevent.
        """
        asymmetric = circuit(
            3,
            operations=[
                gate("op_0", "x", ["q_0"]),
                measure("op_1", "q_0", 0),
                measure("op_2", "q_1", 1),
                measure("op_3", "q_2", 2),
            ],
        )
        backend = get_backend()

        state = backend.simulate_statevector(asymmetric)
        counts = backend.sample(asymmetric, shots=64, seed=1).counts

        assert format(peak(state.amplitudes), "03b") == "001"
        assert counts == {"001": 64}


class TestStatevector:
    def test_produces_a_bell_state(self) -> None:
        state = get_backend().simulate_statevector(
            circuit(
                2,
                operations=[
                    gate("op_0", "h", ["q_0"]),
                    gate("op_1", "cx", ["q_1"], controls=["q_0"]),
                ],
            )
        )

        root_half = 1 / math.sqrt(2)
        assert state.amplitudes[0].real == pytest.approx(root_half)
        assert state.amplitudes[3].real == pytest.approx(root_half)
        assert abs(state.amplitudes[1]) == pytest.approx(0)
        assert abs(state.amplitudes[2]) == pytest.approx(0)

    def test_ignores_measurements_rather_than_refusing_them(self) -> None:
        """A statevector is the state a measurement samples *from*.

        Qiskit's Statevector rejects a circuit containing one, so the adapter
        omits them from the translation. Because the model defers mid-circuit
        measurement, every measurement is terminal and this is exactly the
        state just before the first.
        """
        with_measurement = circuit(
            1,
            operations=[gate("op_0", "h", ["q_0"]), measure("op_1", "q_0", 0)],
        )
        without = circuit(1, operations=[gate("op_0", "h", ["q_0"])])
        backend = get_backend()

        assert backend.simulate_statevector(with_measurement) == (
            backend.simulate_statevector(without)
        )

    def test_a_barrier_does_not_change_the_state(self) -> None:
        """It constrains scheduling, not the result. See ADR-0003."""
        backend = get_backend()
        plain = circuit(2, operations=[gate("op_0", "h", ["q_0"])])
        barriered = circuit(
            2,
            operations=[
                gate("op_0", "h", ["q_0"]),
                {"id": "op_b", "kind": "barrier", "targets": ["q_0", "q_1"]},
            ],
        )

        assert backend.simulate_statevector(barriered) == (
            backend.simulate_statevector(plain)
        )

    def test_applies_a_rotation_parameter(self) -> None:
        """rx(pi) maps |0> to |1> up to phase -- proof the angle is not dropped."""
        state = get_backend().simulate_statevector(
            circuit(
                1,
                operations=[gate("op_0", "rx", ["q_0"], parameters={"theta": math.pi})],
            )
        )

        assert abs(state.amplitudes[1]) == pytest.approx(1)

    def test_answers_a_circuit_with_no_qubits(self) -> None:
        """One amplitude, not none.

        A system of no qubits has a one-dimensional state space -- the empty
        tensor product is the scalar 1 -- so this keeps
        `len(amplitudes) == 2 ** qubit_count` true for every circuit. Returning
        an empty tuple would have made the degenerate case the one place that
        invariant did not hold.
        """
        state = get_backend().simulate_statevector(circuit(0, registers=0))

        assert state.amplitudes == (1 + 0j,)
        assert state.qubit_count == 0

    def test_refuses_a_circuit_past_the_qubit_limit(self) -> None:
        """Refused before allocating: 2^n is the difference between an error
        message and an unresponsive machine."""
        with pytest.raises(CircuitTooLargeError) as raised:
            get_backend().simulate_statevector(circuit(MAX_QUBITS + 1, registers=0))

        assert raised.value.limit == MAX_QUBITS


class TestSampling:
    def test_counts_a_bell_state_across_both_outcomes(self) -> None:
        counts = (
            get_backend()
            .sample(
                circuit(
                    2,
                    operations=[
                        gate("op_0", "h", ["q_0"]),
                        gate("op_1", "cx", ["q_1"], controls=["q_0"]),
                        measure("op_2", "q_0", 0),
                        measure("op_3", "q_1", 1),
                    ],
                ),
                shots=512,
                seed=7,
            )
            .counts
        )

        # Entangled, so only the correlated outcomes appear at all.
        assert set(counts) == {"00", "11"}
        assert sum(counts.values()) == 512

    def test_is_reproducible_with_a_seed(self) -> None:
        sampled = circuit(
            1, operations=[gate("op_0", "h", ["q_0"]), measure("op_1", "q_0", 0)]
        )
        backend = get_backend()

        first = backend.sample(sampled, shots=256, seed=42).counts
        second = backend.sample(sampled, shots=256, seed=42).counts

        assert first == second

    def test_refuses_a_circuit_with_nothing_measured(self) -> None:
        with pytest.raises(UnsupportedOperationError, match="measurement"):
            get_backend().sample(
                circuit(1, operations=[gate("op_0", "h", ["q_0"])]), shots=8
            )

    def test_refuses_a_shot_count_below_one(self) -> None:
        with pytest.raises(UnsupportedOperationError, match="shots"):
            get_backend().sample(
                circuit(
                    1,
                    operations=[
                        gate("op_0", "h", ["q_0"]),
                        measure("op_1", "q_0", 0),
                    ],
                ),
                shots=0,
            )

    def test_refuses_two_registers_rather_than_inventing_a_correlation(self) -> None:
        """The sampler reports each register separately and does not correlate
        them. Joining would fabricate a measurement it never made, so this is
        refused until there is a correct way to do it."""
        two = circuit(
            2,
            registers=2,
            operations=[
                gate("op_0", "h", ["q_0"]),
                measure("op_1", "q_0", 0, register="c_0"),
                measure("op_2", "q_1", 0, register="c_1"),
            ],
        )

        with pytest.raises(UnsupportedOperationError, match="one classical register"):
            get_backend().sample(two, shots=8, seed=1)


class TestCapabilities:
    def test_covers_every_gate_in_the_shared_spec(self) -> None:
        """Checked against the generated spec, never a hand-written list.

        A gate added to circuit.spec.json fails here rather than at runtime
        with an AttributeError -- the same guarantee editor/glyphs.ts gets from
        typing its table as a total Record.
        """
        assert set(GATE_METHODS) == set(GATE_SIGNATURES)
        assert get_backend().capabilities().supported_gates == frozenset(GateName)

    def test_declares_its_own_limit(self) -> None:
        capabilities = get_backend().capabilities()

        assert capabilities.name == "qiskit"
        assert capabilities.max_qubits == MAX_QUBITS
        assert capabilities.supports_statevector
        assert capabilities.supports_sampling


class TestRegistry:
    def test_finds_qiskit(self) -> None:
        assert "qiskit" in available_backends()

    def test_defaults_to_the_first_available_backend(self) -> None:
        assert get_backend().capabilities().name == "qiskit"

    def test_names_what_is_registered_when_asked_for_something_unknown(self) -> None:
        with pytest.raises(BackendUnavailableError, match="qiskit"):
            get_backend("cirq")

    def test_reports_a_registered_backend_whose_dependency_is_missing(self) -> None:
        """The condition an optional extra makes ordinary: registered, absent."""
        register("absent", lambda: False, QiskitBackend)
        try:
            with pytest.raises(BackendUnavailableError, match="not installed"):
                get_backend("absent")
        finally:
            from phasor_workbench.simulation.registry import _CANDIDATES

            _CANDIDATES.pop("absent", None)


class TestIsolation:
    def test_nothing_outside_the_adapter_imports_qiskit(self) -> None:
        """The property that makes the backend swappable.

        Asserted rather than trusted, because it is invisible until the day a
        second backend is added and a stray import has to be chased down.

        Matches import *statements*, not the word: every module here is free to
        mention Qiskit in prose, and an earlier version of this test failed on
        a docstring saying "nothing here imports Qiskit".
        """
        import re
        from pathlib import Path

        imports = re.compile(r"^\s*(?:from|import)\s+qiskit\b", re.MULTILINE)
        source = Path(__file__).resolve().parents[1] / "src" / "phasor_workbench"

        offenders = sorted(
            path.relative_to(source).as_posix()
            for path in source.rglob("*.py")
            if path.name != "qiskit_backend.py"
            and imports.search(path.read_text(encoding="utf-8"))
        )

        assert offenders == []
