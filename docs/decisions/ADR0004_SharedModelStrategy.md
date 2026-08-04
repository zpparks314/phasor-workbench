# ADR-0004: Shared Model Strategy

**Status:** Accepted

**Date:** 2026-07-29

## Context

The frontend is TypeScript and the backend is Python. Both must agree exactly on
what a circuit is. `Architecture.md` places the Circuit Model at the center of
the system and requires that neither project own it, which is why it lives in
`shared/`.

Two approaches were carried into Milestone 2:

* **JSON Schema as the source of truth**, with language bindings generated from
  it. Proposed in `shared/README.md`, but explicitly left unconfirmed.
* **Hand-written types in both languages**, with contract tests enforcing parity.

ADR-0001 changed the weight of this decision after it was first framed. The
cross-language surface is no longer just a set of types: the cycle derivation is
an *algorithm* that both sides must implement identically. Any strategy chosen
here must account for a shared surface that code generation cannot fully cover.

## Decision

**1. JSON Schema is the source of truth for the wire format.**

The canonical schema lives in `shared/schema/`, written against JSON Schema draft
2020-12. It defines the structure of a serialized circuit and nothing else.

**2. Language bindings are generated, committed, and never hand-edited.**

Generation is a development-time step, not a build-time one. Generated output is
committed, and CI regenerates it and fails on any diff. Every generated file
carries a header identifying it as generated and naming the schema it came from.

**3. Generated bindings are written into each consuming project**, not into a
shared output directory:

| Project | Destination | Tool |
|---|---|---|
| Frontend | `frontend/src/model/` | `json-schema-to-typescript` |
| Backend | `backend/src/phasor_workbench/models/` | `datamodel-code-generator` |

Both tools are development-only dependencies.

The previously anticipated `shared/generated/` directory is **removed**. Neither
language's toolchain can import cleanly from a sibling directory outside its own
package root. TypeScript could manage it with a path alias, but Python would
require either a second installable distribution or a relative path dependency —
and this project is developed from more than one machine, with a Docker
environment whose bind mounts are per-service. Generating into each project keeps
`pip install -e .`, `npm install`, and `docker compose up` working with no
packaging changes at all. The schema remains the single source; only its output
is co-located with its consumers.

**4. Generation covers shape only. This is a scope limit, not an oversight.**

Referential validation, semantic validation, and the cycle derivation are
hand-written in both languages and held to agreement by shared fixtures. See
Consequences for the coverage boundary.

**5. The `Operation` union is written with `const` discriminators and verified
before the schema grows.**

`Operation` is a three-way tagged union on `kind` (`gate`, `measurement`,
`barrier`) and is the model's central type. Each branch declares
`"kind": { "const": "..." }` so that generators emit `Literal["gate"]` in Python
and a narrowable literal type in TypeScript, allowing Pydantic to form a true
discriminated union.

Without this, Pydantic falls back to attempting every branch and reports that
none matched, rather than reporting that `kind: "gate"` requires `name`. That
directly violates the informative-error-messages rule in `AGENTS.md`. Verifying
the generated union on both sides is the first task of the milestone, before
anything is built on top of it.

## Rationale

**Ownership neutrality is the deciding argument.** Hand-written types would place
the contract in two type systems with neither authoritative, making drift
something detected by tests rather than prevented by structure. A JSON Schema is
neutral in a way that neither a `.ts` file nor a Pydantic model can be, which is
the property `shared/` exists to provide.

**Structural drift becomes impossible rather than merely detectable.** Neither
side is authored independently, so the two cannot disagree about the wire format
between test runs.

**`schemaVersion` and the migration policy get one home.** The versioning table
in `CircuitModel.md` governs a single artifact.

**A third consumer costs one generator.** A CLI, a language server, or another
language binding is additive.

