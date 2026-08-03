"""OpenQASM 2.0 import.

The first time the Circuit Model meets a format it was not designed around, and
`Roadmap.md` calls it the real test of ADR-0001. Three questions it had to
answer, and what it answered:

* **A bare `barrier;`** expands to every qubit declared at that point. The
  schema already said an importer would do this, because the model has no
  implicit all-qubits barrier -- so the answer was recorded before the parser
  existed, and this confirms it.
* **A gate the spec does not have** reports `UNKNOWN_GATE_NAME`, the model's own
  code. Also recorded in advance, also confirmed. What was *not* anticipated is
  how much of `qelib1.inc` this refuses -- see `gates.py`.
* **A QASM register** maps onto `classicalRegisters` one-for-one, keeping its
  name as a label. Quantum registers do not survive: the model has one flat
  indexed wire list, so `qreg q[2]; qreg r[3];` becomes five wires and the
  grouping is gone.

**Parsing is hand-written and depends on nothing.** Qiskit can read OpenQASM,
but it lives in the optional `simulation` extra, so importing through it would
make a core feature unavailable on a default install -- and it would breach the
isolation that keeps the simulator backend swappable.

The parser produces a *document*, which then goes through `load_circuit` and
`validate_circuit` like any other untrusted input. A QASM file describing an
illegal circuit therefore fails with the model's own violation codes from the
real validator, rather than anything this package invented.
"""

from .errors import QasmError, QasmErrorCode, QasmProblem
from .gates import model_gate
from .parser import ParseResult, parse_qasm

__all__ = [
    "ParseResult",
    "QasmError",
    "QasmErrorCode",
    "QasmProblem",
    "model_gate",
    "parse_qasm",
]
