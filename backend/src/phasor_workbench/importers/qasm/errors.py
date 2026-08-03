"""What can go wrong reading OpenQASM, and where.

**These codes are not circuit violations and deliberately do not live in
`circuit.spec.json`.** That file's `violations` describe a *Circuit Model
document*, and they are shared with the frontend because both languages
implement the same validation. Nothing here describes a circuit -- these
describe QASM *source text*, which only the backend ever reads. Putting them in
the shared spec would claim a symmetry that does not exist and would oblige the
frontend to generate constants it can never raise.

The one exception is deliberate: an unsupported gate reports the spec's own
`UNKNOWN_GATE_NAME`, because that is genuinely the same fact the model already
has a code for, and `Roadmap.md` recorded it as the answer before this parser
existed.

**Syntax errors stop at the first one; semantic problems are collected.** A
parser that has lost track of where it is in the token stream cannot honestly
report a second error -- everything after the first is a guess. Once the program
has parsed, unknown gates and bad register references are independent facts, and
reporting them one round trip at a time would be the behaviour `api/documents.py`
already refuses to inflict.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class QasmErrorCode(StrEnum):
    """Failures that describe the source text rather than the circuit."""

    QASM_SYNTAX_ERROR = "QASM_SYNTAX_ERROR"
    QASM_VERSION_UNSUPPORTED = "QASM_VERSION_UNSUPPORTED"
    QASM_UNSUPPORTED_STATEMENT = "QASM_UNSUPPORTED_STATEMENT"
    QASM_UNKNOWN_REGISTER = "QASM_UNKNOWN_REGISTER"
    QASM_INDEX_OUT_OF_RANGE = "QASM_INDEX_OUT_OF_RANGE"
    QASM_BROADCAST_MISMATCH = "QASM_BROADCAST_MISMATCH"
    QASM_ARGUMENT_COUNT = "QASM_ARGUMENT_COUNT"
    QASM_PARAMETER_COUNT = "QASM_PARAMETER_COUNT"
    QASM_DUPLICATE_REGISTER = "QASM_DUPLICATE_REGISTER"


@dataclass(frozen=True, slots=True)
class QasmProblem:
    """One reason a source file could not be imported.

    `line` and `column` are 1-based, because every editor that will show them
    counts that way.
    """

    code: str
    message: str
    line: int
    column: int

    @property
    def location(self) -> str:
        """The `path` an API error detail carries for a QASM import.

        A JSON pointer is meaningless here -- there is no document to point
        into -- so the location is stated in the terms the source has. Recorded
        in docs/API.md so a client is not left guessing at the shape.
        """
        return f"line {self.line}, column {self.column}"


class QasmError(Exception):
    """A syntax error, which stops parsing where it is."""

    def __init__(self, problem: QasmProblem) -> None:
        super().__init__(problem.message)
        self.problem = problem
