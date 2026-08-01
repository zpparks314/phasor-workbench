/**
 * Reading and writing circuit documents across versions.
 *
 * Mirrors `backend/src/phasor_workbench/serialization/`, and both are held to the
 * same 14 fixtures in `shared/fixtures/version/`. Each fixture declares its own
 * outcome, so the two implementations assert against one artifact and agreement
 * follows transitively -- no cross-language runner, per `tests/README.md`.
 *
 *     loadCircuit(document) -> LoadResult | LoadFailure
 *
 * This module exists because the frontend now reads circuits it did not build,
 * which is exactly the runtime shape validation ADR-0005 section 6 deferred and
 * ADR-0008 answered. The asymmetry ADR-0006 section 5 recorded ends here.
 *
 * **Writing takes a `LoadResult`, not a bare `Circuit`**, for anything that came
 * from `loadCircuit`. A caller that loads a newer-minor document, keeps the
 * circuit, and writes it back drops every field this build did not recognize.
 * `dumpCircuit` is the path for circuits this build authored, where there is
 * nothing to preserve -- and per ADR-0008 section 3, an *edited* circuit is one
 * of those.
 */

import type { Circuit } from '../model/circuit';
import { SCHEMA_VERSION } from '../model/spec';
import type { Violation } from '../validation/violations';
import { MIGRATIONS, migrate, type MigrationRegistry } from './migrations';
import { isRecord, setAt } from './paths';
import {
  asCircuit,
  stripUnknownFields,
  unknownContent,
  validateShape,
  type PreservedField,
} from './shape';
import { CURRENT, decide, type Version } from './version';

export type { PreservedField } from './shape';
export type { Version, LoadMode } from './version';
export { CURRENT, parseVersion, formatVersion } from './version';
export type { Migration, MigrationRegistry } from './migrations';

export interface LoadResult {
  readonly ok: true;
  readonly circuit: Circuit;
  /** Non-fatal, and worth surfacing. A newer minor version arrives here. */
  readonly warnings: readonly Violation[];
  /** Fields this build did not recognize. Writing without these loses data. */
  readonly preserved: readonly PreservedField[];
  readonly migratedFrom: Version | null;
}

export interface LoadFailure {
  readonly ok: false;
  /** Every reason the document could not be read, not just the first. */
  readonly violations: readonly Violation[];
}

/**
 * Read a circuit document, honouring the version it declares.
 *
 * The discriminated `ok` is what the Python side gets from two distinct types:
 * a single shape with an optional circuit would let a caller reach for
 * `.circuit` and find nothing.
 */
export function loadCircuit(
  document: unknown,
  options: {
    readonly current?: Version;
    readonly registry?: MigrationRegistry;
  } = {},
): LoadResult | LoadFailure {
  const current = options.current ?? CURRENT;
  const registry = options.registry ?? MIGRATIONS;

  if (!isRecord(document)) {
    return {
      ok: false,
      violations: [
        {
          code: 'SHAPE_INVALID',
          message: `A circuit document must be a JSON object, got ${kindOf(document)}.`,
          path: '',
        },
      ],
    };
  }

  const outcome = decide(document['schemaVersion'], current);
  if (outcome.mode === null) {
    return { ok: false, violations: outcome.violations };
  }

  let working: Record<string, unknown> = document;
  let migratedFrom: Version | null = null;

  if (outcome.migrateFrom !== null) {
    const step = migrate(working, outcome.migrateFrom, current, registry);
    if (step.violations.length > 0) {
      return { ok: false, violations: step.violations };
    }
    working = step.document;
    migratedFrom = outcome.migrateFrom;
  }

  let preserved: readonly PreservedField[] = [];

  if (outcome.mode === 'tolerant') {
    // Content first. An unknown gate or operation kind is not something
    // tolerance can absorb, and reporting it beats reporting the schema
    // failure it would otherwise cause.
    const content = unknownContent(working);
    if (content.length > 0) return { ok: false, violations: content };

    const stripped = stripUnknownFields(working);
    if (stripped.failures.length > 0) {
      return { ok: false, violations: stripped.failures };
    }
    working = stripped.document;
    preserved = stripped.preserved;
  }

  const violations = validateShape(working);
  if (violations.length > 0) return { ok: false, violations };

  return {
    ok: true,
    circuit: asCircuit(working),
    // A tolerant load carries SCHEMA_VERSION_NEWER_MINOR; a strict one carries
    // nothing. Either way the violations that reach here are advisory, since a
    // refusal returned above.
    warnings: outcome.violations,
    preserved,
    migratedFrom,
  };
}

/**
 * Serialize a circuit this build authored, in wire form.
 *
 * Declares this build's version, and carries no preserved fields because it does
 * not receive any. Per ADR-0008 section 3 this is also the path for an *edited*
 * circuit: editing moves the positions preserved fields are keyed to, so they
 * cannot be restored faithfully once the operation list has changed.
 */
export function dumpCircuit(circuit: Circuit): Record<string, unknown> {
  return { ...circuit, schemaVersion: SCHEMA_VERSION };
}

/**
 * Serialize a loaded circuit, restoring the fields this build ignored.
 *
 * The round-trip path: read a document, change nothing, write it back intact.
 * Only correct while the circuit is untouched, which is why `dumpCircuit` exists
 * beside it.
 */
export function dumpResult(result: LoadResult): Record<string, unknown> {
  const document = {
    ...(result.circuit as unknown as Record<string, unknown>),
  };
  for (const field of result.preserved) {
    setAt(document, field.location, field.value);
  }
  return document;
}

function kindOf(value: unknown): string {
  if (value === null) return 'null';
  return Array.isArray(value) ? 'array' : typeof value;
}
