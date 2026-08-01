/**
 * Bringing an older document forward, one version at a time.
 *
 * Mirrors `backend/src/phasor_workbench/serialization/migrations.py`.
 *
 * ADR-0006 section 8. A migration is registered under the version it upgrades
 * *from*, and is responsible for setting `schemaVersion` to whatever it produces.
 * The document therefore describes its own progress and the chain needs no
 * separate table of destinations.
 *
 * The registry ships **empty**: `0.1.0` is the only version that has ever
 * existed. Its shape is decided now and exercised by a synthetic migration in
 * the tests, because deciding it against zero real examples is easier than
 * retrofitting it around the first one.
 */

import type { Violation } from '../validation/violations';
import { quote } from './paths';
import {
  VERSION_PATH,
  compareVersions,
  formatVersion,
  parseVersion,
  type Version,
} from './version';

export type CircuitDocument = Record<string, unknown>;
export type Migration = (document: CircuitDocument) => CircuitDocument;

/** Keyed by the version each migration upgrades *from*. */
export type MigrationRegistry = ReadonlyMap<string, Migration>;

export const MIGRATIONS: MigrationRegistry = new Map();

export interface MigrationResult {
  readonly document: CircuitDocument;
  readonly violations: readonly Violation[];
}

/** Apply migrations until the document reaches `toVersion`. */
export function migrate(
  document: CircuitDocument,
  from: Version,
  to: Version,
  registry: MigrationRegistry = MIGRATIONS,
): MigrationResult {
  let current = from;
  let working = document;

  while (compareVersions(current, to) < 0) {
    const step = registry.get(formatVersion(current));

    if (step === undefined) {
      return {
        document: working,
        violations: [
          {
            code: 'SCHEMA_VERSION_UNSUPPORTED',
            message:
              `This circuit declares version ${formatVersion(current)} and this ` +
              `build reads ${formatVersion(to)}, with no migration registered ` +
              `from ${formatVersion(current)}.`,
            path: VERSION_PATH,
          },
        ],
      };
    }

    working = step(working);
    const reached = parseVersion(working[VERSION_PATH]);

    // A migration that does not advance the version would loop forever. It is a
    // bug in the migration rather than in the document, so it is reported as
    // one: loudly, and against the field that failed to move.
    if (reached === null || compareVersions(reached, current) <= 0) {
      return {
        document: working,
        violations: [
          {
            code: 'SCHEMA_VERSION_MALFORMED',
            message:
              `The migration from ${formatVersion(current)} left schemaVersion at ` +
              `${quote(working[VERSION_PATH])}. A migration ` +
              `must advance it.`,
            path: VERSION_PATH,
          },
        ],
      };
    }

    current = reached;
  }

  return { document: working, violations: [] };
}
