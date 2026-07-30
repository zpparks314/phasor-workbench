"""What validation reports.

These types are deliberately independent of `api.errors`. Validation sits below
the API and must not depend on the transport envelope; the API layer maps a
`Violation` into an `ErrorDetail` on its way out. See docs/Architecture.md.

Codes come from the generated spec. Nothing here may invent one.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..models.spec import WARNING_CODES, ViolationCode


@dataclass(frozen=True, slots=True)
class Violation:
    """One defect, located within the submitted document.

    `message` is human-readable and may differ between the two implementations.
    `code` and `path` may not: fixtures compare codes, and clients branch on
    them.
    """

    code: ViolationCode
    message: str
    path: str


@dataclass(frozen=True, slots=True)
class ValidationResult:
    """Every violation found, not merely the first.

    A user fixing a circuit should not have to do it one round-trip at a time
    -- see docs/CircuitModel.md.
    """

    violations: tuple[Violation, ...] = ()

    @property
    def errors(self) -> tuple[Violation, ...]:
        return tuple(v for v in self.violations if v.code not in WARNING_CODES)

    @property
    def warnings(self) -> tuple[Violation, ...]:
        return tuple(v for v in self.violations if v.code in WARNING_CODES)

    @property
    def is_valid(self) -> bool:
        """Warnings do not invalidate a circuit; they accompany a valid one."""
        return not self.errors

    def codes(self) -> list[str]:
        """Sorted codes, for comparison against a fixture's declaration.

        Sorted rather than in report order: fixtures assert *which* violations a
        circuit produces, and coupling them to the order rules happen to run in
        would make reordering a rule a fixture change.
        """
        return sorted(violation.code.value for violation in self.violations)