**Committing generated output keeps every install path simple.** A plain
`npm install` or `pip install -e .` needs no code generation toolchain, CI and
Docker stay unchanged, and schema changes appear in review diffs — which is
exactly when they warrant attention. The costs are diff churn and the risk of
hand-editing, addressed by file headers and the CI freshness check.

## Consequences

### The Coverage Boundary

Generation covers structural rules only. Against the validation rules in
`CircuitModel.md`:

| Rule | Expressible in schema |
|---|---|
| Identifier non-empty, length-bounded | Yes — `minLength` / `maxLength` |
| Classical register size ≥ 1 | Yes — `minimum` |
| Qubit index non-negative | Yes — `minimum` |
| Gate name in the known set | Yes — `enum` |
| Barrier carries no controls or parameters | Yes — union branch |
| Identifier unique within its collection | No |
| Qubit indices contiguous, no gaps | No |
| Operation references an existing qubit | No — cross-referential |
| Measurement bit within its register's size | No — cross-referential |
| Gate arity matches its name | No |
| Same qubit in both `targets` and `controls` | No |
| Parameters match the gate's signature | No — combinatorial |
| Nothing acts on a measured qubit | No — order-dependent |

Roughly a third of the rules, and none of the interesting ones. Every remaining
rule is implemented twice, in TypeScript and Python.

The cycle derivation specified in ADR-0003 is generated by nothing at all.

**Contract fixtures are therefore mandatory under this strategy, exactly as they
would have been under the alternative.** Choosing generation narrows what is
shared-by-construction to the wire format — the layer where drift is silent and
consequences are worst — and does not reduce the testing burden elsewhere. Any
claim that this strategy causes validation rules to be "declared once" is false
and should be corrected wherever it appears.

### Fixtures

`shared/fixtures/` carries three categories:

* `valid/` — circuits both sides must accept
* `invalid/` — circuits both sides must reject, each paired with the violation
  codes it must produce
* `decomposition/` — circuits paired with their expected cycle decomposition,
  covering the cases enumerated in ADR-0003

The third is new, added because the derivation is a shared algorithm rather than
a shared type and has no other means of enforcement.

### Operational

* CI gains a job that regenerates bindings and fails on a non-empty diff. It
  needs both Python and Node, so it is separate from the existing per-project
  jobs.
* Two development-only dependencies are added, one per project.
* Generated files appear in review diffs. This is intended.
* A schema change is a two-step commit: edit the schema, regenerate. Neither is
  valid alone, and CI enforces it.

## Alternatives Considered

**Hand-written types in both languages, with contract tests enforcing parity.**
Declined. It permits drift between test runs and leaves the contract with no
authoritative expression. Its genuine advantages — control over ergonomics,
validators attached directly to models, no codegen toolchain — are real but
smaller, and the first two are recoverable by wrapping or subclassing generated
types.

**Pydantic as the source of truth, emitting JSON Schema, with TypeScript
generated downstream.** Declined, and recorded because it is the common
pragmatic path and will be proposed again when the codegen toolchain becomes
irritating. It removes one generator and gives hand-written models with
validators attached, but it makes the backend the owner of the Circuit Model —
precisely what `shared/` exists to prevent, and a direct conflict with
`ProjectStructure.md`.

**Generating at build time instead of committing.** Declined. It puts a code
generation toolchain in the path of every install, every CI job, and both Docker
images, in exchange for avoiding diff churn.

**A shared `shared/generated/` output directory.** Declined on packaging
grounds, detailed in Decision 3.

## Future Considerations

Should generated code quality prove inadequate for a specific type, the escape
hatch is to wrap or subclass the generated type in the consuming project — not to
abandon the schema. Hand-editing generated files is never the answer, and CI will
reject it.

`API.md` request and response schemas should reference the same definitions
rather than restating them, so that the API contract and the model contract
cannot diverge.

If a third consumer appears, its bindings are generated into that consumer by the
same rule, and it adds its own generator rather than reusing another project's
output.
