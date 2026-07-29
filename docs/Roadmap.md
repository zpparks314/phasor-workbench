# Phasor Workbench Roadmap

## Project Status

**Current Phase:** Circuit Model

**Current Milestone:** Milestone 2 — design the application's central data model.

Milestone 1 (Foundation) closed on 2026-07-28. The architecture, tooling, CI, branch protection, licensing, and development environments are in place, so feature work can begin.

Milestone 2 is **in progress.** Its design is settled by ADRs 0001–0004, and its
schema and generated bindings are done. Validation, the cycle derivation, and
the cross-language contract fixtures remain — see *Status* under Milestone 2.

Every decision that blocked this milestone has been answered. The one entry
still open in **Decisions Awaiting the Owner** is scoped to Milestone 4.

---

# Current Objectives

The highest priorities are:

1. ~~Repository setup~~ — done
2. ~~Development environment~~ — done, native and Docker
3. ~~Documentation~~ — done; `UI.md` deferred to Milestone 3
4. **Core data model** — active, Milestone 2
5. ~~Testing infrastructure~~ — done; enforced by CI

Do **not** begin implementing advanced quantum features until the core data model is complete. It is the single source of truth every other subsystem reads from, and building on a provisional version means rewriting all of them.

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

Milestone 2 added a **Shared model** job, the only one needing both toolchains.
It verifies that the bindings committed under each project still match
`shared/schema/circuit.schema.json`. Nothing else in the workflow would catch
that drift — both projects lint, type check and build perfectly against a stale
model.

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

| Decision | Blocks | Status |
|---|---|---|
| Shared model strategy: JSON Schema generation vs. hand-written types with contract tests | Milestone 2 | **Resolved 2026-07-29** — JSON Schema as source of truth, bindings generated into each project. See [ADR-0004](decisions/ADR0004_SharedModelStrategy.md) |
| Mid-circuit measurement: permitted at MVP or deferred? | Milestone 2 | **Resolved 2026-07-29** — deferred. Measurement terminates a qubit; barriers are exempt. See [CircuitModel.md](CircuitModel.md) |
| Are identifiers client-generated or backend-assigned? | Milestone 2 | **Resolved 2026-07-29** — client-generated, backend-validated. Forced by offline operation and local save |
| Interpreter for the `simulation` extra (Qiskit lacks 3.14 wheels) | Milestone 4 | **Partly answered.** The Docker environment pins 3.13, so simulation work happens there. Whether native 3.14 must also be supported is still open |

Also resolved on 2026-07-29, by accepted ADR: the canonical circuit
representation and the cycle derivation
([ADR-0001](decisions/ADR0001_CircuitRepresentation.md),
[ADR-0003](decisions/ADR0003_ExecutionSemantics.md)), object identity
([ADR-0002](decisions/ADR0002_IdentityModel.md)), and whether
`classicalRegisters` may be absent (required field, may be empty, no implicit
register).

**Nothing now blocks Milestone 2.** The only remaining entry above is scoped to
Milestone 4.

Remaining open questions live at the end of [API.md](API.md) and
[Simulation.md](Simulation.md). `CircuitModel.md` no longer has any.

---

# Milestone 2 — Circuit Model

## Goal

Design the application's central data model.

The model is specified in [CircuitModel.md](CircuitModel.md) and its shape is
settled by ADRs [0001](decisions/ADR0001_CircuitRepresentation.md),
[0002](decisions/ADR0002_IdentityModel.md), and
[0003](decisions/ADR0003_ExecutionSemantics.md). Read those before writing code.

### Tasks

* [x] JSON Schema and generated bindings
* [x] Circuit
* [x] Gate
* [x] Qubit
* [x] Classical Register
* [x] Measurement
* [x] Barrier
* [ ] Serialization
* [ ] Validation
* [ ] Cycle derivation
* [ ] Unit tests
* [ ] Cross-language contract fixtures

A checked entity means it is **defined in the schema and generated into both
languages**. It does not mean the entity behaves correctly: nothing validates a
circuit yet, and nothing derives its cycles. Those are the three unchecked items
and they are the bulk of the milestone.

Barrier and cycle derivation were added by ADR-0001. Barriers were pulled
forward from the deferred list because they are how scheduling intent is
expressed, and retrofitting a concurrency constraint after consumers exist is
expensive. Cycle derivation is a specified component rather than a rendering
detail, and it is implemented twice — TypeScript and Python — so the contract
fixtures are what keep the two honest.

### Exit Criteria

The Circuit model becomes the single source of truth used throughout the application.

No UI or simulator should maintain its own circuit representation.

The cycle derivation produces identical output in both languages across the
fixture set in `shared/fixtures/`, enforced from `tests/contract/`.

### Status

**The schema and its generated bindings are done.**
`shared/schema/circuit.schema.json` is the source of truth;
`shared/generate_bindings.py` generates Pydantic models into the backend and
TypeScript types into the frontend; and a **Shared model** CI job fails the
build if either is stale. ADR-0004's gating task — proving the `Operation`
discriminated union survives generation on both sides — is confirmed.

Three findings from that work are worth not rediscovering:

* **The union needs OpenAPI's `discriminator` keyword.** With a plain `oneOf`,
  Pydantic attempts every branch and reports that none matched: a gate missing
  `name` produced four errors and a barrier carrying illegal `controls`
  produced seven, in both cases burying the real one. With it, each produces
  exactly one, and an unknown `kind` reports the tags it accepts.
* **A *constrained* string inside an array generates as `RootModel[str]`**,
  which is unhashable — `target in qubit_ids` raised `TypeError` rather than
  returning a wrong answer. Hence the `Identifier` / `IdentifierRef` split:
  constraints belong where an id is minted, and a reference is validated by
  resolution, which is strictly stronger.
* **The two generators disagree about line endings.** `.gitattributes`
  normalization hid it in the repository while leaving it in the working tree,
  which would have made the byte-exact CI check fail unconditionally on Linux.
  Generation now normalizes.

**Remaining: validation, the cycle derivation, and the contract fixtures.**
Write each subsystem's fixtures alongside it rather than after both languages
are implemented. Fixtures are the only mechanism that detects divergence, so
deferring them means writing the second implementation blind.

### Known Issues

* **Strict schema versus the forward-compatibility policy.** The schema sets
  `additionalProperties: false`, so a circuit written by a newer *minor* version
  is rejected — but the versioning rules in
  [CircuitModel.md](CircuitModel.md) say it should load with unknown fields
  preserved and a warning surfaced. These are reconcilable: the schema defines
  what a circuit of *its own* version looks like, and the loader inspects
  `schemaVersion` first and applies the schema strictly only for an exact
  match. That loader is specified and unwritten, and the interaction should be
  settled before it is built rather than discovered afterwards.
* `register` generates as `register_` in Python, aliased back to `register` on
  the wire. Cosmetic, and confined to the Python API.

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
