"""Turning OpenQASM 2.0 source into tokens.

Hand-written rather than regex-driven at the top level, because the one thing a
tokenizer owes the layer above it is an accurate position for every token, and
a single scanning loop is where that is cheapest to keep right.

Comments are `//` to end of line. OpenQASM 2.0 specifies no block comment, and
accepting `/* */` here would mean accepting files this parser cannot claim to
read -- the grammar it is written against is the one in the 2.0 paper.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum, auto

from .errors import QasmError, QasmErrorCode, QasmProblem

KEYWORDS = frozenset(
    {
        "OPENQASM",
        "include",
        "qreg",
        "creg",
        "gate",
        "opaque",
        "barrier",
        "measure",
        "reset",
        "if",
        "pi",
    }
)

#: Longest first, so `->` is never read as `-` followed by `>`.
SYMBOLS = (
    "->",
    "==",
    ";",
    ",",
    "(",
    ")",
    "[",
    "]",
    "{",
    "}",
    "+",
    "-",
    "*",
    "/",
    "^",
)


class TokenKind(StrEnum):
    IDENTIFIER = auto()
    INTEGER = auto()
    REAL = auto()
    STRING = auto()
    KEYWORD = auto()
    SYMBOL = auto()
    EOF = auto()


@dataclass(frozen=True, slots=True)
class Token:
    kind: TokenKind
    text: str
    line: int
    column: int


def tokenize(source: str) -> list[Token]:
    """Scan a whole program, or raise on the first character that cannot start one."""
    tokens: list[Token] = []
    index = 0
    line = 1
    column = 1
    length = len(source)

    def fail(message: str) -> QasmError:
        return QasmError(
            QasmProblem(
                code=QasmErrorCode.QASM_SYNTAX_ERROR,
                message=message,
                line=line,
                column=column,
            )
        )

    while index < length:
        character = source[index]

        if character == "\n":
            index += 1
            line += 1
            column = 1
            continue

        if character.isspace():
            index += 1
            column += 1
            continue

        if source.startswith("//", index):
            end = source.find("\n", index)
            advance = (length if end == -1 else end) - index
            index += advance
            column += advance
            continue

        if character == '"':
            end = source.find('"', index + 1)
            if end == -1:
                raise fail("Unterminated string.")
            text = source[index + 1 : end]
            tokens.append(Token(TokenKind.STRING, text, line, column))
            column += end - index + 1
            index = end + 1
            continue

        if character.isdigit() or (
            character == "." and index + 1 < length and source[index + 1].isdigit()
        ):
            end = index
            seen_dot = False
            seen_exponent = False
            while end < length:
                current = source[end]
                if current.isdigit():
                    end += 1
                elif current == "." and not seen_dot and not seen_exponent:
                    seen_dot = True
                    end += 1
                elif current in "eE" and not seen_exponent and end > index:
                    seen_exponent = True
                    end += 1
                    if end < length and source[end] in "+-":
                        end += 1
                else:
                    break
            text = source[index:end]
            kind = TokenKind.REAL if seen_dot or seen_exponent else TokenKind.INTEGER
            tokens.append(Token(kind, text, line, column))
            column += end - index
            index = end
            continue

        if character.isalpha() or character == "_":
            end = index
            while end < length and (source[end].isalnum() or source[end] == "_"):
                end += 1
            text = source[index:end]
            kind = TokenKind.KEYWORD if text in KEYWORDS else TokenKind.IDENTIFIER
            tokens.append(Token(kind, text, line, column))
            column += end - index
            index = end
            continue

        symbol = next((s for s in SYMBOLS if source.startswith(s, index)), None)
        if symbol is not None:
            tokens.append(Token(TokenKind.SYMBOL, symbol, line, column))
            index += len(symbol)
            column += len(symbol)
            continue

        raise fail(f"Unexpected character {character!r}.")

    tokens.append(Token(TokenKind.EOF, "", line, column))
    return tokens
