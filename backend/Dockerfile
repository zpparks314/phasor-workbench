# syntax=docker/dockerfile:1

# Python 3.13 rather than the 3.14 used natively. Qiskit publishes no 3.14
# wheels, so the container is where the Milestone 4 `simulation` extra will
# install. Both versions satisfy requires-python, and CI covers 3.11 and 3.14.
# See docs/Roadmap.md.
FROM python:3.13-slim AS base

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

RUN pip install -e ".[dev]"

# Bind-mounted Windows filesystems do not propagate inotify events, so the
# reloader sees nothing without polling. watchfiles ships with
# uvicorn[standard], already a dependency.
ENV WATCHFILES_FORCE_POLLING=true

EXPOSE 8000

# 0.0.0.0, not the uvicorn default: a loopback bind inside a container is
# unreachable from the host, and the published port appears dead.
CMD ["uvicorn", "phasor_workbench.main:app", \
     "--host", "0.0.0.0", "--port", "8000", "--reload"]
