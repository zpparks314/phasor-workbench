# Architecture

## High-Level Overview

Phasor Workbench consists of independent modules that communicate through well-defined interfaces.

The application is divided into three primary layers:

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
* classical registers
* metadata

Future additions may include:

* annotations
* custom gates
* noise definitions
* visualization hints

The model should be versioned to maintain backward compatibility.

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
├── Simulation
├── Importers
├── Exporters
├── Optimization
└── Analysis

Shared
├── Circuit Model
├── Serialization
├── Types
└── Validation Rules
```

Each module should expose a clear public interface.

Avoid cross-module implementation dependencies.

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

Internal Representation

↓

Simulation Backend

↓

Simulation Results

↓

Result Formatter

↓

API Response

The simulation backend should eventually support multiple implementations.

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

The frontend should remain functional even when the simulation backend is unavailable by using mock API responses.

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
