"""The built-in example catalogue.

Two endpoints rather than one, per
[ADR-0009](../../../../../docs/decisions/ADR0009_CircuitCatalogue.md): the list
carries metadata and the circuit is fetched when something is chosen. Six small
circuits would fit in one response, and the split is not about size -- it is
what lets a generated entry, which has no single circuit, join the same list
without changing its contract.

Circuits go through `read_circuit`, the same call an uploaded file makes. An
example that stopped parsing would raise rather than 404, because that is a
broken build rather than a missing resource, and it is what the suite asserts
against for every example.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field

from ...examples import catalogue, find
from ..documents import read_circuit
from ..errors import ApiError, ErrorCode

router = APIRouter(tags=["examples"])


class ExampleEntry(BaseModel):
    """One catalogue entry.

    No circuit, and no `parameters` yet. ADR-0009 section 4 keeps room for the
    second: a client that ignores an absent field keeps working when generated
    entries start carrying one.
    """

    model_config = ConfigDict(populate_by_name=True)

    id: str
    name: str
    summary: str
    qubit_count: int = Field(serialization_alias="qubitCount")
    operation_count: int = Field(serialization_alias="operationCount")


class ExampleCatalogueResponse(BaseModel):
    examples: list[ExampleEntry]


class ExampleCircuitResponse(BaseModel):
    circuit: dict[str, Any]


@router.get(
    "/examples",
    response_model=ExampleCatalogueResponse,
    response_model_by_alias=True,
    summary="Built-in example circuits",
)
def get_examples() -> ExampleCatalogueResponse:
    """List the catalogue, ordered by id so a picker is stable between loads.

    The counts are computed rather than declared in the files, so they cannot
    disagree with the circuit -- the same reason nothing else here is written
    down twice.
    """
    entries = []

    for example in catalogue():
        circuit = read_circuit(example.document())
        entries.append(
            ExampleEntry(
                id=example.id,
                name=example.name,
                summary=example.summary,
                qubit_count=len(circuit.qubits),
                operation_count=len(circuit.operations),
            )
        )

    return ExampleCatalogueResponse(examples=entries)


@router.get(
    "/examples/{identifier}",
    response_model=ExampleCircuitResponse,
    summary="One example as a circuit document",
    responses={404: {"description": "No example with that id."}},
)
def get_example(identifier: str) -> ExampleCircuitResponse:
    """One example, in the wire form every other endpoint accepts."""
    example = find(identifier)

    if example is None:
        raise ApiError(
            code=ErrorCode.NOT_FOUND,
            message=f"No example circuit with id '{identifier}'.",
            status_code=404,
        )

    circuit = read_circuit(example.document())

    return ExampleCircuitResponse(
        circuit=circuit.model_dump(by_alias=True, mode="json")
    )
