<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/phasor-horizontal-dark.svg">
    <img src="assets/phasor-horizontal-light.svg" alt="Phasor Workbench" width="320">
  </picture>
</p>

# Phasor Workbench

[![CI](https://github.com/zpparks314/phasor-workbench/actions/workflows/ci.yml/badge.svg)](https://github.com/zpparks314/phasor-workbench/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

A browser-based workbench for building, simulating, and **understanding** quantum circuits.

Most quantum software optimizes for execution: a circuit goes in, a result comes
out, and everything in between is invisible. That's the right trade for
production work and a poor one for learning. Phasor Workbench treats the part in
between as the interesting part.

It sits deliberately between educational toys that can't express real circuits
and professional frameworks that assume you already know the mathematics.

> **On the name:** a *phasor* is a rotating complex number carrying magnitude and
> phase — which is exactly what a quantum amplitude is.

Built by Zachary Parks ([RogueScholar](https://github.com/zpparks314)).

---

## Try It

There's no hosted instance yet — public deployment is the current milestone. To
run it locally, [Docker](#docker) is one command:

```bash
docker compose up --build
```

Then open `http://localhost:5173`. Native setup is [below](#native-setup).

---

## What Works Today

Everything here is built, tested, and usable in the browser right now.

**Build a circuit.** Start from an empty canvas, add and remove qubits and
classical registers, and place any of the 18 gates in the gate set — `i`, `h`,
`x`, `y`, `z`, `s`, `sdg`, `t`, `tdg`, `rx`, `ry`, `rz`, `p`, `cx`, `cy`, `cz`,
`swap`, `ccx` — plus measurements and barriers. Multi-qubit gates are placed by
explicitly assigning their controls. Rotation angles are editable in an
inspector.

**Work by keyboard.** Nothing is reachable by mouse alone. Placement, control
assignment, movement, selection, removal, and save all have keyboard paths.

**Undo anything.** Every edit is undoable and redoable, including the destructive
ones like removing a qubit that had gates on it.

**See mistakes immediately.** Invalid circuits are reported against the specific
operation that's wrong, in a problems strip that clears as you fix things.

**Keep your work.** Circuits save to local storage and survive a refresh.

**Open and save files.** One Import control takes either a JSON circuit or an
OpenQASM 2.0 program, and the *content* decides which — a mis-named `.txt`
holding QASM still opens, because routing on the extension would refuse it with a
JSON parse error that explains nothing. Export writes JSON. Import is held to
exactly the validation a refresh applies, so a document a reload would reject is
rejected here too, with its reasons named.

**Watch the state follow your edits.** The final state vector updates as you
build, alongside gate count, circuit depth, and labelled cycles so you can check
the depth against the circuit in front of you.

**Run it.** Sample measurement outcomes and compare them against the exact
probabilities.

### Not Yet

**OpenQASM export**, a library of example circuits, responsive layout for small
screens, and a public deployment are the rest of Milestone 5 — see the
[Roadmap](docs/Roadmap.md).

Two honest limits on QASM import today. Most Qiskit-*exported* QASM 2 is refused:
`qelib1.inc` declares `u3`, `u2`, `u0`, `ch`, `crz`, `cu1`, `cu3` and `cswap`,
none of which this gate set represents, and guessing at a decomposition would
hand back a circuit you didn't write. And QASM is parsed by the backend rather
than in the browser, so importing one is the only file operation that can fail
because nothing answered — it says so rather than blaming the file.

Educational visualizations — Bloch spheres, amplitude phase, state evolution over
time — are deliberately deferred until after the first release.

---

## Current Status

**Milestones 1–4 are complete.** The foundation, the circuit model, the editor,
and simulation all exist. **Milestone 5, the first public release, is in
progress.**

| Area | State |
|---|---|
| Circuit model | Settled — ADRs 0001–0008 accepted, implemented in both languages |
| Circuit editor | Built — placement, movement, undo, validation, local save |
| Simulation | Built — state vector and sampling, Qiskit behind a swappable seam |
| Analysis | Built — gate counts, depth, cycle decomposition |
| Import / export | Built — JSON both ways, OpenQASM 2.0 in; QASM export not started |
| Example circuits | **Not started** — Milestone 5 |
| Deployment | **Not started** — Milestone 5 |
| Tests | 809 frontend, 391 backend, 51 cross-language fixtures |
| CI | Lint, format, types, tests, build, and binding freshness on every push |

The HTTP API is five endpoints:

| Endpoint | Does |
|---|---|
| `GET /api/v1/health` | Liveness |
| `POST /api/v1/circuits/analyze` | Gate counts, depth, cycle decomposition |
| `POST /api/v1/circuits/import/qasm` | Parses OpenQASM 2.0 into a circuit |
| `POST /api/v1/simulations/statevector` | Final state vector |
| `POST /api/v1/simulations/sample` | Sampled measurement outcomes |

Full contract in [API.md](docs/API.md).

---

## How It's Built

```text
Frontend  →  Shared Circuit Model  →  Backend Services  →  Simulation Engine
```

The Circuit Model is the center. The editor, simulator, importers, exporters, and
visualizations all read from and write to the same representation — nothing keeps
a second copy.

**Frontend** — React 19, TypeScript (strict), Vite, Tailwind v4, Vitest.
**Backend** — Python 3.11+, FastAPI, Pydantic v2, pytest, Ruff, mypy (strict).
**Simulation** — Qiskit 2.x and NumPy, in an optional extra.

Three decisions worth knowing before reading the code:

**The model is defined once, in JSON Schema, and generated into both languages.**
`shared/schema/circuit.schema.json` and `shared/spec/circuit.spec.json` are the
sources of truth; the Pydantic models, TypeScript types, and shared constants are
generated from them and never edited by hand. CI fails if they drift. See
[ADR-0004](docs/decisions/ADR0004_SharedModelStrategy.md).

**A circuit is a flat ordered list of operations. Cycles are derived, never
stored.** Nothing caches a column index or a coordinate — the layout is
recomputed from the model on every render. See
[ADR-0001](docs/decisions/ADR0001_CircuitRepresentation.md).

**Validation and cycle derivation are implemented twice, once per language, and
held to the same 51 fixtures.** Each fixture declares its own expected outcome,
so both implementations measure against the same artifact and agreement follows
without a cross-language test runner.

Circuit rendering is direct SVG rather than a node-graph library, because a
library that owned node positions would duplicate the layout the model already
derives. Reasoning in [Frontend.md](docs/Frontend.md).

---

## Getting Started

Two supported paths. Docker is fastest; native is what CI runs. Neither is more
official than the other.

### Docker

Requires Docker Desktop or Docker Engine with Compose v2.

```bash
docker compose up --build
```

Frontend on `http://localhost:5173`, backend on `http://localhost:8000`. Both
hot-reload from your working tree — source is bind-mounted, not baked in.

Production images aren't included yet; they arrive with Deployment in Milestone 5.

### Native Setup

**Prerequisites:** Python 3.11+ and Node 20.19+.

**Backend:**

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # macOS / Linux

pip install -e ".[dev,simulation]"
uvicorn phasor_workbench.main:app --reload --port 8000
```

Check it: `http://localhost:8000/api/v1/health` returns
`{"status":"ok","version":"0.1.0"}`. Interactive API docs are at
`http://localhost:8000/api/v1/docs`.

Qiskit and NumPy live in an optional `simulation` extra to keep the default
install light. The app runs without it — simulation is simply unavailable and
those tests skip. Install it with `pip install -e ".[dev]"` if you don't need
simulation.

**Frontend:**

```bash
cd frontend
npm install
npm run dev
```

Runs on `http://localhost:5173` and proxies `/api` to the backend.

### Running the Checks

```bash
# Backend
cd backend && pytest && ruff check . && ruff format --check . && mypy

# Frontend
cd frontend && npm test && npm run lint && npm run format:check && npm run typecheck

# Shared model -- fails if the generated bindings no longer match their sources
python shared/generate_bindings.py --check
```

The `--check` variants are what CI runs. The rewriting variants (`ruff format`,
`npm run format`) pass silently by fixing the problem, so a green local run
proves nothing about CI.

### Changing the Circuit Model

`shared/schema/circuit.schema.json` and `shared/spec/circuit.spec.json` are the
sources of truth. After editing either:

```bash
python shared/generate_bindings.py
```

A source and its regenerated bindings belong in the same commit; CI rejects the
pair when they drift. Generated files are never edited by hand — see
[ADR-0004](docs/decisions/ADR0004_SharedModelStrategy.md).

---

## Repository Layout

```text
frontend/    React + TypeScript + Vite + Tailwind
backend/     Python + FastAPI + Pydantic
shared/      Circuit schema, specification, and cross-language fixtures
tests/       Cross-cutting integration and contract tests
docs/        Project documentation
```

Why `shared/` and `tests/` sit outside both projects is explained in
[ProjectStructure.md](docs/ProjectStructure.md).

---

## Documentation

Documentation is treated as part of the project rather than an afterthought.

**If you're here to understand the project**, start with
[Vision.md](docs/Vision.md), then [Architecture.md](docs/Architecture.md).

**If you're here to contribute code**, read
[Architecture.md](docs/Architecture.md) and the topic document for whatever
you're touching.

| Document | Covers |
|---|---|
| [Vision.md](docs/Vision.md) | Why the project exists, who it's for, what's out of scope |
| [Architecture.md](docs/Architecture.md) | System structure, module boundaries, architectural rules |
| [ProjectStructure.md](docs/ProjectStructure.md) | Repository layout and the reasoning behind it |
| [Roadmap.md](docs/Roadmap.md) | Milestones, current status, open issues, definition of done |
| [CircuitModel.md](docs/CircuitModel.md) | The circuit data model — the single source of truth |
| [UI.md](docs/UI.md) | Editor behaviour, keyboard model, visual language |
| [API.md](docs/API.md) | REST contract between frontend and backend |
| [Simulation.md](docs/Simulation.md) | Simulation pipeline, backends, limits, correctness testing |
| [Frontend.md](docs/Frontend.md) | Frontend structure, rendering decision, API client |
| [decisions/](docs/decisions/) | Architecture Decision Records — why things are shaped the way they are |

`Roadmap.md` is the maintained record of what's done and what's next; where it
disagrees with anything else, the topic document wins on behaviour and the
Roadmap wins on status.

`.claude/CLAUDE.md` is written for AI coding agents working in this repository.
It's not required reading for humans, though it does collect a number of
hard-won environment quirks.

---

## Contributing

Contributions are welcome. The architecture is settled enough to build on, and
[Architecture.md](docs/Architecture.md) plus [Roadmap.md](docs/Roadmap.md) are
the two documents to read first.

Working principles:

* complete the current milestone before starting the next
* finish features rather than leaving partial implementations
* write tests for new functionality, and a regression test for every bug fix
* update documentation alongside code
* keep commits focused on a single logical change

If a change would alter the architecture, open a discussion before implementing
it. If it conflicts with an accepted ADR, say so explicitly — ADRs get revised,
but not silently.

A feature is done only when it works, its tests pass, the documentation is
updated, linting and type checking pass, **the application loads in a browser**,
the code has been reviewed, and the project remains deployable.

That browser check is on the list because everything else on it once passed while
the page rendered nothing.

---

## License

Licensed under the **[Apache License 2.0](LICENSE)**. Copyright 2026 Zachary
Parks.

Apache 2.0 rather than MIT for a reason specific to this field: quantum computing
is heavily patented, and this project implements published algorithms. Apache 2.0
§3 grants an explicit patent license from contributors, with a retaliation
clause, where MIT is silent on patents entirely. It also matches Qiskit, Cirq,
and Q#, which removes friction with the ecosystem this project depends on.

Contributions are accepted under the same license, per Apache 2.0 §5.
