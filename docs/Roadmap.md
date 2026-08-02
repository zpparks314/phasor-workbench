# Phasor Workbench Roadmap

## Project Status

**Current Phase:** Release preparation

**Current Milestone:** Milestone 5 — prepare the project for public deployment.

Milestone 1 (Foundation) closed on 2026-07-28, Milestone 2 (Circuit Model) on
2026-07-30, Milestone 3 (Circuit Editor MVP) on 2026-08-01, and Milestone 4
(Simulation MVP) on 2026-08-02.

**Milestones 1–4 are closed.** The foundation, the Circuit Model, the editor and
simulation all exist and are enforced by tests: 728 frontend and 327 backend,
with 51 fixtures in `shared/fixtures/` holding the two language implementations
to one specification.

A user can build a circuit from empty in the browser, edit its parameters and
measurement targets, save work that survives a refresh, watch its final state
follow every edit, and run it for measurement counts.

The design is settled by ADRs 0001–0008 and by the topic documents. Where this
file and a topic document disagree about behaviour, **the topic document is the
specification** — `CircuitModel.md` for the model, `UI.md` for the editor,
`API.md` for endpoints, `Simulation.md` for the simulator seam.

**Decisions Made** records every question this project has settled, with the
reasoning. Nothing is outstanding.

---

# Open Issues

Everything still outstanding, in one place. None of it blocks Milestone 5, and
the first two are the ones worth clearing during it.

**The canvas grid's screen-reader behaviour is unverified.** The markup follows
the composite-widget pattern and the tests assert roles and names, but SVG
accessibility mapping is inconsistent enough that this proves little. It has now
carried through four milestones, and two later features deliberately steered
around it — the cycle labels are `aria-hidden` rather than a `columnheader` row
precisely so they would not add a row to a model nobody has tested. **A public
release is the point to test this with real assistive technology.**

**Two connector defects in `editor/layout.ts`**, both reachable since multi-qubit
placement landed, and neither a placement bug. Both need a circuit where two
multi-qubit gates share a cycle without sharing a wire, e.g. `cx(q0, q3)` beside
`cx(q1, q2)`:

1. `occupancyByCycle` records an operation's `targets` but not its `controls`,
   so a connector crossing another operation's **control dot** gets the 12px
   empty-wire gap instead of glyph clearance. With `control: 5` that leaves about
   a pixel between line and dot — reading as contact, which is exactly what UI.md
   calls the gap semantically load-bearing to prevent. The one-line fix is wrong
   on its own: `glyphClearance` is sized for a 40px box and far too wide for a
   10px dot, so this wants a third clearance value.
2. Two connectors in one cycle land on the **same x**, nested or overlapping,
   with nothing to distinguish them. No cheap fix; the usual answers are
   splitting the cycle or offsetting one line, and both are design decisions.

**An operation whose every qubit reference dangles is not drawn**, so the
problems strip is the only route to it. That is why the strip selects by path.

**Sampling a circuit with more than one classical register is refused.** Qiskit
reports a separate count dictionary per register and does not correlate them, so
joining would fabricate a measurement it never made. Every circuit the editor
currently produces has one register. A missing feature, not a wrong result.

**`register` generates as `register_` in Python**, aliased back to `register` on
the wire. Cosmetic, and confined to the Python API.

---

# Decisions Made

Every entry is resolved. Kept for the reasoning, which is the part that stops a
settled question being reopened; the full argument is in the ADR each names.

