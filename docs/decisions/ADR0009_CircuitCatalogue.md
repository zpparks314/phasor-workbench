# ADR-0009: The Circuit Catalogue, and Room for Generated Circuits

**Status:** Accepted

**Date:** 2026-08-04

## Context

Milestone 5 asks for example circuits, and its exit criterion is specific: they
"load, validate without violations, and simulate", and "each is authored through
the import path rather than hand-written JSON — that is what makes them evidence
the path works rather than decoration."

That describes a small, static thing: six files a user can open. Building only
that would be straightforward and this ADR would be unnecessary. The reason it is
not is a question asked when the work started — that the eventual goal includes
*generating* circuits for VQE, QAOA and randomized compiling, and that whatever
ships now should not have to be torn out to get there.

So the decision is not "how do we ship six examples". It is **what shape the
catalogue entry has**, because that shape is what a generator either fits into or
does not.

### What was checked first

Three things were verified rather than assumed, and each changed the design.

**The gate set is not the obstacle.** It would be reasonable to assume VQE and
QAOA need gates the model lacks, since `Roadmap.md`'s *Widening the Gate Set*
exists and names `u3`, `cu1` and friends. They do not. A QAOA cost layer
`exp(-iγZᵢZⱼ)` is `cx; rz(2γ); cx`; a hardware-efficient VQE ansatz is `ry`, `rz`
and `cx`; Pauli twirling for randomized compiling needs only `i`, `x`, `y`, `z`.
All three were built against the current eighteen gates and validated with zero
violations before this ADR was written. The gate-set milestone exists because
Qiskit *emits* `u3` when exporting — a different problem, and not a blocker here.

**A generator and a transform are different shapes.** This is the finding the
whole ADR turns on. VQE and QAOA are `parameters → circuit`. Randomized compiling
is `circuit + parameters → circuit`: it twirls the hard cycles of a circuit that
already exists. Modelling it as a generator with "an extra argument that happens
to be a circuit" collapses a distinction that matters — a generator has no input
to be invalid, while a transform can be handed a circuit it cannot process.

**The model cannot honestly express every canonical example.** Teleportation is
in `Vision.md`'s list and is not in the catalogue. Its final corrections are
conditioned on two measurement outcomes, and ADR-0003 defers classical control,
so the closest expressible circuit applies them unconditionally. It validates —
the qubit being corrected is never measured, so nothing refuses it — and it is
not teleportation. An example that looks like the textbook diagram and does
something else is worse than an absent one in a project whose stated purpose is
understanding.

## Decision

### 1. An example is a file, and adding one is adding a file

Each example is a single `.qasm` file in `backend/src/phasor_workbench/examples/`.
Its name and summary are `// key: value` comment lines above the first statement,
which OpenQASM ignores.

There is deliberately **no manifest**. A separate index is a second place to edit
and the first place to drift, and the failure it produces — an example that
exists but is unlisted, or is listed but absent — is precisely the failure a
catalogue must not have. The id comes from the filename.

### 2. Examples go through the importer, and get no shortcut

`Example.document()` stops at the parser. Loading and validating are
`api.documents.read_circuit`'s job, the same call a user's uploaded file makes.

This is the exit criterion's requirement, and it has a second effect worth
stating: an example cannot rely on anything the importer would refuse from
anyone else. If a future change makes the parser stricter, the examples break
loudly in the suite rather than quietly becoming the only circuits in the system
that arrived by a privileged route.

### 3. The catalogue is metadata; circuits are fetched one at a time

`GET /api/v1/examples` returns entries without circuits. `GET
/api/v1/examples/{id}` returns one circuit document.

Six small circuits would fit in one response, and bundling them would save a
round trip today. It is refused because the entry is the thing being designed for
extension: a generated entry cannot carry "the" circuit, since it has one per
parameter set. Splitting now costs one request and means a generator is added
without changing the list endpoint's contract.

### 4. Three shapes, named now, built as needed

| Shape | Signature | Now | Later |
|---|---|---|---|
| **Static** | `→ circuit` | The six examples | more files |
| **Generator** | `parameters → circuit` | not built | QAOA, VQE ansätze |
| **Transform** | `circuit + parameters → circuit` | not built | randomized compiling |

A static example is a generator with no parameters, so the two share an entry
shape: a catalogue entry may carry a `parameters` description, and today none do.
A client that ignores an absent `parameters` field keeps working when one
appears, which is what makes adding generators additive rather than breaking.

**A transform is not a generator and does not share the seam.** It takes a
circuit, so it can fail on its input; it belongs under its own path rather than
`/examples`, and it is closer to `analysis/` than to this module. Naming it here
is the point — the mistake this ADR exists to prevent is discovering the
distinction while writing randomized compiling and bending the generator
interface to fit it.

### 5. Generators are backend-side when they arrive

`Architecture.md` gives the backend validation, simulation, import/export,
analysis and optimization, and gives the frontend UI, interaction and state.
Circuit construction from parameters is not on either list, which is why it is
recorded here: it goes to the backend, for the reason OpenQASM parsing did.
A generator is a specification of a circuit family — the kind of thing that wants
tests, fixtures and a single implementation, not one per client.

The editor building circuits from user gestures is not a counterexample. That is
interaction, and it produces one circuit from one act.

## Consequences

**Adding an example is a one-file change**, with no registration step, and the
suite fails if the file lacks its metadata.

**Every example is held to simulation, not just validation.** This is the exit
criterion, and it earned its place immediately: the first QFT written for this
catalogue validated cleanly and was *wrong* — built the textbook way, with qubit
0 as the most significant bit, where this project fixes qubit 0 as the rightmost.
It produced the correct uniform distribution from `|000⟩` and the wrong state for
every other input. Only comparing amplitudes against the analytic transform
caught it. Any example asserted on structure alone can be confidently, silently
false.

**The catalogue endpoint returns no circuits**, so a client showing a picker
makes one request for the list and one more when something is chosen.

**Teleportation is absent until classical control exists**, and the reason is
recorded so it is not re-added by someone working from the Vision list.

**A generator will need a parameter description format** — types, ranges,
defaults — which is not designed here. Designing it without a generator to test
it against is the mistake this ADR is trying not to make in the other direction;
what is settled is that entries can carry one, not what it looks like.

## Alternatives Considered

**Examples as Circuit Model JSON.** Rejected by the exit criterion, and rightly:
they would be the only circuits in the system never to pass through the importer,
and so evidence of nothing.

**A manifest listing the examples.** Rejected for drift, above.

**Building the generator framework now.** Rejected as speculative. There is no
generator to test the seam against, and a seam designed against an imagined
consumer is usually the wrong seam. What is built now is the part with a
requirement behind it; what is reserved is the shape.

**Treating randomized compiling as a generator taking a circuit parameter.**
Rejected in section 4. It is the specific mistake this ADR was written to
prevent.

**Putting examples in `shared/`.** Rejected. `shared/` holds the Circuit Model,
which neither side may own; examples are content, and only the backend can read
OpenQASM. `ProjectStructure.md`'s rule that `importers/` and `exporters/` are
backend-only applies for the same reason.
