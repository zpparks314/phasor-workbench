# ADR-0002: Stable Object Identity

**Status:** Accepted

**Date:** 2026-07-29

## Context

Phasor Workbench contains mutable objects that users create, modify, move, and
delete.

Many systems require persistent references to these objects, including:

* Undo/redo
* Selection
* Visual annotations
* Simulation results
* Circuit differencing
* Saved editor state
* Collaboration (future)

Relying on positional indices is insufficient, because indices shift as a
circuit evolves. Inserting one operation invalidates every reference that was
expressed as a position after it.

## Decision

Every **stored** first-class object in the Circuit Model carries a stable
identifier:

* Circuit
* Qubit
* Classical Register
* Operation — including gates, measurements, and barriers

Identifiers are opaque strings. No semantic information is encoded into an
identifier, and nothing may parse meaning out of one.

**Execution cycles do not carry identifiers.** Under ADR-0001 cycles are derived
rather than stored, and are addressed by index within a decomposition that is
recomputed whenever the circuit changes. Anything needing to anchor to a point in
execution time anchors to an **operation identifier** instead.

## Rationale

Stable identities let unrelated systems reference objects without depending on
mutable ordering:

* Editor selection survives insertion elsewhere in the circuit
* Visualization overlays stay attached to their operation
* Objects are trackable across edits
* Two circuit versions can be diffed structurally
* Future collaborative editing has referents that survive concurrent edits

The exclusion of cycles follows from this same reasoning rather than
contradicting it. Cycle position is precisely the kind of shifting index this
ADR exists to avoid depending on: inserting a single gate can renumber every
cycle after it. Granting identity to a derived, recomputed grouping would create
references that appear stable but silently retarget. An operation identifier is
the stable anchor; the cycle a given operation occupies is then a question to
ask the derivation, not a fact to store.

Barriers are ordinary operations under ADR-0001 and therefore carry identifiers
like any other operation. This matters in practice: a barrier is exactly the
kind of object an editor needs to select, move, and undo.

## Consequences

All editing operations must preserve object identifiers unless the object itself
is replaced. Moving, reordering, or re-parameterizing an operation preserves its
identifier; deleting and recreating it does not.

Importers preserve identifiers where the source format carries them, and
generate new ones otherwise.

Systems that need to refer to a point in execution time — annotations,
breakpoints, step-through simulation state — express that reference as an
operation identifier. Where a genuinely cycle-shaped reference is required, it is
resolved through the derivation at the time of use rather than stored.

Whether identifiers are generated client-side or assigned by the backend is a
separate question, still open in `Roadmap.md`. This ADR requires only that they
exist, be stable, and be opaque.

## Alternatives Considered

**Positional references only.** Declined. Every system listed in the Context
would break on insertion, and the failure is silent — a stale index still
resolves, just to the wrong object.

**Identifiers on cycles as well**, as proposed in the original draft of this ADR.
Declined once ADR-0001 established cycles as derived. There is no object to which
such an identifier could remain attached across an edit.

**Semantic identifiers** (encoding type, position, or gate name). Declined.
Anything parseable becomes something consumers parse, which converts an internal
detail into a de facto public format.

## Future Considerations

Future annotations, comments, bookmarks, and plugin metadata should reference
stable identifiers rather than positional locations.

If collaborative editing is pursued, identifier generation will need to be
collision-free across clients without coordination, which constrains the still-open
question of who generates them.
