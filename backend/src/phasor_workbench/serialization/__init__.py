"""Reading and writing circuit documents across versions.

Implements ADR-0006. The declared version selects a mode, the content decides the
outcome, and nothing here relaxes the schema -- `schemaVersion` is a top-level
string, so the version is known before a validator sees the document.

    load_circuit(document) -> LoadResult | LoadFailure

**Backend-only in Milestone 2**, deliberately. A frontend loader reads a circuit
the frontend did not build, which is the runtime shape validation ADR-0005
section 6 deferred to Milestone 3's local save; the loader is what makes that
question come due. The backend needs this regardless, because it cannot trust its
input.

Writing takes a `LoadResult`, not a bare `Circuit`. A caller that loads a
newer-minor document, keeps the circuit, and writes it back drops every field this
build did not recognize -- which is how a round-trip guarantee dies in a real
request handler. `dump_result` is the round-trip path and `dump_circuit` is for
circuits this build authored, where there is nothing to preserve.
"""

from __future__ import annotations

from collections.abc import Mapping

from pydantic import ValidationError

from ..models.circuit import Circuit
from ..models.spec import ViolationCode
from ..validation.violations import Violation
from . import migrations, paths, unknown
from .migrations import MIGRATIONS, Document, Migration
from .result import LoadFailure, LoadResult
from .unknown import PreservedField
from .version import CURRENT, LoadMode, Version, decide

__all__ = [
    "CURRENT",
    "LoadFailure",
    "LoadMode",
    "LoadResult",
    "PreservedField",
    "Version",
    "dump_circuit",
    "dump_result",
    "load_circuit",
]


def load_circuit(
    document: object,
    *,
    current: Version = CURRENT,
    registry: Mapping[Version, Migration] = MIGRATIONS,
) -> LoadResult | LoadFailure:
    """Read a circuit document, honouring the version it declares."""
    if not isinstance(document, dict):
        return LoadFailure(
            (
                Violation(
                    code=ViolationCode.SHAPE_INVALID,
                    message=(
                        "A circuit document must be a JSON object, got "
                        f"{type(document).__name__}."
                    ),
                    path="",
                ),
            )
        )

    working: Document = document
    outcome = decide(working.get("schemaVersion"), current)

    if outcome.mode is None:
        return LoadFailure(outcome.violations)

    migrated_from: Version | None = None
    if outcome.migrate_from is not None:
        step = migrations.migrate(
            working,
            from_version=outcome.migrate_from,
            to_version=current,
            registry=registry,
        )
        if step.violations:
            return LoadFailure(step.violations)
        working = step.document
        migrated_from = outcome.migrate_from

    preserved: tuple[PreservedField, ...] = ()

    if outcome.mode is LoadMode.TOLERANT:
        # Content first. An unknown gate or operation kind is not something
        # tolerance can absorb, and reporting it beats reporting the schema
        # failure it would otherwise cause.
        content = unknown.unknown_content(working)
        if content:
            return LoadFailure(tuple(content))

        stripped = unknown.strip_unknown_fields(working)
        if stripped.failures:
            return LoadFailure(stripped.failures)
        working = stripped.document
        preserved = stripped.preserved

    try:
        circuit = Circuit.model_validate(working)
    except ValidationError as error:
        return LoadFailure(tuple(unknown.shape_violations(working, error.errors())))

    return LoadResult(
        circuit=circuit,
        warnings=outcome.violations,
        preserved=preserved,
        migrated_from=migrated_from,
    )


def dump_circuit(circuit: Circuit) -> Document:
    """Serialize a circuit this build authored, in wire form.

    Use `dump_result` for anything that came from `load_circuit`; this drops
    preserved fields because it does not receive them.
    """
    return circuit.model_dump(mode="json", by_alias=True, exclude_none=True)


def dump_result(result: LoadResult) -> Document:
    """Serialize a loaded circuit, restoring the fields this build ignored."""
    document = dump_circuit(result.circuit)

    for preserved in result.preserved:
        paths.set_at(document, preserved.location, preserved.value)

    return document
