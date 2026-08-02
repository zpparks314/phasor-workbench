"""Application configuration.

Limits are configuration rather than constants so they can be tuned per
deployment and advertised through the capabilities endpoint. See docs/API.md.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="QW_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    cors_origins: list[str] = ["http://localhost:5173"]

    # Statevector memory grows as 16 * 2^n bytes. Twenty qubits is 16 MB,
    # which is comfortably beyond any educational circuit while keeping a
    # single request from exhausting a container. See docs/Simulation.md.
    max_qubits: int = 20
    max_operations: int = 10_000
    max_shots: int = 100_000
    simulation_timeout_seconds: int = 30

    # A *response-size* limit, distinct from `max_qubits` above, which is a
    # simulation limit. A statevector crosses the wire as 2^n objects: 12
    # qubits is 4,096 and a few hundred KB, 20 would be a million and tens of
    # MB, which hangs a browser tab and reads as a frontend bug rather than a
    # limit. Sampling is unaffected -- its response is bounded by the number of
    # distinct outcomes observed, not by 2^n.
    max_statevector_qubits: int = 12


settings = Settings()
