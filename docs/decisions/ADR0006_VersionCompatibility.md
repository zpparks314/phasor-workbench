# ADR-0006: Version Compatibility and Loading

**Status:** Accepted

**Date:** 2026-07-30

## Context

`CircuitModel.md` carries a versioning table and three loading rules, written
before anything was implemented and never tested against an implementation.
Serialization is the last unwritten item in Milestone 2, and writing it forces
two problems into the open.

**The mechanical problem, which turns out to be easy.** The schema sets
`additionalProperties: false` and the generated models carry `extra="forbid"`, so
a document containing an unknown field is rejected at parse time — while the
loading rules say a newer *minor* version should load with unknown fields
preserved. These look contradictory, and Milestone 2's Known Issues has recorded
them as such. They are not: `schemaVersion` is a top-level string, so the loader
reads and compares it *before* handing anything to a validator. Strictness never
has to relax; the loader decides what to hand over. Nothing about the schema needs
to change.

**The real problem is that the versioning table is wrong.** It classifies three
changes as minor:

| Change | Table says | An older build actually |
|---|---|---|
| Adding an optional field | minor | ignores it safely |
| Adding a gate to the standard set | minor | **cannot validate or execute it** |
| Adding an operation kind | minor | **cannot validate, schedule, or execute it** |

Only the first is backward-compatible in the sense the loading rules assume. Walk
the other two:

* A **new gate** is absent from the `GateName` enum, so parsing rejects it. Even
  if parsing let it through, it has no entry in `circuit.spec.json`, so its arity
  and parameters are unvalidatable, and simulation has no definition to execute.
  The cycle derivation would survive — gate resources are `targets` plus
  `controls` regardless of the gate — so this case is damaged rather than
  meaningless.
* A **new operation kind** is absent from the discriminated union. Beyond
  validation and simulation, the *cycle derivation* cannot extract its resources,
  because resource extraction is per-kind. Scheduling becomes undefined, which
  means depth becomes undefined, which means the circuit has no interpretation at
  all.

So "a circuit with a newer minor version loads, with unknown fields preserved and
a warning surfaced" is false for two of the three changes the table calls minor.
A circuit containing an operation that cannot be scheduled does not load in any
useful sense.

Separately, and in the same area: **`Metadata` is the only object in the schema
without `additionalProperties: false`**, so Pydantic's default silently discards
unknown metadata keys. That contradicts the round-trip rule in `CircuitModel.md`
and the never-silently-ignore rule in `CLAUDE.md`, and it is the one place where
data disappears without an error.

## Decision

### 1. The declared version is a hint. The document is the evidence.

Loading is a two-stage decision. The version selects a *mode*; the content still
decides the outcome.

```text
read schemaVersion from the raw document

absent or not semver        -> reject, SCHEMA_VERSION_MALFORMED
major > ours                -> reject, SCHEMA_VERSION_UNSUPPORTED
version < ours              -> migrate forward, then load in strict mode
version == ours             -> load in strict mode
version > ours, same major  -> load in tolerant mode, warn SCHEMA_VERSION_NEWER_MINOR
```

**Strict mode** is today's behaviour: the schema is applied as written, and an
unknown field is an error.

**Tolerant mode** differs in exactly one way — unknown *fields* are removed from
the document, retained separately, and reported as a warning rather than an error.

**Tolerant mode does not tolerate unknown content.** A gate name or operation kind
the build does not know is an error even there, reported as `UNKNOWN_GATE_NAME` or
`UNKNOWN_OPERATION_KIND`, naming what was not understood. This is the point of the
whole decision: an unknown field is genuinely ignorable, and an unknown operation
is not.

Tolerance is gated on the version claim, deliberately. A document declaring *our*
version with an unknown field is a bug or a typo, and reporting it is correct.
Tolerance is a response to a specific claim about provenance, not a general
looseness.

### 2. The versioning table keeps its bump levels and gains a second column

Reclassifying gate additions as major would make every new gate a breaking release
in a project that intends to add gates routinely. Instead the table states both
facts, because they are different questions:

