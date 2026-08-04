"""Reading an OpenQASM 2.0 program into a circuit document.

**This produces a document, not a `Circuit`.** The document then goes through
`load_circuit` and `validate_circuit` like any other untrusted input, which is
the point: an importer that built `Circuit` objects directly would be a second
way into the model, and the first thing to diverge would be whatever the loader
checks that the importer forgot. It also means a QASM file whose circuit is
illegal -- an operation after a measurement, say -- reports the model's own
violation code, from the real validator, rather than something this module
invented.

**Identifiers are minted here.** ADR-0002 makes them opaque, and the rule that
they are generated client-side is about the editor authoring circuits; a server
turning foreign text into a document has to name things, and nothing may parse
what it chose. They are readable rather than random because a failing test is
easier to read that way, and nothing depends on the form.

Recovery: a syntax error stops the parse, because a parser that has lost its
place cannot honestly report a second one. Everything semantic -- an unknown
gate, a register that was never declared, an index past the end -- is recorded
and the statement is skipped, so one pass reports every such problem. See
`errors.py`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ...models.spec import GATE_SIGNATURES, SCHEMA_VERSION, ViolationCode
from .errors import QasmError, QasmErrorCode, QasmProblem
from .expressions import ExpressionReader
from .gates import model_gate
from .tokens import Token, TokenKind, tokenize

SUPPORTED_VERSION = "2.0"

#: Statements the model has no representation for. Each is refused rather than
#: dropped: silently ignoring `if` or `reset` would return a circuit that does
#: something different from the file the user handed over.
UNSUPPORTED = {
    "gate": "Custom gate definitions",
    "opaque": "Opaque gate declarations",
    "if": "Classical conditionals",
    "reset": "Reset",
}


@dataclass(slots=True)
class Register:
    """A declared `qreg` or `creg`, and where it was declared."""

    name: str
    size: int
    line: int
    column: int


@dataclass(slots=True)
class Argument:
    """A gate argument: one qubit, or a whole register to broadcast over."""

    ids: list[str]
    whole_register: bool


@dataclass(slots=True)
class ParseResult:
    document: dict[str, Any]
    problems: list[QasmProblem] = field(default_factory=list)


class Parser:
    def __init__(self, source: str) -> None:
        self.tokens = tokenize(source)
        self.index = 0
        self.qubit_registers: dict[str, Register] = {}
        self.classical_registers: dict[str, Register] = {}
        self.qubit_ids: list[str] = []
        self.operations: list[dict[str, Any]] = []
        self.problems: list[QasmProblem] = []

    # -- token helpers ----------------------------------------------------

    @property
    def current(self) -> Token:
        return self.tokens[self.index]

    def at_symbol(self, text: str) -> bool:
        return self.current.kind is TokenKind.SYMBOL and self.current.text == text

    def take(self) -> Token:
        token = self.current
        self.index += 1
        return token

    def expect_symbol(self, text: str) -> Token:
        if not self.at_symbol(text):
            got = self.current.text or "end of file"
            raise self.syntax(f"Expected {text!r}, got {got!r}.")
        return self.take()

    def expect_identifier(self) -> Token:
        if self.current.kind is not TokenKind.IDENTIFIER:
            got = self.current.text or "end of file"
            raise self.syntax(f"Expected a name, got {got!r}.")
        return self.take()

    def expect_integer(self) -> Token:
        if self.current.kind is not TokenKind.INTEGER:
            raise self.syntax(f"Expected a whole number, got {self.current.text!r}.")
        return self.take()

    # -- problem reporting ------------------------------------------------

    def syntax(self, message: str) -> QasmError:
        return QasmError(
            QasmProblem(
                code=QasmErrorCode.QASM_SYNTAX_ERROR,
                message=message,
                line=self.current.line,
                column=self.current.column,
            )
        )

    def record(self, code: str, message: str, token: Token) -> None:
        self.problems.append(
            QasmProblem(
                code=code, message=message, line=token.line, column=token.column
            )
        )

    def skip_statement(self) -> None:
        """Resynchronise after a semantic problem.

        Past the next `;`, or past a balanced `{...}` block for the statements
        that have one. Without the block case, skipping a `gate` definition
        would stop inside its body and read the body as top-level statements.
        """
        depth = 0
        while self.current.kind is not TokenKind.EOF:
            token = self.take()
            if token.kind is not TokenKind.SYMBOL:
                continue
            if token.text == "{":
                depth += 1
            elif token.text == "}":
                depth -= 1
                if depth <= 0:
                    return
            elif token.text == ";" and depth == 0:
                return

    # -- program ----------------------------------------------------------

    def parse(self) -> ParseResult:
        self.parse_header()

        while self.current.kind is not TokenKind.EOF:
            self.parse_statement()

        document: dict[str, Any] = {
            "schemaVersion": SCHEMA_VERSION,
            "id": "circ_qasm_import",
            "qubits": [
                {"id": qubit_id, "index": index}
                for index, qubit_id in enumerate(self.qubit_ids)
            ],
            "classicalRegisters": [
                {"id": self.register_id(register), "size": register.size, "label": name}
                for name, register in self.classical_registers.items()
            ],
            "operations": self.operations,
        }

        return ParseResult(document=document, problems=self.problems)

    def parse_header(self) -> None:
        """`OPENQASM 2.0;`, which the grammar requires before anything else."""
        token = self.current
        if not (token.kind is TokenKind.KEYWORD and token.text == "OPENQASM"):
            raise self.syntax("A program must begin with 'OPENQASM 2.0;'.")
        self.take()

        version = self.take()
        if version.text != SUPPORTED_VERSION:
            raise QasmError(
                QasmProblem(
                    code=QasmErrorCode.QASM_VERSION_UNSUPPORTED,
                    message=(
                        f"This build reads OpenQASM {SUPPORTED_VERSION}, "
                        f"and this file declares {version.text}."
                    ),
                    line=version.line,
                    column=version.column,
                )
            )
        self.expect_symbol(";")

    def parse_statement(self) -> None:
        token = self.current

        if token.kind is TokenKind.KEYWORD:
            if token.text == "include":
                self.skip_statement()
                return
            if token.text in UNSUPPORTED:
                self.record(
                    QasmErrorCode.QASM_UNSUPPORTED_STATEMENT,
                    f"{UNSUPPORTED[token.text]} cannot be represented in the "
                    f"circuit model, so this file cannot be imported unchanged.",
                    token,
                )
                self.skip_statement()
                return
            if token.text in {"qreg", "creg"}:
                self.parse_declaration()
                return
            if token.text == "barrier":
                self.parse_barrier()
                return
            if token.text == "measure":
                self.parse_measure()
                return

        if token.kind is TokenKind.IDENTIFIER:
            self.parse_gate_application()
            return

        raise self.syntax(f"Unexpected {token.text or 'end of file'!r}.")

    # -- declarations -----------------------------------------------------

    def parse_declaration(self) -> None:
        keyword = self.take()
        name = self.expect_identifier()
        self.expect_symbol("[")
        size_token = self.expect_integer()
        self.expect_symbol("]")
        self.expect_symbol(";")

        size = int(size_token.text)
        if size <= 0:
            self.record(
                QasmErrorCode.QASM_SYNTAX_ERROR,
                f"Register {name.text!r} must have at least one bit.",
                size_token,
            )
            return

        registers = (
            self.qubit_registers if keyword.text == "qreg" else self.classical_registers
        )
        if name.text in registers:
            self.record(
                QasmErrorCode.QASM_DUPLICATE_REGISTER,
                f"Register {name.text!r} is declared more than once.",
                name,
            )
            return

        registers[name.text] = Register(name.text, size, name.line, name.column)

        if keyword.text == "qreg":
            # Flattened into one indexed wire list: the model has no register
            # grouping for qubits, so `qreg q[2]; qreg r[3];` becomes five
            # wires indexed 0-4. The register *names* survive in the qubit
            # identifiers, which nothing is allowed to parse -- so the grouping
            # is genuinely lost, and an export cannot reconstruct it. Stated in
            # docs/API.md rather than left for someone to discover.
            self.qubit_ids.extend(f"q_{name.text}_{offset}" for offset in range(size))

    def register_id(self, register: Register) -> str:
        return f"creg_{register.name}"

    # -- arguments --------------------------------------------------------

    def parse_argument(self, *, quantum: bool) -> Argument | None:
        """One `name` or `name[index]`, resolved to qubit identifiers."""
        name = self.expect_identifier()
        registers = self.qubit_registers if quantum else self.classical_registers
        register = registers.get(name.text)

        index_token: Token | None = None
        if self.at_symbol("["):
            self.take()
            index_token = self.expect_integer()
            self.expect_symbol("]")

        if register is None:
            self.record(
                QasmErrorCode.QASM_UNKNOWN_REGISTER,
                f"Register {name.text!r} was never declared.",
                name,
            )
            return None

        if index_token is None:
            ids = self.identifiers(register, quantum=quantum)
            return Argument(ids=ids, whole_register=True)

        offset = int(index_token.text)
        if offset >= register.size:
            self.record(
                QasmErrorCode.QASM_INDEX_OUT_OF_RANGE,
                f"{name.text}[{offset}] is out of range; "
                f"{name.text} has {register.size} bits.",
                index_token,
            )
            return None

        return Argument(
            ids=[self.identifiers(register, quantum=quantum)[offset]],
            whole_register=False,
        )

    def identifiers(self, register: Register, *, quantum: bool) -> list[str]:
        """Every slot in a register, as the thing an operation will reference.

        A quantum register yields qubit identifiers. A classical one yields bit
        *indices* as strings, because the model references a classical bit by
        register plus number rather than by a per-bit identifier. Sharing one
        `Argument` type across both is what lets a single broadcast rule serve
        `cx q, r;` and `measure q -> c;` alike.
        """
        if quantum:
            return [f"q_{register.name}_{offset}" for offset in range(register.size)]
        return [str(offset) for offset in range(register.size)]

    def broadcast(
        self, arguments: list[Argument], token: Token
    ) -> list[list[str]] | None:
        """OpenQASM's register broadcast: `h q;` is one application per qubit.

        Registers in one statement must agree on size; a single qubit beside a
        register is repeated across it. Returns one argument tuple per
        application, or None when the sizes cannot be reconciled.
        """
        sizes = {len(argument.ids) for argument in arguments if argument.whole_register}

        if len(sizes) > 1:
            self.record(
                QasmErrorCode.QASM_BROADCAST_MISMATCH,
                "Registers in one statement must be the same size, "
                f"and these have sizes {sorted(sizes)}.",
                token,
            )
            return None

        count = sizes.pop() if sizes else 1

        return [
            [
                argument.ids[step] if argument.whole_register else argument.ids[0]
                for argument in arguments
            ]
            for step in range(count)
        ]

    # -- statements -------------------------------------------------------

    def parse_gate_application(self) -> None:
        name = self.take()
        gate = model_gate(name.text)

        parameters: list[float] = []
        if self.at_symbol("("):
            self.take()
            if not self.at_symbol(")"):
                while True:
                    reader = ExpressionReader(self.tokens, self.index)
                    parameters.append(reader.read())
                    self.index = reader.index
                    if not self.at_symbol(","):
                        break
                    self.take()
            self.expect_symbol(")")

        arguments: list[Argument] = []
        resolved = True
        while True:
            argument = self.parse_argument(quantum=True)
            if argument is None:
                resolved = False
            else:
                arguments.append(argument)
            if not self.at_symbol(","):
                break
            self.take()
        self.expect_symbol(";")

        if gate is None:
            # The spec's code, not a literal: this is the same fact the model
            # already names, and AGENTS.md keeps codes coming from one place.
            self.record(
                ViolationCode.UNKNOWN_GATE_NAME,
                f"{name.text!r} is not a gate this build can represent.",
                name,
            )
            return

        if not resolved:
            return

        signature = GATE_SIGNATURES[gate]
        expected = signature.targets + signature.controls

        if len(arguments) != expected:
            self.record(
                QasmErrorCode.QASM_ARGUMENT_COUNT,
                f"{name.text} takes {expected} qubits, and got {len(arguments)}.",
                name,
            )
            return

        if len(parameters) != len(signature.parameters):
            self.record(
                QasmErrorCode.QASM_PARAMETER_COUNT,
                f"{name.text} takes {len(signature.parameters)} parameters, "
                f"and got {len(parameters)}.",
                name,
            )
            return

        applications = self.broadcast(arguments, name)
        if applications is None:
            return

        for qubits in applications:
            # Controls first, targets after -- OpenQASM's order, and the split
            # comes from the signature rather than the name. See gates.py.
            self.operations.append(
                {
                    "id": self.next_operation_id(),
                    "kind": "gate",
                    "name": gate.value,
                    "controls": qubits[: signature.controls],
                    "targets": qubits[signature.controls :],
                    "parameters": dict(
                        zip(signature.parameters, parameters, strict=True)
                    ),
                }
            )

    def parse_barrier(self) -> None:
        self.take()

        if self.at_symbol(";"):
            # A bare `barrier;` covers every qubit declared so far. The schema
            # states this is the importer's job precisely because the model has
            # no implicit all-qubits barrier -- see CircuitModel.md.
            self.take()
            if self.qubit_ids:
                self.operations.append(
                    {
                        "id": self.next_operation_id(),
                        "kind": "barrier",
                        "targets": list(self.qubit_ids),
                    }
                )
            return

        targets: list[str] = []
        while True:
            argument = self.parse_argument(quantum=True)
            if argument is not None:
                # A barrier takes the union of its arguments rather than
                # broadcasting: `barrier q;` is one barrier across q, not one
                # barrier per qubit.
                targets.extend(i for i in argument.ids if i not in targets)
            if not self.at_symbol(","):
                break
            self.take()
        self.expect_symbol(";")

        if targets:
            self.operations.append(
                {
                    "id": self.next_operation_id(),
                    "kind": "barrier",
                    "targets": targets,
                }
            )

    def parse_measure(self) -> None:
        keyword = self.take()
        source = self.parse_argument(quantum=True)
        self.expect_symbol("->")

        target_name = self.current
        target = self.parse_argument(quantum=False)
        self.expect_symbol(";")

        if source is None or target is None:
            return

        if len(source.ids) != len(target.ids):
            self.record(
                QasmErrorCode.QASM_BROADCAST_MISMATCH,
                f"A measurement writes {len(source.ids)} qubits into "
                f"{len(target.ids)} bits.",
                keyword,
            )
            return

        register = self.classical_registers[target_name.text]

        for qubit_id, bit in zip(source.ids, target.ids, strict=True):
            self.operations.append(
                {
                    "id": self.next_operation_id(),
                    "kind": "measurement",
                    "targets": [qubit_id],
                    "classicalTarget": {
                        "register": self.register_id(register),
                        "bit": int(bit),
                    },
                }
            )

    def next_operation_id(self) -> str:
        return f"op_{len(self.operations)}"


def parse_qasm(source: str) -> ParseResult:
    """Read a program, or raise `QasmError` on the first syntax error."""
    return Parser(source).parse()
