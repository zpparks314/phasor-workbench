# API

**Status:** Implemented, except where a section says otherwise.

Live: `/health`, `/circuits/analyze`, `/simulations/statevector`, `/simulations/sample`. Still proposed: `/capabilities`, `/circuits/validate`, and the deferred Milestone 5 endpoints listed near the end.

Sections describing built endpoints record where the implementation departed from what this document originally proposed, and why. Those notes are the point — each marks a place the first design was wrong.

---

# Principles

The API is the boundary between frontend and backend. It is the only way they communicate.

* transport is HTTP, style is REST, payloads are JSON
* the API exchanges Circuit Model documents, not framework-specific objects
* nothing in a response may reveal which simulator produced it
* backward compatibility is maintained whenever practical

A response that would require the frontend to know about Qiskit is a design failure.

---

# Statelessness

The MVP stores nothing.

Accounts, saved circuits, and cloud execution are explicitly out of scope (see [Roadmap.md](Roadmap.md)).

Every request therefore carries the full circuit in its body. There are no circuit ids to fetch, and no server-side session.

This keeps the backend trivially horizontally scalable and removes persistence from the critical path until it is actually wanted.

---

# Conventions

**Base path:** `/api/v1`

**Content type:** `application/json; charset=utf-8` on both request and response.

**Versioning:** the major version is in the path. A breaking change produces `/api/v2`; `/api/v1` continues to work during any transition.

**Methods:** analysis and simulation use `POST` despite being read-only, because the circuit is too large to encode in a query string.

---

# Error Format

Every error response uses one shape:

```json
{
  "error": {
    "code": "CIRCUIT_INVALID",
    "message": "Circuit failed validation.",
    "details": [
      {
        "code": "UNKNOWN_QUBIT_REFERENCE",
        "message": "Operation 'op_4' references qubit 'q_9', which does not exist.",
        "path": "operations[4].targets[0]"
      }
    ]
  }
}
```

Rules:

* `code` is a stable, machine-readable constant — clients branch on it, never on `message`
* `message` is human-readable and safe to display
* `details` is present when multiple independent problems exist, and lists all of them
* `path` locates the problem within the submitted document

Errors are never returned with a `200` status.

## Status Codes

| Status | Meaning |
|---|---|
| `200` | Success |
| `400` | Malformed JSON or structurally unreadable request |
| `422` | Well-formed request, invalid circuit |
| `413` | Circuit exceeds size limits |
| `429` | Rate limit exceeded |
| `500` | Unexpected backend failure |
| `503` | Simulation backend unavailable |
| `504` | Simulation exceeded its time budget |

The distinction between `400` and `422` matters: the first means the request could not be read, the second means the user built an invalid circuit.

**Amended 2026-08-02, when OpenQASM import produced a third case.** This previously read "the first means the frontend sent garbage… only the second should be rendered as user-facing feedback." That held while every request body was JSON the frontend had composed. An import request carries *user* content, so a `400` from `/circuits/import/qasm` is a well-formed request whose payload the user wrote and this build cannot read — and it is exactly what should be shown to them. The rule is now about *what* could not be read, not about who is at fault:

| Case | Status | Show the user? |
|---|---|---|
| The request itself is malformed | `400` | No — a frontend bug |
| User-supplied source could not be read | `400` | **Yes**, with its line and column |
| The circuit described is invalid | `422` | Yes, with its violation codes |

---

# Endpoints

## `GET /api/v1/health`

Liveness check. Takes no body.

```json
{ "status": "ok", "version": "0.1.0" }
```

Used by the Docker development environment and CI.

---

## `GET /api/v1/capabilities`

Describes what this backend can do, so the frontend can adapt rather than hard-code assumptions.

```json
{
  "schemaVersion": "0.1.0",
  "simulators": ["qiskit"],
  "maxQubits": 20,
  "supportedGates": ["i", "h", "x", "y", "z", "s", "sdg", "t", "tdg", "rx", "ry", "rz", "p", "cx", "cy", "cz", "swap", "ccx"],
  "features": ["statevector", "sampling", "analysis"]
}
```

