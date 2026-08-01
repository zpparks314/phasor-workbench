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

Both projects scaffolded and verified end to end. CI runs lint, format, type
check, test and build for both on every push, across two Python and two Node
versions. `main` is protected: pull request and passing `CI` required, linear
history, no force pushes. Only the aggregate `CI` check is required, because
matrix job names carry their version and would leave a new leg unprotected.

`docker compose up --build` runs both services with hot reload. The backend
container pins Python 3.13 because Qiskit publishes no 3.14 wheels, making it
where the Milestone 4 `simulation` extra will install. Production images are
deferred to Milestone 5; both Dockerfiles are multi-stage so adding a target is
additive. Docker supplements native development — CI runs natively.

Continuous *deployment* is deliberately absent. It belongs with **Deployment** in
Milestone 5 and should consume the Dockerfile rather than duplicate it.

Two findings from this milestone are documented where they apply rather than
here: the Windows bind-mount polling requirement in `compose.yaml`, and the
repository admin bypass on branch protection, which is a deliberate trade for a
solo project and should be revisited at the first outside contributor.
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

**Two shared sources of truth, not one.** `shared/schema/circuit.schema.json`
defines a circuit's shape; `shared/spec/circuit.spec.json` defines the semantics a
schema cannot express — gate signatures, violation codes with their `phase`, and
the current model version. Bindings generate into `models/circuit.py`,
`models/spec.py`, `model/circuit.ts` and `model/spec.ts`, and the **Shared model**
CI job fails the build if any is stale.

**Four hand-written implementations, held to 51 fixtures.** Validation and the
cycle derivation exist in both languages and agree on every fixture — verified
beyond what the fixtures enforce by diffing both implementations directly: 25
violations with identical codes *and* paths, 17 decompositions with identical
cycles, barriers and depth. The versioned loader is Python-only; the TypeScript
half is Milestone 3.

**Every empirical finding from this work lives beside the thing it constrains**,
not here — the `$comment` fields in `circuit.schema.json` for the `discriminator`
keyword, the `Identifier` / `IdentifierRef` split and `Metadata`'s
`additionalProperties`, and the comments in `generate_bindings.py` for its flags
and newline handling.

Two corrections this milestone produced, worth keeping because both were wrong in
prose before they were right in code:

* **A barrier levelling an unequal frontier can raise depth.** The earlier claim
  that annotating a circuit never changes its depth was false in general;
  `barrier_levels_unequal_frontiers.json` is the counterexample. What holds is
  narrower — a barrier contributes no cycle *of its own*.
* **The versioning table conflated two questions.** "Minor" describes what the
  producer did; it does not follow that an older consumer can read the result. The
  table now states the bump and the loadability separately. See ADR-0006.
### Known Issues

Two issues from this milestone were resolved during it and are recorded where
they were decided rather than here: the apparent tension between the strict
schema and forward compatibility (never real — see
[ADR-0006](decisions/ADR0006_VersionCompatibility.md)), and `Metadata` silently
discarding unknown keys (fixed under the same ADR).

* `register` generates as `register_` in Python, aliased back to `register` on
  the wire. Cosmetic, and confined to the Python API.

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

* [x] A user can build a circuit from empty: add and remove qubits and classical
  registers, with qubit indices contiguous from 0 at every point.
* [x] A user can place, move, and remove every gate in `circuit.spec.json`'s gate
  set, plus measurements and barriers.
* [x] Multi-qubit gates are placed with explicit control assignment and render
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

**Read first:** [ADR-0007](decisions/ADR0007_EditingModel.md) and [UI.md](UI.md).
Everything in this milestone assumes both. *Status* below says what exists;
*Remaining* says what does not.

**What is available to build on.** `frontend/src/model/` for the types,
`frontend/src/validation/` for inline feedback, `frontend/src/cycles/` for render
columns, `frontend/src/state/` for every change to the circuit, and
`frontend/src/editor/` for geometry and placement.

**The constraint that shapes everything here:** `editor/layout.ts` computes pixel
geometry, and never decides *which column* an operation occupies. That is
`deriveCycles`, recomputed every render and never stored. See
[Frontend.md](Frontend.md) and
[ADR-0001](decisions/ADR0001_CircuitRepresentation.md).

**Two decisions this milestone still owes**, both scoped to local save and both
landing in ADR-0008 with the frontend loader:

1. **Runtime shape validation on the frontend.** Deferred by
   [ADR-0005](decisions/ADR0005_SharedSpecification.md) section 6 until local save
   made it concrete. Narrowed since: hand-writing a shape checker is a second
   description of the schema, which ADR-0004 exists to prevent, so the real choice
   is *which* schema-driven mechanism.
