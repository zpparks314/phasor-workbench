# Phasor Workbench Roadmap

## Project Status

**Current Phase:** Circuit Editor

**Current Milestone:** Milestone 3 — allow users to visually construct circuits.

Milestone 1 (Foundation) closed on 2026-07-28. Milestone 2 (Circuit Model) closed
on 2026-07-30.

**The Circuit Model is complete and enforced.** Its design is settled by ADRs
0001–0006. Both languages validate circuits and derive cycles, agreeing on every
fixture; the backend loads documents across versions. 256 backend tests and 168
frontend tests, with 51 fixtures in `shared/fixtures/` holding the two
implementations to one specification.

Nothing in the model is provisional, which was the point of finishing it before
the editor: Milestone 3 builds on a settled foundation rather than on something it
will have to renegotiate.

**Milestone 3 has started with its design decisions rather than its components.**
[ADR-0007](decisions/ADR0007_EditingModel.md) is Accepted and settles the editing
model — edits as pure functions, a bounded stack of labeled snapshots, and
coalescing declared by the interaction. [UI.md](UI.md) is written for this
milestone's scope. Local storage is chosen as the persistence mechanism.

Three entries remain in **Decisions Awaiting the Owner** — two scoped to Milestone
3, one to Milestone 4. The two Milestone 3 entries are one decision cluster and
land together in ADR-0008, alongside the frontend loader; neither blocks the
editor work that precedes local save.

---

# Current Objectives

The highest priorities are:

1. ~~Repository setup~~ — done
2. ~~Development environment~~ — done, native and Docker
3. ~~Documentation~~ — done; `UI.md` written for Milestone 3 scope, with results
   and visualization placement deferred to Milestone 4
4. ~~Core data model~~ — done, Milestone 2
5. ~~Testing infrastructure~~ — done; enforced by CI
6. **Circuit editor** — active, Milestone 3

The rule that gated Milestone 3 — do not build on a provisional data model — is
satisfied. The model is settled, and the editor is the first subsystem to read
from it.

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
| Does the frontend gain a runtime shape validator, and at what dependency cost? | Milestone 3 | **Open, and now due — but narrowed 2026-07-30.** Deferred by ADR-0005 section 6 until local save made it concrete. Local save is that requirement. The narrowing: "no dependency" in practice means hand-writing a shape checker, which is a second hand-maintained description of the schema — precisely what ADR-0004 exists to prevent, and what the backend loader avoids by letting Pydantic decide unknown-ness so there is no list to drift. The frontend gets that property only by validating against `circuit.schema.json` itself, so the real choice is *which* schema-driven mechanism: a runtime validator library, or a validator compiled from the schema during `generate_bindings.py`. Measure the second before assuming the first. Lands in ADR-0008 |
| Do `invalid/` fixtures assert `path` as well as `code`? | Milestone 2 fixtures | **Resolved 2026-07-30** — codes only. Fixtures compare sorted code lists; paths are asserted in each project's own unit tests, where a format difference is a local bug rather than a contract break |
| What `schemaVersion` does an *edited* newer-minor circuit declare on save? | Milestone 3 | **Open.** Round-tripping preserves the declared version, which is right for read-then-write. Editing is different: the document still carries preserved fields this build does not understand, so claiming our own version would be a lie, and keeping theirs claims features we did not write. Surfaced by the loader; ADR-0006 does not address it. Lands in ADR-0008 |
| Snapshot history or command/inverse for undo? | Milestone 3 | **Resolved 2026-07-30** — labeled snapshots, bounded at 100. Decided on correctness, not memory: an inverse that is subtly wrong makes undo produce a *different* circuit rather than failing, and every future edit type would owe one. See [ADR-0007](decisions/ADR0007_EditingModel.md) |
| What does "save locally" mean mechanically — `localStorage`, File System Access, or download/upload? | Milestone 3 | **Resolved 2026-07-30** — `localStorage`, as the working-set store; files are the interchange format and arrive with Milestone 5's JSON import/export. Was not previously tracked here, and had no home in the layout either. Four consequences are handled rather than discovered: it can throw on *access* under private browsing, quota errors are thrown rather than returned, clearing site data destroys work silently, and it does **not** remove the need for the loader |
| Which CI job runs `tests/contract/`? | Milestone 4 | **Moot for Milestone 2.** Each fixture declares its own expectation, so each project's suite asserts against the same artifact and parity follows transitively — no cross-language runner and no new CI job. `tests/contract/` is left holding API conformance, which needs endpoints. See `tests/README.md` |

