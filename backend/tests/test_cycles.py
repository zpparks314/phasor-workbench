"""Cycle derivation, driven by the shared fixtures.

Two kinds of test. The fixture tests pin specific decompositions, hand-computed
from ADR-0003's algorithm. The property tests assert the seven guarantees that
ADR-0003 states hold for *every* valid circuit, and run over the decomposition
fixtures and the `valid/` fixtures alike -- the latter are valid circuits, so
they are free extra inputs.

ADR-0003 is explicit that those guarantees are property tests rather than runtime
checks, which is why nothing in `phasor_workbench.cycles` re-checks them.

A failing fixture is never repaired by accepting the new output. Either an
implementation is wrong or ADR-0003 has changed, and the second requires an ADR
revision.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from phasor_workbench.cycles import Decomposition, derive_cycles
from phasor_workbench.models import Operation
from phasor_workbench.models.circuit import (
    BarrierOperation,
    Circuit,
    GateOperation,
    MeasurementOperation,
)
from phasor_workbench.validation import validate_circuit

FIXTURES = Path(__file__).resolve().parents[2] / "shared" / "fixtures"
DECOMPOSITIONS = FIXTURES / "decomposition"
DECOMPOSITION = sorted(DECOMPOSITIONS.glob("*.json"))
VALID = sorted((FIXTURES / "valid").glob("*.json"))


def load(path: Path) -> dict[str, Any]:
    fixture: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    assert "description" in fixture, f"{path.name} is missing a description"
    return fixture


def circuit_of(path: Path) -> Circuit:
    return Circuit.model_validate(load(path)["circuit"])


def placements(decomposition: Decomposition) -> list[dict[str, Any]]:
    return [
        {
            "operationId": placement.operation_id,
            "beforeCycle": placement.before_cycle,
            "qubits": list(placement.qubits),
        }
        for placement in decomposition.barriers
    ]


def resources_of(operation: Operation) -> set[tuple[str, ...]]:
    """Namespaced resource keys, for the contention property only."""
    if isinstance(operation, GateOperation):
        return {("qubit", q) for q in (*operation.targets, *operation.controls)}

    if isinstance(operation, MeasurementOperation):
        target = operation.classical_target
        return {("qubit", operation.targets[0])} | {
            ("bit", target.register_, str(target.bit))
        }

    return {("qubit", q) for q in operation.targets}


def test_fixtures_exist() -> None:
    assert DECOMPOSITION
    assert VALID


# --- fixture tests -------------------------------------------------------


@pytest.mark.parametrize("path", DECOMPOSITION, ids=lambda p: p.stem)
def test_fixture_decomposition_matches(path: Path) -> None:
    fixture = load(path)
    expected = fixture["decomposition"]

    result = derive_cycles(circuit_of(path))

    assert result.sorted_cycles() == expected["cycles"]
    assert placements(result) == expected["barriers"]
    assert result.depth == expected["depth"]


@pytest.mark.parametrize("path", DECOMPOSITION, ids=lambda p: p.stem)
def test_decomposition_fixture_is_a_valid_circuit(path: Path) -> None:
    """The derivation assumes validity, so a fixture violating it proves nothing."""
    result = validate_circuit(circuit_of(path))

    assert result.is_valid, f"{path.name} is not a valid circuit: {result.codes()}"


def test_reordering_invariance() -> None:
    """ADR-0003 property 6, and the reason depth is objective.

    Two linear extensions of one dependency ordering, decomposed identically.
    """
    first = derive_cycles(circuit_of(DECOMPOSITIONS / "reordering_invariance_a.json"))
    second = derive_cycles(circuit_of(DECOMPOSITIONS / "reordering_invariance_b.json"))

    assert first.sorted_cycles() == second.sorted_cycles()
    assert first.depth == second.depth


def test_an_inert_barrier_does_not_change_depth() -> None:
    """A barrier occupies no cycle of its own.

    In the Bell state the frontier is already level where the barrier sits, so
    the barrier constrains nothing and depth is 3 either way.
    """
    annotated = derive_cycles(circuit_of(DECOMPOSITIONS / "bell_state.json"))
    bare = derive_cycles(circuit_of(DECOMPOSITIONS / "bell_state_without_barrier.json"))

    assert annotated.depth == bare.depth
    assert annotated.sorted_cycles() == bare.sorted_cycles()
    assert len(annotated.barriers) == 1
    assert bare.barriers == ()


def test_a_constraining_barrier_does_delay_operations() -> None:
    """The necessary counterpart, and the reason barriers exist at all.

    What ADR-0003 guarantees is that a barrier contributes no cycle *of its own*
    -- not that adding one can never change depth. A barrier levelling an unequal
    frontier delays every later operation on those qubits, and that is visible in
    the depth. Anything else would make barriers inert in all cases and therefore
    pointless.
    """
    fixture = load(DECOMPOSITIONS / "barrier_levels_unequal_frontiers.json")
    document = fixture["circuit"]
    without = {
        **document,
        "operations": [
            operation
            for operation in document["operations"]
            if operation["kind"] != "barrier"
        ],
    }

    annotated = derive_cycles(Circuit.model_validate(document))
    bare = derive_cycles(Circuit.model_validate(without))

    assert annotated.depth == 3
    assert bare.depth == 2
    assert annotated.barriers[0].before_cycle == 2


def test_trailing_barrier_reports_the_edge() -> None:
    result = derive_cycles(circuit_of(DECOMPOSITIONS / "trailing_barrier.json"))

    assert result.barriers[0].before_cycle == result.depth


# --- properties, over every circuit available ----------------------------

EVERY_CIRCUIT = DECOMPOSITION + VALID


@pytest.mark.parametrize("path", EVERY_CIRCUIT, ids=lambda p: p.stem)
def test_derivation_is_pure(path: Path) -> None:
    """Property 1. Same circuit, same decomposition, every time."""
    circuit = circuit_of(path)

    assert derive_cycles(circuit) == derive_cycles(circuit)


@pytest.mark.parametrize("path", EVERY_CIRCUIT, ids=lambda p: p.stem)
def test_no_intra_cycle_contention(path: Path) -> None:
    """Property 2. The invariant a stored-cycle model would have to enforce."""
    circuit = circuit_of(path)
    by_id = {operation.id: operation for operation in circuit.operations}

    for index, cycle in enumerate(derive_cycles(circuit).cycles):
        claimed: set[tuple[str, ...]] = set()
        for operation_id in cycle:
            resources = resources_of(by_id[operation_id])
            overlap = claimed & resources
            assert not overlap, f"cycle {index} contends for {sorted(overlap)}"
            claimed |= resources


@pytest.mark.parametrize("path", EVERY_CIRCUIT, ids=lambda p: p.stem)
def test_cycles_are_contiguous_and_non_empty(path: Path) -> None:
    """Property 3. No gaps, no empty cycles, and depth agrees with the count."""
    result = derive_cycles(circuit_of(path))

    for index, cycle in enumerate(result.cycles):
        assert cycle, f"cycle {index} is empty"

    assert result.depth == len(result.cycles)


@pytest.mark.parametrize("path", EVERY_CIRCUIT, ids=lambda p: p.stem)
def test_every_operation_is_placed_exactly_once(path: Path) -> None:
    """Totality, and that barriers stay out of the cycles.

    A barrier is not a physical operation; it appears in `barriers` and nowhere
    else, which is what keeps it out of gate counts and out of the depth.
    """
    circuit = circuit_of(path)
    result = derive_cycles(circuit)

    placed = [operation_id for cycle in result.cycles for operation_id in cycle]
    barriers = [
        operation.id
        for operation in circuit.operations
        if isinstance(operation, BarrierOperation)
    ]
    scheduled = [
        operation.id
        for operation in circuit.operations
        if not isinstance(operation, BarrierOperation)
    ]

    assert sorted(placed) == sorted(scheduled)
    assert len(placed) == len(set(placed))
    assert [placement.operation_id for placement in result.barriers] == barriers


@pytest.mark.parametrize("path", EVERY_CIRCUIT, ids=lambda p: p.stem)
def test_barrier_placements_are_within_the_circuit(path: Path) -> None:
    """A barrier sits before a real cycle boundary, or on the trailing edge."""
    result = derive_cycles(circuit_of(path))

    for placement in result.barriers:
        assert 0 <= placement.before_cycle <= result.depth
        assert placement.qubits
