"""The version-aware loader, driven by the shared version fixtures.

Fixtures pair a *document* rather than a circuit, because several of them are not
circuits: one is a JSON array, and others declare versions that have never
existed. Each declares the outcome, the codes, and the paths it expects to be
preserved.

The migration registry ships empty, so the migration tests inject a synthetic one.
That is the point of deciding the registry's shape before a real migration exists.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from phasor_workbench.models.spec import (
    VIOLATION_PHASES,
    ViolationCode,
    ViolationPhase,
)
from phasor_workbench.serialization import (
    CURRENT,
    LoadFailure,
    LoadResult,
    Version,
    dump_circuit,
    dump_result,
    load_circuit,
)
from phasor_workbench.serialization.migrations import Document, Migration
from phasor_workbench.serialization.version import LoadMode, decide

FIXTURES = Path(__file__).resolve().parents[2] / "shared" / "fixtures" / "version"
VERSION_FIXTURES = sorted(FIXTURES.glob("*.json"))

LOAD_CODES = {
    code for code, phase in VIOLATION_PHASES.items() if phase is ViolationPhase.LOAD
}


def load_fixture(path: Path) -> dict[str, Any]:
    fixture: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))

    missing = {"description", "document", "outcome"} - set(fixture)
    assert not missing, f"{path.name} is missing {sorted(missing)}"
    assert fixture["outcome"] in {"loaded", "refused"}, path.name

    return fixture


def codes_of(result: LoadResult | LoadFailure) -> list[str]:
    violations = (
        result.violations if isinstance(result, LoadFailure) else result.warnings
    )
    return sorted(violation.code.value for violation in violations)


def test_fixtures_exist() -> None:
    assert VERSION_FIXTURES


@pytest.mark.parametrize("path", VERSION_FIXTURES, ids=lambda p: p.stem)
def test_fixture_outcome(path: Path) -> None:
    fixture = load_fixture(path)

    result = load_circuit(fixture["document"])

    expected = fixture["outcome"]
    assert isinstance(result, LoadResult if expected == "loaded" else LoadFailure), (
        f"expected {expected}, got {type(result).__name__} with {codes_of(result)}"
    )
    assert codes_of(result) == sorted(fixture["violations"])


@pytest.mark.parametrize("path", VERSION_FIXTURES, ids=lambda p: p.stem)
def test_fixture_preserves_declared_fields(path: Path) -> None:
    fixture = load_fixture(path)
    result = load_circuit(fixture["document"])

    if not isinstance(result, LoadResult):
        assert "preserved" not in fixture, f"{path.name} was refused"
        return

    assert sorted(field.path for field in result.preserved) == sorted(
        fixture.get("preserved", [])
    )


@pytest.mark.parametrize("path", VERSION_FIXTURES, ids=lambda p: p.stem)
def test_every_violation_is_located_and_readable(path: Path) -> None:
    result = load_circuit(load_fixture(path)["document"])
    violations = (
        result.violations if isinstance(result, LoadFailure) else result.warnings
    )

    for violation in violations:
        assert violation.message.endswith(".")
        # An empty path means "the whole document", which only the not-an-object
        # case may claim.
        assert violation.path or path.stem == "document_is_not_an_object"


def test_every_load_code_has_a_fixture() -> None:
    """The `phase` field is what makes this selectable -- see ADR-0006."""
    declared = {
        code for path in VERSION_FIXTURES for code in load_fixture(path)["violations"]
    }

    uncovered = sorted(code.value for code in LOAD_CODES if code.value not in declared)
    assert not uncovered, f"load codes with no fixture: {uncovered}"


def test_declared_codes_are_real() -> None:
    known = {code.value for code in ViolationCode}

    for path in VERSION_FIXTURES:
        unknown = set(load_fixture(path)["violations"]) - known
        assert not unknown, f"{path.name} declares unknown codes: {sorted(unknown)}"


# --- round trip ----------------------------------------------------------


def loaded(name: str) -> LoadResult:
    result = load_circuit(load_fixture(FIXTURES / f"{name}.json")["document"])
    assert isinstance(result, LoadResult)
    return result


def test_dump_result_restores_preserved_fields() -> None:
    result = loaded("newer_minor_unknown_field_in_operation")

    document = dump_result(result)
    operations = document["operations"]

    assert isinstance(operations, list)
    assert operations[0]["duration"] == 42


def test_dump_result_restores_a_preserved_metadata_key() -> None:
    result = loaded("newer_minor_unknown_metadata")

    metadata = dump_result(result)["metadata"]

    assert isinstance(metadata, dict)
    assert metadata["mood"] == "calm"
    assert metadata["description"] == "a circuit"


def test_dump_circuit_drops_preserved_fields() -> None:
    """The documented data-loss path, pinned so it stays deliberate.

    ADR-0006 makes the right thing easy rather than making this impossible.
    """
    result = loaded("newer_minor_unknown_field")

    assert "flavor" in dump_result(result)
    assert "flavor" not in dump_circuit(result.circuit)


def test_a_round_trip_survives_every_unknown_field() -> None:
    fixture = load_fixture(FIXTURES / "newer_minor_several_unknown_fields.json")
    result = load_circuit(fixture["document"])
    assert isinstance(result, LoadResult)

    document = dump_result(result)

    assert document["flavor"] == "vanilla"
    assert document["tempo"] == 120
    qubits = document["qubits"]
    assert isinstance(qubits, list)
    assert qubits[0]["colour"] == "blue"


def test_loading_does_not_mutate_the_caller_document() -> None:
    fixture = load_fixture(FIXTURES / "newer_minor_unknown_field.json")
    document = fixture["document"]
    before = json.dumps(document, sort_keys=True)

    load_circuit(document)

    assert json.dumps(document, sort_keys=True) == before


# --- paths ---------------------------------------------------------------


def test_shape_paths_drop_the_union_tag() -> None:
    """Pydantic reports the union branch it matched; the document has no such key.

    A barrier carrying `controls` reports at ('operations', 0, 'barrier',
    'controls'). Formatting that verbatim would point the client at a field it
    never sent.
    """
    document = {
        "schemaVersion": str(CURRENT),
        "id": "circ_1",
        "qubits": [{"id": "q_0", "index": 0}],
        "classicalRegisters": [],
        "operations": [
            {
                "id": "op_0",
                "kind": "barrier",
                "targets": ["q_0"],
                "controls": ["q_0"],
            }
        ],
    }

    result = load_circuit(document)

    assert isinstance(result, LoadFailure)
    assert [v.path for v in result.violations] == ["operations[0].controls"]


# --- versions ------------------------------------------------------------


def test_versions_order_by_component() -> None:
    assert Version(0, 1, 0) < Version(0, 2, 0) < Version(1, 0, 0)
    assert Version(0, 1, 9) < Version(0, 2, 0)


@pytest.mark.parametrize("text", ["1", "1.0", "1.0.0.0", "01.0.0", "v1.0.0", "", None])
def test_malformed_versions_do_not_parse(text: object) -> None:
    assert Version.parse(text) is None


def test_mode_selection() -> None:
    current = Version(0, 1, 0)

    assert decide("0.1.0", current).mode is LoadMode.STRICT
    assert decide("0.2.0", current).mode is LoadMode.TOLERANT
    assert decide("0.1.1", current).mode is LoadMode.TOLERANT
    assert decide("1.0.0", current).mode is None
    assert decide("0.0.9", current).mode is LoadMode.STRICT
    assert decide("0.0.9", current).migrate_from == Version(0, 0, 9)


# --- migrations ----------------------------------------------------------


def bump_to(version: str) -> Migration:
    def migration(document: Document) -> Document:
        return {**document, "schemaVersion": version}

    return migration


def test_a_registered_migration_brings_a_document_forward() -> None:
    document = load_fixture(FIXTURES / "version_older_without_migration.json")[
        "document"
    ]

    result = load_circuit(document, registry={Version(0, 0, 9): bump_to("0.1.0")})

    assert isinstance(result, LoadResult)
    assert result.migrated_from == Version(0, 0, 9)
    assert result.warnings == ()


def test_migrations_chain_one_step_at_a_time() -> None:
    document = {
        **load_fixture(FIXTURES / "version_older_without_migration.json")["document"],
        "schemaVersion": "0.0.8",
    }

    result = load_circuit(
        document,
        registry={
            Version(0, 0, 8): bump_to("0.0.9"),
            Version(0, 0, 9): bump_to("0.1.0"),
        },
    )

    assert isinstance(result, LoadResult)
    assert result.migrated_from == Version(0, 0, 8)


def test_a_migration_that_does_not_advance_is_refused() -> None:
    """Otherwise the chain loops forever on a registry bug."""
    document = load_fixture(FIXTURES / "version_older_without_migration.json")[
        "document"
    ]

    result = load_circuit(document, registry={Version(0, 0, 9): bump_to("0.0.9")})

    assert isinstance(result, LoadFailure)
    assert codes_of(result) == ["SCHEMA_VERSION_MALFORMED"]


def test_a_missing_migration_is_refused_rather_than_guessed() -> None:
    document = load_fixture(FIXTURES / "version_older_without_migration.json")[
        "document"
    ]

    result = load_circuit(document, registry={})

    assert isinstance(result, LoadFailure)
    assert codes_of(result) == ["SCHEMA_VERSION_UNSUPPORTED"]
