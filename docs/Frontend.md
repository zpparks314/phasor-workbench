# Frontend

**Status:** Stack chosen, scaffolded, and verified. Editor and component design are
specified in [UI.md](UI.md) and [ADR-0007](decisions/ADR0007_EditingModel.md), and
are being built in Milestone 3.

---

# Stack

| Concern | Choice |
|---|---|
| Framework | React 19 |
| Language | TypeScript, strict |
| Build | Vite |
| Styling | Tailwind CSS v4 |
| Testing | Vitest + React Testing Library |
| Linting | ESLint (flat config) + Prettier |

TypeScript strictness is deliberately high — `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes` are both on. The Circuit Model is a deeply
structured document, and loose typing there would undermine the guarantees
[CircuitModel.md](CircuitModel.md) is trying to make.

---

# Rendering: Direct SVG

Circuit rendering uses **hand-written SVG**, not a node-graph library such as
React Flow.

## Why

A node-graph library models free-positioned nodes joined by edges, with
pan/zoom and drag as the primary interactions.

A quantum circuit is not that shape. It is:

* a set of fixed horizontal wire lanes, one per qubit
* gates at discrete `(qubit, column)` positions
* vertical connectors joining lanes for multi-qubit gates

The interaction model is grid snapping, not free placement.

The deciding argument is state ownership. Node-graph libraries hold node
coordinates as their own state. [CircuitModel.md](CircuitModel.md) requires
column layout to be *derived* from the circuit by deterministic left-packing.
Letting a library own positions would create precisely the duplicated state
[Architecture.md](Architecture.md) forbids.

Secondary reasons:

* `CLAUDE.md` directs the project to avoid unnecessary frameworks
* the educational visualizations — Bloch spheres, amplitude bars, annotations
  — need direct drawing control anyway
* SVG is accessible, styleable with Tailwind, and prints cleanly

## When a graph library would be right

If an "algorithm explorer" view ever needs to show a genuine DAG of circuit
dependencies, that is a different visualization with a different shape, and a
library would be appropriate *there*. It should not be adopted for the editor.

---

# Layout

```text
frontend/src/
├── api/            API client -- the only place that calls fetch
├── model/          Circuit types, spec constants, validator -- GENERATED
├── validation/     Circuit validation                  (Milestone 2)
├── cycles/         Cycle derivation                    (Milestone 2)
├── serialization/  Versioned load and dump             (Milestone 3)
├── persistence/    Local storage adapter               (Milestone 3)
├── state/          Circuit state, edits, undo/redo     (Milestone 3)
├── components/     Shared presentational components    (Milestone 3)
├── editor/         Circuit editor, SVG rendering       (Milestone 3)
├── visualization/  State visualization                 (Milestone 4)
└── test/           Test setup
```

Each directory maps to a module named in Architecture.md's frontend
breakdown. New concerns get a new directory rather than being absorbed into
an existing one.

`model/` is generated from `shared/` and never hand-edited — see
[ADR-0004](decisions/ADR0004_SharedModelStrategy.md). `validation/` and
`cycles/` mirror backend modules of the same name and must agree with them
exactly; [ADR-0005](decisions/ADR0005_SharedSpecification.md) explains why they
sit here rather than inside `model/` or `editor/`.

Both are implemented. `deriveCycles(circuit)` returns the decomposition specified
in [ADR-0003](decisions/ADR0003_ExecutionSemantics.md) — cycles, barrier
placements, and depth — and the editor will consume it for render columns without
storing it. That constraint is the reason this project draws circuits with direct
SVG rather than a node-graph library, as below.

## The Milestone 3 Modules

**`state/` owns every change to the circuit.** The store, the edit vocabulary, and
the history stack live here, specified by
[ADR-0007](decisions/ADR0007_EditingModel.md): an edit is a pure
`Circuit → Circuit` function, history is a bounded stack of labeled snapshots, and
coalescing during a drag is declared by the interaction rather than inferred from
timing.

