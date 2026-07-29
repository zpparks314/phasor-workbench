# Architecture Decision Records (ADRs)

This directory contains the **Architecture Decision Records (ADRs)** for Phasor
Workbench.

An ADR captures the reasoning behind a significant architectural decision. It
documents **why** a decision was made, the alternatives that were considered, and
the expected consequences. Unlike implementation documentation, ADRs are intended
to remain relevant even as the code evolves.

## Purpose

The goals of this directory are to:

* Preserve the rationale behind important technical decisions.
* Prevent the same architectural debates from being repeated.
* Provide historical context for future contributors.
* Help AI coding agents understand the project's architectural constraints.
* Ensure new features remain consistent with the project's design philosophy.

## When to Create an ADR

Create an ADR whenever a decision has long-term architectural impact.

Examples include:

* Data model design
* Circuit representation
* Execution semantics
* Technology stack
* Serialization formats
* Public APIs
* Storage formats
* Dependency selection
* Plugin architecture
* Security architecture

Do **not** create ADRs for:

* Bug fixes
* Minor refactoring
* Code style
* Variable naming
* UI tweaks
* Temporary implementation details

## ADR Lifecycle

Each ADR has one of the following statuses:

| Status         | Meaning                                                             |
| -------------- | ------------------------------------------------------------------- |
| **Proposed**   | Under discussion; not yet adopted.                                  |
| **Accepted**   | Official project architecture.                                      |
| **Superseded** | Replaced by a newer ADR.                                            |
| **Deprecated** | No longer recommended, but still documented for historical context. |

An accepted ADR should not be modified simply because the implementation
changes. If the architecture itself changes, create a new ADR and mark the
previous one as **Superseded**.

## File Naming

ADRs are numbered sequentially and named `ADR<number>_<TitleInPascalCase>.md`.

Example:

```text
ADR0001_CircuitRepresentation.md
ADR0002_IdentityModel.md
ADR0003_ExecutionSemantics.md
```

Numbers are never reused.

## Recommended Template

Each ADR should contain the following sections:

```text
Title

Status

Date

Context

Decision

Rationale

Consequences

Alternatives Considered

Future Considerations
```

Not every section must be long, but every decision should explain **why** it
exists.

## Relationship to Other Documentation

The documentation in this repository serves different purposes:

| Document          | Purpose                                         |
| ----------------- | ----------------------------------------------- |
| `Vision.md`       | Project goals and long-term direction.          |
| `Architecture.md` | High-level system organization.                 |
| `CircuitModel.md` | Specification of the circuit data model.        |
| `Simulation.md`   | Simulation architecture and execution model.    |
| `API.md`          | Public API specification.                       |
| `Roadmap.md`      | Planned development milestones.                 |
| **ADRs**          | Rationale behind major architectural decisions. |

ADRs complement these documents—they do not replace them.

## Guidance for Contributors

Before introducing a significant architectural change:

1. Read the existing ADRs.
2. Determine whether the proposed change conflicts with an accepted ADR.
3. If it does, discuss the change before implementation.
4. If a new architectural decision is required, create a new ADR instead of
   silently changing an existing one.

## Guidance for AI Coding Agents

Before implementing changes that affect:

* data models
* execution semantics
* APIs
* serialization
* project structure
* dependency selection
* technology stack

read all relevant ADRs.

If a proposed implementation conflicts with an **Accepted** ADR, stop and request
clarification rather than making assumptions.

If no ADR exists for a significant architectural decision, recommend creating one
before implementing the change.

## Current ADRs

| ADR  | Status   | Description                                                        |
| ---- | -------- | ------------------------------------------------------------------ |
| 0001 | Accepted | Canonical circuit representation — flat operation list, derived cycles |
| 0002 | Accepted | Stable object identity                                             |
| 0003 | Accepted | Execution semantics and cycle derivation                           |

These three are interdependent and should be read in order. 0001 decides what is
stored, 0002 decides how stored objects are referenced, and 0003 specifies the
derivation 0001 relies on.
