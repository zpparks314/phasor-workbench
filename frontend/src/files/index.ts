/**
 * Reading and writing circuit documents as files.
 *
 * The file adapter, and a sibling of `../persistence/` over the same
 * `../serialization/` core. `../persistence/` holds the working set in browser
 * storage; a file is how a circuit leaves this browser and comes back. That
 * split is [ADR-0008](../../../docs/decisions/ADR0008_LocalPersistence.md)'s,
 * which named files the interchange format arriving in Milestone 5.
 *
 * The browser storage API is deliberately not named anywhere in here, and not
 * only as prose: `../persistence/`'s suite scans every source file for it and
 * fails on any mention outside that module. The scan does not read comments
 * differently from code, which is the right trade for a guard that cannot be
 * argued with.
 *
 * **There is no second loader.** Import parses JSON and hands the result
 * straight to `loadCircuit`, exactly as `../persistence/` does with a stored
 * document. A file deserves *less* trust than a stored one — it may have been
 * written by another person's build, or by hand — and a laxer path here would
 * mean a document refused on refresh being accepted on import. The version
 * fixtures assert that the two paths agree.
 *
 * **Download and file input rather than the File System Access API.** Decided
 * 2026-08-02, the choice ADR-0008 deferred. File System Access is Chromium-only,
 * so it needs this path as a fallback regardless; building both to gain
 * overwrite-in-place is a trade for a later milestone, and it is additive when
 * it comes.
 *
 * **A newer-minor file loses its unrecognized fields on import.** `preserved` is
 * dropped here for the same reason `loadStoredCircuit` drops it: the store holds
 * a bare `Circuit`, and per ADR-0008 section 3 the first edit invalidates the
 * positional paths those fields are keyed to. The `SCHEMA_VERSION_NEWER_MINOR`
 * warning is what surfaces it, and it reaches the user before they edit.
 * ADR-0008's *Future Considerations* anticipated import making this common.
 *
 * The DOM-touching functions sit at the bottom, behind the pure ones — the same
 * split `../editor/` uses, so the logic is what the tests drive and the glue is
 * thin enough to read.
 */

import type { Circuit } from '../model/circuit';
import { dumpCircuit, loadCircuit } from '../serialization';
import type { Violation } from '../validation/violations';

/** What a circuit file is called and contains, with no DOM involved. */
export interface CircuitFile {
  readonly filename: string;
  readonly text: string;
  readonly type: string;
}

export type ImportOutcome =
  | {
      readonly ok: true;
      readonly circuit: Circuit;
      /** Non-fatal. A newer-minor document arrives here, per the note above. */
      readonly warnings: readonly Violation[];
    }
  | {
      readonly ok: false;
      readonly reason: 'unreadable';
      /** Every reason the file could not be read, not just the first. */
      readonly violations: readonly Violation[];
    };

const FALLBACK_NAME = 'circuit';

/**
 * Render a circuit as the file that would be written for it.
 *
 * Indented rather than minified, and newline-terminated, because the format is
 * for interchange: someone will open one in an editor or diff two of them, and
 * neither is served by a single line.
 */
export function circuitFile(circuit: Circuit): CircuitFile {
  return {
    filename: `${slugify(circuit.name)}.json`,
    text: `${JSON.stringify(dumpCircuit(circuit), null, 2)}\n`,
    type: 'application/json',
  };
}

/**
 * Read a circuit from a file's text.
 *
 * Mirrors `loadStoredCircuit`, including the treatment of malformed JSON: it is
 * a transport problem rather than a circuit problem, but it reaches the user the
 * same way, as something that could not be read.
 */
export function readCircuitFile(text: string): ImportOutcome {
  let document: unknown;

  try {
    document = JSON.parse(text);
  } catch {
    return {
      ok: false,
      reason: 'unreadable',
      violations: [
        {
          code: 'SHAPE_INVALID',
          message: 'The file is not valid JSON.',
          path: '',
        },
      ],
    };
  }

  const result = loadCircuit(document);
  if (!result.ok) {
    return { ok: false, reason: 'unreadable', violations: result.violations };
  }

  return { ok: true, circuit: result.circuit, warnings: result.warnings };
}

/**
 * A filename stem from the circuit's name, or `circuit` when there is nothing
 * usable.
 *
 * Conservative on purpose: the result crosses into a filesystem this code knows
 * nothing about, so it keeps ASCII letters, digits and hyphens and drops the
 * rest rather than trying to guess what each platform tolerates. A name that
 * survives none of that is not an error — it just falls back.
 */
function slugify(name: string | undefined): string {
  if (name === undefined) return FALLBACK_NAME;

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug === '' ? FALLBACK_NAME : slug;
}

/**
 * Hand a circuit to the browser as a download.
 *
 * The object URL is revoked on a later task rather than immediately after the
 * click: some browsers have not finished reading the blob when `click` returns,
 * and revoking under them cancels the download.
 */
export function downloadCircuit(
  circuit: Circuit,
  target: Document = globalThis.document,
): void {
  const file = circuitFile(circuit);
  const url = URL.createObjectURL(new Blob([file.text], { type: file.type }));

  const anchor = target.createElement('a');
  anchor.href = url;
  anchor.download = file.filename;
  anchor.click();

  globalThis.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

/** Read a circuit from a file the user chose. */
export async function importCircuitFile(file: File): Promise<ImportOutcome> {
  return readCircuitFile(await file.text());
}
