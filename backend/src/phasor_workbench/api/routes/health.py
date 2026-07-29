"""Liveness endpoint.

The only endpoint implemented during Milestone 1. It exists to satisfy the
milestone's exit criterion that frontend and backend communicate.
"""

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

from phasor_workbench import __version__

router = APIRouter(tags=["system"])


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    version: str


@router.get("/health", response_model=HealthResponse, summary="Liveness check")
def get_health() -> HealthResponse:
    return HealthResponse(version=__version__)
