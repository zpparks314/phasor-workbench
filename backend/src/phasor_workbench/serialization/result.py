"""What loading returns.

ADR-0006 section 4. Loading yields either a `LoadResult` or a `LoadFailure`, and
the caller has to tell them apart -- which is the point. A single type with an
optional circuit would let a caller reach for `.circuit` and get `None`.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..models.circuit import Circuit
from ..validation.violations import Violation
from .unknown import PreservedField
from .version import Version


@dataclass(frozen=True, slots=True)
class LoadResult:
    """A document that loaded, with everything the loader learned about it."""

    circuit: Circuit

    warnings: tuple[Violation, ...] = ()
    """Non-fatal, and worth surfacing. A newer minor version arrives here."""

    preserved: tuple[PreservedField, ...] = ()
    """Fields this build did not recognize. Writing without these loses data."""

    migrated_from: Version | None = None


@dataclass(frozen=True, slots=True)
class LoadFailure:
    """A document that could not be read, with every reason found."""

    violations: tuple[Violation, ...]
