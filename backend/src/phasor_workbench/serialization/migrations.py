"""Bringing an older document forward, one version at a time.

ADR-0006 section 8. A migration is registered under the version it upgrades
*from*, and is responsible for setting `schemaVersion` to whatever it produces.
The document therefore describes its own progress and the chain needs no separate
table of destinations.

The registry ships **empty**: `0.1.0` is the only version that has ever existed.
Its shape is decided now and exercised by a synthetic migration in the tests,
because deciding it against zero real examples is easier than retrofitting it
around the first one.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Final

from ..models.spec import ViolationCode
from ..validation.violations import Violation
from .version import VERSION_PATH, Version

Document = dict[str, object]
Migration = Callable[[Document], Document]

MIGRATIONS: Final[Mapping[Version, Migration]] = MappingProxyType({})


@dataclass(frozen=True, slots=True)
class MigrationResult:
    document: Document
    violations: tuple[Violation, ...] = ()


def migrate(
    document: Document,
    *,
    from_version: Version,
    to_version: Version,
    registry: Mapping[Version, Migration] = MIGRATIONS,
) -> MigrationResult:
    """Apply migrations until the document reaches `to_version`."""
    current = from_version
    working = document

    while current < to_version:
        step = registry.get(current)
        if step is None:
            return MigrationResult(
                document=working,
                violations=(
                    Violation(
                        code=ViolationCode.SCHEMA_VERSION_UNSUPPORTED,
                        message=(
                            f"No migration exists from version {current} to "
                            f"{to_version}, so this document cannot be brought "
                            "forward. Migrations are explicit by design; silent "
                            "coercion is not acceptable."
                        ),
                        path=VERSION_PATH,
                    ),
                ),
            )

        working = step(working)
        produced = Version.parse(working.get(VERSION_PATH))

        # A migration that does not advance the version would loop forever, and a
        # migration that overshoots has skipped a step that may still be needed.
        if produced is None or produced <= current:
            return MigrationResult(
                document=working,
                violations=(
                    Violation(
                        code=ViolationCode.SCHEMA_VERSION_MALFORMED,
                        message=(
                            f"The migration from {current} left schemaVersion as "
                            f"{working.get(VERSION_PATH)!r}, which does not advance "
                            "past it. Every migration must set the version it "
                            "produces."
                        ),
                        path=VERSION_PATH,
                    ),
                ),
            )

        current = produced

    return MigrationResult(document=working)
