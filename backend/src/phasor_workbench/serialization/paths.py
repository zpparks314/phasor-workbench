"""Translating a Pydantic error location into a place in the raw document.

Pydantic reports where a problem is as a `loc` tuple, and that tuple is **not** a
path into the document. For a discriminated union it names the branch it matched:
an illegal `controls` on a barrier reports

    ('operations', 1, 'barrier', 'controls')

where the document has no `barrier` key at all. Anything indexing the document
with a raw `loc` walks off the structure, and anything formatting one as a path
tells the client to look at a field it never sent.

Paths use the format in docs/API.md, matching `validation/paths.py`, so the
project has one vocabulary for locating a thing inside a circuit.
"""

from __future__ import annotations

from collections.abc import Sequence

Location = tuple[str | int, ...]


def to_path(location: Sequence[str | int]) -> str:
    """Render a document location as `operations[1].classicalTarget.bit`."""
    parts: list[str] = []

    for element in location:
        if isinstance(element, int):
            parts.append(f"[{element}]")
        elif parts:
            parts.append(f".{element}")
        else:
            parts.append(element)

    return "".join(parts)


def locate(document: object, loc: Sequence[str | int]) -> Location | None:
    """Resolve a Pydantic `loc` against a document, dropping union tags.

    Returns None when the location does not resolve, which happens for errors
    reported against a container rather than a member.
    """
    location: list[str | int] = []
    current = document

    for element in loc:
        if isinstance(current, dict):
            if element not in current:
                # A discriminated-union tag rather than a key. Skipping it is
                # correct because the tag is Pydantic's report of which branch it
                # matched, not part of the document.
                continue
            location.append(element)
            current = current[element]
        elif isinstance(current, list) and isinstance(element, int):
            if not 0 <= element < len(current):
                return None
            location.append(element)
            current = current[element]
        else:
            return None

    return tuple(location)


def pop_at(document: dict[str, object], location: Location) -> object:
    """Remove and return the value at `location`, which must name a dict key."""
    container = _descend(document, location[:-1])
    key = location[-1]

    if not isinstance(container, dict) or not isinstance(key, str):
        raise TypeError(f"{to_path(location)} does not name a field")

    return container.pop(key)


def set_at(document: dict[str, object], location: Location, value: object) -> None:
    """Put `value` back at `location`, creating missing dict parents."""
    container: object = document

    for element in location[:-1]:
        if isinstance(container, dict) and isinstance(element, str):
            container = container.setdefault(element, {})
        elif isinstance(container, list) and isinstance(element, int):
            container = container[element]
        else:
            raise TypeError(f"cannot reach {to_path(location)}")

    key = location[-1]
    if not isinstance(container, dict) or not isinstance(key, str):
        raise TypeError(f"{to_path(location)} does not name a field")

    container[key] = value


def _descend(document: dict[str, object], location: Sequence[str | int]) -> object:
    current: object = document

    for element in location:
        current = _child(current, element, location)

    return current


def _child(
    container: object, element: str | int, location: Sequence[str | int]
) -> object:
    """One step into a container, keyed or indexed according to what it is."""
    if isinstance(container, dict) and isinstance(element, str):
        return container[element]

    if isinstance(container, list) and isinstance(element, int):
        return container[element]

    raise TypeError(f"cannot reach {to_path(location)}")
