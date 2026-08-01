# CLAUDE.md

## Project Overview

**Project Name:** Phasor Workbench

Phasor Workbench is an open-source, browser-based application for creating, visualizing, simulating, and understanding quantum circuits.

The project is intended to bridge the gap between educational tools and professional quantum software frameworks. While existing tools often focus on execution, Phasor Workbench emphasizes understanding through visualization, state inspection, and interactive learning.

Renamed from "RogueScholar's Quantum Workbench" on 2026-07-28. The possessive read as a hobby project, and the bare name collided with at least four existing tools, two in the same niche. A *phasor* is a rotating complex number carrying magnitude and phase — what a quantum amplitude is — so the name describes what the tool makes visible. Python package: `phasor_workbench`.

This project is expected to grow over several years and should be designed with long-term maintainability in mind.

---

# Primary Goals

The project should prioritize the following goals, in order:

1. Clean architecture
2. Readable, maintainable code
3. Extensibility
4. Correctness
5. User experience
6. Performance

Avoid sacrificing architecture for short-term convenience.

---

# Design Philosophy

The application should be modular.

Every major subsystem should be replaceable with minimal changes elsewhere.

Examples include:

* simulator backend
* visualization engine
* circuit editor
* export formats
* persistence layer

No module should depend on implementation details of another module.

Favor interfaces and abstraction over tightly coupled implementations.

---

# Core Principles

## Single Source of Truth

The internal Circuit model is the authoritative representation of every circuit.

All systems—including the editor, simulator, exporters, importers, and visualizations—must operate from this model.

Never duplicate circuit state.

---

## Separation of Concerns

Frontend responsibilities:

* UI
* User interaction
* Rendering
* State management

Backend responsibilities:

* Validation
* Simulation
* Import/export
* Analysis
* Optimization

Shared responsibilities:

* Data models
* Serialization formats
* Type definitions

---

## Incremental Development

Every completed feature should leave the project in a deployable state.

Avoid partially implemented features.

Prefer:

Small finished improvements

instead of

Large incomplete systems.

---

## Testing Philosophy

Every new feature should include automated tests whenever practical.

Bug fixes should include regression tests.

Do not remove failing tests without understanding why they fail.

---

## Documentation

Documentation is part of the project.

When introducing:

* new architecture
* new APIs
* new modules
* new data structures

update the documentation alongside the implementation.

---

# Coding Style

Write code for humans first.

Priorities:

* descriptive names
* small functions
* minimal nesting
* explicit behavior
* minimal comments

Prefer self-documenting code.

Comments should explain "why," not "what."

---

# Error Handling

Never silently ignore errors.

Provide informative error messages.

Validate user input early.

Fail predictably.

---

# Performance

Do not prematurely optimize.

Favor correctness and readability.

Optimize only after measuring bottlenecks.

---

# Dependencies

Minimize external dependencies.

Before introducing a dependency, consider whether the functionality can reasonably be implemented using existing project libraries.

Avoid unnecessary frameworks.

---

# User Interface

The interface should be:

* clean
* accessible
* responsive
* educational

Animations should improve understanding rather than simply provide visual effects.

---

# Accessibility

Design for keyboard navigation where practical.

Maintain sufficient color contrast.

Avoid relying solely on color to communicate information.

---

# AI Agent Guidelines

Before making changes:

1. Read the relevant documentation.
2. Understand the architecture.
3. Follow existing project conventions.
4. Preserve backwards compatibility whenever possible.

When implementing features:

* prefer incremental commits
* avoid unnecessary refactoring
* keep changes focused
* write tests
* update documentation

When uncertain:

Ask for clarification instead of making assumptions.

---

# Current State

**This file holds the durable rules. `docs/Roadmap.md` holds the status**, and
where the two disagree, the Roadmap wins — it is maintained, this is not.

Milestone 3 (Circuit Editor MVP) is active. Milestones 1 and 2 are closed; the
Circuit Model is complete and settled by ADRs 0001-0006.

Read `docs/Roadmap.md` first, then whatever the task needs:

| Read | When |
|---|---|
| `docs/Roadmap.md` — *Project Status* and *Where to Pick Up* | always |
| `docs/Architecture.md` | before adding a module or crossing a layer |
| `docs/ProjectStructure.md` | before creating a directory |
| `docs/CircuitModel.md` + ADRs 0001-0006 | before touching the model, either shared source, or anything generated from them |
| `docs/UI.md` + ADR-0007 | before touching the editor |
| `docs/Frontend.md` | before touching frontend structure; it forbids some obvious shortcuts |
| `docs/decisions/` | when a decision looks arbitrary — the reasoning is there |