Also resolved on 2026-07-29, by accepted ADR: the canonical circuit
representation and the cycle derivation
([ADR-0001](decisions/ADR0001_CircuitRepresentation.md),
[ADR-0003](decisions/ADR0003_ExecutionSemantics.md)), object identity
([ADR-0002](decisions/ADR0002_IdentityModel.md)), and whether
`classicalRegisters` may be absent (required field, may be empty, no implicit
register).

Also resolved on 2026-07-29, by accepted
[ADR-0005](decisions/ADR0005_SharedSpecification.md): where violation codes, gate
signatures, and the current model version live; where the hand-written validation
and cycle derivation live in each project; and that frontend runtime *shape*
validation is deferred to Milestone 3.

**Nothing blocks starting Milestone 3.** Of the entries above still open, one is
scoped to Milestone 4 and two land during Milestone 3 itself — see *Starting
Points* under that milestone.

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

### Status

**Both shared sources and their generated bindings are done.**
`shared/schema/circuit.schema.json` defines a circuit's shape and
`shared/spec/circuit.spec.json` defines the semantics a schema cannot express —
gate signatures, violation codes, and the current model version.
`shared/generate_bindings.py` generates Pydantic models and TypeScript types from
the first and typed constants from the second, and a **Shared model** CI job
fails the build if any of the four outputs is stale. ADR-0004's gating task —
proving the `Operation` discriminated union survives generation on both sides —
is confirmed.

**The module layout for the hand-written half is settled**
([ADR-0005](decisions/ADR0005_SharedSpecification.md)). `validation/` and
`cycles/` exist in both projects, carry the same names, and are empty pending the
next two tasks. Generation refuses to run if the schema and spec disagree about
the gate set, so adding a gate is now guarded end to end rather than half of it
being a hand edit.

One scope decision worth knowing before writing frontend code: Milestone 2 gives
the frontend **semantic validation only**. Runtime shape validation is deferred to
Milestone 3, when the frontend first reads a circuit it did not build — see
ADR-0005 section 6.

**Semantic validation is done in both languages**, with 25 fixtures in
`shared/fixtures/valid/` and `shared/fixtures/invalid/semantic/`. All twelve
semantic violation codes have fixture coverage, enforced in each suite by a test
that fails if a code is added without one. `validate_circuit` /
`validateCircuit` take an already-parsed `Circuit` and report every violation,
each with a code from the generated spec and a document path in the format
`API.md` specifies.

**The two agree, and it was checked rather than assumed.** Across all 20 invalid
fixtures the implementations produce the same 25 violations with the same codes
*and* the same paths. The fixtures only enforce codes, so path agreement was
verified by diffing both implementations' output directly.

Two consequences worth carrying forward. Shape rejection is the parse boundary's
job, so `shared/fixtures/invalid/shape/` stays empty until the endpoint that maps
a parse failure into the error envelope exists. And parity needs no
cross-language runner — see the table entry above and `tests/README.md`.

**The cycle derivation is done in both languages**, with 12 fixtures in
`shared/fixtures/decomposition/` covering the nine cases ADR-0003 enumerates.
Every expected decomposition was hand-computed from the ADR's algorithm rather
than recorded from the implementation. ADR-0003's guaranteed properties are
asserted over every circuit in the repository — the decomposition fixtures and
the `valid/` fixtures alike, since the latter are valid circuits and therefore
free extra inputs.

Building those fixtures corrected a claim this document had been making: a
barrier contributes no cycle *of its own*, but a barrier levelling an unequal
frontier delays later operations and **can** raise depth. The previous wording —
"annotating a circuit must never change its reported depth" — was false in
general, and `barrier_levels_unequal_frontiers.json` is the counterexample. ADR-
0003's normative statement is correct; only the prose around it overstated. See
the note under the worked decomposition in
[CircuitModel.md](CircuitModel.md).

