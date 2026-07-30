"""Circuit validation.

Enforces the rules in docs/CircuitModel.md. Validation returns every
violation rather than the first, so a user fixing a circuit does not have to
do it one round-trip at a time.

Violation codes come from `..models.spec`, which is generated from
shared/spec/circuit.spec.json. Never hand-write a code string here: the
fixtures in shared/fixtures/invalid/ name those codes, and
frontend/src/validation/ must emit exactly the same ones.

Empty until Milestone 2.
"""
