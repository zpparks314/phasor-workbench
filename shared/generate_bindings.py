"""Generate language bindings from the canonical schema.

Per ADR-0004, `shared/schema/` is the source of truth for the wire format and
bindings are generated into each consuming project. This script is the single
definition of how that generation happens, so a developer and CI run exactly
the same command.

Usage, from the repository root:

    python shared/generate_bindings.py            # regenerate in place
    python shared/generate_bindings.py --check    # fail if output is stale

`--check` is what CI runs. It reports stale output rather than silently
correcting it, and leaves the working tree exactly as it found it.

This script invokes each project's toolchain; it does not import from either,
which would violate the dependency rule in shared/README.md.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = ROOT / "shared" / "schema" / "circuit.schema.json"

PYTHON_OUTPUT = ROOT / "backend" / "src" / "phasor_workbench" / "models" / "circuit.py"
TYPESCRIPT_OUTPUT = ROOT / "frontend" / "src" / "model" / "circuit.ts"

# Every flag here is load-bearing; see ADR-0004 and the notes in the schema.
#   --collapse-root-models + unconstrained IdentifierRef  -> list[str], not
#       list[RootModel[str]], which is unhashable and breaks referential checks
#   --snake-case-field  -> satisfies ruff's N815 while aliases preserve the
#       camelCase wire format
#   --strict-nullable   -> a field with a default is `list[str] = []`, not
#       `list[str] | None = []`, so no consumer handles null
#   --formatters ruff-check ruff-format -> output matches the project's own
#       toolchain, so `ruff check` and `ruff format --check` both pass. Both
#       passes are needed: ruff-format does not sort imports (I001) and
#       ruff-check does not format.
PYTHON_ARGS = [
    "--input-file-type", "jsonschema",
    "--output-model-type", "pydantic_v2.BaseModel",
    "--target-python-version", "3.11",
    "--use-annotated",
    "--use-standard-collections",
    "--use-union-operator",
    "--collapse-root-models",
    "--snake-case-field",
    "--strict-nullable",
    "--use-schema-description",
    "--use-field-description",
    "--disable-timestamp",
    "--formatters", "ruff-check", "ruff-format",
]

TYPESCRIPT_ARGS = ["--additionalProperties", "false", "--bannerComment", ""]


_WINDOWS = sys.platform == "win32"


def _resolve(local: Path, name: str, install_hint: str) -> str:
    """Prefer the project-local executable, fall back to PATH.

    Local development runs out of backend/.venv and frontend/node_modules; CI
    installs into the runner's own environment and has neither, so a hardcoded
    project-local path would fail there.
    """
    if local.is_file():
        return str(local)
    found = shutil.which(name)
    if found is not None:
        return found
    sys.exit(f"{name} not found. Install it with: {install_hint}")


def _venv_bin(name: str) -> str:
    scripts = ROOT / "backend" / ".venv" / ("Scripts" if _WINDOWS else "bin")
    local = scripts / f"{name}{'.exe' if _WINDOWS else ''}"
    return _resolve(local, name, 'pip install -e "./backend[dev]"')


def _node_bin(name: str) -> str:
    local = ROOT / "frontend" / "node_modules" / ".bin" / f"{name}{'.cmd' if _WINDOWS else ''}"
    return _resolve(local, name, "npm ci --prefix frontend")


def _run(command: list[str]) -> None:
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        sys.exit(
            f"Generation failed:\n  {' '.join(command)}\n\n"
            f"{result.stdout}\n{result.stderr}"
        )


def _normalize_newlines(path: Path) -> None:
    """Force LF, which .gitattributes requires and the generators disagree on.

    datamodel-code-generator writes CRLF on Windows while json2ts writes LF.
    Left alone, the committed bytes would depend on which platform generated
    them, and --check would compare CRLF against LF and report stale forever.
    """
    content = path.read_bytes()
    normalized = content.replace(b"\r\n", b"\n")
    if normalized != content:
        path.write_bytes(normalized)


def generate_python(output: Path) -> None:
    _run([_venv_bin("datamodel-codegen"), "--input", str(SCHEMA),
          "--output", str(output), *PYTHON_ARGS])
    _normalize_newlines(output)


def generate_typescript(output: Path) -> None:
    _run([_node_bin("json2ts"), "--input", str(SCHEMA),
          "--output", str(output), *TYPESCRIPT_ARGS])
    # json2ts does not read the project's Prettier config, so `format:check`
    # would reject its output. Formatting here mirrors the Python side, which
    # generates through ruff for the same reason.
    _run([_node_bin("prettier"), "--write", "--log-level", "warn", str(output)])
    _normalize_newlines(output)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="fail if committed output differs from freshly generated output",
    )
    args = parser.parse_args()

    if not SCHEMA.is_file():
        sys.exit(f"Schema not found: {SCHEMA}")

    targets = [(generate_python, PYTHON_OUTPUT), (generate_typescript, TYPESCRIPT_OUTPUT)]

    if not args.check:
        for generate, output in targets:
            output.parent.mkdir(parents=True, exist_ok=True)
            generate(output)
            print(f"generated {output.relative_to(ROOT)}")
        return 0

    # Regenerate in place and restore, rather than generating into a temporary
    # directory. Both formatters resolve their configuration by walking up from
    # the file being written, so a candidate outside the project tree is
    # formatted differently and would always compare unequal.
    stale: list[Path] = []
    for generate, output in targets:
        original = output.read_bytes() if output.is_file() else None
        try:
            generate(output)
            if output.read_bytes() != original:
                stale.append(output)
        finally:
            if original is not None:
                output.write_bytes(original)
            elif output.is_file():
                output.unlink()

    if stale:
        listing = "\n".join(f"  {p.relative_to(ROOT)}" for p in stale)
        sys.exit(
            "Generated bindings are stale:\n"
            f"{listing}\n\n"
            "The schema and its regenerated output belong in the same commit.\n"
            "Run: python shared/generate_bindings.py"
        )

    print("generated bindings are up to date")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
