# ADR-0007: The Editing Model

**Status:** Accepted

**Date:** 2026-07-30

## Context

Every subsystem written so far *reads* a circuit. Validation, the cycle
derivation, and the loader all take a `Circuit` and return something about it.
Milestone 3 introduces the first subsystem that produces one, and `Roadmap.md`
records the consequence honestly: the single-source-of-truth rule is currently
satisfied *vacuously*, because nothing exists that could hold a competing
representation. The editor is the first consumer with a reason to want its own
copy.

The Milestone 3 task list puts undo at position seven, after placement, removal,
and movement. That ordering is wrong, and the reason is worth stating rather than
quietly fixing. Undo is not a feature that sits beside the editing features; it is
a constraint on how every one of them is expressed. Editing implemented as ad-hoc
mutation and then retrofitted with history means rewriting each edit, so the
history model has to be decided before the first mutation is written.

[ADR-0002](ADR0002_IdentityModel.md) already anticipated this. It lists undo/redo
first among the systems that need stable identifiers, and it states the rule that
moving or re-parameterizing an operation preserves its identifier while deleting
and recreating does not. What it does not say is how history itself works, or how
a history stack coexists with `Architecture.md`'s rule that "the circuit exists
exactly once."

Three questions have no home in any existing document:

* **What is an edit?** Nothing has yet needed a vocabulary for changing a circuit.
* **What does history store, and how much of it?**
* **What is *not* undoable?** Selection and viewport are state too, and whether
  they belong in the stack changes how undo feels.

## Decision

### 1. An edit is a pure function from `Circuit` to `Circuit`

The editing vocabulary is a set of named pure functions. Each takes the current
circuit and returns a new one. Nothing mutates a circuit in place, and no edit
performs I/O, reads component state, or depends on anything but its arguments.

The vocabulary covers what Milestone 3 authors: add and remove a qubit, add and
remove a classical register, insert an operation, remove an operation, move an
operation within the list, and re-parameterize an operation.

This is the load-bearing decision, and everything below follows from it.
Snapshots are cheap because edits build new arrays by spread and leave unchanged
objects shared by reference; the store is testable without a DOM because an edit
is a function; and history is correct by construction because the previous
circuit is still a live value that nothing has written to.

### 2. History is a bounded stack of labeled snapshots

```text
HistoryEntry   label    what the edit did, e.g. "Place H on q0"
               circuit  the circuit that edit produced

History        past     entries before the present, oldest first
               present  the live entry -- the one circuit everything reads
               future   entries undone but not yet discarded
```

Applying an edit pushes `present` onto `past`, sets `present` to the new entry,
and clears `future`. Undo moves `present` to the front of `future` and pops
`past`. Redo is the mirror.

The label describes the edit that *produced* an entry, which is what lets the UI
say "Undo place H" rather than "Undo". This is the only thing a command model
would have given us that a bare snapshot does not, and it costs one string.

`past` is bounded at 100 entries; exceeding the bound discards the oldest. That
bound is lossy by design and is the one place in this decision where information
is dropped without an error. It is stated here so the limit is a documented
contract rather than something discovered when a long session stops undoing, and
it lives as a single named constant rather than being spelled inline.

### 3. Coalescing is declared by the interaction, never inferred from timing

Dragging a gate across four columns produces four intermediate circuits, and a
user expects one undo to put it back where it started. An edit may therefore be
submitted as **transient**, carrying a coalescing key such as `move:op_3`.
Consecutive transient edits with the same key *replace* `present` instead of
pushing onto `past`. A different key, or any non-transient edit, ends the run.
The interaction ends by committing.

**Coalescing is never decided by elapsed time.** Merging edits that arrive within
some window is the obvious alternative and it makes undo behave differently
depending on how fast the user moved the mouse — the same gesture producing one
entry or three. Undo granularity should be a property of the interaction, which
knows where a gesture starts and ends, not of the clock.

### 4. History holds circuit values and nothing else

