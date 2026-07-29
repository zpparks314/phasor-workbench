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
* [x] Configure CI — lint, format, type check, test, and build both projects
* [x] Configure Docker development environment
* [x] Create project documentation

### Exit Criteria

* [x] Application builds successfully.
* [x] Frontend and backend communicate.
* [x] Documentation exists.
* [x] Tests execute automatically.
* [x] Repository is ready for feature development.

**Milestone 1 is complete.** Milestone 2 (Circuit Model) may begin — but read
the *Decisions Awaiting the Owner* table below first, since three of its four
entries shape that milestone directly.

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

**CI** — `.github/workflows/ci.yml` runs both projects on every push and pull
request: lint, format check, type check, test, and production build. Backend
across Python 3.11 and 3.14, frontend across Node 20.19 and 22. It enforces the
mechanical half of the Definition of Done below; documentation and review stay
human.

Continuous *deployment* is deliberately not part of this milestone. There is
nothing to deploy yet, and a pipeline built now would be rewritten once Docker
exists and the app has features. It belongs with **Deployment** in Milestone 5,
and should consume the Dockerfile rather than duplicate it.

**Branch protection** — a ruleset on the default branch requires a pull request
and a passing `CI` check before merging, requires linear history, and blocks
force pushes and deletion. Only the aggregate `CI` job is required, not the
four matrix jobs: matrix job names carry their version, so requiring those
directly would leave a new leg unprotected until someone remembered to update
the rule.

Repository admin holds an `always` bypass, so the owner can still push directly
to `main`. That is a deliberate trade for a solo project — the rules exist for
contributors who arrive later, and the guardrail against accidental force
pushes and deletions still applies to everyone. Revisit when the project takes
its first outside contributor.

**Docker** — `compose.yaml` runs both services with the working tree bind-mounted
and hot reload verified on both sides. The backend container pins Python 3.13
because Qiskit publishes no 3.14 wheels, making it where the Milestone 4
`simulation` extra will install. Production images are deferred to Milestone 5;
both Dockerfiles are multi-stage so adding a `production` target is additive.

Docker supplements native development rather than replacing it. CI runs
natively, and the venv/npm workflow remains fully supported.

One finding worth keeping: **Vite 7 bundles chokidar instead of depending on
it, and `server.watch.usePolling` alone does not reach the watcher** —
`CHOKIDAR_USEPOLLING` does. Polling is required at all because bind-mounted
Windows filesystems deliver no inotify events; this was verified directly
(`fs.watchFile` sees host edits through the mount, `fs.watch` never fires).
Without that environment variable, frontend hot reload fails silently.

### Known Issues

* `npm audit` reports 5 high-severity findings, all one root cause
  (`brace-expansion` DoS) reached through ESLint's dependency chain. Dev-only,
  never bundled, and the only offered fix is a breaking `eslint@10` upgrade.
  Deliberately deferred until the plugin ecosystem supports ESLint 10.

### Decisions Awaiting the Owner

These block or shape upcoming work and should be answered before the milestone
they affect begins.

| Decision | Blocks | Default if unanswered |
|---|---|---|
| Shared model strategy: JSON Schema generation vs. hand-written types with contract tests | Milestone 2 | JSON Schema as source of truth, per `shared/README.md` |
| Mid-circuit measurement: permitted at MVP or deferred? | Milestone 2 | Deferred; measurement ends a qubit's usable life |
| Are identifiers client-generated or backend-assigned? | Milestone 2 | Client-generated |
| Interpreter for the `simulation` extra (Qiskit lacks 3.14 wheels) | Milestone 4 | Partly answered: the Docker environment pins 3.13, so simulation work happens there. Whether native 3.14 must also be supported is still open |

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
