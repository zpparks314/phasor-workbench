# ADR-0008: Local Persistence and Frontend Shape Validation

**Status:** Accepted

**Date:** 2026-08-01

## Context

Milestone 3's last task is local save, and it is the first time the frontend
*reads a circuit it did not build*. Two questions have been deferred to exactly
this point, and neither can be answered separately from it.

**The first was deferred twice.**
[ADR-0005](ADR0005_SharedSpecification.md) section 6 declined to give the
frontend a runtime shape validator in Milestone 2, on the grounds that the editor
constructs circuits through its own code — so they are shape-valid by
construction — and the backend validates regardless because it cannot trust its
input. It named local save as the requirement that would make the question real.
[ADR-0006](ADR0006_VersionCompatibility.md) section 5 then made `serialization/`
backend-only for the same reason, and recorded that as the first deliberate
asymmetry between the two sides.

The question has since narrowed, and the narrowing matters. "A dependency or not"
is the wrong axis. Hand-writing a shape checker means maintaining a second
description of the schema, which is precisely what
[ADR-0004](ADR0004_SharedModelStrategy.md) exists to prevent — and precisely what
the backend avoids, by letting Pydantic decide unknown-ness so there is no list to
drift. The frontend gets that property only by validating against
`circuit.schema.json` itself. The real choice is *which* schema-driven mechanism.

**The second has no home in any existing document.** ADR-0006 settled what happens
when a document arrives from a different version, and its answer is built for
round-tripping: read a document, preserve what this build does not understand,
write it back unchanged. Editing is a different act. The document still carries
fields this build cannot interpret, so claiming our own version would be a lie,
and keeping the producer's version claims features we did not write. The loader
surfaced the question; ADR-0006 does not address it.

**Local storage is already chosen** as the mechanism, recorded in `Roadmap.md` on
2026-07-30: it is the working-set store, and files are the interchange format that
arrives with Milestone 5's import/export. Choosing it does not remove either
question above. A stored document was written by *some* build — possibly older,
possibly a partial write, possibly hand-edited through devtools — so it is still a
circuit this build did not construct, and ADR-0006's argument that a version claim
is unverifiable evidence applies to it unchanged.

## Decision

### 1. The frontend shape validator is compiled from the schema during generation

`shared/generate_bindings.py` gains a step that runs Ajv's standalone code
generator over `shared/schema/circuit.schema.json` and emits a self-contained
validator into `frontend/src/model/`, beside the types already generated there. It
is a generated file under the existing rules: never hand-edited, regenerated from
the schema, and `--check` fails the build when it is stale.

**Ajv is a devDependency and is not shipped.** This was measured rather than
assumed, as `Roadmap.md` asked:

| | Compiled at generation | Ajv at runtime |
|---|---|---|
| Shipped size | **6.0 KB gzipped** | ~30 KB+ gzipped, plus the schema |
| Runtime imports | **none — fully self-contained** | the Ajv runtime |
| `new Function` at runtime | **no** | yes; a strict CSP blocks it |
| Startup cost | none | compiles the schema on every load |
| Package on disk | devDependency only | ~1 MB runtime dependency |

The compiled option is better on every axis except the generation script's own
simplicity, and it is the option that fits the mechanism ADR-0004 already
established. `generate_bindings.py` needs `frontend/node_modules` and drives the
frontend's own toolchain, so a Node step is not a new kind of thing for it to do.

> **Correction, 2026-08-02.** The row above claiming no runtime imports was true
> of the decision and *false of the first implementation*. Ajv's `standaloneCode`
> emits CommonJS `require` calls for its runtime helpers — `ucs2length`, pulled in
> by the `minLength`/`maxLength` on `Identifier` — and `require` does not exist in
> a browser, so the module threw during evaluation and the application rendered
> nothing. It shipped because the check for it was a line-anchored search that a
> mid-line `require(` slipped past, and because the whole suite runs in Node,
> where `require` is defined.
>
> The decision is unchanged; the implementation now bundles the generated module
> so the property actually holds, and `serialization/validator.test.ts` asserts it
> by resolution rather than by spelling. The lesson is the one this project
> already learned about pointer events: **a suite passing in one environment says
> nothing about whether the code loads in another.**

### 2. Validation dispatches on the discriminator before checking a subtype

This is an implementation constraint rather than a preference, and it was found
empirically. Recording it here because the naive implementation is both obvious
and **actively destructive**.

Two facts about the schema and Ajv:

* **`discriminator` is not ignored.** The `$comment` in `circuit.schema.json`
  states that validators ignore it as an unknown annotation. Ajv does not — it
  errors under its default strict mode, and its own `discriminator: true` support
  rejects our `mapping` keyword outright. Compilation requires `strict: false`.
* **`oneOf` plus `$ref` loses branch attribution.** When an operation fails,
  `schemaPath` is `#/additionalProperties` for *every* branch, so an error cannot
  be traced to the branch that produced it.