2. **What `schemaVersion` an edited newer-minor circuit declares on save.**

Choosing `localStorage` does not remove either question. A stored document was
written by *some* build — possibly older, possibly a partial write, possibly
hand-edited through devtools — so it is still a circuit this build did not
construct, and ADR-0006's argument that a version claim is unverifiable evidence
applies unchanged.


### Status

**Built and working.** A user can construct a circuit in the browser: arm a gate
from the palette, place it by pointer or keyboard, select it, move it by drag or
`Ctrl/Cmd` + arrow, and remove it. Undo and redo work from the keyboard. Barriers
are selectable with `b`. Violations appear in the problems strip and clear when
fixed. 489 frontend tests.

**`editor/EditorHeader.tsx` carries undo, redo and clear**, a `role="toolbar"`
with a roving focus so the header is one tab stop like every other region. The
buttons say what they will do — "Undo place h on q0" — which is the whole reason
ADR-0007 attaches a label to each history entry.

**Clear empties the operation list; it is not "new circuit".** That separation is
what let it land before local save. Emptying the list is an ordinary edit: one
snapshot, one undo step, and a circuit reachable by deleting each operation in
turn. Resetting the *document* — wires, registers and identity — needs to know
whether there are unsaved changes, so it belongs with local save.

Undo and redo are `disabled` here while an unplaceable palette entry is
`aria-disabled`, and both are deliberate: an unavailable gate has something to
teach, an empty undo stack does not. The roving stop never rests on a disabled
control, because a `disabled` button cannot take focus and the region would have
no way in.

**A circuit can be built from empty.** `editor/StructureControls.tsx` adds and
removes qubits and classical registers, and edits a register's size. It is a
region of its own rather than controls inside the SVG gutter — the canvas is a
`role="grid"` with a single tab stop, and focusable controls inside it break that
contract. UI.md records the deviation and why.

Three decisions there worth not undoing:

* **A removal confirmation derives its count by running the edit**, via
  `operationsLostWithQubit`. Restating the rules would get the interesting case
  wrong: a barrier over the qubit is *shrunk* rather than removed, so it is not
  lost. A message whose only job is accuracy should not hold a second copy of the
  logic it describes.
* **Shrinking a register below a bit a measurement writes to is allowed**, and
  reported as `CLASSICAL_BIT_OUT_OF_RANGE`. The user can grow it back or delete
  the measurement, so it is a state they can edit their way out of — which is
  precisely the test that made the pending-gate duplicate-wire case a refusal
  instead. The two agree on the principle and differ on the facts.
* **A register is labelled by position, never by its identifier.** The fallback
  used to be `register.id`, which was harmless when registers came from fixtures
  and puts a UUID in the gutter now that the editor mints them.

**Measurements and barriers are placed from the palette**, alongside the gates,
because they are operations and giving them a separate mode would obscure that.
They are the one hand-written part of the palette and deliberately so: both are
operation *kinds* in the schema, not gates, so no generated list could supply
them.

**A barrier is expanded to every wire at placement time and never rewritten.**
This is the settled answer to "should a barrier extend when a qubit is added?" —
it should not, and `CircuitModel.md` had already decided it: there is no implicit
"all qubits" barrier *because its meaning would silently change when a qubit is
added*. Expanding on placement is what an importer does with OpenQASM's bare
`barrier;`. The asymmetry with removal is principled rather than an oversight — a
removed qubit takes its reference with it, so shrinking is forced by referential
integrity, while a new qubit is referenced by nothing and forces nothing. And the
two cases are indistinguishable anyway: a barrier over all three wires and a
barrier over exactly q0/q1/q2 are byte-identical, so auto-extending could not
touch one without silently widening the other, changing a depth the user set
deliberately. An explicit "extend to all wires" action remains open as a future
addition, and has none of these problems because the user asks for it.

**A measurement writes into the first register's lowest free bit**, and choosing
the register is deferred — a circuit with two registers cannot yet reach the
second. Missing rather than wrong: the circuit produced is valid. Running out of
bits is reported as `CLASSICAL_BIT_OUT_OF_RANGE` rather than clamped, because
clamping would write two measurements to one bit and silently serialise them per
ADR-0003's per-bit contention.

**Every gate in the spec is placeable**, multi-qubit ones by the control-assignment
sequence in [UI.md](UI.md): the first click fixes a wire and a column, each click
after it adds one wire, and the operation commits when the signature is satisfied.
`editor/pending.ts` holds that sequence as pure functions, so the whole thing is
assertable without rendering anything. Three properties are easy to undo by
accident:

* **The sequence is driven by the signature, never by the gate's name.** `swap` is
  two targets and no controls, `ccx` one target and two controls. A gate added to
  `circuit.spec.json` gets its sequence for free; reading it off the name would be
  a second description of the spec.
