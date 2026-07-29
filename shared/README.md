# Shared

The Circuit Model, serialization format, and validation rules.

**Status:** structure only. No schema is defined yet — that is Milestone 2.

---

## Why This Directory Exists

Architecture.md places the Circuit Model at the center of the system, and
requires that neither the frontend nor the backend own it.

If the model lived in `frontend/`, the backend would be a second-class
consumer. If it lived in `backend/`, the frontend would be. It lives here so
neither owns it and both depend on it equally.

---

## The Cross-Language Problem

The frontend is TypeScript. The backend is Python. Both must agree exactly on
what a circuit is, including its validation rules and its version.

**Proposed approach: JSON Schema as the source of truth.**

```text
shared/
├── schema/       Canonical JSON Schema -- the source of truth
├── generated/    Types generated for each language; never hand-edited
└── fixtures/     Circuits used by both sides' test suites
```

A generation step produces TypeScript types and Pydantic models from the
schema. CI fails if generated output is stale.

Rationale:

* the two sides cannot drift, because neither is authored independently
* `schemaVersion` and the migration policy in
  [CircuitModel.md](../docs/CircuitModel.md) have one place to live
* validation rules are declared once
* a third consumer later — a CLI, another language — costs one generator

The alternative, hand-writing types in both languages with contract tests
enforcing parity, is simpler to set up and permits drift between test runs.

**This decision is not final.** It was proposed rather than confirmed, and
changing it while these directories are empty is nearly free. If you prefer
hand-written types with contract tests, say so before Milestone 2 begins.

---

## Fixtures

`fixtures/` holds circuits that both test suites consume:

* `valid/` — circuits that must parse and validate on both sides
* `invalid/` — circuits that must be rejected, each paired with the
  violation codes it should produce

Shared fixtures are what make "the frontend and backend agree" a testable
claim rather than an aspiration.

---

## Rules

* nothing here may import from `frontend/` or `backend/`
* generated files are never hand-edited
* a change to the schema requires a `schemaVersion` decision — see the
  versioning table in [CircuitModel.md](../docs/CircuitModel.md)
