# Simulation

**Status:** Draft — proposed design, pending review.

**Target milestone:** Milestone 4 (Simulation MVP).

Nothing described here is implemented yet.

---

# Goal

Execute a Circuit Model document and return results the frontend can display, without the frontend ever learning which simulator ran.

Architecture.md states the requirement plainly: switching simulators must not require frontend changes.

Everything below exists to satisfy that constraint.

---

# Stack

The backend is **Python + FastAPI + Pydantic**, with Qiskit as the first simulator and NumPy for numerical work. Confirmed during Milestone 1.

## Dependency Placement

Qiskit and NumPy are **not** core backend dependencies. They are isolated in an optional `simulation` extra in `backend/pyproject.toml`, because nothing before Milestone 4 uses them and `CLAUDE.md` directs the project to minimize dependencies.

This also sidesteps a live constraint: Qiskit does not yet publish wheels for Python 3.14, while the rest of the backend installs and runs on it fine. Keeping Qiskit optional means the foundation is not held back by a simulator that is not needed yet.

Before Milestone 4 begins, confirm which interpreter version the simulation extra will target — 3.11–3.13 today, or 3.14 if Qiskit has shipped support by then.

---

# Pipeline

```text
Circuit Model document

↓

Validation

↓

Internal Representation

↓

Simulation Backend

↓

Raw Results

↓

Result Formatter

↓

API Response
```

This mirrors the pipeline in Architecture.md. The two must not diverge.

## Why an Internal Representation

Translating the Circuit Model directly into Qiskit calls inside the request handler would couple the API layer to Qiskit permanently.

The internal representation is a thin, simulator-agnostic structure that each backend adapter consumes.

It is the seam that makes a second backend possible.

## Why a Result Formatter

Each simulator returns results in its own shape — bit ordering, key format, and complex number representation all differ.

The formatter normalizes them into the API response documented in [API.md](API.md).

Without it, a simulator swap would leak through to the frontend.

---

# Backend Interface

Every simulator adapter implements the same conceptual interface:

| Operation | Purpose |
|---|---|
| `capabilities()` | Supported gates, max qubits, supported modes |
| `simulate_statevector(circuit)` | Final state vector |
| `sample(circuit, shots, seed)` | Measurement counts |

Rules for adapters:

* an adapter never imports anything from the API layer
* an adapter never formats a response
* an adapter raises typed errors, never simulator-specific exceptions
* an adapter declares its own limits rather than having them imposed

Adding a simulator means adding one adapter and registering it. It must not require edits elsewhere.

## Planned Backends

| Backend | Status |
|---|---|
| Qiskit | First implementation, Milestone 4 |
| Custom reference simulator | Useful for verification and for removing the Qiskit dependency from tests |
| Cirq | Future |

A small custom simulator is worth building eventually even though Qiskit is available — it gives the test suite something to cross-check against, which is how the correctness guarantee in [Vision.md](Vision.md) is actually enforced.

---

# Simulation Modes

## Statevector

Returns all `2^n` complex amplitudes of the final state.

Deterministic. No measurement involved.

This is the mode that serves the educational goals — Bloch spheres, amplitude displays, and state evolution all read from it.

## Sampling

Executes the circuit `shots` times and returns classical register counts.

Non-deterministic unless seeded.

This is the mode that reflects what real hardware would produce.

## Deferred Modes

* density matrix simulation
* noisy simulation
* unitary extraction
* stabilizer simulation

Each is additive — a new method on the backend interface and a new endpoint, not a restructuring.

---

# Bit Ordering

**Qubit 0 is the rightmost bit of a basis state string.**

For a 3-qubit circuit, the string `"011"` means qubit 2 is `0`, qubit 1 is `1`, qubit 0 is `1`.

This is little-endian, and it matches Qiskit's convention.

This decision is recorded prominently because inconsistent bit ordering is the most common source of silent wrongness in quantum tooling. Adapters for backends using the opposite convention **must** reverse ordering in the formatter, and that reversal must be covered by a test asserting a known asymmetric state.

---

# Determinism and Seeding

Statevector simulation is deterministic by nature.

Sampling accepts an optional seed. When supplied, repeated requests with identical circuit and seed return identical counts.

Seeding is not merely a convenience — it is what makes sampling results testable and what lets an educator reproduce a demonstration.

The seed used is echoed in the response, including when it was generated server-side.

---

# Resource Limits

Statevector memory grows exponentially. For `n` qubits, storing complex128 amplitudes costs `16 × 2^n` bytes:

| Qubits | State vector size |
|---|---|
| 10 | 16 KB |
| 20 | 16 MB |
| 24 | 268 MB |
| 26 | 1.1 GB |
| 30 | 17 GB |

The proposed default cap is **20 qubits**, with an absolute ceiling of 24.

That is comfortably beyond what an educational circuit needs, and it keeps a single request from exhausting a container's memory.

Limits are configuration, advertised through `/api/v1/capabilities`, and enforced during validation — before any allocation occurs.

A circuit exceeding the cap must be rejected with a clear explanation of the exponential cost, not a generic failure. Explaining *why* 30 qubits is refused is itself educational.

Simulations also carry a wall-clock budget, defaulting to 30 seconds, after which the request returns `504`.

---

# Error Handling

Simulation failures map onto typed errors, never raw simulator exceptions:

| Condition | Result |
|---|---|
| Circuit fails validation | `422` with per-violation detail |
| Qubit count exceeds cap | `413` with the limit and the request's count |
| Time budget exceeded | `504` |
| Backend process unavailable | `503` |
| Unexpected adapter failure | `500`, logged with full context |

A simulator stack trace must never reach the client. It reveals implementation details the API is meant to hide, and it is useless to the user.

---

# Testing Strategy

Simulation correctness is the one area where the project cannot rely on manual checking.

Required test categories:

**Known-state tests**

Circuits with analytically known outputs — Bell states, GHZ states, single-gate rotations — asserted against exact amplitudes within a tolerance.

**Cross-backend tests**

Once a second backend exists, identical circuits run through both must agree. This is the strongest available correctness signal.

**Bit-ordering tests**

Asymmetric states asserted explicitly, per the warning above.

**Statistical tests**

Sampling results checked against expected distributions with a fixed seed and a tolerance wide enough not to flake.

**Limit tests**

Circuits at and beyond the qubit cap, asserting rejection before allocation.

Tolerances are defined once and shared. Floating-point comparison must never use exact equality.

---

# Open Questions

1. Does simulation run in-process, or in a separate worker with its own resource limits? The latter is safer for enforcing timeouts but adds infrastructure in Milestone 4.
2. Should mid-circuit measurement be supported at MVP, or deferred? This is also open in [CircuitModel.md](CircuitModel.md) and should be answered once for both.
3. Should the statevector endpoint support returning intermediate states, per the open question in [API.md](API.md)? It would materially serve the educational goal but affects the backend interface.