`docs/API.md` and `docs/Simulation.md` are **draft, describing unbuilt design**
for Milestones 4-5. Do not read them as current behaviour.

Settled — do not reopen without cause: mid-circuit measurement (deferred;
measurement terminates a qubit, barriers exempt), identifier generation
(client-side, backend-validated), `classicalRegisters` (required, may be empty, no
implicit register), the shared-model strategy (JSON Schema as source of truth),
version compatibility (declared version selects a mode, content decides the
outcome), and the editing model (pure edits, snapshot history).

**A barrier's targets are captured at placement and never rewritten.** Placing one
expands it to every wire then present; adding a qubit afterwards does not join it,
and this has already been asked once. `CircuitModel.md` settles it — there is no
implicit "all qubits" barrier *because its meaning would change when a qubit is
added*. Removing a qubit does shrink a barrier, which looks like the mirror image
and is not: a removed qubit takes its reference with it, so the shrink is forced by
referential integrity, while a new qubit is referenced by nothing. The two cases
are also indistinguishable in the document, so a rule that widened one would widen
the other. See `docs/UI.md` under *Placing a Barrier*.

## Rules That Outlive Any Milestone

**Never hand-edit a generated file.** Change `shared/schema/circuit.schema.json`
or `shared/spec/circuit.spec.json` and run `python shared/generate_bindings.py`.
CI rejects a hand edit, and so does the next regeneration.

**Every generation flag and schema oddity is load-bearing and was found
empirically. Do not tidy any of them away** — and the reasoning lives beside each
one rather than here, so it is in front of whoever is about to change it:

* `shared/generate_bindings.py` — the comment above `PYTHON_ARGS` for the flags,
  and `_normalize_newlines` for why output is newline-normalized
* `shared/schema/circuit.schema.json` — `$comment` fields explaining the
  `discriminator` keyword, the `Identifier` / `IdentifierRef` split, and why
  `Metadata` forbids additional properties

**Adding a gate touches both shared sources**, and generation fails if they
disagree. Do not work around that error by editing only one file.

**Violation codes come from the spec, never a string literal.** That is what lets
one fixture serve two languages.

**A fixture's declaration is load-bearing.** Editing one to match new output
defeats the only mechanism that detects divergence between the two
implementations. If a fixture fails, either an implementation is wrong or an ADR
changed — and the second requires an ADR revision.

**Parity needs no cross-language test runner.** Each fixture declares its own
expected outcome, so both suites assert against the same artifact and agreement
follows transitively. `tests/contract/` awaits endpoints; do not put a runner
there.

**The project was renamed to Phasor Workbench on 2026-07-28** (commit `5d902cf`).
On a machine cloned before that, follow the migration under **Environment Notes**
before running anything — the venv will be stale.

---

# Technology Stack

Decided during Milestone 1. Do not change without discussion.

**Frontend** — React 19, TypeScript (strict), Vite, Tailwind v4, Vitest,
ESLint + Prettier

**Backend** — Python 3.11+, FastAPI, Pydantic v2, pytest, Ruff, mypy (strict)

**Simulation** — Qiskit + NumPy, isolated in an optional `simulation` extra
because nothing before Milestone 4 needs them

Two decisions that are easy to accidentally reverse:

* **Circuit rendering is direct SVG, not a node-graph library.** A library
  that owns node positions would duplicate the layout the Circuit Model must
  derive. See `docs/Frontend.md`.
* **Operations are a flat ordered list; cycles are derived, never stored.**
  The decomposition is a specified, cross-language-tested component, not a
  rendering detail. Scheduling intent is expressed as barrier *operations*, not
  by restructuring the list. The project word is **cycle** — not "moment", not
  "column". See ADR-0001 and ADR-0003.

---

# Commands

Backend, from `backend/` with the venv activated:

```
pytest                  # tests
ruff check .            # lint
ruff format .           # format (rewrites)
ruff format --check .   # format (verify only) -- what CI runs
mypy                    # type check
uvicorn phasor_workbench.main:app --reload --port 8000
```

Frontend, from `frontend/`:

```
npm test                # tests
npm run lint            # lint
npm run format          # format (rewrites)
npm run format:check    # format (verify only) -- what CI runs
npm run typecheck       # type check
npm run build           # type check + production build
npm run dev             # dev server on 5173, proxies /api to 8000
```

Shared model, from the repository root. Needs both the backend venv and
`frontend/node_modules`, because it drives each project's own toolchain:

```
python shared/generate_bindings.py            # regenerate bindings
python shared/generate_bindings.py --check    # verify not stale -- what CI runs
```

