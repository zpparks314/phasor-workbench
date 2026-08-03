"""Evaluating OpenQASM parameter expressions to a number.

`rx(pi/2) q[0];` is overwhelmingly how rotations are written, so a parser that
only accepted literals would refuse most real files. This is the smallest
evaluator that handles what OpenQASM 2.0 allows in a gate parameter: numbers,
`pi`, the four operators, `^`, unary minus, parentheses, and the unary functions
the grammar names.

**Evaluated here rather than stored.** The model holds a finite number per
parameter -- `PARAMETER_NOT_FINITE` exists because that is the contract -- so
`pi/2` becomes `1.5707963267948966` at import. The expression itself is not
preserved, which means an exported circuit says `1.5707963267948966` rather than
`pi/2`. That is a real loss of intent and it is recorded in docs/CircuitModel.md
rather than hidden here; keeping it would mean the model carrying an expression
type, which is a change to ADR-0001 and not one an importer gets to make.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Mapping
from typing import Final

from .errors import QasmError, QasmErrorCode, QasmProblem
from .tokens import Token, TokenKind

FUNCTIONS: Final[Mapping[str, Callable[[float], float]]] = {
    "sin": math.sin,
    "cos": math.cos,
    "tan": math.tan,
    "exp": math.exp,
    "ln": math.log,
    "sqrt": math.sqrt,
}


class ExpressionReader:
    """Precedence-climbing over a token list the caller owns.

    Takes and returns the caller's cursor rather than holding its own, so the
    statement parser stays the single authority on position -- two cursors over
    one token list is how a parser starts disagreeing with itself.
    """

    def __init__(self, tokens: list[Token], index: int) -> None:
        self.tokens = tokens
        self.index = index

    @property
    def current(self) -> Token:
        return self.tokens[self.index]

    def fail(self, message: str) -> QasmError:
        return QasmError(
            QasmProblem(
                code=QasmErrorCode.QASM_SYNTAX_ERROR,
                message=message,
                line=self.current.line,
                column=self.current.column,
            )
        )

    def read(self, minimum_precedence: int = 0) -> float:
        value = self.read_unary()

        while True:
            token = self.current
            if token.kind is not TokenKind.SYMBOL:
                break

            precedence = {"+": 1, "-": 1, "*": 2, "/": 2, "^": 3}.get(token.text)
            if precedence is None or precedence < minimum_precedence:
                break

            self.index += 1
            # `^` is right-associative, the others left. Climbing at the same
            # precedence for `^` is what makes 2^3^2 evaluate as 2^(3^2).
            right = self.read(precedence if token.text == "^" else precedence + 1)
            value = self.apply(token, value, right)

        return value

    def apply(self, token: Token, left: float, right: float) -> float:
        if token.text == "/" and right == 0:
            raise self.fail("Division by zero in a parameter expression.")

        operations: Mapping[str, Callable[[float, float], float]] = {
            "+": lambda a, b: a + b,
            "-": lambda a, b: a - b,
            "*": lambda a, b: a * b,
            "/": lambda a, b: a / b,
            "^": lambda a, b: a**b,
        }

        try:
            return operations[token.text](left, right)
        except (OverflowError, ValueError) as error:
            raise self.fail(
                f"Parameter expression is not computable: {error}."
            ) from error

    def read_unary(self) -> float:
        token = self.current

        if token.kind is TokenKind.SYMBOL and token.text in {"-", "+"}:
            self.index += 1
            value = self.read_unary()
            return -value if token.text == "-" else value

        return self.read_atom()

    def read_atom(self) -> float:
        token = self.current

        if token.kind is TokenKind.SYMBOL and token.text == "(":
            self.index += 1
            value = self.read()
            if not (self.current.kind is TokenKind.SYMBOL and self.current.text == ")"):
                raise self.fail("Expected ')' to close a parameter expression.")
            self.index += 1
            return value

        if token.kind is TokenKind.KEYWORD and token.text == "pi":
            self.index += 1
            return math.pi

        if token.kind in {TokenKind.INTEGER, TokenKind.REAL}:
            self.index += 1
            return float(token.text)

        if token.kind is TokenKind.IDENTIFIER and token.text in FUNCTIONS:
            function = FUNCTIONS[token.text]
            self.index += 1
            if not (self.current.kind is TokenKind.SYMBOL and self.current.text == "("):
                raise self.fail(f"Expected '(' after {token.text}.")
            self.index += 1
            argument = self.read()
            if not (self.current.kind is TokenKind.SYMBOL and self.current.text == ")"):
                raise self.fail(f"Expected ')' to close {token.text}.")
            self.index += 1
            try:
                return function(argument)
            except (OverflowError, ValueError) as error:
                raise self.fail(f"{token.text} is undefined here: {error}.") from error

        raise self.fail(f"Expected a number in a parameter, got {token.text!r}.")
