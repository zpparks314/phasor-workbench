# ADR-0005: Shared Specification Data and Module Layout

**Status:** Accepted

**Date:** 2026-07-29

## Context

[ADR-0004](ADR0004_SharedModelStrategy.md) made the JSON Schema the source of
truth for the wire format and had bindings generated into each project. It also
stated its own coverage boundary plainly: generation covers *shape* only, and
every cross-referential, semantic, and order-dependent validation rule — plus
the cycle derivation specified in [ADR-0003](ADR0003_ExecutionSemantics.md) — is
hand-written once per language.

Milestone 2's remaining work is exactly that hand-written half: four artifacts,
two per language. Attempting to start it surfaces two gaps that ADR-0004 did not
address, both consequences of its boundary rather than oversights in it.

**First, the hand-written validators must agree on data that lives nowhere.**

* **Violation codes.** An `invalid/` fixture is a circuit paired with the codes
  both implementations must produce. No such codes exist. `api/errors.py` types
  `ErrorDetail.code` as a bare `str`, and the only code appearing anywhere in the
  project is one illustrative string in an `API.md` example. Two independently
  written validators will not choose the same names, and a fixture cannot be
  written once against names that differ.

* **Gate signatures.** "A gate's qubit count does not match its declared arity"
  is a validation rule whose data lives in a Markdown table in `CircuitModel.md`,
  and that table is not precise enough to implement from. It records `cx` and
  `swap` as taking two qubits each, but `cx` is one target plus one control while
  `swap` is two targets and no controls. The distinction appears only in a prose
  sentence below the table. A validator needs targets, controls, and required
  parameters per gate — strictly more than the table encodes.

  This also leaves adding a gate half-guarded. A new gate is a minor version bump
  under `CircuitModel.md`'s versioning rules, so it will happen repeatedly, and
  today it means editing the `GateName` enum in the schema (generated,
  CI-checked) *and* two hand-written arity tables (unguarded).

* **The current `schemaVersion`.** The schema's pattern only checks that the
  string resembles semantic versioning. Nothing holds the value, yet the entire
  migration policy is comparisons against it.

**Second, three of the four hand-written artifacts have no place to live.**

Python validation has `backend/src/phasor_workbench/validation/`. The other three
do not have a home:

* The Python derivation is not analysis. `analysis/` is labeled Milestone 4 in
  `ProjectStructure.md`, and ADR-0001 is explicit that the derivation is a
  first-class component that analysis, simulation, and rendering all *consume*.
* `frontend/src/model/` is documented as generated and never hand-edited, so
  neither TypeScript artifact can go there. `editor/` is Milestone 3 rendering,
  and ADR-0001 spends a paragraph insisting the derivation is not a rendering
  detail. `state/` is undo/redo.

## Decision

### 1. A second shared artifact, `shared/spec/circuit.spec.json`

It carries the facts about the current model that a JSON Schema structurally
cannot: the current schema version, gate signatures, and violation codes. It sits
beside `shared/schema/circuit.schema.json` and the pairing is deliberate — the
schema defines a circuit's *shape*, the spec defines the *semantics* the shape
cannot hold.

```json
{
  "schemaVersion": "0.1.0",
  "gates": {
    "h":    { "targets": 1, "controls": 0, "parameters": [] },
    "cx":   { "targets": 1, "controls": 1, "parameters": [] },
    "swap": { "targets": 2, "controls": 0, "parameters": [] },
    "ccx":  { "targets": 1, "controls": 2, "parameters": [] },
    "rx":   { "targets": 1, "controls": 0, "parameters": ["theta"] },
    "p":    { "targets": 1, "controls": 0, "parameters": ["lambda"] }
  },
  "violations": { "...": "see section 4" }
}
```

Parameter names are strings in a list, never identifiers. `p` takes `lambda`,
which is a reserved word in Python; keeping parameter names as data rather than
as generated symbols means the reserved-word collision never arises.

### 2. Bindings are generated from it by the same script, under the same rules

`shared/generate_bindings.py` gains a third target, emitting typed constants into
each project beside the bindings already there:

| Project | Destination |
|---|---|
| Frontend | `frontend/src/model/spec.ts` |
| Backend | `backend/src/phasor_workbench/models/spec.py` |

Python receives a `StrEnum` of violation codes and a frozen mapping of gate
signatures; TypeScript receives a string-literal union and a `const` object.
Generated, committed, never hand-edited, and covered by the existing
`Shared model` CI job — no new job is required, because `--check` already
compares every target byte-for-byte.

Unlike the two existing targets, this emitter is written by hand rather than
driven by a third-party tool: the existing tools generate types from schemas, not
constants from data. It reuses the formatting and newline-normalization machinery
already in the script, for the same reasons documented there.

