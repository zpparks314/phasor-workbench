# AGENTS.md

Instructions for AI coding agents working in this repository, in the
cross-tool [`AGENTS.md`](https://agents.md) convention so one file serves every
agent. **This is the file to edit.** Claude Code reads `CLAUDE.md` rather than
this name, so `.claude/CLAUDE.md` is a three-line pointer that imports this
file; anything written there instead of here is invisible to every other tool.

---

**Phasor Workbench** — an open-source, browser-based application for creating,
visualizing, simulating and understanding quantum circuits. It aims between
educational toys that cannot express real circuits and professional frameworks
that assume you already know the mathematics: existing tools optimize for
execution, this one for understanding.

Expected to grow over several years. Design for that.

Renamed from "RogueScholar's Quantum Workbench" on 2026-07-28 (commit `5d902cf`)
— the possessive read as a hobby project and the bare name collided with four
existing tools, two in the same niche. A *phasor* is a rotating complex number
carrying magnitude and phase, which is what a quantum amplitude is. Python
package: `phasor_workbench`. **On a machine cloned before that date, follow the
migration under *Environment Notes* before running anything.**

---

# What To Read

**This file holds the durable rules. `docs/Roadmap.md` holds the status**, and
where they disagree the Roadmap wins — it is maintained, this is not. Where this
file and a *topic* document disagree about behaviour, the topic document is the
specification.

| Read | When |
|---|---|
| `docs/Roadmap.md` — *Project Status*, *Open Issues*, *Where to Pick Up* | always |
| `docs/Architecture.md` | before adding a module or crossing a layer |
| `docs/ProjectStructure.md` | before creating a directory |
| `docs/CircuitModel.md` + ADRs 0001–0006 | before touching the model, either shared source, or anything generated from them |
| `docs/UI.md` + ADR-0007 | before touching the editor |
| `docs/decisions/ADR0008_LocalPersistence.md` | before touching local save, `serialization/`, `persistence/`, or the generated validator |
| `docs/decisions/ADR0009_CircuitCatalogue.md` | before touching `examples/`, or adding anything that produces a circuit from parameters |
| `docs/Frontend.md` | before touching frontend structure; it forbids some obvious shortcuts |
| `docs/API.md`, `docs/Simulation.md` | before touching endpoints or the simulator seam |
| `docs/decisions/` | when a decision looks arbitrary — the reasoning is there |

Milestones 1–4 are closed. `API.md` and `Simulation.md` were drafts through
Milestone 3 and now describe built behaviour; each still ends with open
questions that are genuinely open.

**Settled — do not reopen without cause:** mid-circuit measurement (deferred;
measurement terminates a qubit, barriers exempt), identifier generation
(client-side, backend-validated), `classicalRegisters` (required, may be empty,
no implicit register), the shared-model strategy (JSON Schema as source of
truth), version compatibility (declared version selects a mode, content decides
the outcome), the editing model (pure edits, snapshot history), local
persistence, and bit ordering (**qubit 0 is the rightmost bit of a basis
string**).

**A barrier's targets are captured at placement and never rewritten.** Adding a
qubit afterwards does not join it; removing one does shrink it, because a removed
qubit takes its reference with it and referential integrity forces the shrink.
This has been asked more than once — the full argument is in `docs/UI.md` under
*Placing a Barrier*, and `CircuitModel.md` settles why there is no implicit "all
qubits" barrier.

---

# Primary Goals

In order: **clean architecture, readable code, extensibility, correctness, user
experience, performance.** Do not sacrifice architecture for short-term
convenience.

Every major subsystem — simulator backend, visualization, editor, export
formats, persistence — should be replaceable with minimal changes elsewhere. No
module depends on another's implementation details. Favour interfaces over
tight coupling.

---

# Core Principles

**Single source of truth.** The Circuit Model is the authoritative
representation. Editor, simulator, exporters, importers and visualizations all
operate from it. Never duplicate circuit state.

**Separation of concerns.** Frontend owns UI, interaction, rendering and state
management. Backend owns validation, simulation, import/export, analysis and
optimization. Data models, serialization formats and type definitions are
shared.

**Incremental development.** Every completed feature leaves the project
deployable. Prefer small finished improvements over large incomplete systems.

**Testing.** Every feature includes automated tests where practical; every bug
fix includes a regression test. Never delete a failing test without
understanding why it fails.

**Documentation is part of the project.** New architecture, APIs, modules or
data structures are documented in the same change that introduces them.

**Coding style.** Write for humans: descriptive names, small functions, minimal
nesting, explicit behaviour, few comments. Comments explain *why*, not *what*.

**Error handling.** Never silently ignore an error. Validate input early, fail
predictably, and say what went wrong.

**Performance.** Do not optimize before measuring.

**Dependencies.** Minimize them. Before adding one, check whether existing
libraries cover it. Avoid unnecessary frameworks.

**Interface.** Clean, accessible, responsive, educational. Animation explains
something or does not exist. Design for keyboard navigation, maintain contrast,
and never let colour be the only carrier of meaning.

---

# Rules That Outlive Any Milestone

**Never hand-edit a generated file.** Change `shared/schema/circuit.schema.json`
or `shared/spec/circuit.spec.json` and run `python shared/generate_bindings.py`.
CI rejects a hand edit, and so does the next regeneration.

**Every generation flag and schema oddity is load-bearing and was found
empirically. Do not tidy any of them away** — the reasoning lives beside each
one rather than here, so it is in front of whoever is about to change it:

* `shared/generate_bindings.py` — the comment above `PYTHON_ARGS` for the flags,
  and `_normalize_newlines` for why output is newline-normalized
* `shared/schema/circuit.schema.json` — `$comment` fields explaining the
  `discriminator` keyword, the `Identifier` / `IdentifierRef` split, and why
  `Metadata` forbids additional properties

**Adding a gate touches both shared sources**, and generation fails if they
disagree. Do not work around that error by editing only one file.

**Violation codes come from the spec, never a string literal.** That is what
lets one fixture serve two languages.

**A fixture's declaration is load-bearing.** Editing one to match new output
defeats the only mechanism that detects divergence between the two
implementations. If a fixture fails, either an implementation is wrong or an ADR
changed — and the second requires an ADR revision.

**Parity needs no cross-language test runner.** Each fixture declares its own
expected outcome, so both suites assert against the same artifact and agreement
follows transitively. `tests/contract/` awaits API conformance tests.

**Qiskit is imported by exactly one module**, `simulation/backends/qiskit_backend.py`,
and a test enforces it. That isolation is what makes the backend swappable.

## Two testing lessons, both learned the hard way

**A test that dispatches an event directly on an element proves nothing about
whether a pointer can reach it.** The gate drag shipped broken with a passing
test for exactly that reason. Drive interactions through the element a user
would actually hit.

**A property test that cannot detect its own vacuity is not evidence.** The undo
property held for five seeds over circuits too small to mean anything, until a
guard was added.

## And one about documents

**A dependency claim in a document is evidence about the day it was written.**
Milestone 4 nearly built real structure to route around a constraint that had
already lapsed. Re-run the check before designing around it; it usually costs one
command.

---

# Technology Stack

Decided in Milestone 1. Do not change without discussion.

**Frontend** — React 19, TypeScript (strict), Vite, Tailwind v4, Vitest,
ESLint + Prettier.
**Backend** — Python 3.11+, FastAPI, Pydantic v2, pytest, Ruff, mypy (strict).
**Simulation** — Qiskit 2.x + NumPy, in an optional `simulation` extra. Installs
on 3.11–3.14; optional to keep dependencies minimal, not because of any
interpreter limit.

Two decisions that are easy to reverse by accident:

* **Circuit rendering is direct SVG, not a node-graph library.** A library that
  owns node positions would duplicate the layout the Circuit Model must derive.
  See `docs/Frontend.md`.
* **Operations are a flat ordered list; cycles are derived, never stored.** The
  decomposition is a specified, cross-language-tested component, not a rendering
  detail. Scheduling intent is expressed as barrier *operations*, not by
  restructuring the list. The project word is **cycle** — not "moment", not
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

Run it after **any** edit to either shared source. A source and its regenerated
output belong in the same commit, and `--check` fails the build otherwise.

Docker, from the repository root:

```
docker compose up --build    # both services, hot-reloading
docker compose down          # stop
docker compose build         # rebuild after dependency changes

docker compose run --rm --no-deps backend pytest       # backend suite
docker compose run --rm --no-deps frontend npm test    # frontend suite
```

**Run the whole set before declaring work complete** — the Definition of Done in
`docs/Roadmap.md` also requires the app to load in a browser, which is the one
item that catches a build that passes every check and renders nothing.

**The `--check` variants are what CI runs**, and they fail rather than rewrite.
Run them before pushing: the rewriting variants pass silently by fixing the
problem, so a green local run proves nothing. CI runs `npm ci`, not
`npm install`, which fails if `package.json` and the lockfile have drifted —
commit both together.

**Source changes need no rebuild; dependency changes do.** `src/`, `tests/` and
`shared/` are bind-mounted, so edits appear instantly for days — and then the
first `pyproject.toml` or `package.json` change silently runs against the old
image. That asymmetry is the trap.

**`shared/` is mounted at `/shared` in both services and must stay that way.**
The fixtures live outside both build contexts, so neither image can contain
them; the backend resolves them from `parents[2]` and the frontend from
`process.cwd()/..`, and both land on `/shared`. Without it the containers serve
the app perfectly and fail 20 backend tests.

**Docker supplements native development, it does not replace it.** CI runs
natively. Do not rewrite the native instructions to assume containers.

---

# Environment Notes

**Developed from more than one Windows machine.** Setup state (`.venv/`,
`node_modules/`, `.env`, `.claude/settings.local.json`) is gitignored, so each
machine is configured independently. The notes below are not all true of every
machine — check before acting on them.

**Migrating a machine cloned before the 2026-07-28 rename.** Such a checkout has
an editable install pointing at `backend/src/quantum_workbench/`, a path that no
longer exists; git updates files, not venvs. After pulling:

```
cd backend
.venv\Scripts\activate
pip uninstall -y quantum-workbench-backend    # the old distribution
pip install -e ".[dev,simulation]"
cd ../frontend && npm install
```

Then delete any leftover `backend/src/quantum_workbench/` — git will not remove
it while it holds untracked `__pycache__/`. Skipping the `pip uninstall` is the
failure mode to avoid: both distributions end up registered, the old one
pointing at nothing.

**Do not bulk-edit the Markdown docs with a Python script unless you pass
`encoding='utf-8', newline='\n'` explicitly on both `read_text` and
`write_text`.** They default to the *locale* encoding (cp1252 here) and platform
line endings, so a round trip mangles every em dash, arrow and `π` in `docs/`
and rewrites the file as CRLF. Hit and reverted on 2026-08-01. `git diff`
catches it — a replacement character or a whole-file rewrite means this
happened.

**Line endings are LF everywhere**, enforced by `.gitattributes`, which
overrides the repo-local `core.autocrlf=true`.

**Git Bash rewrites container paths in `docker run`.** A `-v host:/container`
mount or a `/app/script.py` argument gets expanded against the MSYS root, so the
container is told to open something like `/c/Program Files/Git/smoke.py`. Set
`MSYS_NO_PATHCONV=1`, or run Docker from PowerShell.

**On some machines the repository lives inside OneDrive.** There, OneDrive locks
files as it syncs and periodically leaves a stale `.git/index.lock`, blocking
all staging. Delete it only after confirming no git process is running and no
merge or rebase is in progress. Check the checkout is actually inside the synced
tree first — `C:\Users\<you>\Documents` and `C:\Users\<you>\OneDrive\Documents`
are different directories.

**Do not run `npm audit fix --force`.** It installs a breaking ESLint major.
Plain `npm audit fix` is fine and is what cleared the findings on 2026-08-02 —
`npm audit` now reports zero. The deferral note that used to sit here outlived
its premise by some margin, which is the *Rules That Outlive Any Milestone*
lesson about dependency claims, arriving on schedule.

---

# Working Practice

Before changing anything: read the relevant documentation, understand the
architecture, follow existing conventions, and preserve backwards compatibility
where possible.

When implementing: prefer incremental commits, avoid unnecessary refactoring,
keep changes focused, write tests, update documentation in the same change.

**Ask rather than assume.** If a decision would alter the architecture, stop and
ask.

**ADRs.** `docs/decisions/` holds the reasoning behind major choices. Read the
relevant ones before proposing changes to data models, APIs, serialization,
project structure, technology choices or execution semantics. If an
implementation conflicts with an accepted ADR, do not proceed without explicit
approval. If a significant decision has no ADR, recommend writing one. For
*proposed* ADRs, ask before treating them as settled.

**Pull requests.** `main` is protected by a ruleset requiring the `CI` check —
not the legacy branch-protection API, so a check against that endpoint reports
"not protected" and looks alarming. Work goes through a branch and a PR. **PRs
are squash-merged**, so avoid stacking them: a stacked branch's base commits stop
being ancestors of `main` and every one of them conflicts. Single PRs off `main`.

---

# Vision

A platform for circuit construction, interactive simulation, educational
visualization, algorithm demonstrations, error-correction exploration and
research experimentation. Design today's implementation so those can be added
without major rewrites. See `docs/Vision.md`.
