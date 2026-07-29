# Frontend

**Status:** Stack chosen, scaffolded, and verified. Editor and component design still deferred to Milestone 3.

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
├── components/     Shared presentational components   (Milestone 3)
├── editor/         Circuit editor, SVG rendering       (Milestone 3)
├── visualization/  State visualization                 (Milestone 4)
├── state/          Circuit state, undo/redo            (Milestone 3)
└── test/           Test setup
```

Each directory maps to a module named in Architecture.md's frontend
breakdown. New concerns get a new directory rather than being absorbed into
an existing one.

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

Not yet implemented — lands with the first real endpoint in Milestone 2.

---

# Development

The Vite dev server proxies `/api` to `http://localhost:8000`, so the browser
origin is identical in development and CORS is not exercised on the happy
path. CORS is still configured on the backend for deployed environments.

---

# Still Deferred

Component design, editor interaction, and visual language belong to Milestone
3 and are documented in [UI.md](UI.md) when that work begins:

* editor layout and screen regions
* gate palette organization
* placement, movement, selection, undo/redo interaction
* results panel and visualization placement
* keyboard model and shortcut map
* accessibility implementation specifics

---

# Rules

* never implement simulation logic here
* never call `fetch` outside `src/api/`
* never store a second copy of the circuit
* never let a rendering library own circuit layout
* the app must degrade gracefully when the backend is unavailable
