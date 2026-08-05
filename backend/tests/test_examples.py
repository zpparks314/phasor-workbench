"""The built-in example catalogue.

Milestone 5's exit criterion is that examples "load, validate without
violations, and simulate". All three are asserted here, and the third is not a
formality.

**The first QFT written for this catalogue validated cleanly and was wrong.** It
was built the textbook way, with qubit 0 as the most significant bit, where this
project fixes qubit 0 as the rightmost. It produced the correct uniform
distribution from `|000>` -- so any test checking "eight equal outcomes" would
have passed -- and the wrong state for every other input. Only comparing
amplitudes against the analytic transform caught it. That is why the checks below
assert on states rather than on shapes.
"""

from __future__ import annotations

import cmath
import math

import pytest

from phasor_workbench.api.documents import read_circuit
from phasor_workbench.examples import (
    REQUIRED_FIELDS,
    Example,
    catalogue,
    find,
    read_fields,
)
from phasor_workbench.simulation import available_backends, get_backend
from phasor_workbench.validation import validate_circuit

EXAMPLES = catalogue()

#: Scoped to the state checks rather than the module. Loading and validating an
#: example must be asserted on a default install, where the simulation extra is
#: absent -- that is most of the exit criterion and it needs no simulator.
needs_simulator = pytest.mark.skipif(
    "qiskit" not in available_backends(),
    reason="the simulation extra is not installed",
)


def amplitudes(example: Example) -> list[complex]:
    return [
        complex(a)
        for a in get_backend()
        .simulate_statevector(read_circuit(example.document()))
        .amplitudes
    ]


def probabilities(example: Example) -> dict[str, float]:
    """Outcome probabilities keyed by basis string, qubit 0 rightmost."""
    values = amplitudes(example)
    width = len(read_circuit(example.document()).qubits)

    return {
        format(index, f"0{width}b"): abs(value) ** 2
        for index, value in enumerate(values)
        if abs(value) ** 2 > 1e-9
    }


def test_the_catalogue_is_not_empty() -> None:
    """A directory scan can return nothing, and a suite over nothing passes."""
    assert len(EXAMPLES) >= 6


def test_ids_are_unique() -> None:
    assert len({example.id for example in EXAMPLES}) == len(EXAMPLES)


def test_the_catalogue_is_ordered() -> None:
    """A picker whose order changes between requests cannot be learned."""
    assert [example.id for example in EXAMPLES] == sorted(
        example.id for example in EXAMPLES
    )


@pytest.mark.parametrize("example", EXAMPLES, ids=lambda example: example.id)
def test_every_example_declares_its_metadata(example: Example) -> None:
    """Adding a file is the whole registration step, so the file must carry it."""
    fields = read_fields(example.source)

    for field in REQUIRED_FIELDS:
        assert fields.get(field), f"'{example.id}' is missing // {field}:"


@pytest.mark.parametrize("example", EXAMPLES, ids=lambda example: example.id)
def test_every_example_loads_and_validates(example: Example) -> None:
    """Through the importer, exactly as an uploaded file would."""
    circuit = read_circuit(example.document())

    assert list(validate_circuit(circuit).violations) == []
    assert circuit.operations


def test_find_returns_none_for_an_unknown_id() -> None:
    assert find("no-such-example") is None


def test_find_returns_the_named_example() -> None:
    found = find("bell-state")

    assert found is not None
    assert found.name == "Bell State"


# --- What each example is supposed to produce -----------------------------
#
# Asserted as states, not shapes. See the module docstring.


@needs_simulator
def test_bell_state_is_correlated_and_nothing_else() -> None:
    outcomes = probabilities(find_or_fail("bell-state"))

    assert set(outcomes) == {"00", "11"}
    assert outcomes["00"] == pytest.approx(0.5)


@needs_simulator
def test_ghz_state_agrees_across_three_qubits() -> None:
    outcomes = probabilities(find_or_fail("ghz-state"))

    assert set(outcomes) == {"000", "111"}
    assert outcomes["111"] == pytest.approx(0.5)


@needs_simulator
def test_grover_finds_the_marked_state_with_certainty() -> None:
    """One round is exact for two qubits, so this is 1.0 and not 'mostly'."""
    outcomes = probabilities(find_or_fail("grover-two-qubit"))

    assert outcomes == pytest.approx({"11": 1.0})


@needs_simulator
def test_deutsch_jozsa_never_answers_constant() -> None:
    """The oracle is balanced, so the input register is never all zeros.

    The answer qubit is q[2] and is left in |->, so it is random; the claim is
    about the two input qubits, which are the rightmost two bits.
    """
    inputs = {basis[-2:] for basis in probabilities(find_or_fail("deutsch-jozsa"))}

    assert inputs == {"11"}


@needs_simulator
def test_bernstein_vazirani_recovers_the_secret() -> None:
    """The secret is 101, and one query settles it."""
    inputs = {basis[-3:] for basis in probabilities(find_or_fail("bernstein-vazirani"))}

    assert inputs == {"101"}


@needs_simulator
def test_qft_matches_the_analytic_transform_for_every_input() -> None:
    """The check the first draft of this example failed.

    Prepared inputs are made by prefixing `x` gates to the source, so the
    example itself is what is under test rather than a reconstruction of it.
    """
    example = find_or_fail("qft-three-qubit")
    width = 3

    for value in range(2**width):
        prepared = Example(
            id=example.id,
            name=example.name,
            summary=example.summary,
            source=example.source.replace(
                "qreg q[3];\n",
                "qreg q[3];\n"
                + "".join(f"x q[{q}];\n" for q in range(width) if value >> q & 1),
                1,
            ),
        )

        for outcome, amplitude in enumerate(amplitudes(prepared)):
            expected = cmath.exp(2j * math.pi * value * outcome / 2**width) / math.sqrt(
                2**width
            )

            assert amplitude == pytest.approx(expected, abs=1e-9), (
                f"QFT of |{value}> is wrong at |{outcome}>"
            )


def find_or_fail(identifier: str) -> Example:
    example = find(identifier)
    assert example is not None, f"example '{identifier}' is missing"

    return example