Run this after **any** edit to `shared/schema/circuit.schema.json` or
`shared/spec/circuit.spec.json`. A source and its regenerated output belong in
the same commit, and `--check` fails the build otherwise. Never edit a generated
file by hand; see ADR-0004 and ADR-0005.

Docker, from the repository root:

```
docker compose up --build    # both services, hot-reloading
docker compose down          # stop
docker compose build         # rebuild after dependency changes
```

Run the full set before declaring work complete. The Definition of Done in
`docs/Roadmap.md` requires tests, linting, and type checking to pass.

**Docker supplements native development, it does not replace it.** CI runs
natively, and the venv/npm workflow above remains fully supported. Do not
rewrite the native instructions to assume containers.

The container pins **Python 3.13**, not the 3.14 used natively — Qiskit
publishes no 3.14 wheels, so the container is where the Milestone 4
`simulation` extra will install. Dependency changes need
`docker compose build`; source changes do not, because the working tree is
bind-mounted.

**The `--check` variants are the ones CI runs**, and they fail rather than
rewrite. Run them before pushing: the rewriting variants pass silently by
fixing the problem, so a green local run proves nothing about CI. CI also runs
`npm ci` rather than `npm install`, which fails if `package.json` and
`package-lock.json` have drifted — commit both together.

---

# Environment Notes

**This project is developed from more than one Windows machine.** Setup state
(`.venv/`, `node_modules/`, `.env`, `.claude/settings.local.json`) is all
gitignored, so each machine is configured independently and one cannot break
another. The notes below are not all true of every machine — check before
acting on them.

**Migrating a machine cloned before the 2026-07-28 rename.** A checkout made
before commit `5d902cf` has an editable install pointing at
`backend/src/quantum_workbench/`, a path that no longer exists. Git updates
files; it does not update a venv. After pulling:

```
cd backend
.venv\Scripts\activate
pip uninstall -y quantum-workbench-backend    # the old distribution
pip install -e ".[dev]"
cd ../frontend && npm install
```

Then delete any leftover `backend/src/quantum_workbench/`. Git will not remove
that directory if it still holds untracked `__pycache__/`, so it survives the
pull as confusing debris. Skipping the `pip uninstall` is the failure mode to
avoid — both distributions end up registered, the old one pointing at nothing.

**On some machines the repository lives inside OneDrive.** Where it does,
OneDrive locks files as it syncs and periodically leaves a stale
`.git/index.lock`, which blocks all staging and committing. If git refuses to
stage, check for that file; delete it only after confirming no git process is
running and no merge/rebase is in progress. Confirm the checkout is actually
inside the synced tree before blaming OneDrive — note that `C:\Users\<you>\
Documents` and `C:\Users\<you>\OneDrive\Documents` are different directories,
and the repo may sit in the unsynced one.

**Line endings are LF everywhere**, enforced by `.gitattributes`, which
overrides the repo-local `core.autocrlf=true`. Do not reintroduce CRLF.

**Do not bulk-edit the Markdown docs with a Python script on Windows.**
`pathlib.read_text()` / `write_text()` default to the *locale* encoding (cp1252
here), not UTF-8, and to platform line endings. A round trip therefore mangles
every em dash, arrow and `π` in `docs/` and rewrites the file as CRLF, violating
the rule above. This was hit and reverted on 2026-08-01. Use an editor, or pass
`encoding='utf-8', newline='\n'` explicitly on both calls. `git diff` catches it
— a replacement character or a whole-file rewrite means this happened.

**Python 3.14 is installed locally.** The backend runs on it, but Qiskit does
not yet publish 3.14 wheels — hence the optional `simulation` extra.

**`npm audit` reports 5 high-severity dev-only findings** in ESLint's
dependency chain. Deliberately deferred; see `docs/Roadmap.md`. Do not run
`npm audit fix --force`, which would install a breaking ESLint major.

---

# Project Vision

Phasor Workbench is intended to become a platform for:

* quantum circuit construction
* interactive simulation
* educational visualization
* quantum algorithm demonstrations
* error correction exploration
* research experimentation

Design today's implementation so future features can be added without major rewrites.

Every architectural decision should support this long-term vision.

# Architecture Decision Records (ADRs)

The `docs/decisions/` directory contains Architecture Decision Records.

ADRs document the reasoning behind major architectural choices.

Before proposing changes that affect:

- data models
- APIs
- serialization
- project structure
- technology choices
- execution semantics

read the relevant ADRs. If they are proposed ADRs, ask first before moving forward to try to accept the ADRs concretely.

If a proposed implementation conflicts with an accepted ADR, do not proceed without explicit approval.

If no ADR exists for a significant architectural decision, recommend creating one before implementation.