The two implementations agree on all 17 circuits in the repository — the 12
decomposition fixtures plus the 5 in `valid/`. That second group matters: those
have no declared decomposition, so a direct diff of both implementations' output
is the only thing checking they agree there.

**The versioned loader is done in Python**, implementing
[ADR-0006](decisions/ADR0006_VersionCompatibility.md), with 14 fixtures in
`shared/fixtures/version/` covering all five load-phase codes. The declared
version selects a mode and the content decides the outcome: unknown *fields* on a
newer-minor document are stripped, preserved with their document paths, and warned
about; an unknown gate or operation kind is refused with its own code.

Two details worth carrying forward. **Unknown-ness is decided by Pydantic**, not
by a second description of the schema — parsing reports every `extra_forbidden`
error with its exact location, so the thing that rejects unknown fields is also
the authority on what they are, and there is no list to drift. And the **migration
registry ships empty**, since `0.1.0` is the first version; its shape is exercised
by synthetic migrations in the tests, including one that fails to advance the
version, which would otherwise loop forever.

**Remaining in Milestone 2:** nothing substantive. `invalid/shape/` fixtures
belong to the validation endpoint rather than the loader, and the TypeScript
loader is deferred to Milestone 3 with the local-save requirement in hand.

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

* ~~**Strict schema versus the forward-compatibility policy.**~~ **Resolved in
  design 2026-07-30** by [ADR-0006](decisions/ADR0006_VersionCompatibility.md).
  The tension was never real: `schemaVersion` is a top-level string, so the loader
  reads and compares it *before* handing anything to a validator, and strictness
  never has to relax. Settling it did surface a real problem — the versioning
  table classified gate and operation-kind additions as minor while implying an
  older build could still load them, which is false. The table now states the
  version bump and the loadability separately. **The loader itself is still
  unwritten.**
* **`Metadata` silently discarded unknown keys** — the one object in the schema
  without `additionalProperties: false`, so Pydantic dropped them without an
  error, contradicting both the round-trip rule and `CLAUDE.md`. **Fixed
  2026-07-30** under ADR-0006.
* `register` generates as `register_` in Python, aliased back to `register` on
  the wire. Cosmetic, and confined to the Python API.

---

# Milestone 3 — Circuit Editor MVP

## Goal

Allow users to visually construct quantum circuits.

### Tasks

* [x] Editing model and history — pure edits, snapshot stack, coalescing
* [ ] Undo — keyboard done, no button yet
* [ ] Redo — keyboard done, no button yet
* [x] Render quantum wires — read-only canvas, all glyph kinds
* [ ] Add and remove qubits
* [ ] Add and remove classical registers
* [x] Gate palette
* [x] Place gates
* [x] Remove gates
* [x] Move gates — drag and keyboard
* [ ] Multi-qubit gates
* [ ] Place measurements
* [ ] Place barriers
* [ ] Save locally

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

* [ ] A user can build a circuit from empty: add and remove qubits and classical
  registers, with qubit indices contiguous from 0 at every point.
* [ ] A user can place, move, and remove every gate in `circuit.spec.json`'s gate
  set, plus measurements and barriers.
* [ ] Multi-qubit gates are placed with explicit control assignment and render
  with connectors spanning intervening idle wires.
* [ ] Render columns come from `deriveCycles` on every render. No component
  stores a coordinate, a column index, or a second copy of the circuit —
  asserted by a test that the store's state is a bare `Circuit`.
* [ ] Every violation `validateCircuit` reports is surfaced against the operation
  it concerns and clears when fixed. No violation is cached across an edit.
* [ ] Undo and redo restore the exact prior circuit for every edit type, verified
  by a property test: apply a random valid edit sequence, undo to the start,
  assert deep equality with the initial circuit.
* [ ] A circuit survives a browser refresh, and `frontend/src/serialization/`
  produces the same outcome as the Python loader on all 14 fixtures in
  `shared/fixtures/version/`.
