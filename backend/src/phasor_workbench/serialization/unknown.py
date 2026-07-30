"""Separating fields this build does not recognize from content it cannot read.

ADR-0006 rests on that distinction. An unknown *field* is inert: removing it and
keeping it aside loses nothing, because nothing in this build was going to read it.
An unknown *gate* or *operation kind* is not inert — the first has no signature to
validate against and no definition to execute, and the second leaves the cycle
derivation unable to extract resources, which makes the circuit's depth undefined.

Unknown-ness is decided by Pydantic rather than by a second description of the
schema. Parsing reports every `extra_forbidden` error at once, each with the exact
location, so the strict model is both the authority on what is unknown and the
thing that rejects it. There is no separate list to drift.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field

from pydantic import ValidationError
from pydantic_core import ErrorDetails

from ..models.circuit import Circuit, GateName
from ..models.spec import ViolationCode
from ..validation.violations import Violation
from . import paths

KNOWN_KINDS = frozenset({"gate", "measurement", "barrier"})

# Removing an unknown field cannot create a new one, so one pass is enough. The
# bound exists so a surprise cannot become an infinite loop.
_MAX_PASSES = 8


@dataclass(frozen=True, slots=True)
class PreservedField:
    """A field this build did not recognize, kept so a round trip does not lose it."""

    path: str
    location: paths.Location
    value: object = field(compare=False)


@dataclass(frozen=True, slots=True)
class StripResult:
    document: dict[str, object]
    preserved: tuple[PreservedField, ...] = ()
    failures: tuple[Violation, ...] = ()
    """Shape errors that are not unknown fields, so stripping cannot help."""


def strip_unknown_fields(document: dict[str, object]) -> StripResult:
    """Remove every unrecognized field, keeping it aside with its location."""
    working: dict[str, object] = _copy(document)
    preserved: list[PreservedField] = []

    for _ in range(_MAX_PASSES):
        try:
            Circuit.model_validate(working)
        except ValidationError as error:
            extra = [e for e in error.errors() if e["type"] == "extra_forbidden"]
            other = [e for e in error.errors() if e["type"] != "extra_forbidden"]

            if other:
                return StripResult(
                    document=working,
                    preserved=tuple(preserved),
                    failures=tuple(shape_violations(working, other)),
                )

            for entry in extra:
                location = paths.locate(working, entry["loc"])
                if location is None:
                    continue
                preserved.append(
                    PreservedField(
                        path=paths.to_path(location),
                        location=location,
                        value=paths.pop_at(working, location),
                    )
                )
            continue

        return StripResult(document=working, preserved=tuple(preserved))

    return StripResult(  # pragma: no cover - requires pathological input
        document=working,
        preserved=tuple(preserved),
        failures=(
            Violation(
                code=ViolationCode.SHAPE_INVALID,
                message="Gave up removing unrecognized fields after too many passes.",
                path="",
            ),
        ),
    )


def shape_violations(
    document: object, errors: Sequence[ErrorDetails]
) -> list[Violation]:
    """Turn Pydantic errors into SHAPE_INVALID violations with document paths."""
    violations: list[Violation] = []

    for entry in errors:
        location = paths.locate(document, entry["loc"])
        violations.append(
            Violation(
                code=ViolationCode.SHAPE_INVALID,
                message=f"{entry['msg']}.",
                path=paths.to_path(location) if location is not None else "",
            )
        )

    return violations


def unknown_content(document: dict[str, object]) -> list[Violation]:
    """Report gates and operation kinds this build cannot interpret.

    Only meaningful in tolerant mode. In strict mode the same defects are ordinary
    schema failures and report as SHAPE_INVALID, which is the right answer there:
    a document claiming *this* version with an unknown gate is malformed, not
    ahead of us. See ADR-0006.
    """
    operations = document.get("operations")
    if not isinstance(operations, list):
        return []

    known_gates = {name.value for name in GateName}
    violations: list[Violation] = []

    for index, operation in enumerate(operations):
        if not isinstance(operation, dict):
            continue

        kind = operation.get("kind")
        if kind not in KNOWN_KINDS:
            violations.append(
                Violation(
                    code=ViolationCode.UNKNOWN_OPERATION_KIND,
                    message=(
                        f"Operation kind {kind!r} is not one of "
                        f"{', '.join(sorted(KNOWN_KINDS))}. A newer version added it, "
                        "and this build cannot schedule an operation it does not know."
                    ),
                    path=f"operations[{index}].kind",
                )
            )
            continue

        name = operation.get("name")
        if kind == "gate" and name not in known_gates:
            violations.append(
                Violation(
                    code=ViolationCode.UNKNOWN_GATE_NAME,
                    message=(
                        f"Gate {name!r} is not in this build's gate set. A newer "
                        "version added it, and this build has neither a signature to "
                        "validate it against nor a definition to execute it."
                    ),
                    path=f"operations[{index}].name",
                )
            )

    return violations


def _copy(value: dict[str, object]) -> dict[str, object]:
    """Deep-copy the containers, so stripping never edits the caller's document."""
    return {key: _copy_value(item) for key, item in value.items()}


def _copy_value(value: object) -> object:
    if isinstance(value, dict):
        return {key: _copy_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_copy_value(item) for item in value]
    return value