This endpoint is what allows a simulator swap to require no frontend changes. The gate palette and qubit limit should be driven by this response rather than by constants in the UI.

---

## `POST /api/v1/circuits/validate`

Validates a circuit without executing it.

**Request**

```json
{ "circuit": { "...": "Circuit Model document" } }
```

**Response — valid**

```json
{ "valid": true, "warnings": [] }
```

**Response — invalid**

Returns `422` with the standard error envelope, listing every violation.

Validation rules are defined in [CircuitModel.md](CircuitModel.md) and shared with the frontend. This endpoint exists because the backend cannot trust client-side validation, not because the frontend lacks it.

---

## `POST /api/v1/circuits/analyze`

Static analysis. No simulation. **Implemented in Milestone 4** — the first endpoint to take a circuit, and the rest of this section is now description rather than plan.

**Request**

```json
{ "circuit": { "...": "Circuit Model document" } }
```

**Response**

```json
{
  "qubitCount": 2,
  "gateCount": 2,
  "measurementCount": 2,
  "depth": 3,
  "gateBreakdown": { "h": 1, "cx": 1 }
}
```

Cheap enough to call on every edit, which is why it is separate from simulation.

**The depth in that example was `2` until 2026-08-02, and it was wrong.** The circuit it describes is `h(q0)`, `cx(q0, q1)`, then a measurement on each wire: the two measurements share a cycle, so the decomposition is three cycles deep, not two. The number was written by hand before anything could compute it. It now comes from `derive_cycles`, and the endpoint's test asserts this body verbatim so the document and the implementation cannot drift again.

Three properties worth stating, because each is a decision rather than an accident:

* **`depth` is the cycle derivation's, never a recount.** It is the same component the canvas draws its columns from, implemented separately in both languages and held to the same fixtures. A second opinion about depth is exactly what ADR-0001 forbids.
* **A barrier is counted as neither a gate nor a measurement**, so `gateCount + measurementCount` is deliberately not the operation count. A barrier is an authoring constraint rather than something the circuit does. It can still *raise* depth by levelling an unequal frontier, which is not a contradiction — it occupies no cycle of its own while changing which cycle other operations land in.
* **A gate absent from the circuit is absent from `gateBreakdown`**, rather than present with a zero.

The request body is loaded through the versioned loader before it is validated, per ADR-0006 — a document can be well-shaped and still not a legal circuit, and the two stages report different codes. An invalid circuit returns `422` with `CIRCUIT_INVALID` and one `details` entry per violation, carrying the shared spec's codes unchanged.

---

## `POST /api/v1/simulations/statevector`

Executes the circuit and returns the final state vector. **Implemented in Milestone 4**; the rest of this section is description rather than plan.

**Request**

```json
{
  "circuit": { "...": "Circuit Model document" },
  "options": { "includeProbabilities": true }
}
```

**Response**

```json
{
  "qubitCount": 2,
  "amplitudes": [
    { "basisState": "00", "real": 0.7071067812, "imaginary": 0.0 },
    { "basisState": "01", "real": 0.0, "imaginary": 0.0 },
    { "basisState": "10", "real": 0.0, "imaginary": 0.0 },
    { "basisState": "11", "real": 0.7071067812, "imaginary": 0.0 }
  ],
  "probabilities": [
    { "basisState": "00", "probability": 0.5 },
    { "basisState": "11", "probability": 0.5 }
  ]
}
```

Amplitudes are returned as explicit `real`/`imaginary` pairs rather than tuples, because JSON has no complex type and named fields survive schema evolution better than positional arrays.

`basisState` is a bit string. Bit ordering is fixed and documented in [Simulation.md](Simulation.md) — it is the single most common source of confusion in quantum tooling and must not be left implicit.

**Circuits containing measurements are accepted, and the measurements ignored.** This section previously said they were rejected "unless mid-circuit measurement support is settled" — and it *is* settled. Mid-circuit measurement is deferred and measurement terminates a qubit, so every measurement in a valid document is terminal, and the state with them omitted is exactly the state just before the first one. That is what a statevector is: the deterministic state a measurement samples *from*.

