"""Circuit Model types, generated from the two shared sources.

`circuit.py` comes from shared/schema/circuit.schema.json and `spec.py` from
shared/spec/circuit.spec.json. The backend does not own the Circuit Model --
neither side does. Regenerate with `python shared/generate_bindings.py`; CI
rejects a hand edit, and so does the next regeneration.

See docs/CircuitModel.md, ADR-0004, and ADR-0005.

`Operation` below is the one hand-written name in this package, and it exists
because the two generators disagree: json2ts emits the union as a named type,
while datamodel-code-generator inlines it into `Circuit.operations`, leaving
Python with the three branches and no name for their union. Every consumer that
accepts "an operation" needs that name. This is ADR-0004's stated escape hatch
-- bridge a generation gap in the consuming project rather than hand-edit
generated output. Nothing else belongs here.
"""

from typing import TypeAlias

from .circuit import BarrierOperation, GateOperation, MeasurementOperation

Operation: TypeAlias = GateOperation | MeasurementOperation | BarrierOperation