| Change | Version bump | Older build can load |
|---|---|---|
| Adding an optional field | minor | yes, field preserved |
| Adding a gate to the standard set | minor | **no** — rejected by name |
| Adding an operation kind | minor | **no** — rejected by kind |
| Renaming or removing a field | major | no |
| Changing the meaning of an existing field | major | no |

"Minor" continues to mean what semantic versioning says about the *producer*:
nothing was removed and nothing changed meaning. It stops implying that every
older consumer can read the result.

### 3. Unknown fields are stripped and stashed, not parsed leniently

The loader diffs the raw document against the known fields, removes the unknowns
into a side-channel keyed by document path, parses what remains strictly, and
re-grafts on write.

Paths reuse the format already established for violations — `operations[3].foo` —
so the project has one vocabulary for locating a thing inside a circuit.

The alternative is constructing a permissive variant of the model tree at runtime.
`extra="forbid"` is baked into every generated class, and a subclass overriding it
covers only the top level, so a lenient parse means walking and rebuilding the
whole tree on every load. Stripping keeps the generated models untouched, keeps
parsing strict in both modes, and makes preserved data an explicit value rather
than an implicit parser state.

### 4. Loading returns a result, not just a circuit

```text
LoadResult
  circuit    the parsed Circuit
  warnings   Violations with warning severity
  preserved  path -> value, for fields this build did not recognize
  migrated   the version it was migrated from, if any
```

A caller that ignores `preserved` and writes the circuit back **loses data**, so
the write path takes a `LoadResult` rather than a bare `Circuit`. That is the only
way the round-trip rule survives contact with a real API handler.

### 5. `serialization/` is a new module, backend-only in Milestone 2

It joins `validation/` and `cycles/` under the mirroring rule in ADR-0005, and
like them it will exist in both projects — but **not yet**.

A frontend loader reads a circuit the frontend did not build, which is precisely
the runtime shape validation ADR-0005 section 6 deferred to Milestone 3's local
save. The loader is what makes that question come due, and answering it needs the
local-save requirement in hand. Milestone 2 implements the backend loader, which
the API needs regardless because it cannot trust its input.

This is the first deliberate asymmetry between the two sides, and it is recorded
here so it does not read as an oversight.

### 6. `Metadata` gets `additionalProperties: false`

Unknown metadata then flows through the same strip-and-preserve path as every
other unknown field, instead of vanishing. One rule for unknown data, one place
that implements it.

The schema is at `0.1.0` and unreleased, so tightening a constraint is a
correction rather than a version event. No document exists that would newly be
rejected — Pydantic was discarding those keys anyway, so they never round-tripped.

### 7. Violation entries in the spec gain a `phase`

`circuit.spec.json` currently lets a reader infer which codes belong to which
stage only by reading prose. Each violation gains `"phase": "shape" | "semantic" |
"load"`, and both test suites derive their own code sets from that field instead of
hardcoding "everything except `SHAPE_INVALID` and the warnings", as they do today.

New codes, all `load`:

| Code | Severity |
|---|---|
| `SCHEMA_VERSION_MALFORMED` | error |
| `SCHEMA_VERSION_UNSUPPORTED` | error |
| `UNKNOWN_GATE_NAME` | error |
| `UNKNOWN_OPERATION_KIND` | error |

`SCHEMA_VERSION_NEWER_MINOR` already exists and becomes `load` / warning.

### 8. Migrations are registered by the version they upgrade *from*

A migration is a pure function from one document shape to the next, keyed by the
version it leaves. Loading an older document walks the chain forward one step at a
time until it reaches the current version.

`0.1.0` is the only version that has ever existed, so the registry ships **empty**.
Its shape is still decided now, and exercised by a synthetic migration that lives
only in tests — deciding the shape against zero real examples is easier than
retrofitting it around the first one.

Migrations remain one-way, explicit, and individually tested, as
`CircuitModel.md` already requires.

## Rationale

**A version claim is unverifiable, so it cannot be the whole decision.** Nothing
stops a producer from writing the wrong `schemaVersion`, and a buggy one will.
Treating the declared version as routing information and the document as evidence
means a wrong claim produces a specific error about actual content rather than a
confident misinterpretation.