* [ ] Placement, selection, and removal are operable by keyboard.
* [ ] `UI.md` is written; ADR-0007 and ADR-0008 are Accepted; `Frontend.md` and
  `ProjectStructure.md` carry the new modules.

Two of these are worth noting for why they are cheap rather than aspirational.
The undo property test is possible because ADR-0007 makes `state/` headless and
edits pure — it is the same property-testing discipline ADR-0003 established for
the derivation. And the loader criterion costs no new fixtures: the version
fixtures declare `outcome`, `violations`, and `preserved` in a language-neutral
form, so the TypeScript loader is held to the same 14 artifacts as the Python one
and parity follows transitively, exactly as it does for validation and cycles.

### Where to Pick Up

Written at the end of the session that built the palette and placement. The task
list above is the plan; this is what a new session needs that the list does not
say.

**Read first:** [ADR-0007](decisions/ADR0007_EditingModel.md) and [UI.md](UI.md).
Everything below assumes both.

**The next piece of work, in order:**

1. **Move gates.** The pure half already exists — `moveOperation` in
   `state/edits.ts` and `insertionIndexFor` in `editor/placement.ts` — so this is
   a drag interaction over machinery that is built and tested. Use a coalescing
   key of `move:<operationId>` and call `store.endCoalescing()` when the gesture
   ends, or the whole drag becomes one undo step per intermediate position.
2. **The settle animation.** Do this *with* move, not after. Placement already
   packs a gate left of where it was dropped, correctly and tested, but nothing
   explains why — it currently looks like a bug. This is the one piece of `UI.md`
   doing the educational work, and it is the oldest outstanding gap.
3. **Multi-qubit placement.** The palette entries are present and
   `aria-disabled`; `PaletteEntry.placeable` is the flag to remove. Needs the
   control-assignment sequence in `UI.md`: place the target, then one click per
   control, `Escape` cancelling the whole pending operation rather than one step.
4. **Measurements and barriers**, then **qubit and register management**.
5. **Undo/redo buttons.** The model is complete and labelled — `undoLabel` and
   `redoLabel` on the store state exist so the buttons can say "Undo place H"
   rather than "Undo". This is a header, not a feature.

**Known gaps, none of them accidental:**

* **Barriers have no keyboard path.** They sit on boundaries *between* columns, so
  they are in no grid cell, and mouse is currently the only way to select one.
  This violates `UI.md`'s "nothing is reachable by mouse alone" and should be
  settled alongside barrier placement — it needs a decision about how boundaries
  participate in the grid, not a patch.
* **An operation whose every qubit reference dangles is not drawn**, so the
  problems strip is the only route to it. Acceptable, but it is why that strip
  selects by path.
* **Rotation and phase gates place with a default of π/2** and cannot be edited.
  Parameter editing is unbuilt.
* **The grid's screen-reader behaviour is unverified.** The markup follows the
  composite-widget pattern and the tests asserted names and roles, but SVG
  accessibility mapping is inconsistent enough that this proves little. Test it
  with a real screen reader before Milestone 3 closes.
* **`editor/demoCircuit.ts` is scaffolding** and should be deleted once the editor
  opens on an empty circuit or on restored local storage.

**Move and the settle animation are built.** Dragging works by pointer and by
`Ctrl/Cmd` + arrow; the settle animates an operation from where it was requested
to the column the derivation gave it, which is the piece of `UI.md` doing the
educational work and was the oldest outstanding gap. Keyboard undo/redo landed
with it — not scope creep, but because "a drag is one undo step" is untestable
without it, and ADR-0007's coalescing would otherwise have shipped unexercised.

**Three ordering bugs came out of that work, all the same mistake.** Each was a
rule that reads correctly in prose while quietly assuming list position tracks
execution time. It does not: the list is canonical and cycles are derived.

1. The move index was computed from an operation's **target only**, so a `cx`'s
   control wire was ignored and a two-qubit gate dragged right landed far left.
2. The index was computed with the moving operation **still in the list**, so it
   was its own predecessor and never moved.
3. The rule took "after the last operation before the column", which is only
   equivalent to "before the first at or after it" **along a single wire**.
   Across wires the two disagree, and a barrier dragged beside two measurements
   landed on the wrong side of one and stopped constraining it.

