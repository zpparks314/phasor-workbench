"""Turning an untrusted request body into a `Circuit`, or into an error.

Shared by every endpoint that accepts a circuit, so they cannot drift into
treating the same document differently -- which is exactly the kind of
divergence nobody notices until one endpoint accepts what another rejects.

Lives in the API layer rather than in `serialization/` because raising an HTTP
error envelope is an API concern; the loader below it knows nothing about
status codes.
"""

from __future__ import annotations

from typing import Any

from ..models.circuit import Circuit
from ..serialization import LoadFailure, load_circuit
from ..validation import validate_circuit
from ..validation.violations import Violation
from .errors import ApiError, ErrorCode, ErrorDetail

__all__ = ["invalid_circuit", "read_circuit"]


def read_circuit(document: dict[str, Any]) -> Circuit:
    """Load and semantically validate, or raise the documented envelope.

    Two checks rather than one, because they answer different questions and
    ADR-0006 keeps them apart: `load_circuit` decides whether this build can
    read the document at all, and `validate_circuit` decides whether what it
    read is a legal circuit. A document can pass the first and fail the second
    -- a measurement naming a register that was never declared is perfectly
    well-shaped.

    Warnings are not errors and do not stop the caller. A newer-minor document
    arrives as a warning precisely so it can still be used.
    """
    outcome = load_circuit(document)
    if isinstance(outcome, LoadFailure):
        raise invalid_circuit(outcome.violations)

    errors = validate_circuit(outcome.circuit).errors
    if errors:
        raise invalid_circuit(errors)

    return outcome.circuit


def invalid_circuit(violations: tuple[Violation, ...]) -> ApiError:
    """Map violations into the single error envelope docs/API.md defines.

    Every violation, not the first: a user fixing a circuit should not have to
    do it one round trip at a time. The codes cross the wire unchanged, because
    they come from the shared spec and the frontend already knows them --
    rephrasing them here would be a second vocabulary to keep in step.
    """
    return ApiError(
        code=ErrorCode.CIRCUIT_INVALID,
        message="The circuit is not valid.",
        status_code=422,
        details=[
            ErrorDetail(
                code=violation.code.value,
                message=violation.message,
                path=violation.path,
            )
            for violation in violations
        ],
    )
