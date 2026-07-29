# Phasor Workbench Roadmap

## Project Status

**Current Phase:** Project Foundation

**Current Milestone:** Establish project architecture and development environment.

The focus at this stage is creating a clean, maintainable foundation. Features are intentionally limited until the architecture is in place.

---

# Current Objectives

The highest priorities are:

1. Repository setup
2. Development environment
3. Documentation
4. Core data model
5. Testing infrastructure

Do **not** begin implementing advanced quantum features until these objectives are complete.

---

# Milestone 1 — Foundation

## Goal

Create a maintainable project structure.

### Tasks

* [x] Initialize repository
* [x] Configure frontend project
* [x] Configure backend project
* [x] Configure formatting and linting
* [x] Configure testing
* [ ] Configure CI/CD
* [ ] Configure Docker development environment
* [x] Create project documentation

### Exit Criteria

* [x] Application builds successfully.
* [x] Frontend and backend communicate.
* [x] Documentation exists.
* [x] Tests execute automatically.
* [ ] Repository is ready for feature development.

### Status

Both projects are scaffolded and **verified end to end**.

**Backend** — installs on Python 3.14, `pytest` passes (3 tests), `ruff` and
`mypy --strict` clean. `GET /api/v1/health` returns a valid response.

**Frontend** — `npm install` succeeds, `tsc --noEmit` clean, `eslint` clean,
`vitest` passes (3 tests), production build succeeds.

**Integration** — the running frontend reaches the backend through the Vite
proxy and reports the API version. With the backend stopped, it degrades to a
readable message rather than failing blank, satisfying the requirement in
Architecture.md that the frontend stay functional when the backend is down.

Remaining before this milestone can close:

1. Configure CI/CD.
2. Configure the Docker development environment.

### Known Issues

* `npm audit` reports 5 high-severity findings, all one root cause
  (`brace-expansion` DoS) reached through ESLint's dependency chain. Dev-only,
  never bundled, and the only offered fix is a breaking `eslint@10` upgrade.
  Deliberately deferred until the plugin ecosystem supports ESLint 10.
* `LICENSE` is an empty file. The project is intended to be open source but no
  license has been selected, so no license is currently granted.

### Decisions Awaiting the Owner

These block or shape upcoming work and should be answered before the milestone
they affect begins.

| Decision | Blocks | Default if unanswered |
|---|---|---|
| Shared model strategy: JSON Schema generation vs. hand-written types with contract tests | Milestone 2 | JSON Schema as source of truth, per `shared/README.md` |
| Mid-circuit measurement: permitted at MVP or deferred? | Milestone 2 | Deferred; measurement ends a qubit's usable life |
| Are identifiers client-generated or backend-assigned? | Milestone 2 | Client-generated |
| Which open-source license? | Public release | None; currently unlicensed |
| Interpreter for the `simulation` extra (Qiskit lacks 3.14 wheels) | Milestone 4 | Pin 3.11–3.13 for that extra |

The full set of open questions lives at the end of
[CircuitModel.md](CircuitModel.md), [API.md](API.md), and
[Simulation.md](Simulation.md).

---

# Milestone 2 — Circuit Model

## Goal

Design the application's central data model.

### Tasks

* [ ] Circuit
* [ ] Gate
* [ ] Qubit
* [ ] Classical Register
* [ ] Measurement
* [ ] Serialization
* [ ] Validation
* [ ] Unit tests

### Exit Criteria

The Circuit model becomes the single source of truth used throughout the application.

No UI or simulator should maintain its own circuit representation.

---

# Milestone 3 — Circuit Editor MVP

## Goal

Allow users to visually construct quantum circuits.

### Tasks

* [ ] Render quantum wires
* [ ] Gate palette
* [ ] Place gates
* [ ] Remove gates
* [ ] Move gates
* [ ] Multi-qubit gates
* [ ] Undo
* [ ] Redo
* [ ] Save locally

### Exit Criteria

Users can build simple circuits entirely within the browser.

---

# Milestone 4 — Simulation MVP

## Goal

Execute circuits and display results.

### Tasks

* [ ] Backend API
* [ ] Qiskit integration
* [ ] Statevector simulation
* [ ] Measurement simulation
* [ ] Probability display
* [ ] Gate count
* [ ] Circuit depth

### Exit Criteria

Users can build a circuit and receive valid simulation results.

---

# Milestone 5 — First Public Release

## Goal

Prepare the project for public deployment.

### Tasks

* [ ] Responsive layout
* [ ] Error handling
* [ ] Keyboard shortcuts
* [ ] OpenQASM import
* [ ] OpenQASM export
* [ ] JSON import/export
* [ ] Example circuits
* [ ] Documentation
* [ ] Deployment

### Exit Criteria

The application is suitable for public use and portfolio demonstration.

---

# Future Milestones

These are intentionally out of scope for the MVP.

## Educational Visualizations

* Bloch spheres
* State evolution timeline
* Gate explanations
* Matrix viewer
* Tensor products

---

## Advanced Simulation

* Density matrices
* Noise models
* Error mitigation
* Fidelity metrics
* Multiple simulator backends

---

## Quantum Algorithms

* Bell states
* GHZ states
* Teleportation
* Deutsch-Jozsa
* Bernstein-Vazirani
* Grover
* Quantum Fourier Transform

---

## Research Features

* Error correction
* Surface codes
* Stabilizer circuits
* Tensor-network simulation
* Custom gate libraries

---

## User Features

* Accounts
* Saved circuits
* Public sharing
* Classroom mode
* Collaborative editing

---

# Out of Scope

The following features should not be implemented during the MVP unless explicitly requested.

* Authentication
* Cloud execution
* Real quantum hardware integration
* AI-assisted circuit generation
* Plugin marketplace
* Mobile applications

These may be revisited after a stable public release.

---

# Development Principles

When working on this project:

* Complete the current milestone before beginning the next.
* Finish features rather than leaving partial implementations.
* Write tests for new functionality.
* Update documentation alongside code.
* Avoid unnecessary refactoring.
* Preserve modularity.
* Keep commits focused on a single logical change.

---

# Definition of Done

A feature is considered complete only when:

* Functionality works correctly.
* Automated tests pass.
* Documentation is updated.
* Linting passes.
* Type checking passes.
* Code has been reviewed.
* The application remains deployable.

---

# Notes for AI Agents

Before making changes:

1. Read `CLAUDE.md`.
2. Read `architecture.md`.
3. Read this roadmap.
4. Identify the active milestone.
5. Work only on tasks relevant to that milestone unless instructed otherwise.
6. Prefer small, incremental pull requests over large, sweeping changes.
7. If an implementation decision would alter the architecture, stop and ask for clarification instead of making assumptions.