| Decision | Resolution |
|---|---|
| Shared model strategy | JSON Schema as source of truth, bindings generated into each project — [ADR-0004](decisions/ADR0004_SharedModelStrategy.md) |
| Mid-circuit measurement | Deferred. Measurement terminates a qubit; barriers exempt — [CircuitModel.md](CircuitModel.md) |
| Identifier generation | Client-side, backend-validated. Forced by offline operation and local save |
| `classicalRegisters` absent? | Required field, may be empty, no implicit register |
| Canonical representation, cycles, identity | [ADR-0001](decisions/ADR0001_CircuitRepresentation.md), [ADR-0002](decisions/ADR0002_IdentityModel.md), [ADR-0003](decisions/ADR0003_ExecutionSemantics.md) |
| Where codes, signatures and version live | [ADR-0005](decisions/ADR0005_SharedSpecification.md) |
| Version compatibility | Declared version selects a mode, content decides the outcome — [ADR-0006](decisions/ADR0006_VersionCompatibility.md) |
| Undo: snapshots or command/inverse? | Labeled snapshots, bounded at 100. Decided on correctness, not memory: a subtly wrong inverse makes undo produce a *different* circuit rather than failing — [ADR-0007](decisions/ADR0007_EditingModel.md) |
| What "save locally" means | `localStorage` as the working-set store; files are the interchange format and arrive with Milestone 5 |
| Frontend runtime shape validator? | Yes, compiled from the schema during generation. Ajv is a devDependency, never shipped; cost measured at +5.1 KB gzipped — [ADR-0008](decisions/ADR0008_LocalPersistence.md) |
| `schemaVersion` an edited newer-minor circuit declares | This build's own, preserved fields dropped and the loss surfaced first. Preserved fields are keyed by *positional* path and editing reorders operations, so re-grafting would attach a newer build's field to the wrong operation — [ADR-0008](decisions/ADR0008_LocalPersistence.md) §3 |
| Do `invalid/` fixtures assert `path`? | Codes only. Paths are asserted in each project's unit tests, where a format difference is a local bug rather than a contract break |
| Which CI job runs `tests/contract/`? | None. Each fixture declares its own expectation, so parity follows transitively. `tests/contract/` awaits API conformance tests |
| Interpreter for the `simulation` extra | **The question expired.** Qiskit 2.x ships `cp310-abi3` wheels, so it runs on 3.11–3.14 and neither a CI leg nor a container-only extra was needed. The premise lapsed *without any 3.14 wheel being published*, which is why watching for a cp314 tag would never have shown it |
| The `npm audit` findings, deferred behind an ESLint 10 upgrade | **The premise expired**, and rechecking cost one command. Cleared on 2026-08-02 by `npm audit fix` — a lockfile-only `brace-expansion` 1.1.16 → 1.1.18 patch bump on a dev-only transitive dependency. The count had already fallen 5 → 1 and the breaking upgrade was no longer the offered fix, so nothing was traded away. `npm audit` now reports zero. **`--force` is still the thing not to run** |

Also resolved during Milestone 4, and recorded in the documents they affect:
measurements are ignored rather than rejected by the statevector endpoint
(API.md), there is no separate internal representation (Simulation.md), and the
mock is computed for analysis but recorded for simulation (Frontend.md).

---

# Current Objectives

The highest priorities are:

1. ~~Repository setup~~ — done
2. ~~Development environment~~ — done, native and Docker
3. ~~Documentation~~ — done; `UI.md` written for Milestone 3 scope, with results
   and visualization placement deferred to Milestone 4
4. ~~Core data model~~ — done, Milestone 2
5. ~~Testing infrastructure~~ — done; enforced by CI
6. ~~Circuit editor~~ — done, Milestone 3
7. ~~Simulation~~ — done, Milestone 4
8. **Public release** — active, Milestone 5

The rule that gated Milestone 3 — do not build on a provisional data model — held.
The model was settled first, and the editor never had to renegotiate it. Milestone
4 inherits the same position: it consumes a circuit the editor already produces
correctly, and `deriveCycles` already gives it depth and scheduling.

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
the *Decisions Made* table below first, since three of its entries shape that
milestone directly.

### What It Settled

CI runs lint, format, type check, test and build for both projects on every
push, across two Python and two Node versions, plus a Docker image build and a
generated-bindings staleness check. Only the aggregate `CI` check is required by
branch protection, because matrix job names carry their version and requiring
them directly would leave a new leg unprotected.

Continuous *deployment* is deliberately absent. It belongs with **Deployment** in
Milestone 5 and should consume the Dockerfiles rather than duplicate them; both
are multi-stage so adding a `production` target is additive.

Two findings live where they apply rather than here: the Windows bind-mount
polling requirement in `compose.yaml`, and the repository admin bypass on branch
protection — a deliberate trade for a solo project, worth revisiting at the first
outside contributor.


# Milestone 2 — Circuit Model

## Goal

Design the application's central data model.