Its core imports nothing from React — the React binding is a thin adapter over it.
That is what makes the undo property test in the Milestone 3 exit criteria
possible without a DOM, and it keeps the module replaceable in the sense
`CLAUDE.md` requires of every subsystem.

**`state/` has no backend counterpart, and that is deliberate.** `validation/`,
`cycles/`, and `serialization/` mirror backend modules because both sides need
them; the backend does not author circuits. Recorded in ADR-0007 section 8 so it
does not read as an oversight, in the same way ADR-0006 recorded the first such
asymmetry.

**`editor/` renders and interprets input.** `editor/layout.ts` is a pure function
of `(circuit, decomposition)` producing pixel geometry, kept out of the components
so it is testable without a DOM. It decides where a column sits on screen. It never
decides *which* column an operation occupies — that is the derivation's answer.
Interaction design is in [UI.md](UI.md).

Three of its modules are pure and DOM-free for the same reason as `layout.ts`,
and are where the logic lives rather than in the components:

| Module | Responsibility |
|---|---|
| `layout.ts` | `(circuit, decomposition)` → pixel geometry |
| `placement.ts` | a drop column → a position in the canonical list |
| `pending.ts` | the multi-qubit control-assignment sequence |
| `palette.ts` | what the palette offers, and its grouping |
| `glyphs.ts` | how each gate draws its target |

The components — `CircuitEditor`, `CircuitCanvas`, `GatePalette`,
`StructureControls`, `EditorHeader`, `ProblemsStrip` — render what those return
and hold only interaction state: what is armed, where the cursor is, which
placement is part-way through. None of that belongs in history, per ADR-0007
section 4.

`CircuitEditor` owns the store and is the only place edits are dispatched. Every
other component receives values and callbacks, which is what keeps the
single-source-of-truth rule checkable rather than aspirational.

**`serialization/` mirrors `backend/src/phasor_workbench/serialization/`** and is
held to the same 14 fixtures in `shared/fixtures/version/`, which declare their
expected outcome in a language-neutral form. See
[ADR-0006](decisions/ADR0006_VersionCompatibility.md) section 5. **Implemented**,
which ends the asymmetry that ADR recorded — module for module: `version.ts`,
`migrations.ts`, `paths.ts`, `shape.ts` (mirroring `unknown.py`), and the loader
itself.

Two things about it are worth knowing before changing it:

* **`loadCircuit` returns a discriminated `ok`**, where Python returns one of two
  types. A single shape with an optional circuit would let a caller reach for
  `.circuit` and find nothing.
* **`dumpResult` restores preserved fields; `dumpCircuit` does not.** The first is
  the round trip, correct only while the circuit is untouched. An *edited* circuit
  goes through the second and declares this build's version, per
  [ADR-0008](decisions/ADR0008_LocalPersistence.md) section 3 — preserved fields
  are keyed to positions that editing moves.

Fixtures compare codes rather than paths, so the two loaders were also diffed
directly, which is what caught the frontend blaming a whole document for one
unknown field. Paths are asserted in `serialization.test.ts`, per ADR-0005.

**`persistence/` is the `localStorage` adapter** and the only module that touches
browser storage, on the same principle that confines `fetch` to `api/`. It is the
working-set store; files are the interchange format and arrive with Milestone 5's
JSON import/export. Storage can be unavailable or full, and both surface as errors
rather than silence — the editor stays fully usable without it.

## Validation Scope

**Implemented.** `validateCircuit(circuit)` returns every violation, each with a
code from `model/spec.ts` and a document path. It mirrors the Python
implementation module for module and is held to it by the fixtures in
`shared/fixtures/`, read directly by `src/validation/validation.test.ts`.

The frontend validates for fast editor feedback. For circuits it *builds*, that
means **semantic validation only** — the editor constructs them through its own
code, so they are shape-valid by construction. Shape validation applies where a
circuit arrives from outside: `serialization/`, and later import.

That changes the first time the frontend reads a circuit it did not build —
Milestone 3's local save. Deferred deliberately, per ADR-0005 section 6, so the
dependency question is answered with that requirement in hand.