* **Single- and multi-qubit placement are one code path.** A single-qubit
  signature is satisfied by its first click, so it commits immediately and never
  shows a pending state. Two paths that had to agree would be two chances to
  disagree.
* **Only the first click carries a column**, and it resolves against every qubit
  the finished operation names — a `cx` occupies its control wire as surely as its
  target.

**`frontend/src/state/`** holds the store, the edit vocabulary and history,
implementing [ADR-0007](decisions/ADR0007_EditingModel.md). Headless — only the
React adapter imports React, which is what makes the undo property test possible
without a DOM.

**`frontend/src/editor/`** holds `layout.ts` (a pure
`(circuit, decomposition) -> geometry` function), `placement.ts` (drop column to
list index), the SVG canvas, the palette and the problems strip.

**The single-source-of-truth rule now has a real consumer**, which this document
previously noted was satisfied only vacuously. The decomposition, the geometry,
the cell contents and the violations are all recomputed every render from the one
circuit the store holds. No component stores a column or a coordinate.

Design decisions made here are in [UI.md](UI.md) — conventional gate notation, the
canvas layering rule, the two connector gap widths, the settle animation, and why
`b` reaches barriers. Two that are easy to undo by accident:

* **Edits take identifiers as arguments rather than minting them.** A function
  calling `crypto.randomUUID()` internally is not pure and cannot be asserted
  against — the undo property test would have nothing to compare.
* **Removing a qubit shrinks a barrier rather than deleting it.** The constraint
  on the remaining qubits survives one of them leaving, and deleting it would
  silently change the circuit's depth.

**Two testing lessons, both learned the hard way and both now enforced in the
tests themselves.** A test that dispatches an event directly on an element proves
nothing about whether a pointer can reach it — the gate drag shipped broken with a
passing test for exactly that reason. And a property test that cannot detect its
own vacuity is not evidence: the undo property held for five seeds over circuits
too small to mean anything until a guard was added.

`@testing-library/user-event` was considered for interaction tests and declined —
`fireEvent` from the already-installed library covers keydown and click.

### Remaining

* [ ] Parameter editing — rotation gates place at a fixed π/2
* [ ] Choosing a measurement's register and bit — it always writes to the first
  register's lowest free bit, so a circuit with two registers cannot reach the
  second. The circuit produced is valid, so this is a missing feature rather than
  a wrong result
* [ ] Local save, and with it ADR-0008 and `frontend/src/serialization/`

**Known gaps**

* **The grid's screen-reader behaviour is unverified.** The markup follows the
  composite-widget pattern and the tests assert roles and names, but SVG
  accessibility mapping is inconsistent enough that this proves little. Test with
  real assistive technology before this milestone closes.
* **An operation whose every qubit reference dangles is not drawn**, so the
  problems strip is the only route to it. That is why the strip selects by path.

* **Two connector defects became reachable when multi-qubit placement landed**,
  and neither is a placement bug — both are in `editor/layout.ts`. They were
  unreachable before only because the palette could not place the gates that
  produce them, and the demo circuit happens not to contain the arrangement.
  Both need a circuit where two multi-qubit gates share a cycle without sharing a
  wire, e.g. `cx(q0, q3)` beside `cx(q1, q2)`:

  1. `occupancyByCycle` records an operation's `targets` but not its `controls`,
     so a connector crossing another operation's **control dot** gets the 12px
     empty-wire gap instead of glyph clearance. With `control: 5` that leaves
     about a pixel between the line and the dot — reading as contact, which is
     exactly what UI.md calls the gap semantically load-bearing to prevent. The
     one-line fix is wrong on its own: `glyphClearance` is sized for a 40px box
     and is far too wide for a 10px dot, so this wants a third clearance value.
  2. Two connectors in one cycle land on the **same x**, nested or overlapping,
     with nothing to distinguish them. No cheap fix; the usual answers are
     splitting the cycle or offsetting one line, and both are design decisions.

* **The pending-placement connector uses the empty-wire gap throughout**, even
  where a glyph sits on a crossed wire. That is deliberate rather than the same
  bug: a pending operation is not in the circuit, so `deriveCycles` has not
  placed it and which wires are occupied *in its eventual column* has no answer
  yet. The committed render, one click later, is where the distinction is real.
* **`editor/demoCircuit.ts` is scaffolding** and should go once the editor opens
  on an empty or restored circuit. Half of that is now satisfied — a circuit can
  be built from empty — so the only thing still holding it is local save: with
  nothing surviving a refresh, opening blank would mean losing the work every
  time. It goes with that item, not before.

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
