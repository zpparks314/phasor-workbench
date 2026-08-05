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

import { ApiError } from '../api/client';
import { exportQasm, importQasm } from '../api/qasm';
import type { Circuit } from '../model/circuit';
import { dumpCircuit, loadCircuit } from '../serialization';
import type { Violation } from '../validation/violations';

/** What a circuit file is called and contains, with no DOM involved. */
export interface CircuitFile {
  readonly filename: string;
  readonly text: string;
  readonly type: string;
}

/**
 * What reading a circuit document can produce.
 *
 * Narrower than `ImportOutcome` on purpose: a document is read in this process,
 * so "nothing answered" is not among its possible endings. Typing it that way
 * means a caller of `readCircuitFile` never has to rule out a case that cannot
 * happen.
 */
export type DocumentOutcome =
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

export type ImportOutcome =
  | DocumentOutcome
  /**
   * The file may be perfectly good; nothing could read it. Only OpenQASM
   * reaches this, since JSON is read locally -- and it is a separate outcome
   * because telling someone their file is wrong when the backend is merely
   * down would send them off to fix nothing.
   */
  | {
      readonly ok: false;
      readonly reason: 'unreachable';
      readonly message: string;
    };

/**
 * What writing a circuit out can produce.
 *
 * Only OpenQASM can fail: JSON is written in this process. There are no
 * violations here because a circuit on the canvas is already valid -- the
 * failure is always the backend, never the document.
 */
export type ExportOutcome =
  { readonly ok: true } | { readonly ok: false; readonly message: string };

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
export function readCircuitFile(text: string): DocumentOutcome {
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

/** Hand a circuit to the browser as a JSON download. */
export function downloadCircuit(
  circuit: Circuit,
  target: Document = globalThis.document,
): void {
  downloadFile(circuitFile(circuit), target);
}

/**
 * Hand a circuit to the browser as an OpenQASM file.
 *
 * Asynchronous where `downloadCircuit` is not, because the writer lives on the
 * backend: a Circuit Model document *is* JSON, so the frontend can write one
 * itself, and OpenQASM is a foreign grammar that `Architecture.md` puts on the
 * other side of the API. That makes this the only export that can fail without
 * the circuit being at fault, so it returns an outcome rather than throwing --
 * the same shape `importCircuitFile` returns, for the same reason.
 */
export async function downloadQasm(
  circuit: Circuit,
  target: Document = globalThis.document,
): Promise<ExportOutcome> {
  let source: string;

  try {
    source = await exportQasm(circuit);
  } catch (error) {
    /**
     * A valid circuit always has an OpenQASM form, so a failure here is the
     * backend rather than the document -- and the message says so instead of
     * implying the user's circuit cannot be written.
     */
    return {
      ok: false,
      message:
        error instanceof ApiError && error.code === 'BACKEND_UNAVAILABLE'
          ? 'Writing OpenQASM needs the backend, and it could not be reached.'
          : 'OpenQASM export failed unexpectedly.',
    };
  }

  downloadFile(
    {
      filename: `${slugify(circuit.name)}.qasm`,
      text: source,
      type: 'text/plain',
    },
    target,
  );

  return { ok: true };
}

/**
 * The click-a-link download, shared by every format.
 *
 * Exported because not everything handed to the browser starts as a `Circuit`:
 * the recovery screen downloads the stored document as raw text, precisely
 * because it may be one this build cannot turn into a circuit at all.
 *
 * The object URL is revoked on a later task rather than immediately after the
 * click: some browsers have not finished reading the blob when `click` returns,
 * and revoking under them cancels the download.
 */
export function downloadFile(
  file: CircuitFile,
  target: Document = globalThis.document,
): void {
  const url = URL.createObjectURL(new Blob([file.text], { type: file.type }));

  const anchor = target.createElement('a');
  anchor.href = url;
  anchor.download = file.filename;
  anchor.click();

  globalThis.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

/**
 * Does this text look like OpenQASM rather than a circuit document?
 *
 * **The content decides, not the extension.** A file's name is whatever the
 * user or their last tool called it, and a `.txt` full of OpenQASM is still
 * OpenQASM; routing on the extension would refuse it with a JSON parse error
 * that says nothing useful. The grammar requires `OPENQASM` as the first
 * statement, so the first non-comment, non-blank line is enough to tell.
 */
export function looksLikeQasm(text: string): boolean {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('//')) continue;
    return trimmed.startsWith('OPENQASM');
  }

  return false;
}

/**
 * Read a circuit from a file the user chose, in whichever format it is.
 *
 * One entry point for both formats, because the caller's question is "give me
 * the circuit in this file" and which grammar it happens to use is this
 * module's problem. JSON is read here; OpenQASM goes to the backend, which is
 * where `Architecture.md` puts format conversion and where the parser lives.
 */
export async function importCircuitFile(file: File): Promise<ImportOutcome> {
  const text = await file.text();

  return looksLikeQasm(text) ? importQasmText(text) : readCircuitFile(text);
}

async function importQasmText(source: string): Promise<ImportOutcome> {
  try {
    return { ok: true, circuit: await importQasm(source), warnings: [] };
  } catch (error) {
    if (!(error instanceof ApiError)) {
      return {
        ok: false,
        reason: 'unreachable',
        message: 'OpenQASM import failed unexpectedly.',
      };
    }

    /**
     * `isUserFacing` is deliberately not consulted.
     *
     * It answers "is the user's *circuit* at fault", which is the right
     * question for the analysis and simulation endpoints and the wrong one
     * here: import returns `REQUEST_MALFORMED` when the user's *file* cannot be
     * read, and that is as user-facing as a failure gets. docs/API.md records
     * the same distinction for the status codes.
     */
    if (error.code === 'BACKEND_UNAVAILABLE') {
      /**
       * Worded here rather than passed through, because the client's generic
       * "Could not reach the backend" leaves out the only part the user does
       * not already know: that opening a *file* involved a backend at all.
       * JSON never does, so this is genuinely surprising the first time.
       */
      return {
        ok: false,
        reason: 'unreachable',
        message:
          'OpenQASM is read by the backend, and it could not be reached. ' +
          'The file itself may be fine.',
      };
    }

    return {
      ok: false,
      reason: 'unreadable',
      // The backend already reported every problem it found, each with a line
      // and column in `path`. Re-deriving or summarising them here would be a
      // second vocabulary for facts the parser already stated precisely.
      violations: error.details.map((detail) => ({
        code: detail.code as Violation['code'],
        message:
          detail.path === undefined
            ? detail.message
            : `${detail.message} (${detail.path})`,
        path: '',
      })),
    };
  }
}
