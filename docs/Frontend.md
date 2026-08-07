# Frontend

**Status:** Implemented through Milestone 4. Editor and component design are
specified in [UI.md](UI.md) and [ADR-0007](decisions/ADR0007_EditingModel.md);
this document covers structure, boundaries and the rules that keep them.

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

* `AGENTS.md` directs the project to avoid unnecessary frameworks
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
├── files/          File import and export adapter      (Milestone 5)
├── state/          Circuit state, edits, undo/redo     (Milestone 3)
├── components/     Shared presentational components    (Milestone 5)
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
`AGENTS.md` requires of every subsystem.

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
| `shortcuts.ts` | a key press → the command it means |

`shortcuts.ts` is the newest of these and the one whose purity is doing the most
work: because it is a list of data rather than a chain of `if`s in a component,
the `?` reference can *render* the same entries the canvas *dispatches* through.
A help panel written by hand would be a second description of the bindings and
would drift the first time one changed — which is the exact failure mode
`ADR-0004` exists to prevent for the circuit model, applied to a much smaller
thing. See [UI.md](UI.md) under *Shortcuts*.

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

## `components/`, and the One Thing In It

Reserved from Milestone 3 and first filled in Milestone 5, by the two modules
that catch a render error: `ErrorBoundary` and `RecoveryScreen`. They are here
rather than in `editor/` because neither is about circuits — the boundary is
mechanism, and the screen is what the *application* shows once there is no editor
left to show anything.

**`ErrorBoundary` is a class, and it is the only one in the frontend.**
`getDerivedStateFromError` and `componentDidCatch` have no function-component
equivalent in React 19, and this is the one place that needs them. It knows
nothing about what to say: the caller supplies the fallback, which is what would
let a second boundary around a panel reuse it without dragging a full-page
recovery screen along.

**It does not log.** React's root already reports a caught error to the console,
so a `console.error` here would print every crash twice. The `onError` prop is
the seam for a real reporter and is deliberately not filled with a second logger
in the meantime.

**It normalises what was thrown.** `throw` takes any value, and a string reaches
a boundary exactly as an `Error` does; without normalising, a fallback reading
`.message` off a string would itself be the second thing to fail.

`RecoveryScreen` is the fallback the root installs, and what it offers is
specified in [UI.md](UI.md) under *When the Editor Stops* — including the reason
it reaches past `serialization/` for the stored document, which is the one design
decision in it that looks like a shortcut and is not.

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
Ajv is a devDependency and is never shipped. The emitted validator is a generated
file under the same rules as the types beside it — never hand-edited, and
`--check` fails on a stale one.

**It is bundled during generation, and that is not cosmetic.** `standaloneCode`
emits CommonJS `require` calls for Ajv's runtime helpers, which a browser cannot
resolve — the module throws while being evaluated and the page renders nothing.
Node has `require`, so tests pass regardless; `serialization/validator.test.ts`
asserts self-containment by resolution instead. The
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

**A 5xx with no JSON body is reported as an unreachable backend, not an internal
error**, and the reason is the dev proxy. A backend that is simply not running is
*not* a network-level failure from the browser's point of view: the Vite proxy
answers on its behalf with `500` and an empty body, so `fetch` resolves and the
`catch` around it never runs. Until 2026-08-02 that surfaced as "Request failed
with status 500" — accurate about the transport, and silent about the only fact
worth knowing.

The body is what separates the two cases. A backend that threw still answers with
JSON, either the error envelope or FastAPI's own `{"detail": ...}`, so it stays
an internal error; nothing answering at all leaves nothing to parse. Collapsing
both into "unreachable" would hide real backend faults behind a message saying it
is not running.

This was invisible for two milestones because nothing called an endpoint. The
first one that did found it immediately.

## Mocking

Architecture.md requires the frontend to stay functional when the backend is
unavailable.

`VITE_USE_MOCK_API` switches the client away from the network. It landed on
2026-08-02 with `/circuits/analyze`, the first circuit endpoint — as this section
had said it would, having waited through Milestone 2 (no endpoints) and Milestone
3 (no backend calls at all, since validation, cycles, and local save are
client-side).

**It is not one mechanism, and the difference is the response's nature rather
than a preference.** This section previously described recorded responses only.

* **A response the frontend cannot derive is recorded.** A statevector has to
  come from somewhere; a recording is honest about being a fixture, and
  validating it against the backend's OpenAPI schema in `tests/contract/` is what
  stops it drifting. This is still the plan for the simulation endpoints.
* **A response that is a pure function of the request is computed.**
  `/circuits/analyze` is one: counts and a depth, entirely determined by the
  circuit posted. A recording would answer every circuit with one circuit's
  numbers, so the panel would display a depth belonging to something the user is
  not looking at — worse than showing nothing, in a tool whose purpose is making
  a circuit legible. `api/analysis.ts` computes it instead.

The computed mock introduces no second implementation of anything: depth comes
from the same `deriveCycles` the canvas calls, and only the counting — a filter
and a length — lives in the mock. When the backend is reachable it is the sole
source of these numbers.

**The simulation endpoints take the recorded branch**, which is that rule
working rather than an exception to it. The frontend cannot derive a statevector
without shipping a simulator, so `api/simulation.ts` returns a recorded Bell
state. It is deliberately recognisable rather than plausible-looking: a
developer running against the mock should be able to tell at a glance that the
panel shows a fixture and not their circuit. Its sampled numbers are off 50/50
on purpose, since a mock returning exactly 512/512 would hide the shot noise the
results panel exists to make visible.

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
* ~~**responsive and small-screen layout**~~ — **built** 2026-08-06. The claim
  above that the three-column grid was built so collapsing it is a change to the
  grid rather than the components held: `CircuitEditor`'s one grid template gained
  two breakpoints and the components below it were untouched, except where they
  had defects of their own. `GatePalette` is the exception and a deliberate one —
  it becomes a horizontal scrolling strip in one column, which is a change to
  what it *is*, not to what it knows
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
* a render error must never reach the browser as a blank page — the root error
  boundary in `main.tsx` is what guarantees it, and nothing may be mounted
  outside it