**That question is answered by [ADR-0008](decisions/ADR0008_LocalPersistence.md):
a validator compiled from `circuit.schema.json` during `generate_bindings.py`.**
Ajv is a devDependency and is never shipped; the emitted validator is
self-contained, 6 KB gzipped, and a generated file under the same rules as the
types beside it — never hand-edited, and `--check` fails on a stale one. The
alternative, hand-writing a shape checker, is the second description of the schema
[ADR-0004](decisions/ADR0004_SharedModelStrategy.md) exists to prevent; the backend
avoids it by letting Pydantic decide unknown-ness, so there is no list to drift,
and generating the frontend's validator gives it the same property.

**One implementation constraint is load-bearing and non-obvious.** `oneOf` plus
`$ref` loses branch attribution — Ajv reports `#/additionalProperties` for every
branch — so every non-matching operation subtype reports the fields it does not
share as unknown. A stripper that trusts those errors deletes a gate's `name`,
`controls` and `parameters`. Validate per subtype instead, selected through the
schema's own `discriminator.mapping`. ADR-0008 section 2 has the detail.

**Choosing `localStorage` does not remove the requirement.** A stored document was
written by *some* build — possibly older, possibly a partial write, possibly
hand-edited through devtools — so it is still a circuit this build did not
construct. ADR-0006's argument that a version claim is unverifiable evidence
applies to it unchanged.

Violation codes come from generated constants in `model/spec.ts`. Never
hand-write a code string.

---

# API Client

`src/api/` is the only module permitted to call `fetch`. Everything else goes
through it.

Structure:

* `client.ts` — request execution, error translation
* `types.ts` — the API envelope from [API.md](API.md)
* one module per resource group (`health.ts`, later `circuits.ts`, `simulations.ts`)

## Error Handling

The backend's single error envelope is translated into an `ApiError` carrying
a stable `code`, an HTTP `status`, and per-violation `details`.

`ApiError.isUserFacing` distinguishes *the user built an invalid circuit*
from *the request or backend failed*. Only the former should surface as
inline editor feedback; the latter belongs in a status area. Conflating them
produces interfaces that blame the user for infrastructure problems.

## Mocking

Architecture.md requires the frontend to stay functional when the backend is
unavailable.

`VITE_USE_MOCK_API` will switch the client to recorded responses. Those
recordings are validated against the backend's OpenAPI schema by the contract
tests in `tests/contract/`, so they cannot silently drift.

Not yet implemented. It was expected to land with the first real endpoint in
Milestone 2, and did not — Milestone 2 added no endpoints, and Milestone 3 makes
no backend calls at all, since validation, cycles, and local save are all
client-side. It lands with the first circuit endpoint in Milestone 4, which is
also when `tests/contract/` gains something to run.

---

# Development

The Vite dev server proxies `/api` to `http://localhost:8000`, so the browser
origin is identical in development and CORS is not exercised on the happy
path. CORS is still configured on the backend for deployed environments.

---

# Still Deferred

Component design, editor interaction, and visual language are now written in
[UI.md](UI.md) — screen regions, palette organization, placement and movement,
multi-qubit control assignment, selection, the keyboard model and shortcut map,
empty and error states, and the visual language.

What UI.md still defers, and why:

* **results panel and visualization placement** — Milestone 4. The three-column
  grid reserves the space; nothing else about them is designed, because designing
  a results panel before results exist is the speculation that kept UI.md empty
  through two milestones.
* **responsive and small-screen layout** — Milestone 5, where `Roadmap.md` places
  it
* **multi-select** — changes what `Delete` and drag mean, and is not needed to
  build a simple circuit

---

# Rules

* never implement simulation logic here
* never call `fetch` outside `src/api/`
* never touch browser storage outside `src/persistence/`
* never store a second copy of the circuit
* never let a rendering library own circuit layout
* never store a coordinate or a column index — geometry is derived every render
* every change to the circuit goes through the edit vocabulary in `src/state/`,
  so that history and labeling cannot be bypassed
* the app must degrade gracefully when the backend is unavailable, and when local
  storage is unavailable
