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
from ...config import settings
from ...exporters.qasm import export_qasm
from ...importers.qasm import QasmError, QasmProblem, parse_qasm
from ..documents import read_circuit
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


class QasmImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: str


class CircuitDocumentResponse(BaseModel):
    """The imported circuit, in the same wire form every other endpoint takes.

    Serialized from the parsed `Circuit` rather than handed back as the parser's
    raw document, so what a client receives is what survived loading and
    validation -- not merely what the parser proposed.
    """

    circuit: dict[str, Any]


@router.post(
    "/circuits/import/qasm",
    response_model=CircuitDocumentResponse,
    summary="OpenQASM 2.0 to Circuit Model",
)
def post_import_qasm(request: QasmImportRequest) -> CircuitDocumentResponse:
    """Read OpenQASM 2.0 into a circuit document.

    Two distinct failures, and they are deliberately different codes. Source
    this build cannot *read* is `REQUEST_MALFORMED`, because the payload is
    what is wrong and there is no circuit yet. Source that reads cleanly but
    describes an illegal circuit is `CIRCUIT_INVALID`, and arrives free from
    `read_circuit` with the model's own violation codes -- a measurement
    followed by a gate is a real circuit error, not a parse error, and saying so
    is the difference between "your file is broken" and "your circuit is".
    """
    if len(request.source) > settings.max_qasm_characters:
        raise ApiError(
            code=ErrorCode.LIMIT_EXCEEDED,
            message=(
                f"OpenQASM source is limited to "
                f"{settings.max_qasm_characters} characters."
            ),
            status_code=413,
        )

    try:
        result = parse_qasm(request.source)
    except QasmError as error:
        raise unreadable_qasm([error.problem]) from error

    if result.problems:
        raise unreadable_qasm(result.problems)

    return CircuitDocumentResponse(
        circuit=read_circuit(result.document).model_dump(by_alias=True, mode="json")
    )


class QasmExportResponse(BaseModel):
    source: str


@router.post(
    "/circuits/export/qasm",
    response_model=QasmExportResponse,
    summary="Circuit Model to OpenQASM 2.0",
    responses={422: {"description": "The circuit is not valid."}},
)
def post_export_qasm(request: CircuitRequest) -> QasmExportResponse:
    """Write a circuit document as OpenQASM 2.0.

    The body is a raw document for the same reason `/circuits/analyze` takes
    one: `read_circuit` owns the version decision, and a document that fails it
    has no business being written out. Exporting an invalid circuit would
    produce a file describing something the model says cannot exist.

    There is no export-specific failure below that. Every valid circuit has an
    OpenQASM form -- the model's gate set is a subset of `qelib1.inc` -- so once
    the document loads, this cannot fail. The asymmetry with import is real: a
    QASM file can say things the model cannot hold, and the model cannot say
    anything QASM will not take.
    """
    return QasmExportResponse(source=export_qasm(read_circuit(request.circuit)))


def unreadable_qasm(problems: list[QasmProblem]) -> ApiError:
    """Map QASM problems into the one error envelope docs/API.md defines.

    `path` carries a line and column rather than a JSON pointer, because that is
    where the problem is: there is no document to point into. Documented in
    API.md so a client is not left inferring the shape from examples.
    """
    return ApiError(
        code=ErrorCode.REQUEST_MALFORMED,
        message="The OpenQASM source could not be imported.",
        status_code=400,
        details=[
            ErrorDetail(
                code=problem.code, message=problem.message, path=problem.location
            )
            for problem in problems
        ],
    )
