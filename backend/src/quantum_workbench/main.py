"""Application entry point.

Wires the API together. Contains no business logic.
"""

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from quantum_workbench import __version__
from quantum_workbench.api.errors import ApiError
from quantum_workbench.api.routes import health
from quantum_workbench.config import settings

API_PREFIX = "/api/v1"


def create_app() -> FastAPI:
    app = FastAPI(
        title="Quantum Workbench API",
        version=__version__,
        description="See docs/API.md for the contract this implements.",
        openapi_url=f"{API_PREFIX}/openapi.json",
        docs_url=f"{API_PREFIX}/docs",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )

    @app.exception_handler(ApiError)
    async def handle_api_error(_: Request, exc: ApiError) -> JSONResponse:
        """Render service errors in the single documented envelope."""
        return JSONResponse(
            status_code=exc.status_code,
            content=exc.to_response().model_dump(mode="json"),
        )

    app.include_router(health.router, prefix=API_PREFIX)

    return app


app = create_app()
