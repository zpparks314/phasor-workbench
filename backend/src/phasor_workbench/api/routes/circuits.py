"""Circuit endpoints that do not execute anything.

Analysis is here rather than under `/simulations` because it runs no circuit:
it counts what is in the document and asks `derive_cycles` for the depth. That
separation is docs/API.md's, and it is what makes this callable on every edit.

**The request body is a raw document, not a parsed `Circuit`.** It goes through
`load_circuit` for the reason ADR-0006 gives: a version claim is unverifiable
evidence, and this build cannot trust a document it did not author. Letting
FastAPI bind straight to `Circuit` would skip the version decision entirely and
give a 422 phrased in Pydantic's vocabulary rather than the model's violation
codes -- which are what the frontend already knows how to display.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field

from ...analysis import analyze_circuit
from ...models.circuit import Circuit
from ...serialization import LoadFailure, load_circuit
from ...validation import validate_circuit
from ...validation.violations import Violation
from ..errors import ApiError, ErrorCode, ErrorDetail

router = APIRouter(tags=["circuits"])


class CircuitRequest(BaseModel):
    """A circuit document, unparsed.

    `dict[str, Any]` rather than `Circuit`: this is untrusted input and the
    loader owns reading it. Typing it as `Circuit` here would move that decision
    into FastAPI's binding, where the version is never consulted.
    """

    model_config = ConfigDict(extra="forbid")

    circuit: dict[str, Any]


class AnalysisResponse(BaseModel):
    """docs/API.md's analysis body.

    camelCase on the wire, matching the circuit model's own serialization --
    one convention across the API rather than one per endpoint.
    """

    model_config = ConfigDict(populate_by_name=True)

    qubit_count: int = Field(serialization_alias="qubitCount")
    gate_count: int = Field(serialization_alias="gateCount")
    measurement_count: int = Field(serialization_alias="measurementCount")
    depth: int
    gate_breakdown: dict[str, int] = Field(serialization_alias="gateBreakdown")


@router.post(
    "/circuits/analyze",
    response_model=AnalysisResponse,
    response_model_by_alias=True,
    summary="Static analysis: counts and depth",
)
def post_analyze(request: CircuitRequest) -> AnalysisResponse:
    analysis = analyze_circuit(_read(request.circuit))

    return AnalysisResponse(
        qubit_count=analysis.qubit_count,
        gate_count=analysis.gate_count,
        measurement_count=analysis.measurement_count,
        depth=analysis.depth,
        gate_breakdown={
            name.value: count for name, count in analysis.gate_breakdown.items()
        },
    )


def _read(document: dict[str, Any]) -> Circuit:
    """Load and semantically validate, or raise the documented envelope.

    Two checks rather than one, because they answer different questions and
    ADR-0006 keeps them apart: `load_circuit` decides whether this build can
    read the document at all, and `validate_circuit` decides whether what it
    read is a legal circuit. A document can pass the first and fail the second
    -- a measurement naming a register that was never declared is perfectly
    well-shaped.

    Warnings are not errors and do not stop the analysis. A newer-minor document
    arrives as a warning precisely so it can still be used.
    """
    outcome = load_circuit(document)
    if isinstance(outcome, LoadFailure):
        raise _invalid(outcome.violations)

    errors = validate_circuit(outcome.circuit).errors
    if errors:
        raise _invalid(errors)

    return outcome.circuit


def _invalid(violations: tuple[Violation, ...]) -> ApiError:
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