The consequence: every non-matching branch reports the fields it does not share as
"additional". For a gate, `MeasurementOperation` and `BarrierOperation` both report
`name`, `controls` and `parameters` as unknown. A stripper that trusts those
errors **deletes real data** — verified against
`newer_minor_unknown_gate.json`, where it removed the gate's `name`.

So the validator is structured as **one compiled validator per operation subtype,
selected by reading the document's `kind` through the schema's own
`discriminator.mapping`**, plus one for the surrounding document. Nothing restates
the schema: the mapping is read from it. Only `additionalProperties` errors from
the selected subtype are trusted.

Verified against all seven tolerant-mode fixtures in `shared/fixtures/version/`,
which agree exactly with the Python loader's `preserved` lists.

### 3. Editing converts a document to this build's version and drops preserved fields

An **unedited** circuit round-trips as ADR-0006 specifies: the declared version is
kept, preserved fields are re-grafted, nothing is lost.

The **first edit** converts the document to the version this build writes and
discards its preserved fields. The user is told before it happens, not after.

Two independent arguments force this, and either alone would be enough.

**Preserved fields are keyed positionally, and editing moves positions.**
`Location` is a tuple of keys and indices, and `dump_result` restores each field
with `set_at`. That is correct for a round trip, which is all ADR-0006 scoped it
for. The editor reorders operations as a matter of course — `moveOperation` is one
of its commonest edits — so re-grafting `operations[3].duration` after an edit
attaches a newer build's field to whatever operation now sits at index 3. That is
silent corruption, and it is the same failure mode [ADR-0007](ADR0007_EditingModel.md)
rejected command-inverses to avoid: a plausible wrong answer that nothing reports.

**"Our version, with preserved fields" is not a document we could read back.**
Tolerance is gated on the version claim (ADR-0006 section 1), so at our own version
an unknown field is an error, not a stashable extra —
`unknown_field_at_current_version.json` is refused with `SHAPE_INVALID`. Writing
our version alongside fields we do not understand would produce a document *this
build itself* rejects on the next load.

The dropped data is real, so it is surfaced rather than swallowed, per `CLAUDE.md`.
`dump_circuit` already does exactly the right thing and already documents itself as
being for "a circuit this build authored"; the decision here is that an edited
circuit *is* one.

### 4. `frontend/src/serialization/` mirrors the backend and is held to the same fixtures

It joins `validation/` and `cycles/` under ADR-0005's mirroring rule, completing
the set. The asymmetry ADR-0006 section 5 recorded ends here.

It costs no new fixtures. The 14 documents in `shared/fixtures/version/` declare
`outcome`, `violations` and `preserved` in a language-neutral form, so both loaders
assert against the same artifacts and parity follows transitively — exactly as it
does for validation and the cycle derivation. No cross-language runner, for the
reason `tests/README.md` gives.

### 5. `frontend/src/persistence/` is the only module that touches browser storage

On the same principle that confines `fetch` to `api/`. It stores one document —
the working set — and knows nothing about circuits beyond handing bytes to and
from `serialization/`.

Four properties of `localStorage` are handled rather than discovered:

* **Access itself can throw.** Reading `window.localStorage` raises in some
  private-browsing configurations, so the check is a `try`, not a truthiness test.
* **Quota is reported by throwing**, not by a return value, and a quota failure on
  save is the case most likely to be hit with a large circuit.
* **Clearing site data destroys the working set silently.** Nothing can prevent
  that; it is a reason files are the interchange format and this is not a backup.
* **It does not remove the need for the loader.** A stored document is still one
  this build did not construct.

Storage being unavailable is **not** an editor error. The editor stays fully
usable, and `Architecture.md`'s rule that the app degrades gracefully applies to
storage exactly as it does to the backend. A failed save surfaces a persistent,
non-blocking banner naming the cause and stating that the circuit is still in
memory, per `UI.md`.

### 6. Saving is explicit

`Ctrl/Cmd + S` and a header button, with the last saved time shown, as `UI.md`
specifies. Autosave is not adopted: it would write on every keystroke of a drag,
and the coalescing rules that make undo sane (ADR-0007 section 3) are about
history, not about I/O. An explicit save also gives the version conversion in
section 3 a moment to report itself.

## Rationale

**The generated-validator choice is ADR-0004's argument applied one layer further
out.** That ADR's claim was that two hand-maintained descriptions of one model
will diverge, and that generation removes the possibility rather than the
likelihood. A hand-written shape checker is exactly the second description it
forbids. Between the two schema-driven options, the measurement is lopsided enough
that the remaining argument is about where complexity sits — and putting it in the
generation script, which is a build-time tool that already drives both toolchains,
is better than putting it in the shipped bundle.

**The discriminator finding is the reason section 2 exists at all.** It would have
been reasonable to leave validation structure to the implementation. But the
obvious implementation silently deletes real fields, and it does so on a document
that *loads successfully* — the corruption appears in what gets written back, not
in an error. A decision record whose job is to stop debates being repeated should
carry the fact that cost half a day to find.

