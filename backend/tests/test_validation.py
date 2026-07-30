"""Semantic validation, driven by the shared fixtures.

Every case lives in shared/fixtures/ rather than inline, because
frontend/src/validation/ must agree with this implementation and a fixture is
the only artifact both can read. Each fixture declares the codes it expects; a
suite that asserts against that declaration on both sides makes the two agree
transitively, without either needing to see the other's output.

A failing fixture is never repaired by editing its declaration to match new
output.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from phasor_workbench.models.circuit import Circuit
from phasor_workbench.models.spec import WARNING_CODES, ViolationCode
from phasor_workbench.validation import validate_circuit

FIXTURES = Path(__file__).resolve().parents[2] / "shared" / "fixtures"
VALID = sorted((FIXTURES / "valid").glob("*.json"))
INVALID = sorted((FIXTURES / "invalid" / "semantic").glob("*.json"))

# SHAPE_INVALID belongs to the parse boundary, not to this module, and warnings
# are produced by the version-aware loader, which is not written yet.
SEMANTIC_CODES = {
    code for code in ViolationCode if code is not ViolationCode.SHAPE_INVALID
} - set(WARNING_CODES)


def load(path: Path) -> dict[str, Any]:
    fixture: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))

    missing = {"description", "circuit"} - set(fixture)
    assert not missing, f"{path.name} is missing {sorted(missing)}"

    return fixture


def declared_codes(path: Path) -> list[str]:
    codes = load(path)["violations"]
    assert isinstance(codes, list), f"{path.name} must declare a list of codes"
    return sorted(codes)


def test_fixtures_exist() -> None:
    """A glob that silently matches nothing would make every test below pass."""
    assert VALID
    assert INVALID


@pytest.mark.parametrize("path", VALID, ids=lambda p: p.stem)
def test_valid_fixture_is_accepted(path: Path) -> None:
    circuit = Circuit.model_validate(load(path)["circuit"])

    result = validate_circuit(circuit)

    assert result.is_valid, f"unexpected violations: {result.codes()}"
    assert result.violations == ()


@pytest.mark.parametrize("path", INVALID, ids=lambda p: p.stem)
def test_invalid_fixture_produces_declared_codes(path: Path) -> None:
    fixture = load(path)
    circuit = Circuit.model_validate(fixture["circuit"])

    result = validate_circuit(circuit)

    assert result.codes() == declared_codes(path)
    assert not result.is_valid


@pytest.mark.parametrize("path", INVALID, ids=lambda p: p.stem)
def test_every_violation_is_located(path: Path) -> None:
    """A violation with no path cannot be rendered against the document."""
    circuit = Circuit.model_validate(load(path)["circuit"])

    for violation in validate_circuit(circuit).violations:
        assert violation.path
        assert violation.message.endswith(".")


def test_every_semantic_code_has_a_fixture() -> None:
    """Adding a code without a fixture leaves a rule untested in both languages."""
    covered = {code for path in INVALID for code in declared_codes(path)}

    uncovered = sorted(code.value for code in SEMANTIC_CODES)
    assert set(uncovered) - covered == set(), (
        f"codes with no fixture: {sorted(set(uncovered) - covered)}"
    )


def test_declared_codes_are_real() -> None:
    """A fixture may not invent a code -- see shared/README.md."""
    known = {code.value for code in ViolationCode}

    for path in INVALID:
        unknown = set(declared_codes(path)) - known
        assert not unknown, f"{path.name} declares unknown codes: {sorted(unknown)}"


def test_paths_use_wire_names_not_python_names() -> None:
    """`classical_target` is the Python attribute; the client sent camelCase."""
    fixture = load(
        FIXTURES / "invalid" / "semantic" / "classical_bit_out_of_range.json"
    )
    circuit = Circuit.model_validate(fixture["circuit"])

    violation = validate_circuit(circuit).violations[0]

    assert violation.path == "operations[0].classicalTarget.bit"


def test_unresolved_register_suppresses_the_bit_check() -> None:
    """One mistake is one violation, not a cascade."""
    fixture = load(
        FIXTURES / "invalid" / "semantic" / "unknown_register_reference.json"
    )
    circuit = Circuit.model_validate(fixture["circuit"])

    assert validate_circuit(circuit).codes() == ["UNKNOWN_REGISTER_REFERENCE"]
