# Circuit Model

**Status:** Draft — proposed design, pending review.

**Target milestone:** Milestone 2 (Circuit Model).

This document describes the intended shape of the model. Nothing here is implemented yet.

---

# Role

The Circuit Model is the single source of truth for the entire application.

The editor, simulator, importers, exporters, analyzers, and every visualization operate on this one representation.

No subsystem may maintain its own circuit state.

If a subsystem needs a different shape for internal work — a simulator's tensor layout, a renderer's grid — it derives that shape on demand and discards it. It does not persist a parallel copy.

The model is language-neutral by design. It lives in `Shared/` and is expressed as JSON so that frontend and backend agree on it without either owning it.

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

## Operation

Anything that occupies a position in the circuit's execution order.

Two kinds exist at this stage:

* **gate** — a unitary operation on one or more qubits
* **measurement** — a projective measurement writing into a classical bit

Modeling gates and measurements as variants of a single ordered `operations` list keeps execution order unambiguous and avoids a second list that would need to be kept in sync.

## Metadata

Descriptive information that does not affect execution: name, description, timestamps, author notes.

Metadata must never carry semantics. If the simulator would behave differently based on a metadata field, that field belongs in the model proper.

---

# Structural Decision: Ordered List, Not Moments

A circuit could be stored either as:

**A.** a flat, ordered list of operations, with visual columns derived at render time

**B.** an array of moments (columns), each containing operations that execute in parallel

**This design chooses A.**

Reasons:

* execution order is explicit and unambiguous
* insertion and removal are local edits rather than column rebalancing
* OpenQASM import and export map directly onto a linear sequence
* column layout is a *presentation* concern, and Architecture.md forbids the backend from holding presentation logic

The cost of choice A is that the editor is grid-shaped while the model is not.

That gap is closed by a **deterministic layout derivation**: columns are computed by greedy left-packing — each operation is placed in the earliest column where all of its qubits are free.

The derivation must be pure and stable, so the same circuit always renders identically.

If users later need manual control over layout, the correct extension is an optional visualization hint in metadata (already anticipated in Architecture.md), not a change to the execution model.

---

# Identity

Every qubit, classical register, and operation carries a **stable identifier**.

Identifiers are required, not optional, because:

* undo and redo need to reference operations across edits
* the editor needs to track selection through reordering
* visualizations need to anchor annotations to specific operations
* diffing two circuit versions is otherwise impossible

Positional index alone is insufficient — indices shift when an operation is inserted.

Identifiers are opaque strings. Nothing may parse meaning out of them.

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
      "kind": "measurement",
      "targets": ["q_0"],
      "classicalTarget": { "register": "c_0", "bit": 0 }
    },
    {
      "id": "op_3",
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
* unknown fields are preserved on round-trip where practical, to avoid destroying data written by a newer version
* absent optional fields and `null` are equivalent
* floating-point parameters are stored in radians

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

Controlled gates express their control qubits in `controls`, not by encoding control count into the gate name. `cx` therefore has one entry in `targets` and one in `controls`.

Aligning names with OpenQASM now avoids a translation table later, when import and export land in Milestone 5.

---

# Versioning

The model carries `schemaVersion` using semantic versioning.

| Change | Version bump |
|---|---|
| Adding an optional field | minor |
| Adding a gate to the standard set | minor |
| Renaming or removing a field | major |
| Changing the meaning of an existing field | major |

Loading rules:

* a circuit with an **older compatible** version is migrated forward on load
* a circuit with a **newer minor** version loads, with unknown fields preserved and a warning surfaced
* a circuit with a **newer major** version is rejected with an explicit error

Migrations are one-way, explicit, and individually tested. Silent coercion is not acceptable — see the error handling rules in `CLAUDE.md`.

---

# Validation Rules

Validation is defined once in `Shared/` and executed on both sides of the API. The frontend validates for fast feedback; the backend validates because it cannot trust its input.

A circuit is invalid if any of the following hold:

**Structural**

* an identifier is duplicated within its collection
* a qubit `index` is negative, duplicated, or leaves a gap in the sequence
* a classical register has size less than 1

**Reference**

* an operation references a qubit id that does not exist
* a measurement references a classical register that does not exist
* a measurement's `bit` falls outside its register's size

**Operational**

* a gate's qubit count does not match its declared arity
* the same qubit appears more than once across `targets` and `controls` of one operation
* a required parameter is missing, or an unrecognized parameter is supplied
* a parameter is not a finite number

**Semantic**

* a gate name is not in the known gate set

Validation returns *all* violations, not the first one. A user fixing a circuit should not have to fix errors one round-trip at a time.

---

# Invariants

These hold for every valid circuit and may be assumed by consumers:

1. `operations` is in execution order.
2. Qubit indices are contiguous starting at 0.
3. Every id referenced by an operation resolves.
4. Derived column layout is a pure function of the circuit.
5. Metadata never affects execution.

Any code that would break an invariant must change this document first.

---

# Deliberately Deferred

Out of scope for Milestone 2, listed so the design leaves room:

* **Parameterized circuits** — symbolic parameters bound at execution time
* **Custom and composite gates** — user-defined subcircuits
* **Classical control** — operations conditioned on measurement results
* **Barriers** — optimization boundaries
* **Noise definitions** — per-gate error models
* **Visualization hints** — manual layout overrides

Each is an additive change under the versioning rules above. None requires restructuring `operations`.

---

# Open Questions

To resolve before implementation begins:

1. Should measurement of a qubit prevent subsequent gates on it, or is mid-circuit measurement permitted from the start?
2. Should `classicalRegisters` be required, or may a circuit have none and default measurements to an implicit register?
3. Are identifiers generated client-side (UUID-like) or assigned by the backend?

These affect validation rules and are worth settling before code is written.