Selection, viewport, palette state, and panel layout are not in the stack. Undo
restores the document; it does not restore where you were looking. An undo that
scrolls the canvas or changes the selection is unpredictable in the way that
makes people stop trusting undo.

The consequence has to be handled rather than assumed away: selection is held as
operation identifiers, and undo can remove the operation a selection points at.
Selection is therefore **resolved against the present circuit on read**, and
identifiers that no longer resolve are dropped. Selection is derived state that
happens to be stored as identifiers, not a second thing that must be kept in sync
with the circuit — and per ADR-0002 an identifier is exactly the kind of
reference that survives everything except the object's deletion.

### 5. History is not a second representation of the circuit

This reconciles the decision with `Architecture.md`'s "the circuit exists exactly
once," which it otherwise appears to violate.

**Exactly one circuit is live: `present.circuit`.** Every consumer — the
renderer, `validateCircuit`, `deriveCycles`, save — reads that one. Entries in
`past` and `future` are inert past *values* of it. Nothing renders them, derives
cycles from them, validates them, or writes to them.

The rule's actual target is a component holding a mutable copy that must be kept
in sync with the real circuit, because that copy can disagree. History cannot
disagree: nothing writes to it, and a value that is never written to has nothing
to drift from. The failure mode the rule exists to prevent is structurally absent.

### 6. Edits preserve identity, and `move` is not remove-then-insert

ADR-0002's consequence becomes an implementation constraint here. Moving an
operation preserves its identifier, so `move` reorders the list; it does not
delete the operation and insert a new one at the destination. Implementing it as
remove-then-insert would mint a new identifier and silently break selection,
undo anchoring, and any future annotation attached to that operation — while
producing a circuit that looks correct.

New identifiers come from `crypto.randomUUID()`, per `CircuitModel.md`.

### 7. Edits do not validate, and are shape-valid by construction

The store applies an edit unconditionally and does not refuse a circuit that
fails semantic validation. `validateCircuit` runs on the result and the UI
surfaces what it reports.

An editor that rejects invalid intermediate states is unusable: a user assembling
a controlled gate passes through a state with the wrong arity, and a user adding a
register before the measurement that uses it passes through an unresolved
reference. `CircuitModel.md` already returns every violation rather than the
first for exactly this reason — so a user can fix a circuit at leisure instead of
one round-trip at a time.

Rendering an invalid circuit is safe because `deriveCycles` documents that it does
not throw on one; an unresolvable qubit id is still a usable frontier key.

**Shape validity is different and is guaranteed.** The edit vocabulary is typed,
so no sequence of edits can produce a structurally malformed circuit. This is the
same argument [ADR-0005](ADR0005_SharedSpecification.md) section 6 used to defer
frontend shape validation, and it still holds — it stops holding only where the
editor reads a circuit it did not build, which is local save and belongs to a
separate decision.

### 8. `frontend/src/state/`, headless, and deliberately not mirrored

The store, the edit vocabulary, and history live in `frontend/src/state/`, the
directory `Frontend.md` already reserves for "circuit state, undo/redo." The core
imports nothing from React; the React binding is a thin adapter over it.

**This module has no backend counterpart, and that is not an oversight.**
`validation/`, `cycles/`, and `serialization/` are mirrored because both sides
genuinely need them. Editing is not such a concern — the backend does not author
circuits, and `Architecture.md` gives it no reason to. This is the second
deliberate asymmetry between the two sides, after the one ADR-0006 section 5
recorded, and it is noted here for the same reason.

## Rationale

**The deciding argument is correctness, not memory.** A command model requires
every edit type to ship a correct *inverse*. The inverse of removing an operation
must restore it at its original index; the inverse of a move must restore position
and control assignment. Each is a place where undo can silently produce a
*different* circuit rather than failing — the worst available failure mode, since
nothing reports it and the user only discovers it later. Snapshots have no such
class of bug: undo restores exactly what was there, because it *is* what was
there.

