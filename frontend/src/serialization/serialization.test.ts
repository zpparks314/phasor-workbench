/**
 * The versioned loader, driven by the shared fixtures.
 *
 * The same 14 documents in `shared/fixtures/version/` that hold the Python
 * loader. Each declares its own outcome, the codes it expects, and the paths it
 * expects preserved, so both implementations assert against one artifact and
 * agreement follows transitively — there is no cross-language runner, and
 * `tests/README.md` explains why there should not be one.
 *
 * A failing fixture means an implementation is wrong or an ADR changed. Editing
 * the fixture to match new output defeats the only mechanism that detects
 * divergence between the two languages.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

import { describe, expect, it } from 'vitest';

import { loadCircuit, dumpCircuit, dumpResult, type LoadResult } from './index';
import { migrate, type MigrationRegistry } from './migrations';
import { readAt } from './paths';
import { CURRENT, decide, formatVersion, parseVersion } from './version';

const FIXTURES = join(process.cwd(), '..', 'shared', 'fixtures', 'version');

if (!existsSync(FIXTURES)) {
  throw new Error(
    `Shared fixtures not found at ${FIXTURES}. Run vitest from frontend/.`,
  );
}

interface VersionFixture {
  readonly description: string;
  readonly document: unknown;
  readonly outcome: 'loaded' | 'refused';
  readonly violations: readonly string[];
  readonly preserved?: readonly string[];
}

const NAMES = readdirSync(FIXTURES)
  .filter((name) => name.endsWith('.json'))
  .sort();

function read(name: string): VersionFixture {
  return JSON.parse(
    readFileSync(join(FIXTURES, name), 'utf8'),
  ) as VersionFixture;
}

/** Sorted codes, matching how the fixture declares them. */
function codesOf(result: ReturnType<typeof loadCircuit>): string[] {
  const violations = result.ok ? result.warnings : result.violations;
  return violations.map((violation) => violation.code).sort();
}

describe('the shared version fixtures', () => {
  it('exist', () => {
    expect(NAMES.length).toBeGreaterThan(0);
  });

  it.each(NAMES)('%s reaches its declared outcome', (name) => {
    const fixture = read(name);
    const result = loadCircuit(fixture.document);

    expect(result.ok, `${name}: got codes ${codesOf(result).join(', ')}`).toBe(
      fixture.outcome === 'loaded',
    );
    expect(codesOf(result)).toEqual([...fixture.violations].sort());
  });

  it.each(NAMES)('%s preserves exactly the fields it declares', (name) => {
    const fixture = read(name);
    const result = loadCircuit(fixture.document);

    if (!result.ok) {
      expect(fixture.preserved, `${name} was refused`).toBeUndefined();
      return;
    }

    expect(result.preserved.map((field) => field.path).sort()).toEqual(
      [...(fixture.preserved ?? [])].sort(),
    );
  });

  it.each(NAMES)('%s locates and explains every violation', (name) => {
    const result = loadCircuit(read(name).document);
    const violations = result.ok ? result.warnings : result.violations;

    for (const violation of violations) {
      expect(violation.message.length, violation.code).toBeGreaterThan(0);
      expect(violation.message.endsWith('.'), violation.message).toBe(true);
      expect(typeof violation.path).toBe('string');
    }
  });
});

/**
 * The round-trip guarantee ADR-0006 section 4 exists to protect: a document read
 * and written unchanged keeps every field this build did not understand.
 */
describe('round-tripping a newer-minor document', () => {
  const withPreserved = NAMES.filter(
    (name) => (read(name).preserved ?? []).length > 0,
  );

  it('has fixtures to exercise', () => {
    expect(withPreserved.length).toBeGreaterThan(0);
  });

  it.each(withPreserved)('%s survives dumpResult intact', (name) => {
    const fixture = read(name);
    const result = loadCircuit(fixture.document);
    if (!result.ok) throw new Error(`${name} did not load`);

    expect(dumpResult(result)).toEqual(fixture.document);
  });

  /**
   * ADR-0008 section 3. `dumpCircuit` is the path for a circuit this build
   * authored, and an edited one is such a circuit: the preserved fields are
   * keyed to positions the edit may have moved, so they are dropped rather than
   * grafted onto whatever now sits at that index.
   */
  it.each(withPreserved)(
    '%s loses its preserved fields via dumpCircuit',
    (name) => {
      const result = loadCircuit(read(name).document);
      if (!result.ok) throw new Error(`${name} did not load`);

      const dumped = dumpCircuit(result.circuit);

      expect(dumped['schemaVersion']).toBe(formatVersion(CURRENT));
      // Checked at the exact location rather than by top-level key: a preserved
      // `metadata.mood` sits under a `metadata` that is itself entirely legitimate.
      for (const field of result.preserved) {
        expect(readAt(dumped, field.location), field.path).toBeUndefined();
      }
    },
  );
});

/**
 * Paths, which the fixtures deliberately do not assert.
 *
 * ADR-0005 settled that `invalid/` fixtures compare codes only, and that paths
 * are asserted in each project's own unit tests — a format difference is a local
 * bug rather than a contract break. These are the frontend's half, and they exist
 * because diffing the two loaders directly found a real divergence: Ajv reports
 * an `additionalProperties` error against the *containing* object, so an unknown
 * field at the current version was being blamed on the whole document.
 */
