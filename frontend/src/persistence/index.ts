/**
 * Local persistence: the `localStorage` adapter.
 *
 * The only module permitted to touch browser storage, on the same principle that
 * confines `fetch` to `api/`. It stores one document — the working set — and
 * knows nothing about circuits beyond handing them to `../serialization/`. Files
 * are the interchange format and arrive with Milestone 5's import/export.
 *
 * **A stored document is not trusted.** It was written by *some* build: possibly
 * older, possibly a partial write, possibly hand-edited through devtools. So it
 * goes through the loader like any other foreign document, which is the whole
 * reason ADR-0008 gave the frontend a shape validator.
 *
 * **Every failure is returned, never thrown past the caller and never swallowed.**
 * ADR-0008 section 5 lists the four behaviours this has to survive:
 *
 * - reading `window.localStorage` can *itself* throw under private browsing, so
 *   availability is a `try`, not a truthiness check
 * - quota is reported by throwing, and it is the likeliest real failure
 * - clearing site data destroys the working set silently, which nothing here can
 *   prevent and which is why this is not a backup
 * - none of it removes the need for the loader
 *
 * Storage being unavailable is not an editor error. The editor stays fully usable
 * without it, exactly as `Architecture.md` requires of a missing backend.
 */

import type { Circuit } from '../model/circuit';
import { dumpCircuit, loadCircuit } from '../serialization';
import type { Violation } from '../validation/violations';

/** One key: this is the working set, not a circuit library. */
export const STORAGE_KEY = 'phasor-workbench.circuit';

export type SaveOutcome =
  | { readonly ok: true; readonly savedAt: Date }
  | { readonly ok: false; readonly reason: StorageFailure };

export type LoadOutcome =
  | {
      readonly ok: true;
      readonly circuit: Circuit;
      readonly warnings: readonly Violation[];
    }
  /** Nothing stored yet. Not a failure — the common first-run case. */
  | { readonly ok: false; readonly reason: 'empty' }
  | { readonly ok: false; readonly reason: StorageFailure }
  | {
      readonly ok: false;
      readonly reason: 'unreadable';
      readonly violations: readonly Violation[];
    };

export type StorageFailure = 'unavailable' | 'full';

export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * The browser's store, or null when it cannot be reached.
 *
 * Wrapped in a `try` because the *access* throws in some private-browsing
 * configurations, before any read or write is attempted. A truthiness check on
 * `window.localStorage` is the intuitive version and it throws.
 */
export function browserStorage(): StorageAdapter | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/** Save the circuit as the working set, replacing whatever was there. */
export function saveCircuit(
  circuit: Circuit,
  storage: StorageAdapter | null = browserStorage(),
): SaveOutcome {
  if (storage === null) return { ok: false, reason: 'unavailable' };

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(dumpCircuit(circuit)));
    return { ok: true, savedAt: new Date() };
  } catch (error) {
    // Quota is the failure worth distinguishing: the user can act on it by
    // making the circuit smaller, and cannot act on anything else here.
    return { ok: false, reason: isQuotaError(error) ? 'full' : 'unavailable' };
  }
}

/**
 * Restore the working set.
 *
 * Returns the loader's warnings rather than hiding them — a document written by
 * a newer build loads with `SCHEMA_VERSION_NEWER_MINOR`, and the editor has to
 * say so before the first edit discards what it could not understand.
 */
export function loadStoredCircuit(
  storage: StorageAdapter | null = browserStorage(),
): LoadOutcome {
  if (storage === null) return { ok: false, reason: 'unavailable' };

  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return { ok: false, reason: 'unavailable' };
  }

  if (raw === null || raw === '') return { ok: false, reason: 'empty' };

  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch {
    // Malformed JSON is a partial write or a hand edit, not a circuit problem,
    // but it reaches the user the same way: as something that cannot be read.
    return {
      ok: false,
      reason: 'unreadable',
      violations: [
        {
          code: 'SHAPE_INVALID',
          message: 'The stored circuit is not valid JSON.',
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

/** Forget the working set. Used when a stored document cannot be read. */
export function clearStoredCircuit(
  storage: StorageAdapter | null = browserStorage(),
): void {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do and nothing to tell the user: they asked to discard it, and
    // it is already unreachable.
  }
}

/**
 * Did this write fail because the store is full?
 *
 * The name and the legacy code are both checked because browsers disagree, and
 * `code` is gone in newer Firefox while the name is absent in older Safari.
 */
function isQuotaError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === 'QuotaExceededError' ||
    error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    (error as { code?: number }).code === 22
  );
}