The model is specified in [CircuitModel.md](CircuitModel.md) and its shape is
settled by ADRs [0001](decisions/ADR0001_CircuitRepresentation.md),
[0002](decisions/ADR0002_IdentityModel.md), and
[0003](decisions/ADR0003_ExecutionSemantics.md). Read those before writing code.

### Tasks

* [x] JSON Schema and generated bindings
* [x] Shared specification data — gate signatures, violation codes, version
* [x] Circuit
* [x] Gate
* [x] Qubit
* [x] Classical Register
* [x] Measurement
* [x] Barrier
* [x] Serialization — versioned loader, backend; frontend deferred to Milestone 3
* [x] Validation — both languages, agreeing on the shared fixtures
* [x] Cycle derivation — both languages, agreeing on the shared fixtures
* [x] Unit tests — 190 backend, 168 frontend
* [ ] Cross-language contract fixtures — `valid/`, `invalid/semantic/`, and
  `decomposition/` done; `invalid/shape/` lands with the validation endpoint

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

* [x] The cycle derivation produces identical output in both languages across the
  fixture set in `shared/fixtures/`. Enforced from each project's own suite rather
  than from `tests/contract/` — each fixture declares its expected decomposition,
  so both sides measure against the same artifact and agreement follows
  transitively. Verified beyond the fixtures by diffing both implementations'
  output over all 17 circuits in the repository.
* [x] The Circuit model is the single source of truth, and nothing maintains a
  second representation.
* [x] Validation agrees across both languages on all 25 validation fixtures,
  including paths, which the fixtures do not themselves enforce.

**A caveat worth stating rather than glossing.** The middle criterion is currently
satisfied *vacuously*: there is no UI and no simulator, so nothing exists that
could hold a competing representation. It becomes a real constraint in Milestone 3,
when the editor is the first consumer with a reason to want its own copy. The rule
is in place — `Architecture.md`, `Frontend.md`, and ADR-0001 all forbid it — but it
has not yet been tested by anything that would be tempted to break it.

**Milestone 2 is complete.** Milestone 3 (Circuit Editor MVP) may begin.

### What It Settled

**Two shared sources of truth, not one.** `circuit.schema.json` defines a
circuit's shape; `circuit.spec.json` defines the semantics a schema cannot
express — gate signatures, violation codes with their `phase`, and the model
version. Bindings generate into both languages and the **Shared model** CI job
fails the build if any is stale.

**Four hand-written implementations, held to 51 fixtures.** Validation and cycle
derivation exist in both languages and agree on every fixture — verified beyond
what the fixtures enforce by diffing the implementations directly: 25 violations
with identical codes *and* paths, 17 decompositions with identical cycles,
barriers and depth.

**Every empirical finding lives beside the thing it constrains**, not here. See
the `$comment` fields in `circuit.schema.json` and the comments in
`generate_bindings.py`.

Two corrections worth keeping, because both were wrong in prose before they were
right in code:

* **A barrier levelling an unequal frontier can raise depth.** The earlier claim
  that annotating a circuit never changes its depth was false in general;
  `barrier_levels_unequal_frontiers.json` is the counterexample. What holds is
  narrower — a barrier contributes no cycle *of its own*.
* **The versioning table conflated two questions.** "Minor" describes what the
  producer did; it does not follow that an older consumer can read the result.
  See ADR-0006.


---

# Milestone 3 — Circuit Editor MVP

## Goal

Allow users to visually construct quantum circuits.

### Tasks

* [x] Editing model and history — pure edits, snapshot stack, coalescing
* [x] Undo — keyboard and header button
* [x] Redo — keyboard and header button
* [x] Render quantum wires — read-only canvas, all glyph kinds
* [x] Add and remove qubits
* [x] Add and remove classical registers — with an editable size
* [x] Gate palette
* [x] Place gates
* [x] Remove gates
* [x] Move gates — drag and keyboard
* [x] Multi-qubit gates — placed by control assignment, pointer and keyboard
* [x] Place measurements
* [x] Place barriers — expanded to every wire at placement time
* [x] Save locally

**This list was reordered and extended on 2026-07-30.** Two changes, both
deliberate:

**History moved to the front.** It previously sat seventh, after placement,
removal, and movement. That ordering treated undo as a feature beside the editing
features when it is a constraint on how every one of them is expressed — edits
written as ad-hoc mutation and then retrofitted with history means rewriting each
one. See [ADR-0007](decisions/ADR0007_EditingModel.md).