**The distinction that matters is ignorable versus uninterpretable, and the
version number cannot express it.** An unknown field is inert. An unknown
operation kind removes the circuit's meaning, because scheduling — and therefore
depth — is undefined for it. No single integer in a version string separates those
cases; only inspecting the content does.

**Stating both columns is more useful than picking one.** A producer needs to know
what bump to publish. A consumer needs to know whether it can read what arrived.
Collapsing those into one word is what made the original table wrong.

**Different codes for the same shape defect in different modes is correct, not
inconsistent.** "You sent a malformed circuit" and "this circuit is from a newer
version and uses something I do not know" are different situations with different
remedies — fix your document, versus upgrade or ask for an export. The code is how
a client tells them apart.

## Consequences

**`CircuitModel.md` changes.** The versioning table gains its second column, the
loading rules are restated with the two-stage decision, and the `Metadata` note
about semantics gains a note about unknown keys.

**Two shared sources change together**, so a regeneration lands in the same commit:
`Metadata` in the schema, and the new codes plus `phase` in the spec.

**Both existing test suites change.** The "every semantic code has a fixture" test
currently hardcodes its exclusions; it will read `phase` instead. This is a small
improvement forced by a small addition, which is the usual sign the spec is
carrying its weight.

**`shared/fixtures/` gains a fourth category.** Version fixtures are documents
paired with an expected outcome — accepted, accepted-with-warnings, or rejected
with codes. Unlike the existing three they are not all valid circuits, and some
declare versions that do not exist, so they need their own directory rather than a
home in `valid/`.

**`invalid/shape/` remains empty** and is now clearly the endpoint's business
rather than the loader's: the loader reports `SHAPE_INVALID` by delegating, and the
endpoint maps it into the envelope.

**A caller can still lose data by ignoring `preserved`.** The write path taking a
`LoadResult` makes that hard rather than impossible. Nothing in the type system
prevents constructing a `LoadResult` with empty `preserved` and writing it; the
guard is that the ordinary path makes the right thing easy.

## Alternatives Considered

**Reclassify gate and operation-kind additions as major.** The honest fix to the
table, and rejected on cost: this project expects to add gates routinely, and a
major bump per gate would exhaust the version space and force a migration story
for changes that require no migration.

**Reject any newer version, minor or major.** Simplest possible loader, and it
contradicts a documented policy for no gain. The additive-field case is genuinely
loadable and is also the common case, since most minor bumps will be fields.

**Parse leniently by rebuilding the model tree with `extra="allow"`.** Rejected on
machinery. It also loses the distinction the decision rests on: a lenient parse
tolerates unknown *content* as readily as unknown fields, which is exactly what
must not happen.

**Store preserved fields inside the model, as an `extra` field on `Circuit`.**
Rejected. That puts loader state into the shared wire type, where the other
language and every exporter would have to understand it, in exchange for avoiding
one return value.

**A capability or feature-flag negotiation, so a producer can state what a document
requires rather than leaving a consumer to discover it.** The correct long-term
answer and premature now. It needs a second implementation and a real version
history to design against; see Future Considerations.

## Future Considerations

`UNKNOWN_GATE_NAME` and `UNKNOWN_OPERATION_KIND` are reported only from the
tolerant path in this decision. Reporting them from strict mode too would give
better errors everywhere, at the cost of pre-checking content the schema already
rejects. Worth doing when the editor wants to highlight the offending operation,
which is Milestone 3 at the earliest.

The frontend loader, and with it the runtime shape validation question ADR-0005
section 6 deferred, land with Milestone 3's local save. That decision should be
made with the local-save requirement concrete, not now.

`/capabilities` in `API.md` already advertises `schemaVersion` and
`supportedGates`. Once a second version exists, a client could compare those
before sending rather than discovering incompatibility from an error — the
beginning of the capability negotiation rejected above.

When `0.2.0` arrives, the first real migration is also the first test of the
registry's shape. Expect to revisit it then; that is the point of shipping it
empty and exercised rather than merely designed.
