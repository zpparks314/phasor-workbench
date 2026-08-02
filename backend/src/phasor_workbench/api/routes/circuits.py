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
from ..documents import read_circuit

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
    analysis = analyze_circuit(read_circuit(request.circuit))

    return AnalysisResponse(
        qubit_count=analysis.qubit_count,
        gate_count=analysis.gate_count,
        measurement_count=analysis.measurement_count,
        depth=analysis.depth,
        gate_breakdown={
            name.value: count for name, count in analysis.gate_breakdown.items()
        },
    )