Rejecting would also have made the editor's ordinary output unusable here — a Bell circuit with its two measurements is the canonical thing a user builds, and being told to delete them before the state could be shown is poor behaviour in a tool whose purpose is showing the state. The response carries no flag saying measurements were ignored: a client posting a circuit already has that circuit, and can say so itself.

**`qubitCount` is capped at 12 for this endpoint**, returning `413` / `LIMIT_EXCEEDED` above it. This is a *response-size* limit rather than a simulation one, and the two are deliberately different numbers — the simulator will do 20, and `/circuits/analyze` is unaffected. A statevector is 2^n amplitudes, each an object with a basis string and two floats:

| Qubits | Amplitudes | Response |
|---|---|---|
| 12 | 4,096 | a few hundred KB |
| 15 | 32,768 | a few MB |
| 20 | 1,048,576 | tens of MB |

The last would hang a browser tab, and would look like a frontend bug rather than a limit. The error message names which limit refused, because a caller that hits one will otherwise go looking at the other.

**`probabilities` is sparse; `amplitudes` is not.** Every amplitude is returned because the amplitudes *are* the state. Probabilities are a summary, and a floating-point simulation reports a mathematically empty state as `1e-17` rather than `0.0` — listing those would bury the two entries a Bell state actually has under a thousand indistinguishable from noise. Entries below `1e-12` are omitted.

`includeProbabilities` defaults to `true`. An unknown option is a `422` rather than a silent no-op.

---

## `POST /api/v1/simulations/sample`

Executes the circuit repeatedly and returns measurement counts. **Implemented in Milestone 4.**

**Request**

```json
{
  "circuit": { "...": "Circuit Model document" },
  "options": { "shots": 1024, "seed": 42 }
}
```

`shots` defaults to 1024. `seed` is optional; supplying it makes the run reproducible.

**Response**

```json
{
  "shots": 1024,
  "seed": 42,
  "counts": { "00": 517, "11": 507 },
  "probabilities": { "00": 0.5049, "11": 0.4951 }
}
```

Keys are classical register values, not qubit states — asserted with an asymmetric circuit, since a symmetric one reads the same under either interpretation. A circuit with no measurements is invalid here, and returns `422`.

`counts` and `probabilities` are objects keyed by outcome rather than lists of pairs, which is what the data is: a mapping with no ordering to preserve and no room for a second field per entry. The statevector response uses a list of objects because each amplitude carries two numbers. The shapes differ because the data differs.

**`seed` is echoed as `null` when none was supplied**, rather than omitted. `null` says the run was not seeded and so is not reproducible, which is information; an absent field would be indistinguishable from a build that does not support seeding.

**Sampling a circuit with more than one classical register is refused**, with `422`. Qiskit reports a separate count dictionary per register and does not correlate them, so joining the two would fabricate a correlation it never measured. Every circuit the editor currently produces has one register. This is a missing feature rather than a wrong result, and it is refused rather than approximated because a caller cannot repair an answer it was never told was wrong. See [Simulation.md](Simulation.md).

`shots` above the deployment limit returns `413`; `shots` below 1 is a malformed request rather than a circuit problem, and returns `422`.

---

## `POST /api/v1/circuits/import/qasm`

OpenQASM 2.0 → Circuit Model. Built 2026-08-02.

```json
{ "source": "OPENQASM 2.0;\ninclude \"qelib1.inc\";\nqreg q[2];\nh q[0];\n" }
```

Responds with a circuit document in the same wire form every other endpoint
accepts, so an import can be fed straight into `/circuits/analyze` with no
translation step:

```json
{ "circuit": { "schemaVersion": "0.1.0", "id": "...", "qubits": [], "...": "..." } }
```

**Only 2.0.** A file declaring any other version is refused with
`QASM_VERSION_UNSUPPORTED` rather than attempted. OpenQASM 3 adds classical
control flow, typed variables and subroutines, none of which the Circuit Model
can hold, so accepting it would mean refusing most of what it contains.

**Two failures, and they are different on purpose.** Source this build cannot
*read* is `REQUEST_MALFORMED` with `400` — the payload is what is wrong and
there is no circuit yet. Source that reads cleanly but describes an illegal
circuit is `CIRCUIT_INVALID` with `422`, carrying the model's own violation
codes from the same validator every other endpoint uses. A measurement followed
by a gate is a circuit error, not a parse error, and the difference is what lets
a client say "your file is broken" or "your circuit is".

