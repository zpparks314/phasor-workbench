# Circuit Model

**Status:** Accepted. The design is settled by
[ADR-0001](decisions/ADR0001_CircuitRepresentation.md),
[ADR-0002](decisions/ADR0002_IdentityModel.md), and
[ADR-0003](decisions/ADR0003_ExecutionSemantics.md). Not yet implemented.

**Target milestone:** Milestone 2 (Circuit Model).

This document specifies the model. The ADRs record why it is shaped this way;
where the two disagree, the ADRs win and this document is wrong.

---

# Role

The Circuit Model is the single source of truth for the entire application.

The editor, simulator, importers, exporters, analyzers, and every visualization
operate on this one representation.

No subsystem may maintain its own circuit state.

If a subsystem needs a different shape for internal work — a simulator's tensor
layout, a renderer's grid — it derives that shape on demand and discards it. It
does not persist a parallel copy.

The model is language-neutral by design. It lives in `shared/` and is expressed
as JSON so that frontend and backend agree on it without either owning it.

---

# Core Entities

## Circuit

The top-level container.

Holds qubits, classical registers, an ordered list of operations, and metadata.

## Qubit

A single quantum wire.

Has a stable identifier, a positional index, and an optional display label.

## Classical Register

A named group of classical bits that measurement results are written into.

Has a stable identifier, a size, and an optional label.

Classical registers are explicit. A circuit may declare none — `[]` is valid and
is the normal state of a circuit with no measurements — but there is **no
implicit default register**. Every measurement names a register that exists.

The alternative, synthesizing a register at export time, would require inventing
a name and size that the model never held. OpenQASM requires an explicit `creg`
declaration and Qiskit requires an explicit `ClassicalRegister`, so an invented
register would appear in exported artifacts and would not survive a round trip.
Declaring registers in the model keeps export lossless.

## Operation

Anything that occupies a position in the circuit's execution order.

Three kinds exist:

* **gate** — a unitary operation on one or more qubits
* **measurement** — a projective measurement writing into a classical bit
* **barrier** — an authoring constraint that prevents operations from being
  scheduled across it

Modeling all three as variants of a single ordered `operations` list keeps
execution order unambiguous and avoids parallel lists that would need to be kept
in sync.

## Barrier

A barrier constrains concurrency beyond what data dependencies imply.

It carries a non-empty set of target qubits and nothing else — no controls, no
parameters, no classical target. Operations on those qubits appearing before the
barrier are guaranteed to occupy strictly earlier cycles than operations on those
qubits appearing after it.

A barrier is not a physical operation. It consumes no time, occupies no cycle,
and does not contribute to circuit depth. It is also not a gate, and is excluded
from gate counts.

There is no implicit "all qubits" barrier, because its meaning would silently
change when a qubit is added to the circuit. An importer reading OpenQASM's bare
`barrier;` expands it to the full qubit list at import time.

## Metadata

Descriptive information that does not affect execution: name, description,
timestamps, author notes.

Metadata must never carry semantics. If the simulator would behave differently
based on a metadata field, that field belongs in the model proper.

---

# Structural Decision: Ordered Operations With Derived Cycles

Decided in [ADR-0001](decisions/ADR0001_CircuitRepresentation.md). Summarized
here; the reasoning and the rejected alternatives live in the ADR.

**The canonical circuit is a flat, ordered list of operations.** That is what is
stored, serialized, transmitted, diffed, and versioned.

**The cycle decomposition is derived, never stored.** Grouping operations into
concurrent sets is a pure function of the circuit, specified in
[ADR-0003](decisions/ADR0003_ExecutionSemantics.md).

The derived layer is not a rendering detail. It is a specified,
cross-language-tested component with the same standing as serialization and
validation, and it is what supplies circuit depth, explicit parallelism, render
columns, and scheduling input. Simulation, analysis, optimization, and rendering
all consume it. None of them store it.

Two consequences worth stating plainly:

* Concurrency invariants hold **by construction**. No valid circuit can produce a
  decomposition in which two operations in one cycle contend for a qubit, so
  there is no such validation rule to enforce.
* Depth is **objective**. The derivation is invariant under reorderings that
  preserve data dependencies, so depth is a property of the circuit rather than
  of how its operation list happened to be serialized.

Where an author needs concurrency constrained beyond data dependencies, that
constraint is an operation — a barrier — not a change to the container's shape.

