# ADR-0003: Execution Semantics and Cycle Derivation

**Status:** Accepted

**Date:** 2026-07-29

## Context

ADR-0001 establishes that the canonical circuit is a flat ordered list of
operations, and that the cycle decomposition is derived from it rather than
stored.

That decision is only safe if the derivation is specified precisely enough that
independent implementations cannot disagree. Two implementations are required
from the outset — TypeScript in the frontend for rendering, Python in the backend
for analysis — and a divergence between them would mean the editor and the
analyzer disagree about what a circuit means. Prose is not sufficient for this;
the algorithm itself is the contract.

This ADR specifies that algorithm, states the properties it guarantees, and
defines how barriers constrain it.

## Decision

### Resources

A **resource** is anything two operations can contend for:

* each qubit, identified by its qubit identifier
* each classical **bit**, identified by the pair (register identifier, bit index)

Classical contention is tracked per bit, not per register. Two measurements
writing to `c_0[0]` and `c_0[1]` are concurrent; two writing to `c_0[0]` are
not. Per-register granularity would serialize independent measurements and
inflate reported depth.

Qubit and classical resources occupy distinct namespaces.

An operation's resource set is:

| Kind | Resources |
|---|---|
| `gate` | `targets` + `controls` |
| `measurement` | `targets` + the classical bit named by `classicalTarget` |
| `barrier` | `targets` |

### Algorithm

The decomposition is an as-soon-as-possible packing over a per-resource
frontier, evaluated in canonical list order.

```text
derive(circuit) -> { cycles, barriers, depth }

frontier : resource -> next available cycle index, default 0
cycles   : list of lists of operation ids, grown on demand
barriers : list of barrier placements

for op in circuit.operations:              # canonical list order

    if op.kind == "barrier":
        c = max(frontier[q] for q in op.targets)
        for q in op.targets:
            frontier[q] = c                # level, do not advance
        barriers.append({ operationId: op.id,
                          beforeCycle:  c,
                          qubits:       op.targets })
        continue

    r = resources(op)
    c = max(frontier[x] for x in r)
    cycles[c].append(op.id)
    for x in r:
        frontier[x] = c + 1                # advance

depth = len(cycles)
```

`max` over an empty set is 0; no operation may have an empty resource set.

### Barrier Semantics

A barrier **levels** the frontier of its target qubits to their collective
maximum without advancing it. Every operation on those qubits appearing earlier
in the list lands in a strictly earlier cycle than every operation on those
qubits appearing later.

**A barrier occupies no cycle of its own and does not contribute to depth.** A
barrier is an authoring constraint, not a physical operation; it consumes no time
on hardware. If barriers contributed to depth, adding an optimization boundary
would change a circuit's reported depth, which would make depth a property of how
the circuit was annotated rather than of the circuit.

A barrier is reported as sitting *before* cycle `beforeCycle`, which is what a
renderer needs in order to draw it on the boundary between two columns. A barrier
at the end of a circuit may report `beforeCycle == depth`, meaning the trailing
edge.

Consecutive barriers over the same qubits are idempotent: the second computes the
same level and changes nothing.

Barrier `targets` are required and non-empty. There is no implicit "all qubits"
barrier, because its meaning would silently change when a qubit is added to the
circuit. An importer encountering OpenQASM's bare `barrier;` expands it to the
circuit's full qubit list at import time.

### Guaranteed Properties

These hold for every valid circuit and may be assumed by all consumers. Each is
a property test, not a runtime check.

1. **Purity and totality.** The derivation is a pure function of the circuit.
   Every valid circuit has exactly one decomposition.
2. **No intra-cycle contention.** No two operations in the same cycle share a
   resource. Placing an operation at cycle `c` advances its resources to `c + 1`,
   so any later operation contending for one lands at `c + 1` or beyond.
3. **Contiguity and non-emptiness.** Cycle indices run from 0 to `depth - 1`
   with no gaps and no empty cycles. Every frontier value is either 0 or one
   greater than an occupied cycle, so no placement can skip an index.
4. **Sequential cycle execution.** Cycle `c` completes before cycle `c + 1`
   begins. Operations within a cycle are conceptually simultaneous.
5. **Order independence within a cycle.** Consumers must not depend on the order
   of operation ids within a cycle. Exporters may serialize a cycle in any
   deterministic order.