describe('locating a violation', () => {
  it('names the unknown field itself, not the object holding it', () => {
    const result = loadCircuit(
      read('unknown_field_at_current_version.json').document,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.map((violation) => violation.path)).toEqual([
      'flavor',
    ]);
  });

  it('locates a bad version at schemaVersion', () => {
    const result = loadCircuit(read('version_not_semver.json').document);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations[0]?.path).toBe('schemaVersion');
  });

  it('locates an unknown gate at the operation that names it', () => {
    const result = loadCircuit(read('newer_minor_unknown_gate.json').document);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations[0]?.path).toBe('operations[0].name');
  });

  it('locates an unknown kind at the discriminator', () => {
    const result = loadCircuit(
      read('newer_minor_unknown_operation_kind.json').document,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations[0]?.path).toBe('operations[0].kind');
  });
});

describe('parseVersion', () => {
  it.each(['1', '1.0', '1.0.0.0', '01.0.0', 'v1.0.0', '', null, 3])(
    'refuses %s',
    (text) => {
      expect(parseVersion(text)).toBeNull();
    },
  );

  it('reads a semantic version', () => {
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
  });
});

describe('decide', () => {
  const at = (major: number, minor: number, patch: number) => ({
    major,
    minor,
    patch,
  });

  it("reads this build's own version strictly", () => {
    expect(decide('1.0.0', at(1, 0, 0)).mode).toBe('strict');
  });

  it('refuses a newer major outright', () => {
    const outcome = decide('2.0.0', at(1, 0, 0));

    expect(outcome.mode).toBeNull();
    expect(outcome.violations[0]?.code).toBe('SCHEMA_VERSION_UNSUPPORTED');
  });

  it('reads a newer minor tolerantly, and says so', () => {
    const outcome = decide('1.1.0', at(1, 0, 0));

    expect(outcome.mode).toBe('tolerant');
    expect(outcome.violations[0]?.code).toBe('SCHEMA_VERSION_NEWER_MINOR');
  });

  it('marks an older version for migration', () => {
    expect(decide('1.0.0', at(1, 1, 0)).migrateFrom).toEqual(at(1, 0, 0));
  });
});

/**
 * The registry ships empty, so the shape is exercised synthetically rather than
 * against a real migration — the same approach the Python tests take, and for
 * the reason ADR-0006 section 8 gives.
 */
describe('migrate', () => {
  const bump: MigrationRegistry = new Map([
    [
      '0.1.0',
      (document: Record<string, unknown>) => ({
        ...document,
        schemaVersion: '0.2.0',
        migrated: true,
      }),
    ],
  ]);

  it('applies a registered migration and advances the version', () => {
    const result = migrate(
      { schemaVersion: '0.1.0' },
      { major: 0, minor: 1, patch: 0 },
      { major: 0, minor: 2, patch: 0 },
      bump,
    );

    expect(result.violations).toEqual([]);
    expect(result.document['migrated']).toBe(true);
  });

  it('refuses when no migration is registered from that version', () => {
    const result = migrate(
      { schemaVersion: '0.1.0' },
      { major: 0, minor: 1, patch: 0 },
      { major: 0, minor: 2, patch: 0 },
      new Map(),
    );

    expect(result.violations[0]?.code).toBe('SCHEMA_VERSION_UNSUPPORTED');
  });

  /** A migration that does not advance the version would otherwise loop. */
  it('reports a migration that leaves the version where it was', () => {
    const stuck: MigrationRegistry = new Map([
      ['0.1.0', (document: Record<string, unknown>) => document],
    ]);

    const result = migrate(
      { schemaVersion: '0.1.0' },
      { major: 0, minor: 1, patch: 0 },
      { major: 0, minor: 2, patch: 0 },
      stuck,
    );

    expect(result.violations[0]?.code).toBe('SCHEMA_VERSION_MALFORMED');
  });
});

describe('loadCircuit rejects what is not a document', () => {
  it.each([[[]], [null], ['a string'], [3]])('refuses %s', (value) => {
    const result = loadCircuit(value);

    expect(result.ok).toBe(false);
    expect(codesOf(result)).toEqual(['SHAPE_INVALID']);
  });
});

/**
 * The trap ADR-0008 section 2 records. Validating a gate against the whole
 * `Operation` union and stripping every `additionalProperties` error deletes
 * `name`, `controls` and `parameters`, because the branches that do not match
 * report the fields they do not share. This asserts the fields survive.
 */
describe('an unknown field inside a gate', () => {
  const fixture = read('newer_minor_unknown_field_in_operation.json');

  it('strips only the unknown field, leaving the gate intact', () => {
    const result = loadCircuit(fixture.document) as LoadResult;

    expect(result.ok).toBe(true);
    const operation = result.circuit.operations[0];
    expect(operation?.kind).toBe('gate');
    expect(operation).toHaveProperty('name');
    expect(operation).toHaveProperty('controls');
    expect(operation).toHaveProperty('parameters');
    expect(result.preserved.map((field) => field.path)).toEqual([
      'operations[0].duration',
    ]);
  });
});
