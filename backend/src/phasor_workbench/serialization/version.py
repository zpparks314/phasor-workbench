"""Reading the declared version and deciding what it implies.

ADR-0006 section 1: the declared version selects a *mode*; the content still
decides the outcome. Everything here happens before a validator sees the
document, which is why the schema never has to relax its strictness.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum
from typing import Final

from ..models.spec import SCHEMA_VERSION, ViolationCode
from ..validation.violations import Violation

_SEMVER = re.compile(r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$")

VERSION_PATH = "schemaVersion"


class LoadMode(StrEnum):
    """How strictly the document is read once its version is known."""

    STRICT = "strict"
    """The schema applies as written. An unknown field is an error."""

    TOLERANT = "tolerant"
    """Unknown *fields* are stripped and preserved. Unknown content is not."""


@dataclass(frozen=True, slots=True, order=True)
class Version:
    """A semantic version, ordered by major, then minor, then patch."""

    major: int
    minor: int
    patch: int

    @classmethod
    def parse(cls, text: object) -> Version | None:
        """Return None rather than raising: a bad version is expected input."""
        if not isinstance(text, str):
            return None

        match = _SEMVER.match(text)
        if match is None:
            return None

        major, minor, patch = (int(part) for part in match.groups())
        return cls(major=major, minor=minor, patch=patch)

    def __str__(self) -> str:
        return f"{self.major}.{self.minor}.{self.patch}"


_current = Version.parse(SCHEMA_VERSION)
if _current is None:  # pragma: no cover - generation would have to be broken
    raise RuntimeError(
        f"The generated SCHEMA_VERSION is not a semantic version: {SCHEMA_VERSION!r}"
    )

#: The version this build reads and writes, from the generated spec.
CURRENT: Final[Version] = _current


@dataclass(frozen=True, slots=True)
class VersionOutcome:
    """Everything the declared version decides, before content is examined."""

    mode: LoadMode | None
    """None when the document is refused outright."""

    violations: tuple[Violation, ...] = ()
    """The refusal, or the warning that accompanies a tolerant load."""

    migrate_from: Version | None = None


def decide(declared: object, current: Version = CURRENT) -> VersionOutcome:
    """Apply the loading table in docs/CircuitModel.md to a declared version."""
    version = Version.parse(declared)

    if version is None:
        return VersionOutcome(
            mode=None,
            violations=(
                Violation(
                    code=ViolationCode.SCHEMA_VERSION_MALFORMED,
                    message=(
                        "schemaVersion must be a semantic version such as "
                        f"'{current}'. Got {declared!r}."
                    ),
                    path=VERSION_PATH,
                ),
            ),
        )

    if version.major > current.major:
        return VersionOutcome(
            mode=None,
            violations=(
                Violation(
                    code=ViolationCode.SCHEMA_VERSION_UNSUPPORTED,
                    message=(
                        f"This circuit declares version {version}, and this build "
                        f"reads {current}. A major version change renames, removes, "
                        "or redefines fields, so the document cannot be read."
                    ),
                    path=VERSION_PATH,
                ),
            ),
        )

    if version > current:
        # Same major, newer minor or patch. Load, but expect not to understand
        # everything -- and say so.
        return VersionOutcome(
            mode=LoadMode.TOLERANT,
            violations=(
                Violation(
                    code=ViolationCode.SCHEMA_VERSION_NEWER_MINOR,
                    message=(
                        f"This circuit declares version {version} and this build "
                        f"reads {current}. Fields this build does not recognize are "
                        "preserved but ignored."
                    ),
                    path=VERSION_PATH,
                ),
            ),
        )

    return VersionOutcome(
        mode=LoadMode.STRICT,
        migrate_from=version if version < current else None,
    )
