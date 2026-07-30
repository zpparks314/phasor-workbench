# Project Structure

How the repository is laid out and why. See [Architecture.md](Architecture.md)
for the rules this structure exists to enforce.

---

# Top Level

```text
phasor-workbench/
├── frontend/    React + TypeScript + Vite + Tailwind
├── backend/     Python + FastAPI + Pydantic
├── shared/      Circuit Model, schema, cross-language fixtures
├── tests/       Cross-cutting integration and contract tests
├── docs/        Project documentation
├── .editorconfig
└── .gitignore
```

The four code directories map directly onto the module organization in
Architecture.md. Nothing lives at the top level that belongs inside one of
them.

---

# Why `shared/` Is Separate

The Circuit Model is the single source of truth, and neither side may own it.

If it lived in `frontend/`, the backend would be a second-class consumer of
it. If it lived in `backend/`, the frontend would be. Placing it in its own
directory makes both sides equal dependents.

`shared/` may not import from `frontend/` or `backend/`. The dependency
arrows point inward only.

```text
shared/
├── schema/               Canonical JSON Schema -- the wire format
├── spec/                 Gate signatures, violation codes, current version
├── fixtures/
│   ├── valid/            Circuits both sides must accept
│   ├── invalid/          Circuits both sides must reject, with violation codes
│   └── decomposition/    Circuits with their expected cycle decomposition
├── generate_bindings.py  Generates bindings into each consuming project
└── README.md
```

There are **two** sources of truth, and the split is deliberate. `schema/`
defines a circuit's shape; `spec/` defines the semantics a JSON Schema cannot
express. Generation fails if the two disagree about the gate set, which is what
keeps adding a gate a single logical edit. See
[ADR-0005](decisions/ADR0005_SharedSpecification.md).

Generated bindings live **in the consuming projects**, not here. Neither
language can import cleanly from a sibling directory outside its package root,
and forcing it would add packaging complexity to every install path. The two
sources stay authoritative; only their output is co-located with its consumers.
See [ADR-0004](decisions/ADR0004_SharedModelStrategy.md).

`generate_bindings.py` invokes each project's toolchain as a subprocess. That
is not an import, so the rule above still holds.

---

# Why `tests/` Is Separate From Project Tests

Unit tests live beside the code they test:

| Test kind | Location |
|---|---|
| Frontend units and components | `frontend/src/**/*.test.ts(x)` |
| Backend units and routes | `backend/tests/` |
| Simulation correctness | `backend/tests/` |
| Frontend + backend together | `tests/integration/` |
| API conformance, model parity | `tests/contract/` |

Colocating unit tests is what makes Architecture.md's requirement that "each
module should be testable independently" true in practice — a module and its
tests move together.

The top-level `tests/` directory is for the tests that are deliberately *not*
independent: the ones asserting that two projects agree with each other.
Those have no natural home inside either project, and putting them in one
would imply that project owns the contract.

---

# Frontend

```text
frontend/
├── src/
│   ├── api/            The only module permitted to call fetch
│   ├── model/          Circuit types and spec constants -- GENERATED
│   ├── validation/     Circuit validation                (Milestone 2)
│   ├── cycles/         Cycle derivation                  (Milestone 2)
│   ├── components/     Shared presentational components  (Milestone 3)
│   ├── editor/         Circuit editor, SVG rendering     (Milestone 3)
│   ├── visualization/  State visualization               (Milestone 4)
│   ├── state/          Circuit state, undo/redo          (Milestone 3)
│   └── test/           Test setup
├── index.html
├── vite.config.ts
├── tsconfig.json
├── eslint.config.js
└── package.json
```

Details and the SVG rendering decision: [Frontend.md](Frontend.md).

---

# Backend

```text
backend/
├── src/phasor_workbench/
│   ├── main.py          Application assembly, no business logic
│   ├── config.py        Settings and resource limits
│   ├── api/
│   │   ├── errors.py    The single documented error envelope
│   │   └── routes/      One module per resource group
│   ├── models/          Circuit types, spec constants  (GENERATED)
│   ├── validation/      Circuit validation       (Milestone 2)
│   ├── cycles/          Cycle derivation         (Milestone 2)
│   ├── serialization/   Versioned load and dump  (Milestone 2)
│   ├── simulation/
│   │   └── backends/    Simulator adapters       (Milestone 4)
│   ├── analysis/        Gate counts, depth       (Milestone 4)
│   ├── importers/       OpenQASM, JSON in        (Milestone 5)
│   └── exporters/       OpenQASM, JSON out       (Milestone 5)
├── tests/
└── pyproject.toml
```

The `src/` layout is deliberate: it prevents the package from being
importable straight out of the working directory, so tests exercise the
installed package rather than a copy that happens to be on the path.

Each subpackage corresponds to a backend module named in Architecture.md.
They exist while empty so the intended shape is visible, and each carries a
docstring stating its responsibility and the milestone that fills it.

---

# Mirrored Modules

Two concerns are implemented in both languages, and they carry the same name on
both sides:

| Concern | Backend | Frontend |
|---|---|---|
| Validation | `validation/` | `src/validation/` |
| Cycle derivation | `cycles/` | `src/cycles/` |
| Versioned loading | `serialization/` | *deferred to Milestone 3* |

Entry points match too, under each language's naming convention:
`validate_circuit` / `validateCircuit`, `derive_cycles` / `deriveCycles`.

`serialization/` is deliberately backend-only for now. A frontend loader reads a
circuit the frontend did not build, which is the runtime shape validation
[ADR-0005](decisions/ADR0005_SharedSpecification.md) section 6 deferred to
Milestone 3's local save — the loader is what makes that question come due. The
backend needs it regardless, because it cannot trust its input. See
[ADR-0006](decisions/ADR0006_VersionCompatibility.md) section 5.

The symmetry is not tidiness. These four artifacts must agree permanently, the
fixtures in `shared/fixtures/` are what detect a disagreement, and mirrored names
are what make the disagreeing half findable by name instead of by search. Decided
in [ADR-0005](decisions/ADR0005_SharedSpecification.md).

The generated directories — `models/` and `src/model/` — stay generated-only.
Hand-written code that consumes the model does not live beside it.

---

# Placeholder Convention

Directories that are intentionally empty contain a `.gitkeep` explaining:

* what will live there
* which milestone fills it
* which rules constrain it

An empty directory with no explanation is indistinguishable from an
oversight. This convention is the same reason [UI.md](UI.md) states why it is
deferred rather than sitting empty.

---

# Adding a Module

Per Architecture.md, prefer a new module over expanding an existing one
beyond its scope.

A new module needs:

1. a directory under the appropriate project
2. a docstring or `.gitkeep` stating its single responsibility
3. a clear public interface
4. tests
5. an entry in this document

If a new module would require the frontend to simulate, the backend to
render, or a second copy of the circuit to exist, the design is wrong — stop
and revisit [Architecture.md](Architecture.md).
