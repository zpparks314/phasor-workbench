/**
 * Reading the declared version and deciding what it implies.
 *
 * Mirrors `backend/src/phasor_workbench/serialization/version.py`, and the two
 * are held to the same fixtures in `shared/fixtures/version/`.
 *
 * ADR-0006 section 1: the declared version selects a *mode*; the content still
 * decides the outcome. Everything here happens before a validator sees the
 * document, which is why the schema never has to relax its strictness.
 */

import { SCHEMA_VERSION } from '../model/spec';
import { quote } from './paths';
import type { Violation } from '../validation/violations';

const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

export const VERSION_PATH = 'schemaVersion';

/** How strictly the document is read once its version is known. */
export type LoadMode =
  /** The schema applies as written. An unknown field is an error. */
  | 'strict'
  /** Unknown *fields* are stripped and preserved. Unknown content is not. */
  | 'tolerant';

export interface Version {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

/** Returns null rather than throwing: a bad version is expected input. */
export function parseVersion(text: unknown): Version | null {
  if (typeof text !== 'string') return null;

  const match = SEMVER.exec(text);
  if (match === null) return null;

  const [major, minor, patch] = match.slice(1, 4).map(Number);
  if (major === undefined || minor === undefined || patch === undefined) {
    return null;
  }
  return { major, minor, patch };
}

export function formatVersion(version: Version): string {
  return `${String(version.major)}.${String(version.minor)}.${String(version.patch)}`;
}

/** Negative, zero, or positive, ordered by major then minor then patch. */
export function compareVersions(a: Version, b: Version): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

const parsed = parseVersion(SCHEMA_VERSION);
if (parsed === null) {
  throw new Error(
    `The generated SCHEMA_VERSION is not a semantic version: ${SCHEMA_VERSION}`,
  );
}

/** The version this build reads and writes, from the generated spec. */
export const CURRENT: Version = parsed;

export interface VersionOutcome {
  /** Null when the document is refused outright. */
  readonly mode: LoadMode | null;
  /** The refusal, or the warning that accompanies a tolerant load. */
  readonly violations: readonly Violation[];
  readonly migrateFrom: Version | null;
}

/** Apply the loading table in docs/CircuitModel.md to a declared version. */
export function decide(
  declared: unknown,
  current: Version = CURRENT,
): VersionOutcome {
  const version = parseVersion(declared);

  if (version === null) {
    return {
      mode: null,
      migrateFrom: null,
      violations: [
        {
          code: 'SCHEMA_VERSION_MALFORMED',
          message:
            `schemaVersion must be a semantic version such as ` +
            `'${formatVersion(current)}'. Got ${quote(declared)}.`,
          path: VERSION_PATH,
        },
      ],
    };
  }

  if (version.major > current.major) {
    return {
      mode: null,
      migrateFrom: null,
      violations: [
        {
          code: 'SCHEMA_VERSION_UNSUPPORTED',
          message:
            `This circuit declares version ${formatVersion(version)}, and this ` +
            `build reads ${formatVersion(current)}. A major version change ` +
            `renames, removes, or redefines fields, so the document cannot be read.`,
          path: VERSION_PATH,
        },
      ],
    };
  }

  if (compareVersions(version, current) > 0) {
    // Same major, newer minor or patch. Load, but expect not to understand
    // everything -- and say so.
    return {
      mode: 'tolerant',
      migrateFrom: null,
      violations: [
        {
          code: 'SCHEMA_VERSION_NEWER_MINOR',
          message:
            `This circuit declares version ${formatVersion(version)} and this ` +
            `build reads ${formatVersion(current)}. Fields this build does not ` +
            `recognize are preserved but ignored.`,
          path: VERSION_PATH,
        },
      ],
    };
  }

  return {
    mode: 'strict',
    migrateFrom: compareVersions(version, current) < 0 ? version : null,
    violations: [],
  };
}