**Section 3 chooses a loss that is visible over a corruption that is not.**
Dropping preserved fields loses information the user can see described. Re-grafting
by stale path produces a document that looks right and is wrong. The project has
consistently chosen the first: it is why ADR-0006 returns every violation rather
than the first, why ADR-0007 chose snapshots over inverses, and why the editor
refuses to assign one wire twice to a pending gate rather than committing an
operation nothing can repair.

**The narrow scope is deliberate.** Preserved fields only arise in the editor when
a *newer* build wrote to this browser's storage and an older one reads it — a
downgrade, or two builds sharing an origin. It is a real case, and it is rare.
Spending a cross-language redesign on it now, at the end of the milestone, would be
disproportionate; ignoring it would be the silent-corruption path. Converting on
edit is the proportionate answer, and section 3's argument is written so that a
future decision to do better has the reasoning already assembled.

## Consequences

**`generate_bindings.py` gains a Node step and a third generated artifact.** The
`--check` mode covers it, so a stale validator fails CI like a stale type does. The
script's existing requirement for `frontend/node_modules` becomes load-bearing
rather than incidental.

**Ajv enters `package.json` as a devDependency.** It is the first dependency added
since the stack was chosen, and it is justified by ADR-0004 rather than by
convenience: the alternative is the hand-maintained description that ADR forbids.
Nothing ships.

**`invalid/shape/` fixtures become cross-language.** ADR-0005 section 6 split them
by phase and left shape fixtures backend-only precisely until this decision. They
can now be exercised by both suites, which closes the last item on Milestone 2's
task list.

**The frontend gains a real answer to "is this a circuit?"** — which Milestone 5's
JSON and OpenQASM import will need, and which is the reason this decision is
written to be about shape validation generally rather than about local storage.

**A circuit loaded from a newer build is editable but not preservable.** The
editor must tell the user that before the first edit, not at save time, which
`UI.md` needs to specify.

**`state/` gains nothing.** Persistence reads and writes the circuit the store
holds; it does not become another owner of it. The single-source-of-truth rule is
unaffected, and no history entry is created by saving.

## Alternatives Considered

**Ajv at runtime.** Rejected on the measurement in section 1 — strictly worse on
size, CSP compatibility, and startup, in exchange for a marginally simpler
generation script.

**A hand-written shape checker.** Rejected as a re-opening of ADR-0004. Its appeal
is "no dependency", but the dependency it avoids is a devDependency while the cost
it incurs is a permanent second description of the schema.

**Zod, or another TypeScript-first schema library.** Rejected for the same reason:
its schema would be hand-written TypeScript, so the JSON Schema would stop being
the source of truth for the frontend. Generating Zod *from* the JSON Schema was
considered and is strictly more machinery than generating a validator directly.

**Keeping the producer's version on an edited circuit.** Rejected on the path-drift
argument in section 3. It is the option that looks most respectful of the original
document and is the one that can corrupt it.

**Refusing to edit a tolerant-loaded circuit** — read-only until explicitly saved
as a copy. Loses nothing and never corrupts, and was a genuine contender. Rejected
as disproportionate: it introduces an editor mode that does not otherwise exist, to
block editing a circuit that is completely readable, in a situation most users will
never reach.

**Re-keying preserved fields to stable identifiers** so re-grafting survives
reordering. This is the principled fix, and ADR-0002's identity model exists for
exactly this class of problem. Rejected *for now* on scope: it revises ADR-0006,
changes the Python loader, and edits the shared version fixtures, which is a
cross-language change landing on the last task of a milestone. See below.

**Autosave.** Rejected in section 6.

**Persisting history alongside the circuit.** Already declined by ADR-0007's
alternatives, and declined again here for the reason it predicted: restoring a
stack whose entries were written by a possibly different build multiplies the
loader's problem by the history depth, for a benefit nobody has asked for.

## Future Considerations

**Identifier-keyed preserved fields are the natural successor to section 3.** If
Milestone 5's file import makes preserved data common — and reading files written
by other people's builds is exactly what would — then anchoring each preserved
field to the nearest enclosing object's identifier plus a relative path would let
an edited circuit keep its declared version honestly. That is a revision of
ADR-0006 and should be written as its own ADR, with the fixtures updated in the
same commit.

**The compiled validator makes shape fixtures cheap**, so `invalid/shape/` should
grow when the validation endpoint lands in Milestone 4 rather than staying at its
current size.

**File System Access and download/upload** were considered and deferred with the
persistence choice itself. `localStorage` is the working set; files are the
interchange format, and they arrive with Milestone 5.

**Nothing here anticipates multi-document storage.** One working set is stored, and
a circuit library — named documents, a picker, deletion — is a `Roadmap.md` future
feature that would want IndexedDB rather than `localStorage` and should be decided
then.
