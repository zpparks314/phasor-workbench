# Cross-Cutting Tests

Tests that span more than one project.

**Status:** structure only, and less will live here than originally planned —
see *Parity Does Not Require a Cross-Language Runner* below. Shared-model parity
runs from each project's own suite against `shared/fixtures/`. API conformance
lands in Milestone 4.

---

## What Belongs Here

Tests that cannot live inside a single project because they assert something
about the boundary *between* projects.

```text
tests/
├── integration/   Frontend and backend running together
└── contract/      API responses and shared-model parity
```

## What Does Not Belong Here

Unit tests stay with the code they test:

| Test kind | Location |
|---|---|
| Frontend units and components | `frontend/src/**/*.test.ts(x)` |
| Backend units and routes | `backend/tests/` |
| Simulation correctness | `backend/tests/` |

Keeping unit tests next to their source is what makes Architecture.md's
"each module should be testable independently" true in practice. This
directory is for the tests that are deliberately *not* independent.

---

## Integration

End-to-end checks with both services running: the frontend can reach the
backend, a circuit survives a round trip, error responses render correctly.

Planned for Milestone 4, once there is something to round-trip.

## Contract

Two things, both of which prevent silent drift:

**API conformance** — recorded mock responses in the frontend must validate
against the backend's live OpenAPI schema. Architecture.md requires the
frontend to work with mocks when the backend is down; this is what stops
those mocks from quietly diverging from reality.

**Shared-model parity** — every fixture in `shared/fixtures/` must be
accepted or rejected identically by the TypeScript and Python
implementations, with matching violation codes, and every fixture in
`shared/fixtures/decomposition/` must produce an identical cycle decomposition
in both.

Parity matters more than it looks. Per ADR-0004 the JSON Schema covers only the
*shape* of a circuit; validation and the cycle derivation are hand-written once
per language, so these fixtures are the only mechanism that detects the two
implementations disagreeing.

A failing decomposition fixture is never repaired by regenerating it to match
the new output. Either an implementation is wrong or ADR-0003 has changed, and
the second requires an ADR revision.

## Parity Does Not Require a Cross-Language Runner

This was expected to need machinery here, and it does not.

Each fixture **declares** its own expectation — the codes it must produce, or
the decomposition it must yield. Each project's own suite asserts against that
declaration, so both are measured against the same artifact and agreement
follows transitively. Neither side needs to see the other's output, and no test
here has to drive two toolchains.

Two things follow. Validation and derivation parity is enforced from
`backend/tests/` and `frontend/src/**/*.test.ts` against `shared/fixtures/`, and
it is enforced by the *existing* per-project CI jobs. And a fixture's declaration
is load-bearing: editing one to match new output defeats the only mechanism that
detects divergence.

What still belongs here is **API conformance**, which genuinely spans both
projects and cannot be reduced to a declaration — recorded frontend mocks
validated against the backend's live OpenAPI schema. That needs endpoints, so it
lands in Milestone 4.

The *wire format* half of the contract is enforced elsewhere again: the
`Shared model` CI job checks that the committed bindings still match the two
shared sources they were generated from.