### 3. Generation verifies the two shared artifacts agree

Generation fails if the gate names in `circuit.spec.json` are not exactly the
`GateName` enum in `circuit.schema.json`.

This is what closes the half-guarded gap. With the check in place, adding a gate
requires editing both shared files and regenerating, and forgetting either half
fails the build rather than shipping a gate the validator silently rejects.

### 4. Violation codes cover the hand-written pass; shape rejection is one code

The taxonomy is deliberately small. Every semantic rule in `CircuitModel.md` maps
to exactly one code:

| Code | Rule |
|---|---|
| `DUPLICATE_IDENTIFIER` | an identifier is duplicated within its collection |
| `DUPLICATE_QUBIT_INDEX` | a qubit index is duplicated |
| `QUBIT_INDEX_GAP` | qubit indices are not contiguous from 0 |
| `UNKNOWN_QUBIT_REFERENCE` | an operation references a qubit that does not exist |
| `UNKNOWN_REGISTER_REFERENCE` | a measurement references a register that does not exist |
| `CLASSICAL_BIT_OUT_OF_RANGE` | a measurement's bit falls outside its register's size |
| `GATE_ARITY_MISMATCH` | target or control count disagrees with the gate's signature |
| `QUBIT_REUSED_IN_OPERATION` | a qubit appears more than once across one operation's qubits |
| `PARAMETER_MISSING` | a required parameter is absent |
| `PARAMETER_UNKNOWN` | an unrecognized parameter is supplied |
| `PARAMETER_NOT_FINITE` | a parameter is not a finite number |
| `OPERATION_AFTER_MEASUREMENT` | a gate or measurement acts on an already-measured qubit |

One warning code, `SCHEMA_VERSION_NEWER_MINOR`, shares the namespace. Warnings
and errors are both things a consumer branches on, and splitting the namespace
would invite the same code to mean different things on either side of the split.

Everything else in `CircuitModel.md`'s rule list is enforced by the schema:
identifier length, negative qubit index, register size, unknown gate name,
unknown operation kind, empty barrier targets, and a barrier carrying `controls`,
`parameters`, or `classicalTarget`. Those are reported under a single
`SHAPE_INVALID` code carrying the underlying validator's message and path.

Collapsing shape failures to one code is a deliberate limit. Pydantic and any
JavaScript equivalent have different internal error taxonomies, so mapping both
onto a shared enum would reintroduce exactly the drift this ADR removes — and no
consumer branches on *which* shape rule failed, only on whether the document was
readable at all.

### 5. Mirrored module names in both projects

```text
backend/src/phasor_workbench/          frontend/src/
├── models/     generated              ├── model/        generated
├── validation/ hand-written  (M2)     ├── validation/   hand-written  (M2)
└── cycles/     hand-written  (M2)     └── cycles/       hand-written  (M2)
```

Generated directories stay generated-only; the generated spec constants join the
generated bindings there. The two hand-written modules carry the same name in both
languages, and their entry points are the same name under each language's
convention: `validate_circuit` / `validateCircuit`, `derive_cycles` /
`deriveCycles`. Where a module grows to several files, the file names mirror too.

The symmetry is the point rather than tidiness. Four artifacts must agree
permanently, and whoever writes or debugs a contract test should be able to find
both halves of a disagreement by name instead of by search.

`cycles` is the module name because ADR-0001 Decision 4 makes **cycle** the
project word and retires "moment" and "column".

### 6. Milestone 2 frontend validation is semantic only

The frontend implements the hand-written semantic validator. It does **not** gain
a runtime shape validator in Milestone 2.

TypeScript types do not exist at runtime, so frontend shape validation would mean
a new dependency, and nothing in Milestone 2 needs it: the editor constructs
circuits through its own code, so they are shape-valid by construction, and the
backend validates anyway because it cannot trust its input. Shape validation
becomes a real question when the frontend first *reads* a circuit it did not
build — Milestone 3's local save, and Milestone 5's import — and should be decided
there with that requirement in hand.

The consequence for fixtures: `invalid/` fixtures are split by phase. Semantic
fixtures are exercised by both languages; shape fixtures are backend-only until
the question above is answered.

## Rationale

**The mechanism is ADR-0004's, applied one layer up.** That ADR's argument was
ownership neutrality: a contract expressed in two type systems has no
authoritative form, so drift becomes something tests detect rather than something
structure prevents. Gate signatures and violation codes are a contract in exactly
that sense. Nothing about the argument depended on the artifact being a *type*.

**It makes the guarded fraction of a gate addition 100% rather than 50%.** This is
the concrete payoff, and it recurs on a predictable schedule, because adding gates
is planned routine work rather than a one-time event.

