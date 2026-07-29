# Project Structure

How the repository is laid out and why. See [Architecture.md](Architecture.md)
for the rules this structure exists to enforce.

---

# Top Level

```text
quantumworkbench/
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
├── src/quantum_workbench/
│   ├── main.py          Application assembly, no business logic
│   ├── config.py        Settings and resource limits
│   ├── api/
│   │   ├── errors.py    The single documented error envelope
│   │   └── routes/      One module per resource group
│   ├── models/          Circuit Model types      (Milestone 2)
│   ├── validation/      Circuit validation       (Milestone 2)
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