**A fourth class, three times over: the cell layer.** Transparent cells cover the
canvas and swallow anything drawn beneath them. That broke barrier selection, gate
pick-up, and barrier dragging in turn. The stacking order and the rule it implies
are now written down in `UI.md`.

**One of those shipped with a passing test**, which is the finding worth keeping:
the drag test dispatched `pointerDown` directly on the glyph element, bypassing
hit-testing entirely. It asserted that a handler works when called, not that a
user can call it. Interaction tests now fire on the element a browser would hit.

**Milestone 3's two open decisions are still open** and are unblocked — see
*Decisions Awaiting the Owner*. They land together in ADR-0008 with the frontend
loader, and nothing before local save depends on them.

### Starting Points

**Available to build on.** `frontend/src/model/` for the types,
`frontend/src/validation/` for inline feedback, and `frontend/src/cycles/` for
render columns. `deriveCycles` also returns the barrier placements a renderer
needs to draw on a column boundary.

The editor computes pixel geometry — that is `editor/layout.ts`, a pure function
of `(circuit, decomposition)` kept out of the components so it is testable without
a DOM. What it must never do is decide *which column* an operation occupies. That
is the derivation's answer, recomputed every render and never stored. See
[Frontend.md](Frontend.md) and
[ADR-0001](decisions/ADR0001_CircuitRepresentation.md).

**Settled 2026-07-30, before any component was written:**

* **The editing model** — [ADR-0007](decisions/ADR0007_EditingModel.md), Accepted.
  Edits are pure `Circuit → Circuit` functions from a named vocabulary; history is
  a bounded stack of labeled snapshots; coalescing is declared by the interaction
  rather than inferred from timing; history holds circuit values only.
* **Interface design** — [UI.md](UI.md), written for this milestone's scope with
  results and visualization left to Milestone 4.
* **Persistence mechanism** — `localStorage`, as the working-set store. Files are
  the interchange format and arrive with Milestone 5's JSON import/export.

**Two decisions this milestone still must make.** They are one cluster, and land
together in ADR-0008 with the loader they force:

1. **Runtime shape validation on the frontend.** Deferred by
   [ADR-0005](decisions/ADR0005_SharedSpecification.md) section 6 until local save
   gave it a concrete requirement. Local save is that requirement.
2. **What `schemaVersion` an edited newer-minor circuit declares on save.**

`localStorage` does not make either question go away, and it is worth saying so
because it looks like it might. A stored document was written by *some* build —
possibly older, possibly a partial write, possibly hand-edited through devtools —
so it is still a circuit the editor did not build, and ADR-0006's argument that a
version claim is unverifiable evidence applies to it unchanged.

### Status

**`frontend/src/state/` is built and tested** — the edit vocabulary, the history
stack, and the store, implementing ADR-0007. Headless, with no React import in
the module, so all of it is tested without a DOM. 52 new tests, taking the
frontend suite to 220. Nothing renders yet and the application is unchanged, which
is the point of building this half first.

Two things from that work worth not rediscovering:

* **Edits take identifiers as arguments rather than minting them.** A function
  that calls `crypto.randomUUID()` internally returns a different circuit on every
  call, which is not a pure function and cannot be asserted against — the undo
  property test would have had nothing to compare. Callers mint; `state/edits.ts`
  stays pure. `newIdentifier()` lives in its own module for that reason.
* **Removing a qubit shrinks a barrier rather than deleting it.** A barrier
  constrains a *set* of qubits and the constraint on the rest survives one of them
  leaving. Deleting it would silently change the circuit's depth. A barrier left
  with no targets is dropped, since empty targets are shape-invalid.

The undo property test found a real weakness in its own generator before it found
anything else: with uniformly chosen edits, `removeQubit` — which deletes every
operation on its wire — dominated, and one seed never built a circuit past three
operations. The property held, but only over circuits too small to mean anything.
The edit weights and the vacuity guard in `store.test.ts` are the fix, and the
guard is the part worth keeping: a property test that cannot detect its own
vacuity is not evidence.

