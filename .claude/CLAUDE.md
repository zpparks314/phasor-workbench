# CLAUDE.md

## Project Overview

**Project Name:** RogueScholar's Quantum Workbench

RogueScholar's Quantum Workbench is an open-source, browser-based application for creating, visualizing, simulating, and understanding quantum circuits.

The project is intended to bridge the gap between educational tools and professional quantum software frameworks. While existing tools often focus on execution, Quantum Workbench emphasizes understanding through visualization, state inspection, and interactive learning.

This project is expected to grow over several years and should be designed with long-term maintainability in mind.

---

# Primary Goals

The project should prioritize the following goals, in order:

1. Clean architecture
2. Readable, maintainable code
3. Extensibility
4. Correctness
5. User experience
6. Performance

Avoid sacrificing architecture for short-term convenience.

---

# Design Philosophy

The application should be modular.

Every major subsystem should be replaceable with minimal changes elsewhere.

Examples include:

* simulator backend
* visualization engine
* circuit editor
* export formats
* persistence layer

No module should depend on implementation details of another module.

Favor interfaces and abstraction over tightly coupled implementations.

---

# Core Principles

## Single Source of Truth

The internal Circuit model is the authoritative representation of every circuit.

All systems—including the editor, simulator, exporters, importers, and visualizations—must operate from this model.

Never duplicate circuit state.

---

## Separation of Concerns

Frontend responsibilities:

* UI
* User interaction
* Rendering
* State management

Backend responsibilities:

* Validation
* Simulation
* Import/export
* Analysis
* Optimization

Shared responsibilities:

* Data models
* Serialization formats
* Type definitions

---

## Incremental Development

Every completed feature should leave the project in a deployable state.

Avoid partially implemented features.

Prefer:

Small finished improvements

instead of

Large incomplete systems.

---

## Testing Philosophy

Every new feature should include automated tests whenever practical.

Bug fixes should include regression tests.

Do not remove failing tests without understanding why they fail.

---

## Documentation

Documentation is part of the project.

When introducing:

* new architecture
* new APIs
* new modules
* new data structures

update the documentation alongside the implementation.

---

# Coding Style

Write code for humans first.

Priorities:

* descriptive names
* small functions
* minimal nesting
* explicit behavior
* minimal comments

Prefer self-documenting code.

Comments should explain "why," not "what."

---

# Error Handling

Never silently ignore errors.

Provide informative error messages.

Validate user input early.

Fail predictably.

---

# Performance

Do not prematurely optimize.

Favor correctness and readability.

Optimize only after measuring bottlenecks.

---

# Dependencies

Minimize external dependencies.

Before introducing a dependency, consider whether the functionality can reasonably be implemented using existing project libraries.

Avoid unnecessary frameworks.

---

# User Interface

The interface should be:

* clean
* accessible
* responsive
* educational

Animations should improve understanding rather than simply provide visual effects.

---

# Accessibility

Design for keyboard navigation where practical.

Maintain sufficient color contrast.

Avoid relying solely on color to communicate information.

---

# AI Agent Guidelines

Before making changes:

1. Read the relevant documentation.
2. Understand the architecture.
3. Follow existing project conventions.
4. Preserve backwards compatibility whenever possible.

When implementing features:

* prefer incremental commits
* avoid unnecessary refactoring
* keep changes focused
* write tests
* update documentation

When uncertain:

Ask for clarification instead of making assumptions.

---

# Current State

**Milestone 1 (Foundation) — nearly complete.**

Both projects are scaffolded and verified end to end: the backend installs and
serves, the frontend builds, and the two communicate. Remaining before the
milestone closes: **CI/CD** and **Docker development environment**.

No quantum features exist yet. The only endpoint is `GET /api/v1/health`.
`shared/` has directory structure but no schema — that is Milestone 2.

Start any session by reading, in order:

1. `docs/Roadmap.md` — status, remaining tasks, known issues, and the table of
   **decisions awaiting the owner**
2. `docs/Architecture.md` — the rules
3. `docs/ProjectStructure.md` — where things go and why

Documents marked *draft pending review* (`CircuitModel.md`, `API.md`,
`Simulation.md`) describe intended design, not implemented behavior. Their
closing "Open Questions" sections are unresolved.

---

# Technology Stack

Decided during Milestone 1. Do not change without discussion.

**Frontend** — React 19, TypeScript (strict), Vite, Tailwind v4, Vitest,
ESLint + Prettier

**Backend** — Python 3.11+, FastAPI, Pydantic v2, pytest, Ruff, mypy (strict)

**Simulation** — Qiskit + NumPy, isolated in an optional `simulation` extra
because nothing before Milestone 4 needs them

Two decisions that are easy to accidentally reverse:

* **Circuit rendering is direct SVG, not a node-graph library.** A library
  that owns node positions would duplicate the layout the Circuit Model must
  derive. See `docs/Frontend.md`.
* **Operations are a flat ordered list, not moments/columns.** Column layout
  is derived at render time. See `docs/CircuitModel.md`.

---

# Commands

Backend, from `backend/` with the venv activated:

```
pytest              # tests
ruff check .        # lint
ruff format .       # format
mypy                # type check
uvicorn quantum_workbench.main:app --reload --port 8000
```

Frontend, from `frontend/`:

```
npm test            # tests
npm run lint        # lint
npm run typecheck   # type check
npm run build       # type check + production build
npm run dev         # dev server on 5173, proxies /api to 8000
```

Run the full set before declaring work complete. The Definition of Done in
`docs/Roadmap.md` requires tests, linting, and type checking to pass.

---

# Environment Notes

**The repository lives inside OneDrive.** OneDrive locks files as it syncs and
periodically leaves a stale `.git/index.lock`, which blocks all staging and
committing. If git refuses to stage, check for that file; delete it only after
confirming no git process is running and no merge/rebase is in progress.

**Line endings are LF everywhere**, enforced by `.gitattributes`, which
overrides the repo-local `core.autocrlf=true`. Do not reintroduce CRLF.

**Python 3.14 is installed locally.** The backend runs on it, but Qiskit does
not yet publish 3.14 wheels — hence the optional `simulation` extra.

**`npm audit` reports 5 high-severity dev-only findings** in ESLint's
dependency chain. Deliberately deferred; see `docs/Roadmap.md`. Do not run
`npm audit fix --force`, which would install a breaking ESLint major.

---

# Project Vision

RogueScholar's Quantum Workbench is intended to become a platform for:

* quantum circuit construction
* interactive simulation
* educational visualization
* quantum algorithm demonstrations
* error correction exploration
* research experimentation

Design today's implementation so future features can be added without major rewrites.

Every architectural decision should support this long-term vision.
