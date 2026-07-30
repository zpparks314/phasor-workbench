"""Invariants of the generated spec that Python's type system cannot hold.

The frontend gets most of these for free: `Readonly<Record<GateName, ...>>`
makes a missing gate a compile error, so `tsc` is that side's equivalent of
this file. Python has no such check, which is the gap these tests cover.

They do not re-test what generation already guarantees. The spec agreeing with
the schema is enforced in shared/generate_bindings.py, and the committed output
matching its source is enforced by the `Shared model` CI job.
"""

import re

import pytest

from phasor_workbench.models.circuit import GateName
from phasor_workbench.models.spec import (
    GATE_SIGNATURES,
    SCHEMA_VERSION,
    VIOLATION_PHASES,
    WARNING_CODES,
    ViolationCode,
    ViolationPhase,
)

SEMVER = re.compile(r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$")


def test_every_gate_name_has_a_signature() -> None:
    """A gate the schema accepts but the spec cannot describe is unvalidatable."""
    assert set(GATE_SIGNATURES) == set(GateName)


def test_signatures_are_immutable() -> None:
    """Validators read this table concurrently; none of them may edit it."""
    with pytest.raises(TypeError):
        GATE_SIGNATURES[GateName.h] = GATE_SIGNATURES[GateName.x]  # type: ignore[index]


@pytest.mark.parametrize("name", sorted(GateName))
def test_signature_is_self_consistent(name: GateName) -> None:
    signature = GATE_SIGNATURES[name]

    assert signature.targets >= 1
    assert signature.controls >= 0
    assert len(set(signature.parameters)) == len(signature.parameters)


def test_schema_version_is_semver() -> None:
    """It is compared against a circuit's declared version, so it must parse."""
    assert SEMVER.match(SCHEMA_VERSION)


def test_every_code_declares_a_phase() -> None:
    """A code with no phase is a code no consumer selects -- see ADR-0006.

    The frontend gets this from `Record<ViolationCode, ViolationPhase>`, where a
    missing entry is a compile error. Python has no equivalent.
    """
    assert set(VIOLATION_PHASES) == set(ViolationCode)


def test_every_phase_is_used() -> None:
    """Three phases exist because three stages report. An empty one is a mistake."""
    assert set(VIOLATION_PHASES.values()) == set(ViolationPhase)


def test_warning_codes_are_violation_codes() -> None:
    """Warnings share the code namespace with errors -- see ADR-0005."""
    errors = set(ViolationCode) - WARNING_CODES

    assert WARNING_CODES.issubset(ViolationCode)
    assert WARNING_CODES, "a namespace with no warnings needs no severity"
    assert errors, "not every code can be a warning"


def test_controlled_gates_split_their_qubits() -> None:
    """The distinction a Markdown table could not carry -- see ADR-0005 context.

    Both take two qubits; only one of them is controlled.
    """
    assert GATE_SIGNATURES[GateName.cx] == (1, 1, ())
    assert GATE_SIGNATURES[GateName.swap] == (2, 0, ())