**It makes recurring work cheaper, and that work is guaranteed to recur.** Adding
an edit type is not a one-time event — Milestone 5 brings import, and custom gates
follow. Under a command model each new edit costs an implementation plus an
inverse that must agree with it. Under snapshots it costs one function. The
project ranks correctness and extensibility above performance, and this is the
choice where those three point the same way.

**The memory objection does not survive the numbers.** Because edits build new
arrays by spread, unchanged operation objects are shared by reference across
entries; retained memory is proportional to what each edit changed, not to depth
times circuit size. At Milestone 3 scale a hundred entries is negligible.
`AGENTS.md` forbids optimizing before measuring, and a command model is the
optimization here.

**Timing-based coalescing is the tempting shortcut and it is wrong for a teaching
tool.** Undo that behaves differently depending on how fast someone moved is
exactly the kind of unpredictability that makes a beginner distrust the interface.

## Consequences

**The Milestone 3 task order changes.** History comes before placement, removal,
and movement rather than after them. `Roadmap.md` should reflect the dependency.

**`state/` is built and tested before anything renders.** It is pure TypeScript
with no DOM, which is what makes the property test in Milestone 3's exit criteria
possible: apply a random valid edit sequence, undo back to the start, assert deep
equality with the initial circuit. That test is the whole safety argument for
snapshots made checkable, and it is the same property-testing discipline
[ADR-0003](ADR0003_ExecutionSemantics.md) established.

**`Frontend.md` and `ProjectStructure.md` gain a description of `state/`** — its
responsibility, its headless constraint, and the note that it is not mirrored.

**Every edit must be added to the vocabulary rather than performed inline.** A
component calling `setCircuit` with a hand-built object bypasses history and
labeling. This is a review rule; nothing in the type system prevents it, and
pretending otherwise would be the same overclaim ADR-0006 declined to make about
`preserved`.

**Selection can go stale and is resolved on read.** Any future annotation,
bookmark, or breakpoint anchored to an operation identifier inherits the same
requirement.

## Alternatives Considered

**Command objects with inverses.** The classic answer, and rejected on the
correctness argument above: it introduces a bug class where undo produces a
plausible wrong circuit, and it doubles the cost of every future edit type. Its
real advantages — compact history and an operation log — serve requirements this
project does not have.

**A hybrid: commands for their labels, snapshots for restoring.** This is what was
adopted, minus the commands. Once snapshots do the restoring, the only thing the
command layer contributes is a description string, and a string is a string.

**Immer or a similar immutability library.** It would make edits read like
mutations and guarantee structural sharing. Declined under `AGENTS.md`'s
instruction to minimize dependencies: spread-based updates over a model this
shallow are already readable, and the sharing comes for free. Worth revisiting
only if edit implementations become hard to read, which is a measurable trigger
rather than a taste one.

**Persisting history to localStorage alongside the circuit.** Declined as scope
that belongs to the persistence decision, and probably declined there too: undo
across sessions implies restoring a stack whose entries were written by a possibly
different build, which multiplies the loader's problem by the history depth for a
benefit nobody asked for.

**Unbounded history.** Simpler, and it makes memory a function of session length
rather than of anything the user can see. A bound that is documented is better
than a bound that is discovered.

## Future Considerations

Collaborative editing appears in `Roadmap.md`'s future features and does need
operations rather than snapshots, since concurrent edits must be transformed
against each other. That is a redesign of this decision rather than an extension
of it, and it would also reopen identifier generation — ADR-0002 already flags
the same constraint. Adopting a command model now to prepare for it would pay the
full cost immediately for a feature explicitly out of scope.

If circuits grow large enough that snapshot memory is measurable, the first move
is to bound the stack more tightly, and the second is to snapshot only the changed
sub-structure. Neither requires the command model.

The history entries are a sequence of circuit values, which is the input a diff
view would want. If circuit differencing is ever built — ADR-0002 lists it among
the systems stable identifiers exist for — it should read from here rather than
reconstruct its own history.
