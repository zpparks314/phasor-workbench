# Architecture

## High-Level Overview

Phasor Workbench consists of independent modules that communicate through well-defined interfaces.

The application is divided into four conceptual layers:

```text
Frontend

↓

Shared Circuit Model

↓

Backend Services

↓

Simulation Engine
```

The Circuit Model is the center of the architecture.

Every subsystem reads from or writes to the same circuit representation.

## Production Deployment Boundary

The production topology serves the static React/Vite frontend from GitHub Pages
at `phasor.zacharyparks.site` and runs the FastAPI/Qiskit backend on Render.
The browser calls the compute service over HTTPS through the existing REST API.
This separates static delivery from Python execution without changing module
ownership, the Circuit Model, or the simulator interface.

The backend remains stateless; circuit persistence stays in the browser. Local
development continues to use Vite's `/api` proxy. See
[Deployment.md](Deployment.md) for configuration and operational instructions.

---

# Frontend

Responsibilities:

* circuit editing
* rendering
* user interaction
* visualization
* displaying simulation results

The frontend should never implement simulation logic.

It should communicate with the backend exclusively through documented APIs.

---

# Backend

Responsibilities:

* validation
* simulation
* import/export
* optimization
* analysis

The backend should not contain presentation logic.

---

# Shared Circuit Model

The Circuit Model is the single source of truth.

Every circuit consists of:

* qubits
* gates
* measurements
* barriers
* classical registers
* metadata

Future additions may include:

* annotations
* custom gates
* noise definitions
* visualization hints

The model should be versioned to maintain backward compatibility.

## Two Shared Concerns Cross the Layer Split

The responsibility lists above give validation to the backend. That is true of
*trust* but not of *code*: model validation and cycle derivation are each
implemented in both projects, because each project needs them for a different
reason and neither can borrow the other's.

| Concern | Frontend runs it for | Backend runs it for |
|---|---|---|
| Validation | fast editor feedback | it cannot trust its input |
| Cycle derivation | render columns | depth, analysis, simulation |

Neither is a violation of the split. The frontend still does not simulate, and
the backend still does not render. Both implementations are held to one
specification by the fixtures in `shared/fixtures/`.

Settled by [ADR-0003](decisions/ADR0003_ExecutionSemantics.md),
[ADR-0004](decisions/ADR0004_SharedModelStrategy.md), and
[ADR-0005](decisions/ADR0005_SharedSpecification.md), which postdate the lists
above.

---

# Module Organization

```text
Frontend
├── UI
├── Circuit Editor
├── Visualization
├── API Client
└── State Management

Backend
├── API
├── Validation
├── Cycles
├── Serialization
├── Simulation
├── Importers
├── Exporters
├── Optimization
└── Analysis

Shared
├── Circuit Model
├── Serialization
├── Types
├── Specification
└── Fixtures
```

Each module should expose a clear public interface.

Avoid cross-module implementation dependencies.

**Shared is not a runtime service.** Its generator executes at development/build
time; application runtime code lives in the consuming projects. Shared holds the
schema, the specification data
(gate signatures, violation codes, the current model version), and the fixtures
both projects test against. Validation *rules* are specified there as data;
validation itself is implemented in each project. Likewise Shared defines the
serialization *format* while the code that reads a document across versions lives
in each project. See ADR-0004, ADR-0005, and ADR-0006.

---

# Data Flow

Circuit Editing

↓

Update Circuit Model

↓

Validate

↓

Send to Backend

↓

Simulation

↓

Return Results

↓

Render Visualizations

No component should maintain an independent representation of the circuit.

---

# Simulation Pipeline

Input Circuit

↓

Validation

↓

Circuit passed through SimulatorBackend protocol

↓

Qiskit adapter (temporary QuantumCircuit)

↓

Simulation Results

↓

Result Formatter

↓

API Response

The protocol consumes the canonical `Circuit`; there is no separate
simulator-neutral internal representation. Only the Qiskit adapter imports
Qiskit. See [Simulation.md](Simulation.md) for the reasoning and typed results.

Qiskit is the only implemented backend. The protocol is intended to support
additional implementations.

Examples:

* Qiskit
* Cirq
* Custom simulator

Switching simulators should not require changes to frontend code.

---

# API Philosophy

The frontend should communicate through stable REST endpoints.

The API should exchange structured JSON.

Avoid exposing implementation-specific details.

Maintain backward compatibility whenever practical.

---

# Extensibility

Future modules should be able to integrate without modifying existing architecture.

Examples include:

* Bloch sphere visualization
* Density matrix viewer
* Noise models
* Error correction
* Algorithm explorer
* Plugin system

Favor extension over modification.

---

# State Management

The circuit exists exactly once.

All UI components derive their state from the central Circuit Model.

Avoid duplicated state.

Avoid hidden state.

---

# Testing Strategy

Each module should be testable independently.

Test categories include:

* unit tests
* integration tests
* API tests
* serialization tests
* simulation correctness tests

Editing, validation, local persistence, and JSON file handling remain usable
when the backend is unavailable. Backend-dependent panels report failures;
production does not silently substitute mock results.

Explicit development mode (`VITE_USE_MOCK_API=true`) provides computed analysis
and recorded simulation fixtures. QASM conversion and examples require the real
backend. See [Frontend.md](Frontend.md#mocking).

---

# Architectural Rules

The following rules should rarely be violated:

* The frontend does not simulate circuits.
* The backend does not render UI.
* The Circuit Model is the single source of truth.
* APIs define module boundaries.
* Every feature should be independently testable.
* Every module should have a clearly defined responsibility.

When introducing new functionality, prefer creating a new module over expanding an existing one beyond its intended scope.

The architecture should remain understandable by a new contributor after reading this document and browsing the project structure for a few minutes.
