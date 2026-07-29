# ADR-0001: Canonical Circuit Representation

**Status:** Accepted

**Date:** 2026-07-29

## Context

Phasor Workbench requires a canonical representation of a quantum circuit that
serves as the single source of truth for:

* Circuit editing
* Simulation
* Visualization
* Analysis
* Import/export
* Future optimization and transpilation

The representation must satisfy a constraint from `Architecture.md`: the circuit
exists exactly once, and no subsystem may hold a parallel copy of it.

Three candidate representations were considered.

### Option A — Ordered Operations

A circuit is a single ordered list of operations. Concurrency is inferred by
later stages and never stored.

### Option B — Ordered Execution Cycles

A circuit is an ordered sequence of execution cycles. Each cycle holds the
operations intended to execute concurrently. Cycle membership is authored and
persisted.

### Option C — Ordered Operations With a Derived Cycle Layer

A circuit is a single ordered list of operations, as in Option A. The cycle
decomposition is computed from it by a specified, deterministic algorithm and
treated as a first-class part of the model's public surface — but is never
stored or serialized.

### The Question That Separates Them

"Cycle" does two different jobs in the Option B proposal, and separating them
resolves most of the apparent disagreement:

1. **Cycle as a view** — the grouping of operations into concurrent sets,
   computed from the circuit. This yields depth, explicit parallelism, render
   columns, scheduling input, and optimizer input.
2. **Cycle as storage** — the grouping is authored and persisted, and is
   therefore capable of expressing something the operation list cannot.

Every benefit originally claimed for Option B is delivered by job 1. None of
them requires job 2.

Greedy left-packing produces a *unique, canonical* cycle assignment for any
operation list. For every circuit whose intended cycles match that packing,
storing cycles is a verbatim second copy of derivable data — the duplicated
state `Architecture.md` forbids.

Stored cycles therefore carry information in exactly one case: when an operation
is deliberately placed later than its dependencies require. Deliberate idle time
is the entire marginal expressiveness of Option B. That is a real requirement,
but it is *content* — a constraint the author asserted — and content belongs in
the operation list, not in the shape of the container.

## Decision

Phasor Workbench adopts **Option C**.

**1. The canonical representation is a flat, ordered list of operations.**

Execution order is the list order. This is what is stored, serialized,
transmitted, diffed, and versioned.

**2. The cycle decomposition is a first-class derived layer.**

It is produced by the algorithm specified in ADR-0003. It is not a rendering
detail: it is a named, specified, cross-language-tested module with the same
standing as serialization and validation. It is never stored and never appears
in the wire format.

**3. Scheduling intent is expressed as operations, not as structure.**

Where an author needs to constrain concurrency beyond what data dependencies
imply, that constraint is an operation in the list. The **barrier** operation is
therefore in scope for Milestone 2 rather than deferred: designing it in now is
free, and retrofitting a concurrency constraint after consumers exist is not.

A barrier is an operation with `kind: "barrier"` and a non-empty set of target
qubits. It takes no controls, no parameters, and no classical target. Its effect
on the derivation is specified in ADR-0003.

**4. "Cycle" is the project-wide term** for the derived grouping.

"Moment" (Cirq's term) and "column" (a rendering term) are retired from the
project vocabulary. The documentation matches the terminology used in the
project's accompanying research even though the storage does not match Cirq's.

## Rationale

**Execution order is explicit and unambiguous.** A flat list has exactly one
reading. Option B must additionally legislate that intra-cycle ordering is
meaningless and rely on every consumer honoring that.

**Editing is local.** Insertion and removal touch one position. Under Option B
they can force cycle rebalancing across the circuit.

**Import and export map directly.** OpenQASM is a linear instruction sequence.
Option A/C round-trips it without a scheduling step in the middle.

**Layout stays out of the model.** Column assignment is presentation, and
`Architecture.md` forbids the backend from holding presentation logic. Under
Option C the backend derives cycles for *analysis* and the frontend derives them
for *rendering*, from the same specification, with neither storing the result.

**Invalid states become unrepresentable.** Option B's central invariant — no two
operations in a cycle touch the same qubit — must be enforced by every editor
that constructs a cycle. Under Option C it is a theorem about the derivation,
provable once and tested once, rather than a rule enforced everywhere.

**Depth is objective.** Because the derivation is invariant under
dependency-preserving reordering (ADR-0003), circuit depth is a property of the
circuit rather than of how its list happened to be serialized.

**Derivation is one-way.** A flat list can produce cycles at any time. Stored
cycles cannot recover which orderings were meaningful and which were incidental.
When one direction is free and the other is lossy, store the form that preserves
the most.

## Consequences

**Advantages**

* Single stored representation; no synchronization problem
* Local, cheap edits
* Direct OpenQASM correspondence
* Concurrency invariants hold by construction
* Depth and parallelism remain fully available through the derived layer
* Scheduling constraints extend the operation set additively

**Costs**

* **The derivation is implemented twice** — once in TypeScript, once in Python —
  and the two must agree exactly, permanently. This is the significant cost, and
  the reason ADR-0003 specifies the algorithm rather than describing it. It is
  enforced by paired fixtures in `shared/fixtures/` exercised from
  `tests/contract/`.
* The serialized list carries incidental ordering, so a diff can show a change
  where none is semantic. The derived decomposition is unaffected, so semantic
  comparison remains exact. A canonicalization pass may be added later if the
  noise becomes a practical problem.
* Consumers wanting columns must call the derivation. It is `O(n)` and
  memoizable.

**Consequences for related decisions**

* This raises the urgency of the shared-model strategy decision in
  `Roadmap.md`. That entry is scoped to sharing *types*; Option C means sharing
  an *algorithm* as well, which changes what the strategy must support.
* `CircuitModel.md` must be updated: barrier added as a third operation kind and
  removed from its Deferred list, terminology unified on "cycle", and the
  derived cycle layer promoted from a single sentence to a specified component.
* ADR-0002 drops execution cycles from the set of objects carrying stable
  identity, since derived cycles cannot have stable identity.

## Alternatives Considered

**Option B — stored execution cycles.** Declined. Its benefits are all
obtainable from a derived layer; its only unique capability is expressing
deliberate idle time, which barriers provide without restructuring the model;
and it introduces stored state that duplicates a derivable quantity.

**Option A as originally written.** Declined as insufficient in emphasis rather
than in substance. Treating cycle derivation as an incidental rendering detail
understates a component that simulation, analysis, optimization, and rendering
all depend on. Option C is Option A with that component given its proper
standing.

**Serializing the derived cycles alongside the operations**, as a convenience so
that consumers need not implement the derivation. Declined, and recorded here
because it is the natural thing to propose later. It is a cache embedded in a
wire format with no invalidation story: any producer that edits operations
without recomputing emits a file whose halves disagree, with no way to determine
which is authoritative. Consumers needing the decomposition call the function.

## Future Considerations

Future scheduling metadata, timing constraints, and hardware-aware compilation
should follow the same principle: express the constraint as an operation or as
an explicitly optional annotation, not by restructuring the operation list.

A `delay` operation is the anticipated next step if physical timing becomes
relevant. Like a barrier, it is additive under the versioning rules in
`CircuitModel.md`.

Should a future requirement genuinely demand authored cycle membership that no
operation-level constraint can express, that requires a new ADR superseding this
one — not an incremental relaxation.
