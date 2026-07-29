# Backend

Python + FastAPI + Pydantic.

**Status:** foundation only. Only `/api/v1/health` is implemented.

---

## Setup

Requires Python 3.11+.

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # macOS / Linux

pip install -e ".[dev]"
cp .env.example .env
uvicorn phasor_workbench.main:app --reload --port 8000
```

Interactive API docs: `http://localhost:8000/api/v1/docs`

## Qiskit and Python 3.14

Qiskit and NumPy are **not** core dependencies. They live in an optional
`simulation` extra because nothing before Milestone 4 uses them:

```bash
pip install -e ".[dev,simulation]"
```

Qiskit does not yet publish wheels for Python 3.14, so that extra needs
Python 3.11–3.13. Keeping it optional means the foundation installs and runs
on 3.14 today.

**The Docker development environment pins Python 3.13 for exactly this
reason**, so the container is where the `simulation` extra will install when
Milestone 4 arrives. From the repository root:

```bash
docker compose up --build
```

That does not force containers on anyone — native development on 3.14 stays
supported for everything except the `simulation` extra.

## Commands

| Command | Purpose |
|---|---|
| `pytest` | Run tests |
| `pytest --cov` | Run tests with coverage |
| `ruff check .` | Lint |
| `ruff format .` | Format |
| `mypy` | Type check |

## Layout

```text
src/phasor_workbench/
├── main.py          Application assembly, no business logic
├── config.py        Settings and resource limits
├── api/
│   ├── errors.py    The single documented error envelope
│   └── routes/      One module per resource group
├── models/          Circuit Model types       (Milestone 2)
├── validation/      Circuit validation        (Milestone 2)
├── simulation/
│   └── backends/    Simulator adapters        (Milestone 4)
├── analysis/        Gate counts, depth        (Milestone 4)
├── importers/       OpenQASM, JSON in         (Milestone 5)
└── exporters/       OpenQASM, JSON out        (Milestone 5)
```

## Rules

* never render UI or return presentation logic
* never let a simulator exception reach the client
* never trust client-side validation
* the backend does not own the Circuit Model — `shared/` does