**Terminology:** this project says **cycle**. Not "moment" (Cirq's word) and not
"column" (a rendering word).

---

# Identity

Every stored first-class object carries a **stable identifier**: the circuit,
each qubit, each classical register, and each operation. Decided in
[ADR-0002](decisions/ADR0002_IdentityModel.md).

Identifiers are required because:

* undo and redo need to reference operations across edits
* the editor needs to track selection through reordering
* visualizations need to anchor annotations to specific operations
* diffing two circuit versions is otherwise impossible

Positional index alone is insufficient — indices shift when an operation is
inserted.

Identifiers are opaque strings. Nothing may parse meaning out of them.

**Derived cycles have no identifiers.** They are addressed by index within a
decomposition that is recomputed on every change. Anything needing to anchor to a
point in execution time anchors to an operation identifier and resolves the cycle
through the derivation at the time of use.

## Generation

**Identifiers are generated client-side.**

This is forced by two existing constraints rather than chosen for convenience:
`Architecture.md` requires the frontend to remain functional while the backend is
unavailable, and Milestone 3's local save involves no backend at all. An
identifier that only the backend can mint would make both impossible.

The frontend generates UUIDs (`crypto.randomUUID()`). Fixtures and documentation
examples may use short readable identifiers such as `q_0` — precisely because
nothing is permitted to parse them. If a readable fixture identifier ever changes
behavior, that is evidence something parsed it, and the fixture has done its job.

**Client-generated is not client-trusted.** The backend validates every incoming
identifier — non-empty, within length bounds, unique within its collection — and
resolves every reference. It does not assume the frontend produced them
correctly.

---

# Serialization Format

Canonical form is JSON.

```json
{
  "schemaVersion": "0.1.0",
  "id": "circ_7f3a",
  "name": "Bell State",
  "qubits": [
    { "id": "q_0", "index": 0, "label": "q0" },
    { "id": "q_1", "index": 1, "label": "q1" }
  ],
  "classicalRegisters": [
    { "id": "c_0", "size": 2, "label": "c" }
  ],
  "operations": [
    {
      "id": "op_0",
      "kind": "gate",
      "name": "h",
      "targets": ["q_0"],
      "controls": [],
      "parameters": {}
    },
    {
      "id": "op_1",
      "kind": "gate",
      "name": "cx",
      "targets": ["q_1"],
      "controls": ["q_0"],
      "parameters": {}
    },
    {
      "id": "op_2",
      "kind": "barrier",
      "targets": ["q_0", "q_1"]
    },
    {
      "id": "op_3",
      "kind": "measurement",
      "targets": ["q_0"],
      "classicalTarget": { "register": "c_0", "bit": 0 }
    },
    {
      "id": "op_4",
      "kind": "measurement",
      "targets": ["q_1"],
      "classicalTarget": { "register": "c_0", "bit": 1 }
    }
  ],
  "metadata": {
    "description": "Prepares an entangled pair and measures both qubits."
  }
}
```

Serialization rules:

* field order is not significant
* unknown fields are preserved on round-trip where practical, to avoid destroying
  data written by a newer version
* absent optional fields and `null` are equivalent
* floating-point parameters are stored in radians
* the cycle decomposition never appears in the wire format

## Derived Decomposition of the Example

Not stored — shown to make the derivation concrete.

```text
cycle 0   op_0                 h q_0
cycle 1   op_1                 cx q_0 -> q_1
--------  op_2 barrier (q_0, q_1), before cycle 2
cycle 2   op_3, op_4           measure q_0, measure q_1   (concurrent)

depth = 3
```

The two measurements share a cycle because they contend for different classical
bits of `c_0`; contention is tracked per bit, not per register.

The barrier in this example is inert — the frontier was already level at cycle 2
— and depth is 3 with or without it. That is the intended behavior: annotating a
circuit must never change its reported depth.

---

# Gate Naming

Gate names are lowercase and follow OpenQASM convention where one exists.

Initial set:

| Name | Qubits | Parameters |
|---|---|---|
| `i` | 1 | — |
| `h` | 1 | — |
| `x`, `y`, `z` | 1 | — |
| `s`, `sdg` | 1 | — |
| `t`, `tdg` | 1 | — |
| `rx`, `ry`, `rz` | 1 | `theta` |
| `p` | 1 | `lambda` |
| `cx`, `cy`, `cz` | 2 | — |
| `swap` | 2 | — |
| `ccx` | 3 | — |

Controlled gates express their control qubits in `controls`, not by encoding
control count into the gate name. `cx` therefore has one entry in `targets` and
one in `controls`.

Aligning names with OpenQASM now avoids a translation table later, when import
and export land in Milestone 5.

`barrier` is not in this table. It is an operation kind, not a gate name.

---

# Versioning

The model carries `schemaVersion` using semantic versioning.

| Change | Version bump |
|---|---|
| Adding an optional field | minor |
| Adding a gate to the standard set | minor |
| Adding an operation kind | minor |
| Renaming or removing a field | major |
| Changing the meaning of an existing field | major |

Loading rules:

* a circuit with an **older compatible** version is migrated forward on load
* a circuit with a **newer minor** version loads, with unknown fields preserved
  and a warning surfaced
* a circuit with a **newer major** version is rejected with an explicit error

Migrations are one-way, explicit, and individually tested. Silent coercion is not
acceptable — see the error handling rules in `CLAUDE.md`.

The cycle derivation is not versioned by `schemaVersion`, because it is not
stored. A change to the derivation changes every consumer's reading of every
circuit at once and requires no migration — but it does require the contract
fixtures to be regenerated deliberately. A failing fixture is never repaired by
accepting the new output.

---

# Validation Rules

Validation is defined once in `shared/` and executed on both sides of the API.
The frontend validates for fast feedback; the backend validates because it cannot
trust its input.

A circuit is invalid if any of the following hold:

**Structural**

* an identifier is duplicated within its collection
* an identifier is empty or exceeds 64 characters
* a qubit `index` is negative, duplicated, or leaves a gap in the sequence
* a classical register has size less than 1

**Reference**

* an operation references a qubit id that does not exist
* a measurement references a classical register that does not exist
* a measurement's `bit` falls outside its register's size

**Operational**

* a gate's qubit count does not match its declared arity
* the same qubit appears more than once across `targets` and `controls` of one
  operation
* a required parameter is missing, or an unrecognized parameter is supplied
* a parameter is not a finite number
* a barrier has an empty `targets`, a repeated qubit in `targets`, or carries
  `controls`, `parameters`, or `classicalTarget`

**Semantic**

* a gate name is not in the known gate set
* a gate or measurement acts on a qubit that an earlier measurement already
  measured (see below)

Validation returns *all* violations, not the first one. A user fixing a circuit
should not have to fix errors one round-trip at a time.

## Measurement Terminates a Qubit

Mid-circuit measurement is deferred (Milestone 2 decision, 2026-07-29). While it
is deferred, measurement ends a qubit's usable life: no gate may act on a
measured qubit, and no qubit may be measured twice.

**Barriers are exempt.** A barrier may span a measured qubit. Without this
exemption a full-width barrier placed after measurement would be invalid, and an
importer expanding OpenQASM's bare `barrier;` to every qubit would produce
invalid circuits from valid input. A barrier is an authoring constraint rather
than an action on the qubit, so the restriction does not apply to it.

This rule is a validation constraint only. It has no effect on the cycle
derivation — a measurement already contends for its qubit, so later operations on
that qubit schedule correctly whether or not they are permitted to exist.

Lifting this restriction is an execution-semantics change and warrants its own
ADR, since it is the prerequisite for classical control.

---

# Invariants

These hold for every valid circuit and may be assumed by consumers:

1. `operations` is in execution order.
2. Qubit indices are contiguous starting at 0.
3. Every id referenced by an operation resolves.
4. The cycle decomposition is a pure function of the circuit.
5. Metadata never affects execution.
6. Each qubit is measured at most once, and nothing but a barrier follows its
   measurement. *(Holds while mid-circuit measurement is deferred.)*

Any code that would break an invariant must change this document first.

---

# Deliberately Deferred

Out of scope for Milestone 2, listed so the design leaves room:

* **Mid-circuit measurement** — decided and deferred, not undecided. See above.
* **Classical control** — operations conditioned on measurement results.
  Depends on mid-circuit measurement.
* **Parameterized circuits** — symbolic parameters bound at execution time
* **Custom and composite gates** — user-defined subcircuits
* **Delays** — timing-aware scheduling; would make depth a weighted quantity
* **Noise definitions** — per-gate error models
* **Visualization hints** — manual layout overrides

Each is an additive change under the versioning rules above. None requires
restructuring `operations`.

Barriers are **no longer** on this list. They were pulled into Milestone 2 by
ADR-0001, which makes barriers the vehicle for expressing scheduling intent.

---

# Resolved Decisions

Recorded so they are not relitigated. Each was open at the start of Milestone 2.

| Question | Resolution | Recorded in |
|---|---|---|
| Ordered list or stored cycles? | Ordered list, with cycles derived | ADR-0001 |
| How are cycles computed? | ASAP frontier packing, specified | ADR-0003 |
| Do cycles carry identity? | No — operations do | ADR-0002 |
| Mid-circuit measurement at MVP? | Deferred; measurement terminates a qubit | This document |
| Identifiers client- or backend-generated? | Client-generated, backend-validated | This document |
| May `classicalRegisters` be absent? | Field required, may be empty; no implicit register | This document |

One decision affecting this document remains open: whether the shared model is
generated from JSON Schema or hand-written on both sides with contract tests. See
`Roadmap.md`. It does not change the model specified here, but it determines how
this specification becomes code — and now also how the shared *derivation*
becomes code, which is a larger surface than types alone.