**`path` carries a line and column, not a JSON pointer.** There is no document
to point into, so the location is stated in the terms the source has:

```json
{
  "error": {
    "code": "REQUEST_MALFORMED",
    "message": "The OpenQASM source could not be imported.",
    "details": [
      {
        "code": "UNKNOWN_GATE_NAME",
        "message": "'u3' is not a gate this build can represent.",
        "path": "line 4, column 1"
      }
    ]
  }
}
```

Syntax errors report the first one only — a parser that has lost its place
cannot honestly report a second. Everything semantic is collected, so one
request reports every unknown gate and bad reference in the file.

Codes beginning `QASM_` describe the source text and are defined by the backend,
not by `circuit.spec.json`: nothing in the frontend parses QASM, so there is no
second implementation for the shared spec to hold in step. `UNKNOWN_GATE_NAME`
is the exception and is the model's own code, because an unsupported gate is a
fact the model already names.

| Code | Means |
|---|---|
| `QASM_SYNTAX_ERROR` | The source could not be parsed |
| `QASM_VERSION_UNSUPPORTED` | Not OpenQASM 2.0 |
| `QASM_UNSUPPORTED_STATEMENT` | `gate`, `opaque`, `if` or `reset` |
| `QASM_UNKNOWN_REGISTER` | A register that was never declared |
| `QASM_DUPLICATE_REGISTER` | A register declared twice |
| `QASM_INDEX_OUT_OF_RANGE` | An index past a register's size |
| `QASM_BROADCAST_MISMATCH` | Registers of different sizes in one statement |
| `QASM_ARGUMENT_COUNT` | Wrong number of qubits for the gate |
| `QASM_PARAMETER_COUNT` | Wrong number of parameters for the gate |
| `UNKNOWN_GATE_NAME` | A gate the model cannot represent |

**What does not survive the trip.** Quantum register grouping: the model has one
flat indexed wire list, so `qreg q[2]; qreg r[3];` becomes five wires and the
names are gone. Classical registers *do* survive one-for-one, keeping their name
as a label. Parameter expressions are evaluated, so `rx(pi/2)` becomes a number
and an export cannot recover the `pi/2`.

`source` is limited to `QW_MAX_QASM_CHARACTERS` characters (default 256,000),
refused with `LIMIT_EXCEEDED` and `413`. The parser is reachable before any
circuit limit applies, since `max_operations` cannot refuse a file until the
file has been read.

---

## Deferred Endpoints

Planned for Milestone 5, listed so the path structure stays coherent:

| Endpoint | Purpose |
|---|---|
| `POST /api/v1/circuits/export/qasm` | Circuit Model → OpenQASM |
| `GET /api/v1/examples` | Built-in example circuits |

---

# Limits

Requests exceeding any limit return `413`.

| Limit | Proposed default |
|---|---|
| Request body size | 1 MB |
| Qubits per circuit | 20 |
| Operations per circuit | 10,000 |
| Shots per request | 100,000 |
| Simulation wall clock | 30 s |

The qubit limit is a memory constraint, not an arbitrary one — see [Simulation.md](Simulation.md).

Limits are configuration, not constants in code, and are advertised through `/capabilities`.

---

# Mocking

Architecture.md requires the frontend to remain functional when the backend is unavailable.

To support this, every endpoint above must have a recorded mock response committed alongside the API client.

Mocks are generated from real backend responses and validated against the same schema in CI, so they cannot silently drift from the live contract.

This also lets frontend work proceed in Milestone 3 before the backend exists.

---

# Open Questions

1. Should `/simulations/statevector` accept an operation id to return the state *at that point*, rather than only the final state? The educational goals in [Vision.md](Vision.md) suggest yes, but it complicates the response shape.
2. Is a single `/simulations` endpoint with a `mode` field preferable to separate `statevector` and `sample` paths?
3. Should validation warnings (as opposed to errors) be part of every response envelope rather than only the validate endpoint?