**Qubits, registers, measurements, and barriers were added.** The original list
covered gates only, which cannot satisfy the exit criteria below: a circuit with
no qubits has nowhere to put a gate, and a circuit that cannot hold a measurement
gives Milestone 4 nothing to simulate. Milestone 4's measurement simulation and
probability display would have begun by finishing Milestone 3.

### Exit Criteria

Replaced on 2026-07-30. The previous single sentence — "users can build simple
circuits entirely within the browser" — is the goal, but it is not checkable, and
the Definition of Done leans on these.

* [x] A user can build a circuit from empty: add and remove qubits and classical
  registers, with qubit indices contiguous from 0 at every point.
* [x] A user can place, move, and remove every gate in `circuit.spec.json`'s gate
  set, plus measurements and barriers.
* [x] Multi-qubit gates are placed with explicit control assignment and render
  with connectors spanning intervening idle wires.
* [x] Render columns come from `deriveCycles` on every render. No component
  stores a coordinate, a column index, or a second copy of the circuit —
  asserted by a test that the store's state is a bare `Circuit`.
* [x] Every violation `validateCircuit` reports is surfaced against the operation
  it concerns and clears when fixed. No violation is cached across an edit.
* [x] Undo and redo restore the exact prior circuit for every edit type, verified
  by a property test: apply a random valid edit sequence, undo to the start,
  assert deep equality with the initial circuit.
* [x] A circuit survives a browser refresh, and `frontend/src/serialization/`
  produces the same outcome as the Python loader on all 14 fixtures in
  `shared/fixtures/version/`.
* [x] Placement, selection, and removal are operable by keyboard.
* [x] `UI.md` is written; ADR-0007 and ADR-0008 are Accepted; `Frontend.md` and
  `ProjectStructure.md` carry the new modules.

Two of these are worth noting for why they are cheap rather than aspirational.
The undo property test is possible because ADR-0007 makes `state/` headless and
edits pure — it is the same property-testing discipline ADR-0003 established for
the derivation. And the loader criterion costs no new fixtures: the version
fixtures declare `outcome`, `violations`, and `preserved` in a language-neutral
form, so the TypeScript loader is held to the same 14 artifacts as the Python one
and parity follows transitively, exactly as it does for validation and cycles.

### What It Settled

Everything user-facing about the editor is specified in [UI.md](UI.md); the
editing model is [ADR-0007](decisions/ADR0007_EditingModel.md) and local
persistence [ADR-0008](decisions/ADR0008_LocalPersistence.md). This section does
not restate them.

Three properties are easy to undo by accident and are asserted by tests rather
than only described:

* **The store holds a bare `Circuit`.** The decomposition, geometry, cell
  contents and violations are recomputed every render; no component stores a
  column or a coordinate. This milestone is where that rule stopped being
  vacuous, since the editor was the first consumer with a reason to want its own
  copy.
* **Edits take identifiers as arguments rather than minting them.** A function
  calling `crypto.randomUUID()` internally is not pure, and the undo property
  test would have nothing to compare against.
* **A placement sequence is driven by the gate's signature, never its name.** A
  gate added to `circuit.spec.json` gets its sequence for free; reading it off
  the name would be a second description of the spec.

`@testing-library/user-event` was considered and declined — `fireEvent` from the
already-installed library covers keydown and click.


---

# Milestone 4 — Simulation MVP

## Goal

Execute circuits and display results.

### Tasks

* [x] Parameter editing — an inspector, which closed the measurement-target
  deferral at the same time
* [x] Backend API — `POST /api/v1/circuits/analyze`, the first circuit endpoint
* [x] Qiskit integration — the backend seam, and the adapter behind it
* [x] Statevector simulation — `POST /api/v1/simulations/statevector`
* [x] Measurement simulation — `POST /api/v1/simulations/sample`
* [x] Probability display — exact and sampled, in one list
* [x] Gate count
* [x] Circuit depth
* [x] Cycle labels — added to this milestone on 2026-08-02, at the owner's
  request, and not in the original list. It belongs here rather than in
  *Educational Visualizations*: depth had just become a number the app reports,
  and this is what makes that number checkable against the circuit