6. **Reordering invariance.** Any two operation lists that are linear extensions
   of the same dependency ordering produce identical decompositions. Each
   operation's cycle equals the maximum over its resources of one plus the cycle
   of the previous operation contending for that resource, and the relative order
   of any two contending operations is fixed. Incidental ordering in the
   serialized list therefore cannot affect the result.
7. **Depth is objective.** By (6), depth is a property of the circuit and not of
   its serialization.

### Validation

Circuit validation is specified in `CircuitModel.md` and executed on both sides
of the API. The derivation assumes a valid circuit and is not a validation pass.

Property (2) — the invariant that Option B in ADR-0001 would have required every
editor to enforce — needs no validation rule at all under this design, because no
valid circuit can produce a decomposition violating it.

Barriers add the following rules to `CircuitModel.md`:

* `targets` is present and non-empty
* every target qubit exists
* no qubit appears more than once in `targets`
* `controls`, `parameters`, and `classicalTarget` are absent

As with all validation, every violation is reported, not merely the first.

### Cross-Implementation Agreement

The TypeScript and Python implementations are held to this specification by
paired fixtures in `shared/fixtures/`, each pairing a circuit with its expected
decomposition, exercised from `tests/contract/`. Fixtures must cover at minimum:
an empty circuit, disjoint concurrent operations, a serialized dependency chain,
multi-qubit gates spanning idle wires, per-bit classical contention, barrier
leveling across unequal frontiers, consecutive barriers, a trailing barrier, and
a reordering-invariance pair.

## Rationale

Specifying the algorithm rather than describing its intent is the whole point.
The cost ADR-0001 accepts is a derivation implemented twice; that cost is only
payable if there is an unambiguous artifact for both implementations to conform
to and a fixture set that detects drift.

Stating the guarantees as provable properties rather than enforced rules is what
makes the derived model stronger than the stored one. Under a stored-cycle model,
"no two operations in a cycle share a qubit" is a rule that every editor,
importer, and optimizer must independently uphold, and a bug anywhere produces a
circuit that is structurally representable but meaningless. Here it is a theorem.

## Consequences

Editors need no cycle-construction logic and cannot construct an invalid cycle.

Importers linearize into the operation list; they do not schedule. Where a source
format expresses explicit concurrency or barriers, those become barrier
operations.

Exporters read the decomposition where the target format is cycle-shaped, and
ignore it where the target format is linear.

Analysis obtains depth from the decomposition. Gate count comes from the
operation list directly and excludes barriers, which are not gates.

Any change to the algorithm changes every consumer's understanding of every
circuit simultaneously. Because nothing is stored, no migration is required — but
the fixture set must be regenerated deliberately, never updated to match new
output as a way of making a failing test pass.

## Alternatives Considered

**Barriers occupying a cycle.** Simpler and uniform: a barrier would be placed
and advance the frontier like any operation. Declined because it inflates depth
with a non-physical operation, corrupting a metric that Milestone 4 reports and
that optimization passes will compare against.

**Per-register classical contention.** Simpler bookkeeping, but serializes
independent measurements into the same register and overstates depth for the
common case of measuring every qubit into one register.

**As-late-as-possible packing.** Equally derivable, but ASAP matches the reading
order of a circuit diagram and keeps a newly placed operation adjacent to its
dependencies rather than jumping to the end.

**Describing the derivation in prose and letting each implementation choose.**
Declined. Two independently reasonable implementations of "group operations that
can run at the same time" disagree on the first non-trivial circuit.

## Future Considerations

The following remain intentionally unresolved and are expected to require their
own ADRs:

* **Mid-circuit measurement** — deferred by decision on 2026-07-29, not
  undecided. While deferred, measurement terminates a qubit, with barriers
  exempt; the rule is specified in `CircuitModel.md`. It affects validation
  rather than the derivation: a measurement already contends for its qubit, so
  subsequent operations on that qubit schedule correctly whether or not they are
  permitted to exist. Lifting the restriction is the prerequisite for classical
  control and warrants its own ADR.
* **Classical control** — operations conditioned on measurement results. These
  read a classical bit, which extends the resource set but not the algorithm.
* **Timing-aware scheduling** — a `delay` operation, anticipated in ADR-0001,
  would carry a duration and require depth to become a weighted rather than
  counted quantity.
* **Hardware-specific execution constraints** — connectivity, native gate sets,
  and crosstalk restrictions belong to a compilation layer above this model, not
  to the derivation.
