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

## The simulation extra

Qiskit and NumPy are **not** core dependencies. They live in an optional
`simulation` extra because nothing before Milestone 4 uses them:

```bash
pip install -e ".[dev,simulation]"
```

It installs on every interpreter this project supports, 3.11 through 3.14, and
both CI legs cover it.

This section previously warned that Qiskit published no Python 3.14 wheels and
that the extra needed 3.11–3.13. That stopped being true without any 3.14 wheel
appearing: Qiskit 2.x ships `cp310-abi3` wheels, and the stable ABI means one
wheel serves every CPython from 3.10 upward, including releases that did not
exist when it was built. The extra now floors at `qiskit>=2.1` for that reason —
1.x predates the change.

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
