"""Circuit validation.

Enforces the rules in docs/CircuitModel.md. Validation returns every violation
rather than the first, so a user fixing a circuit does not have to do it one
round-trip at a time.

**Semantic rules only.** This module takes an already-parsed `Circuit`, so the
schema has already rejected anything structurally wrong; that failure is the
parse boundary's to report, as SHAPE_INVALID. The split keeps this signature a
true mirror of `frontend/src/validation/`, which has no parse step at all -- see
ADR-0005 section 6.

Rule modules follow the groups in docs/CircuitModel.md so the code reads against
the specification:

* `structure`   -- identifier uniqueness, qubit index integrity
* `references`  -- every named qubit, register, and bit resolves
* `operations`  -- arity, qubit reuse, parameters
* `measurement` -- nothing but a barrier follows a measured qubit

Violation codes come from `..models.spec`, generated from
shared/spec/circuit.spec.json. Never hand-write a code string: the fixtures in
shared/fixtures/ name those codes, and frontend/src/validation/ must emit
exactly the same ones.

Order between groups is not significant to callers -- `ValidationResult.codes()`
sorts -- but references are checked before the rules that depend on resolution,
so one mistake produces one violation instead of a cascade.
"""

from ..models.circuit import Circuit
from . import measurement, operations, references, structure
from .violations import ValidationResult, Violation

__all__ = ["ValidationResult", "Violation", "validate_circuit"]


def validate_circuit(circuit: Circuit) -> ValidationResult:
    """Check every semantic rule and report all violations found."""
    violations = (
        *structure.check(circuit),
        *references.check(circuit),
        *operations.check(circuit),
        *measurement.check(circuit),
    )
    return ValidationResult(violations)
