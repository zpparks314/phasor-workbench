# syntax=docker/dockerfile:1

# 3.14, matching the interpreter used natively and the upper CI leg. This was
# pinned to 3.13 until 2026-08-02 because Qiskit published no 3.14 wheels and
# the container was to be the only place the `simulation` extra could install.
# Qiskit 2.x ships stable-ABI wheels, so that is no longer true and the pin has
# no reason left to exist. See docs/Roadmap.md.
FROM python:3.14-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app


# --- Development ---------------------------------------------------------
#
# Source is bind-mounted over /app/src by compose, so the editable install
# below resolves to the host's working tree and edits take effect live.

FROM base AS development

# pyproject.toml declares readme = "README.md", so the build fails without it.
COPY pyproject.toml README.md ./
COPY src/ ./src/

# Wheels only, for the same reason CI does it: Qiskit, NumPy and SciPy will
# each build from source if no wheel matches, and a slim image has no compiler.
RUN pip install --only-binary=:all: -e ".[dev,simulation]"

# Bind-mounted Windows filesystems do not propagate inotify events, so the
# reloader sees nothing without polling. watchfiles ships with
# uvicorn[standard], already a dependency.
ENV WATCHFILES_FORCE_POLLING=true

EXPOSE 8000

# 0.0.0.0, not the uvicorn default: a loopback bind inside a container is
# unreachable from the host, and the published port appears dead.
CMD ["uvicorn", "phasor_workbench.main:app", \
     "--host", "0.0.0.0", "--port", "8000", "--reload"]