**A small taxonomy is more likely to stay honest than a complete one.** Twelve
codes traceable one-to-one to named rules in `CircuitModel.md` can be verified by
reading. A taxonomy that also enumerated every shape failure would be larger,
would duplicate two libraries' error models, and would have no consumer for the
extra precision.

**Mirrored names convert a permanent obligation into a navigable one.** The cost
ADR-0001 accepted was a derivation implemented twice, forever. Fixtures detect
disagreement; mirrored module names are what make the disagreement quick to
locate.

## Consequences

**New shared artifact and one more generated file per project.** `shared/spec/`
joins `shared/schema/` as a source of truth. A change to either is a two-step
commit — edit, regenerate — enforced by the existing CI check.

**No new dependency.** The emitter is hand-written project code, roughly the size
of the existing generator wrappers, and reuses their formatting and newline
handling.

**Documentation corrections this ADR obliges.** ADR-0004 asked for the first of
these explicitly and it has not been done:

* `CircuitModel.md` states validation is "defined once in `shared/`". It is
  implemented twice, in both languages. Same claim in `shared/README.md`'s opening
  line and in `Architecture.md`'s module tree, which lists "Validation Rules"
  under Shared.
* `Architecture.md` assigns validation to the backend and gives the frontend UI,
  interaction, rendering, and state. That split predates ADR-0004 and is already
  contradicted by it and by `CircuitModel.md`. It needs a line acknowledging that
  model validation and cycle derivation are shared concerns executed on both
  sides.
* `ProjectStructure.md` gains `shared/spec/`, the two new modules per project, and
  the note that generated spec constants live with the generated bindings.
* `Frontend.md`'s layout tree omits `model/` entirely and needs the two new
  modules.
* `CircuitModel.md`'s gate table remains the human-readable reference, and gains a
  pointer to `circuit.spec.json` as the machine-readable source. Where the two
  disagree, the spec wins and the table is wrong.

**Two things this ADR deliberately does not decide.**

* Whether `invalid/` fixtures assert `path` in addition to `code`. Asserting paths
  catches more divergence but makes path construction a third piece of shared
  behavior both languages must implement identically. Recommend starting with
  codes alone.
* Which CI job runs `tests/contract/`. Nothing currently runs that directory, and
  the backend's `pytest`, `ruff`, and `mypy` are all scoped to `backend/`. This
  ADR's module layout is an input to that decision, not an answer to it.

## Alternatives Considered

**Express arity and parameters in the JSON Schema.** Genuinely possible with one
`oneOf` branch per gate, and rejected in the schema's own comments before this
ADR existed. Eighteen branches would turn the `Operation` union into a twenty-way
discriminated union, undoing the error-quality work ADR-0004 records as its
gating task. Violation codes have no place in a wire-format schema regardless:
they describe validator behavior, not what a circuit looks like.

**Read the JSON at runtime on both sides, with no generation.** Declined as
blocked rather than merely inelegant, on the same packaging grounds as ADR-0004
Decision 3. `circuit.spec.json` sits outside `src/phasor_workbench`, so hatchling
does not ship it; `frontend/tsconfig.json` includes only `src` and
`vite.config.ts`, so the path is outside the program despite `resolveJsonModule`;
and Docker's bind mounts are per-service, so the file would be absent from both
containers.

**Hand-write the codes and signatures in each language, with a contract test
asserting parity.** The cheapest option, and the failure is loud. Declined for
the reason ADR-0004 declined it for types: drift is detected between test runs
rather than prevented. It remains the fallback if the emitter proves more trouble
than it is worth, and it costs one file per language plus one test to adopt later.

**A single `circuit/` module per side, absorbing the existing backend
`validation/`.** Clean and symmetric, and declined only because it removes a
module `Architecture.md` names, making a structural doc rewrite a precondition for
starting Milestone 2 work.

**Hand-written validation and derivation as siblings of the generated bindings,
inside `model/` and `models/`.** Defensible — ADR-0001 gives the derivation "the
same standing as serialization and validation," so all of it is arguably the
model's public surface. Declined because it puts hand-written files in the one
directory whose safety rule is that everything in it is generated, and because it
strands the existing backend `validation/`.

## Future Considerations

`shared/spec/` is where later non-schema model facts belong: the API limits in
`API.md` if they become shared rather than backend configuration, and the
`/capabilities` gate list, which is the same data this ADR centralizes and should
read from it rather than restate it.

If a gate ever needs a signature this shape cannot express — a variadic gate, or
parameters that are not finite numbers in radians — that is a change to the spec's
own shape, and it should be schema-validated at generation time rather than
trusted.

Frontend runtime shape validation is deferred, not declined. Milestone 3's local
save is the first requirement that forces it, and it should be decided there.
