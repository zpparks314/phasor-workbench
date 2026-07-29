"""The API's single error shape.

docs/API.md defines one envelope for every failure. Clients branch on `code`,
never on `message`. Simulator exceptions must never reach the client -- they
expose implementation details the API exists to hide.
"""

from enum import StrEnum

from pydantic import BaseModel, Field


class ErrorCode(StrEnum):
    CIRCUIT_INVALID = "CIRCUIT_INVALID"
    REQUEST_MALFORMED = "REQUEST_MALFORMED"
    LIMIT_EXCEEDED = "LIMIT_EXCEEDED"
    RATE_LIMITED = "RATE_LIMITED"
    BACKEND_UNAVAILABLE = "BACKEND_UNAVAILABLE"
    SIMULATION_TIMEOUT = "SIMULATION_TIMEOUT"
    INTERNAL_ERROR = "INTERNAL_ERROR"


class ErrorDetail(BaseModel):
    code: str
    message: str
    path: str | None = Field(
        default=None,
        description="Location of the problem within the submitted document.",
    )


class ErrorBody(BaseModel):
    code: ErrorCode
    message: str
    details: list[ErrorDetail] = Field(default_factory=list)


class ErrorResponse(BaseModel):
    error: ErrorBody


class ApiError(Exception):
    """Raised by service code; converted to an ErrorResponse by the app."""

    def __init__(
        self,
        code: ErrorCode,
        message: str,
        status_code: int,
        details: list[ErrorDetail] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details or []

    def to_response(self) -> ErrorResponse:
        return ErrorResponse(
            error=ErrorBody(code=self.code, message=self.message, details=self.details)
        )
