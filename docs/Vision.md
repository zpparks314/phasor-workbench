# Vision

## Purpose

RogueScholar's Quantum Workbench exists to make quantum circuits **understandable**, not merely executable.

Most quantum software falls into one of two categories:

* professional frameworks that assume the user already understands the mathematics
* educational toys that demonstrate concepts but cannot express real circuits

Quantum Workbench aims to occupy the space between them.

A user should be able to build a circuit, run it, and then see *why* it produced the result it did.

---

# The Gap We Are Filling

Existing tools generally optimize for execution.

A circuit goes in, a result comes out, and the intermediate state is invisible.

That is appropriate for production work and unhelpful for learning.

Quantum Workbench treats the intermediate state as the interesting part.

Priorities that follow from this:

* state should be inspectable at any point in a circuit
* visualization is a primary feature, not decoration
* explanations should accompany results
* the tool should remain honest about what it is approximating

---

# Intended Audience

In rough order of priority:

1. **Learners** studying quantum computing independently
2. **Students** in formal coursework
3. **Educators** who need a tool to demonstrate concepts live
4. **Developers** prototyping small circuits before moving to a full framework
5. **Researchers** exploring error correction and circuit structure

The tool should be approachable for the first group without becoming useless to the last.

---

# What Success Looks Like

Quantum Workbench is successful when:

* a newcomer can build a Bell state and understand what entanglement did to the state vector
* an educator can demonstrate teleportation without preparing slides
* a developer can sketch a circuit and export valid OpenQASM
* a contributor can read the documentation and add a visualization module without touching unrelated code

The last point is a product goal, not only an engineering one.

A tool that cannot be extended will not survive the years this project expects to run.

---

# Guiding Beliefs

## Understanding Over Throughput

Simulation speed matters less than clarity.

When the two conflict, prefer clarity.

Performance work is justified only once a real bottleneck is measured.

---

## Visualization Is a Feature, Not a Skin

Bloch spheres, state timelines, and matrix viewers are not cosmetic additions.

They are the reason the project exists.

The architecture must treat them as first-class consumers of the Circuit Model rather than afterthoughts bolted onto the editor.

---

## Correctness Is Non-Negotiable

An educational tool that teaches the wrong thing is worse than no tool.

Simulation results must be verifiable against established frameworks.

Where the application approximates or truncates, it should say so in the interface.

---

## Longevity Over Momentum

This project is expected to grow over several years.

Decisions that produce a working demo this week but constrain the design next year should be rejected.

See [Architecture.md](Architecture.md) for the structural rules that enforce this.

---

## Open Source By Default

The project should be readable, forkable, and self-hostable.

Nothing essential should depend on a service the user cannot run themselves.

---

# Long-Term Direction

These are directional, not scheduled. See [Roadmap.md](Roadmap.md) for what is actually planned.

**Educational depth**

Bloch spheres, state evolution timelines, gate explanations, tensor product visualization.

**Simulation depth**

Density matrices, noise models, fidelity metrics, multiple simulator backends.

**Algorithm library**

Bell and GHZ states, teleportation, Deutsch-Jozsa, Bernstein-Vazirani, Grover, QFT — each presented as an explorable, annotated circuit rather than a code sample.

**Research surface**

Error correction, surface codes, stabilizer circuits, tensor-network simulation.

**Collaboration**

Saved circuits, sharing, classroom mode.

---

# Explicit Non-Goals

Naming these protects the architecture from drift.

**Quantum Workbench is not a replacement for Qiskit or Cirq.**

It consumes them. It does not compete with them as a general-purpose framework.

**Quantum Workbench is not a hardware access portal.**

Real device execution is out of scope. The project simulates.

**Quantum Workbench is not an AI tool.**

Circuit generation by language model is out of scope. The user builds the circuit.

**Quantum Workbench is not a platform business.**

No marketplace, no accounts-first design, no telemetry-driven feature gating.

---

# Relationship to Other Documents

| Document | Answers |
|---|---|
| `Vision.md` (this file) | Why the project exists |
| [Architecture.md](Architecture.md) | How the system is structured |
| [Roadmap.md](Roadmap.md) | What is being built, and when |
| [CircuitModel.md](CircuitModel.md) | What a circuit *is* |
| [API.md](API.md) | How frontend and backend communicate |
| [Simulation.md](Simulation.md) | How circuits are executed |

When this document and the roadmap disagree, the roadmap wins for scheduling and this document wins for intent.