**`frontend/src/editor/` renders, read-only.** `layout.ts` is a pure
`(circuit, decomposition, metrics) → geometry` function with no DOM dependency;
`CircuitCanvas.tsx` draws what it produced and nothing else. Wires, gates,
controls and connectors, measurements with their register lanes, and barriers all
render. The app shows a demo circuit built through the edit vocabulary, which is
temporary scaffolding until the palette exists. 35 new tests, 255 in the suite.

**The single-source-of-truth rule now has a real consumer**, which `Roadmap.md`
noted was previously satisfied only vacuously. `CircuitEditor.tsx` recomputes the
decomposition and the geometry on every render from the one circuit the store
holds. No component stores a column or a coordinate.

One rendering rule `UI.md` did not spell out, added there now: a barrier over a
non-contiguous set of wires draws one segment per contiguous run rather than a
single rule through the wires it skips, since it does not constrain them.

**The palette, placement, selection, removal, and the problems strip are built.**
The canvas is now a real grid: `role="grid"`, a row per qubit, a cell per
position, with the cursor moving by `aria-activedescendant` so a forty-gate
circuit is one tab stop rather than forty. Placement works by click-to-arm and by
drag, both routed through one activation path rather than two that must agree.
316 tests.

**`insertionIndexFor` is where the interaction actually lives.** A drop column is
translated into a position in the canonical list — after the last operation on
that wire before the column, and after any barrier sitting at it — and the
derivation then decides where the operation appears. An `h` dropped far right of
an empty wire packs back to column 1, asserted end to end.

**The palette reads its gate list from `model/spec.ts`**, so a gate added to the
shared spec appears without a code change here. A test fails if one arrives
without a group. Only the *grouping* and the descriptions are hand-written, being
the two things a gate signature cannot express.

Four gaps against `UI.md`, none of them accidental:

* **The settle animation is not built.** The packing *behaviour* is there and
  tested, but the animation that explains it is not, so a gate currently jumps to
  its derived column with no indication why. This is the part of UI.md doing the
  educational work and it should not stay missing.
* **Rotation and phase gates place with a default of π/2 rather than prompting.**
  The circuits produced are valid; parameter editing is simply not built.
* **Multi-qubit gates are shown but disabled**, with a reason in their accessible
  name. They need control assignment, which is a placement sequence rather than a
  single action.
* **The reserved third column is not rendered.** The grid is two columns until
  Milestone 4 has results to put there.

`@testing-library/user-event` was considered for the interaction tests and
declined — `fireEvent` from the already-installed library covers keydown and
click, and `CLAUDE.md` asks whether an existing dependency suffices first.

One defect found while testing: `aria-activedescendant` could name a cell that no
longer existed, because removing an operation shrinks the column count and the
cursor did not follow. The cursor is now clamped on read rather than stored
clamped — the same treatment stale selection gets under ADR-0007 section 4, and
for the same reason.

**Six refinements followed from using it**, all from review of the running editor
rather than from tests, which is worth noting: every one was invisible to a
suite that already passed.

* **The palette was one tab stop per gate**, so reaching the canvas took eighteen
  presses. `UI.md` already required one stop per region; the palette now has a
  roving focus. Unavailable gates became `aria-disabled` rather than `disabled` in
  the same change, so arrowing across them announces why instead of skipping in
  silence.
* **The placement preview did not follow the mouse** — cells handled click and
  drop but not pointer-enter.
* **Barrier selection was unreachable.** The handler existed, but the transparent
  cell rectangles render above it and swallowed the click. There is now a hit
  layer above the cells, with a wide invisible stroke, because a 2px dashed rule
  is not a click target.
* **Deleting required the keyboard.** A `×` now appears on the selection.
* **Connectors drew across glyphs**, because they were ordered per operation.
  They are now a single layer beneath every glyph.
* **A `cz` target and an unrelated gate looked like the same object.** Resolved by
  adopting conventional notation, recorded in `UI.md`: a box now means exactly one
  thing, a single-qubit gate.

The last of those had a follow-on bug worth remembering: the crossed circle
borrowed the connector for its vertical bar, and the connector *terminates at the
anchor centre*, so only the upper half of the cross drew. A glyph owns all of its
strokes.

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