### Exit Criteria

Users can build a circuit and receive valid simulation results.

### What It Settled

The endpoints are specified in [API.md](API.md), the simulator seam and the
Qiskit adapter in [Simulation.md](Simulation.md), and the inspector, cycle
labels and results panel in [UI.md](UI.md). This section does not restate them.

Four things that are not obvious from any one of those:

* **Qiskit is behind a seam exactly one module crosses.** A test asserts that no
  file outside `simulation/backends/qiskit_backend.py` imports it. That
  isolation is what makes a second backend possible, and it is invisible until
  the day something breaks it.
* **There is no separate internal representation**, though Simulation.md
  originally called for one. The Circuit Model is already simulator-agnostic, so
  the intermediate structure would have been a second description of the same
  circuit. Reintroduce one only if a backend needs a form the model cannot
  express.
* **Three limits share two numbers and have different owners**: a backend
  declares what it *can* do, configuration declares what a deployment *permits*,
  and the statevector endpoint's cap is neither — it is a response-size limit,
  because 2^n objects of JSON hangs a browser long before the simulation would
  struggle. The effective limit is the lowest, and each error says which refused.
* **Absence of the `simulation` extra is an ordinary state.** The app installs,
  imports and runs without it; the registry reports no backends and the
  simulation tests skip. Both CI legs install it, so nothing in CI exercises
  that path — check it by hand when touching the registry.


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

Written on 2026-08-02, replacing the single sentence "the application is suitable
for public use and portfolio demonstration." That sentence is the goal and
remains it; what follows is what would make it true. Milestone 3's criteria were
replaced mid-milestone for exactly this reason, which is why the instruction to
do it *before* starting was left here.

* [ ] A circuit exports to a JSON file and re-imports deep-equal, and import
  routes through the existing versioned loader in `frontend/src/serialization/`
  rather than a second one — asserted by driving the import path over all 14
  fixtures in `shared/fixtures/version/` and getting each fixture's declared
  `outcome`.
* [ ] Every circuit in `shared/fixtures/valid/` exports to OpenQASM and
  re-imports with the same operation sequence and the same `deriveCycles`
  output. Identifiers may differ — ADR-0002 makes them arbitrary — so equality
  is asserted structurally, not on the document.
* [ ] The three questions OpenQASM import asks of the model are answered in
  `docs/`, with reasoning: what a bare `barrier;` expands to, what becomes of a
  gate `circuit.spec.json` does not have, and how a QASM register maps onto
  `classicalRegisters`. Two have recorded answers already, so the criterion is
  that the implementation either confirms them or the document records what
  changed and why.
* [ ] Example circuits load, validate without violations, and simulate. Each is
  authored through the import path rather than hand-written JSON — that is what
  makes them evidence the path works rather than decoration.
* [ ] At 1280px, 768px and 375px every region is reachable and the body never
  scrolls horizontally. The canvas keeps its own horizontal scroll; that is not
  the same thing.
* [ ] **An import that fails to parse reaches the user with its cause**, matching
  the treatment the rest of the set already gets: local storage unavailable or
  full, an unreadable stored document and a newer-build document from Milestone
  3, the backend unreachable from Milestone 4. Import is the only member of that
  set with nothing behind it, so this task is narrower than its name suggests.
* [ ] An unhandled render error shows something other than a blank page. This is
  the failure the Definition of Done's browser check was added for, and nothing
  currently catches it.
* [ ] The `?` shortcut reference exists and is derived from the same source the
  editor binds its keys from, so it cannot drift from behaviour. It is currently
  the one row in `UI.md`'s shortcut table with nothing behind it.
* [ ] `README.md` describes the application that exists. It currently announces
  "**Project status: building the circuit model**", says there is no editor, no
  validation and no simulation, reports 256 backend tests and `/health` as the
  only endpoint, calls `UI.md` deferred and `API.md` and `Simulation.md` drafts,
  and repeats the expired Qiskit-3.14-wheels claim. All of that was true two
  milestones ago. It is the repository's front page, so it is the one document
  whose staleness is publicly visible, and a newcomer must be able to install,
  run and test both projects from it alone — `.claude/CLAUDE.md` is an agent's
  file, not a contributor's. The *Current Status* table is also structurally
  broken: four rows sit below the prose that closes it.
