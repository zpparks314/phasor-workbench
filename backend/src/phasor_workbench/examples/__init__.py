"""Built-in example circuits.

Each example is one `.qasm` file in this directory, and **adding one is adding a
file**. There is no manifest to update alongside it: a separate index is a second
place to edit and the first place to drift, and an example that exists but is
unlisted is exactly the failure it would produce. The name and summary live in
comment lines at the top of the source, which OpenQASM ignores, so the file
stays a valid program that a person can read on its own.

**Examples are loaded through the importer, not hand-written as documents.**
That is `Roadmap.md`'s exit criterion rather than a convenience: a circuit
authored as a Circuit Model document proves nothing about the import path, while
one authored as OpenQASM and parsed by the same endpoint a user's file goes
through is evidence that path works. It also means an example cannot rely on
anything the importer would refuse from anyone else.

**What is here is bounded by what the model can honestly say.** Teleportation is
the notable absence, and it is deliberate: the corrections at the end are
conditioned on the two measurement outcomes, and ADR-0003 defers classical
control, so the closest expressible circuit applies them unconditionally. That is
not teleportation -- it is a circuit that looks like the diagram and does
something else, which is the worst thing an example meant to teach can be. It
returns when classical control does.

This module is a *static* catalogue. `docs/decisions/ADR0009_CircuitCatalogue.md`
records why the entry shape leaves room for generated circuits -- a QAOA layer
count, a VQE ansatz width -- and why a circuit-to-circuit transform such as
randomized compiling is a different seam rather than a generator with an extra
argument.
"""

from __future__ import annotations

from dataclasses import dataclass
from importlib import resources
from typing import Any, Final

from ..importers.qasm import parse_qasm

#: Comment keys every example must declare, checked by the suite rather than
#: assumed, so a new file cannot arrive without them.
REQUIRED_FIELDS: Final[tuple[str, ...]] = ("name", "summary")

_PREFIX: Final[str] = "//"


@dataclass(frozen=True, slots=True)
class Example:
    """One catalogue entry, before its circuit is parsed.

    The source is carried rather than a `Circuit` because parsing is the
    interesting step, and because it keeps this module out of the business of
    deciding whether a document is acceptable. `document()` stops at the
    parser; loading and validating it is `api.documents.read_circuit`'s job,
    which is the same call a user's uploaded file goes through. Doing it here
    as well would be a second opinion about what a valid circuit is.
    """

    id: str
    name: str
    summary: str
    source: str

    def document(self) -> dict[str, Any]:
        """The parser's document, ready for `read_circuit`.

        Raises if an example stops parsing. That is not a user-facing failure
        and should never reach a request: it means this build can no longer
        read a file it ships, which the suite asserts against for every
        example.
        """
        result = parse_qasm(self.source)
        if result.problems:
            raise ValueError(f"Example '{self.id}' no longer parses: {result.problems}")

        return result.document


def read_fields(source: str) -> dict[str, str]:
    """The `// key: value` lines before the first statement.

    Stops at the first line that is not a comment, so a comment further down --
    and every example has several, explaining the circuit -- is prose rather
    than metadata.
    """
    fields: dict[str, str] = {}

    for line in source.splitlines():
        stripped = line.strip()
        if not stripped.startswith(_PREFIX):
            break

        key, separator, value = stripped[len(_PREFIX) :].partition(":")
        if separator:
            fields[key.strip().lower()] = value.strip()

    return fields


def catalogue() -> tuple[Example, ...]:
    """Every built-in example, ordered by id so the list is stable.

    Stable order matters more than it looks: this is what a user sees in a
    picker, and a set that reshuffles between requests is a list nobody can
    learn the shape of.
    """
    found: list[Example] = []

    for entry in resources.files(__name__).iterdir():
        if not entry.name.endswith(".qasm"):
            continue

        source = entry.read_text(encoding="utf-8")
        fields = read_fields(source)
        identifier = entry.name.removesuffix(".qasm").replace("_", "-")

        found.append(
            Example(
                id=identifier,
                name=fields.get("name", identifier),
                summary=fields.get("summary", ""),
                source=source,
            )
        )

    return tuple(sorted(found, key=lambda example: example.id))


def find(identifier: str) -> Example | None:
    """One example by id, or None. The route turns None into a 404."""
    return next((example for example in catalogue() if example.id == identifier), None)
