"""Mapping `qelib1.inc` gate names onto the model's gate set.

**Only the names need mapping. The argument order does not.** OpenQASM writes
controls before targets -- `cx control, target`, `ccx c1, c2, target` -- and
`GATE_SIGNATURES` already says how many of each a gate takes, so one rule
covers every gate: the first `controls` arguments are controls and the rest are
targets. That is the same discipline the editor uses for placement, where a
sequence is driven by the signature and never by the name, and it means a gate
added to `circuit.spec.json` needs no change here.

Two aliases, and both are exact rather than approximate:

* `id` is the model's `i`. A spelling difference.
* `u1(lambda)` is the model's `p(lambda)`. `u1` is `diag(1, exp(i*lambda))`,
  which is the phase gate; the names differ because OpenQASM 2 predates the
  naming the model follows.

**Everything else in `qelib1.inc` is refused rather than approximated.** `u3`,
`u2`, `ch`, `crz`, `cu1`, `cu3` and `cswap` have no representation in the model,
and decomposing them here would put a second, silent definition of each gate
inside an importer -- the circuit a user got back would not be the circuit they
handed over. They report `UNKNOWN_GATE_NAME`, which is the answer `Roadmap.md`
recorded before this parser existed.

That refusal has a cost worth stating plainly: **Qiskit's own OpenQASM 2 output
uses `u3` and `u2` heavily**, so files exported from Qiskit will often be
refused. That is the model being honest about what it can hold, not a parser
limitation, and it is the kind of gap the Roadmap expected this milestone to
expose.
"""

from __future__ import annotations

from collections.abc import Mapping
from types import MappingProxyType
from typing import Final

from ...models.circuit import GateName
from ...models.spec import GATE_SIGNATURES

#: QASM spellings that differ from the model's. See the module docstring.
ALIASES: Final[Mapping[str, str]] = MappingProxyType({"id": "i", "u1": "p"})

#: Checked against before constructing a `GateName`, which raises on an unknown
#: value. Derived from the generated signatures, so it cannot drift from them.
SUPPORTED: Final[frozenset[str]] = frozenset(gate.value for gate in GATE_SIGNATURES)


def model_gate(qasm_name: str) -> GateName | None:
    """The model's name for a QASM gate, or None when it has none."""
    name = ALIASES.get(qasm_name, qasm_name)

    return GateName(name) if name in SUPPORTED else None