* [ ] Both Dockerfiles gain a `production` target, additively as they were built
  for, and the deployed application loads in a browser.
* [ ] **The canvas grid has been driven with a real screen reader**, and what it
  actually announced is recorded in `UI.md` beside the markup that section
  describes. Pass or fail, the recorded result is the criterion.
* [ ] Both `editor/layout.ts` connector defects are fixed, or deferred with the
  reasoning written down and a test pinning current behaviour. Defect 2 is a
  design decision and may legitimately end deferred — *silently* is what it may
  not end.

Three of these deserve their reasoning stated, because in each case the cheap
version is the one that proves nothing.

**The JSON criterion is about the loader, not the file.** Reading a circuit off
disk is a dozen lines. The risk is that it grows a second, laxer path beside
`serialization/`, and then a document rejected on refresh is accepted on import.
The fixtures to prevent that already exist and cost nothing to point at.

**The QASM criterion asserts structural equality deliberately.** The round trip
is the first real test of ADR-0001, and asserting *document* equality would fail
on identifier regeneration alone — noise, not a finding. What has to survive the
trip is the circuit.

**The accessibility criterion cannot be met by a test.** The suite already
asserts roles and names, and that is precisely the evidence *Open Issues* calls
insufficient. This one is met by a person and real assistive technology, and its
output is a paragraph in `UI.md` rather than a green check.

### Where to Pick Up

**Read first:** this section, then *Open Issues* above.

**Nothing blocks starting.** No decision is outstanding, `main` is green, and
the app runs natively and in Docker on 3.11 and 3.14.

**This milestone is a different kind of work.** The first four built the thing;
this one makes it fit for other people. Two consequences worth planning for:

**OpenQASM import/export is the real test of ADR-0001.** It is the first time
the Circuit Model meets a format it was not designed around, and the first
consumer that can genuinely disagree with it — an importer has to answer what a
bare `barrier;` expands to, what happens to a gate the spec does not have, and
how a QASM register maps onto `classicalRegisters`. The first two already have
answers recorded (expansion at placement time; `UNKNOWN_GATE_NAME`), and the
value of doing import early is that it either confirms them or exposes a gap
while there is still room to move.

**The accessibility gap should close here.** *Open Issues* has the detail: the
grid's screen-reader behaviour has never been checked against real assistive
technology, and "suitable for public use" is not honestly claimable while that
is true.

**Suggested order.** JSON import/export first — it is the smallest, it reuses
`serialization/` unchanged, and it gives OpenQASM a working file-handling path
to build on. Then OpenQASM import, then export, then example circuits, which
need an import path to be written in anything but hand-authored JSON. Deployment
last, since it consumes the Dockerfiles and should not be built against a moving
target.

**One exception, found on 2026-08-02: `README.md` should be fixed early rather
than with the rest of *Documentation*.** Every other stale document is read by
someone who has already cloned the repository; this one is the front page, and
it currently tells a visitor the project has no editor and no simulation. It is
also the only Milestone 5 task that costs nothing to do now — it depends on
none of the others, and leaving it until the end means the milestone's most
visible artifact is wrong for the whole of it.

**Two things already prepared for this milestone.** Both Dockerfiles are
multi-stage, so adding a `production` target is additive rather than a rewrite.
And the three-column grid was built so that collapsing it for small screens is a
change to the grid rather than to the components.

**`docs/API.md` lists deferred endpoints** — QASM import/export and examples —
so the path structure stays coherent when they arrive.

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
* **The application loads in a browser.**
* Documentation is updated.
* Linting passes.
* Type checking passes.
* Code has been reviewed.
* The application remains deployable.

**The browser check was added on 2026-08-02, and it was added because everything
else on this list passed while the page rendered nothing.** The compiled validator
carried a CommonJS `require` that a browser cannot resolve; the suite runs in Node,
where `require` exists, so 600 tests, the type checker, the linter and the
production build were all satisfied by a module that could not load. Tests, types
and lint are evidence about the code. None of them is evidence that the thing
starts, and the gap between those is exactly where that bug lived.

`npm run dev` and looking at the page is enough. It takes a few seconds, and it is
the only item here that would have caught it.

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
