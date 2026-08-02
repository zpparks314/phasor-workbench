"""Endpoints that actually run a circuit.

The API-layer half of the pipeline in docs/Simulation.md: this module is the
**result formatter**, turning typed simulator results into the response shapes
API.md documents. The adapter never formats a response and never learns about
HTTP; this never learns about Qiskit.

Sampling joins this module when measurement simulation lands, which is why the
error mapping below is written once rather than inlined.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field

from ...config import settings
from ...models.circuit import Circuit
from ...simulation import (
    BackendUnavailableError,
    CircuitTooLargeError,
    SimulationError,
    StatevectorResult,
    UnsupportedOperationError,
    get_backend,
)
from ..documents import read_circuit
from ..errors import ApiError, ErrorCode

router = APIRouter(tags=["simulations"])

"""
Below this, a probability is reported as absent rather than as a tiny number.

Amplitudes come back from a floating-point simulation, so a state that is
mathematically zero arrives as 1e-17 rather than 0.0. Listing those would bury
the two entries a Bell state actually has under a thousand that only look like
noise. The threshold is well under any probability a shot count could resolve.
"""
NEGLIGIBLE = 1e-12


class StatevectorOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    include_probabilities: bool = Field(
        default=True,
        alias="includeProbabilities",
        serialization_alias="includeProbabilities",
    )


class StatevectorRequest(BaseModel):
    """A circuit document, unparsed, plus options.

    `dict[str, Any]` rather than `Circuit` for the reason `circuits.py` gives:
    this is untrusted input and the loader owns reading it, so that ADR-0006's
    version decision happens rather than being skipped by FastAPI's binding.
    """

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    circuit: dict[str, Any]
    options: StatevectorOptions = Field(default_factory=StatevectorOptions)


class Amplitude(BaseModel):
    """One basis state's complex amplitude.

    Explicit `real`/`imaginary` rather than a tuple: JSON has no complex type,
    and named fields survive schema evolution better than positional arrays.
    API.md fixes this shape.
    """

    model_config = ConfigDict(populate_by_name=True)

    basis_state: str = Field(serialization_alias="basisState")
    real: float
    imaginary: float


class Probability(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    basis_state: str = Field(serialization_alias="basisState")
    probability: float


class StatevectorResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    qubit_count: int = Field(serialization_alias="qubitCount")
    amplitudes: list[Amplitude]
    probabilities: list[Probability] | None = None


@router.post(
    "/simulations/statevector",
    response_model=StatevectorResponse,
    response_model_by_alias=True,
    response_model_exclude_none=True,
    summary="Final state vector",
)
def post_statevector(request: StatevectorRequest) -> StatevectorResponse:
    circuit = read_circuit(request.circuit)
    _check_response_size(circuit)

    try:
        result = get_backend().simulate_statevector(circuit)
    except SimulationError as error:
        raise _from_simulation(error) from error

    return _format(result, include_probabilities=request.options.include_probabilities)


def _check_response_size(circuit: Circuit) -> None:
    """Refuse before simulating, not after.

    Simulating 20 qubits and then discovering the response cannot be sent
    wastes the expensive half and reports the limit too late.
    """
    qubits = len(circuit.qubits)
    if qubits > settings.max_statevector_qubits:
        raise ApiError(
            code=ErrorCode.LIMIT_EXCEEDED,
            message=(
                f"A {qubits}-qubit state has {2**qubits} amplitudes, more than "
                f"this endpoint returns. The limit is "
                f"{settings.max_statevector_qubits} qubits, and it is a "
                "response-size limit rather than a simulation one."
            ),
            status_code=413,
        )


def _format(
    result: StatevectorResult, *, include_probabilities: bool
) -> StatevectorResponse:
    """Typed result -> the documented response.

    **Basis strings are built here, and the bit order is docs/Simulation.md's:
    qubit 0 is the rightmost bit.** `index` is the amplitude's position, whose
    binary form is already in that order, so zero-padding it is the whole
    conversion -- and a reversal appearing here would be a bug rather than a
    safeguard.

    Amplitudes are returned in full and probabilities sparsely, which is not an
    inconsistency: the amplitudes *are* the state, while the probabilities are
    a summary, and a summary listing a thousand values indistinguishable from
    zero would summarise nothing.
    """
    width = result.qubit_count

    amplitudes = [
        Amplitude(
            basis_state=format(index, f"0{width}b") if width else "",
            real=amplitude.real,
            imaginary=amplitude.imag,
        )
        for index, amplitude in enumerate(result.amplitudes)
    ]

    probabilities = None
    if include_probabilities:
        probabilities = [
            Probability(
                basis_state=amplitude.basis_state,
                probability=weight,
            )
            for amplitude in amplitudes
            if (weight := amplitude.real**2 + amplitude.imaginary**2) > NEGLIGIBLE
        ]

    return StatevectorResponse(
        qubit_count=width,
        amplitudes=amplitudes,
        probabilities=probabilities,
    )


def _from_simulation(error: SimulationError) -> ApiError:
    """Simulator failures, in the one envelope API.md defines.

    The adapter raises only `simulation.errors` types, so this mapping is total
    without catching anything simulator-specific -- which is the property that
    lets a backend be swapped without touching the API layer.
    """
    if isinstance(error, BackendUnavailableError):
        return ApiError(
            code=ErrorCode.BACKEND_UNAVAILABLE,
            message=str(error),
            status_code=503,
        )
    if isinstance(error, CircuitTooLargeError):
        return ApiError(
            code=ErrorCode.LIMIT_EXCEEDED,
            message=str(error),
            status_code=413,
        )
    if isinstance(error, UnsupportedOperationError):
        return ApiError(
            code=ErrorCode.CIRCUIT_INVALID,
            message=str(error),
            status_code=422,
        )

    # A SimulationError subclass added later, before this mapping learns about
    # it. Reported as an internal error rather than escaping as a 500 with a
    # stack trace, which would leak the simulator the API exists to hide.
    return ApiError(
        code=ErrorCode.INTERNAL_ERROR,
        message="The simulation failed.",
        status_code=500,
    )


class SampleOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    shots: int = Field(default=1024, ge=1)
    """
    API.md's default. `ge=1` rather than a hand-checked bound: zero shots is a
    malformed request rather than a circuit problem, and FastAPI reports it as
    one without the route having to.
    """

    seed: int | None = None
    """Optional. Supplying it makes the run reproducible; omitting it does not."""


class SampleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    circuit: dict[str, Any]
    options: SampleOptions = Field(default_factory=SampleOptions)


class SampleResponse(BaseModel):
    """docs/API.md's sampling body.

    `counts` and `probabilities` are objects keyed by classical bit string
    rather than lists of pairs, which is what API.md specifies and what the
    shape genuinely is -- a mapping from outcome to number, with no ordering to
    preserve and no room for a second field per entry.

    That differs from the statevector response, where each amplitude carries
    two numbers and so has to be an object. The two shapes differ because the
    data differs, not by oversight.
    """

    model_config = ConfigDict(populate_by_name=True)

    shots: int
    seed: int | None
    counts: dict[str, int]
    probabilities: dict[str, float]


@router.post(
    "/simulations/sample",
    response_model=SampleResponse,
    response_model_by_alias=True,
    summary="Measurement counts over repeated shots",
)
def post_sample(request: SampleRequest) -> SampleResponse:
    circuit = read_circuit(request.circuit)
    _check_shots(request.options.shots)

    try:
        result = get_backend().sample(
            circuit, shots=request.options.shots, seed=request.options.seed
        )
    except SimulationError as error:
        raise _from_simulation(error) from error

    return SampleResponse(
        shots=result.shots,
        # Echoed rather than omitted when absent. `null` says "this run was not
        # seeded, so it is not reproducible", which is information; leaving the
        # field out would be indistinguishable from a build that does not
        # support seeding.
        seed=request.options.seed,
        counts=result.counts,
        probabilities={
            outcome: count / result.shots for outcome, count in result.counts.items()
        },
    )


def _check_shots(shots: int) -> None:
    """The deployment's shot ceiling, per docs/API.md's limits table.

    Configuration rather than a constant, so it can be tuned per deployment --
    which is also why it is read here rather than captured at import time.
    """
    if shots > settings.max_shots:
        raise ApiError(
            code=ErrorCode.LIMIT_EXCEEDED,
            message=(
                f"{shots} shots exceeds this deployment's limit of "
                f"{settings.max_shots}."
            ),
            status_code=413,
        )
