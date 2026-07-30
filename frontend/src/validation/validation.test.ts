/**
 * Semantic validation, driven by the shared fixtures.
 *
 * The mirror of `backend/tests/test_validation.py`, reading the same files. Each
 * fixture declares the codes it expects; both suites assert against that
 * declaration, so the two implementations agree transitively without either
 * needing to see the other's output. See tests/README.md.
 *
 * A failing fixture is never repaired by editing its declaration to match new
 * output.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

import { describe, expect, it } from 'vitest';

import type { Circuit } from '../model/circuit';
import { VIOLATION_CODES, WARNING_CODES } from '../model/spec';
import { validateCircuit } from './index';

// Resolved from the working directory rather than `import.meta.url`, which is
// not a file URL under the jsdom environment. Vitest runs with the frontend
// project root as its cwd.
const FIXTURES = join(process.cwd(), '..', 'shared', 'fixtures');

if (!existsSync(FIXTURES)) {
  throw new Error(
    `Shared fixtures not found at ${FIXTURES}. ` +
      `Expected to run with the frontend directory as cwd, but it is ${process.cwd()}.`,
  );
}

interface Fixture {
  readonly description: string;
  readonly circuit: Circuit;
  readonly violations?: readonly string[];
}

function fixturePaths(...segments: string[]): string[] {
  const directory = join(FIXTURES, ...segments);
  return readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => join(directory, name));
}

function load(path: string): Fixture {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const fixture = parsed as Fixture;

  expect(fixture.description, `${path} is missing a description`).toBeTruthy();
  expect(fixture.circuit, `${path} is missing a circuit`).toBeTruthy();

  return fixture;
}

function declaredCodes(path: string): string[] {
  const { violations } = load(path);
  expect(violations, `${path} must declare violations`).toBeInstanceOf(Array);
  return [...(violations ?? [])].sort();
}

const VALID = fixturePaths('valid');
const INVALID = fixturePaths('invalid', 'semantic');

// SHAPE_INVALID belongs to the parse boundary, which this side does not have,
// and warnings come from the version-aware loader, which is not written yet.
const SEMANTIC_CODES = VIOLATION_CODES.filter(
  (code) => code !== 'SHAPE_INVALID' && !WARNING_CODES.includes(code),
);

const name = (path: string): string => path.replace(/^.*[\\/]/, '');

it('finds the shared fixtures', () => {
  // A directory read that silently yielded nothing would make every test below
  // pass without exercising anything.
  expect(VALID.length).toBeGreaterThan(0);
  expect(INVALID.length).toBeGreaterThan(0);
});

describe('valid fixtures', () => {
  it.each(VALID.map((path) => [name(path), path] as const))(
    'accepts %s',
    (_label, path) => {
      const result = validateCircuit(load(path).circuit);

      expect(result.violations).toEqual([]);
      expect(result.isValid).toBe(true);
    },
  );
});

describe('invalid fixtures', () => {
  it.each(INVALID.map((path) => [name(path), path] as const))(
    'reports the declared codes for %s',
    (_label, path) => {
      const result = validateCircuit(load(path).circuit);

      expect(result.codes).toEqual(declaredCodes(path));
      expect(result.isValid).toBe(false);
    },
  );

  it.each(INVALID.map((path) => [name(path), path] as const))(
    'locates every violation in %s',
    (_label, path) => {
      for (const violation of validateCircuit(load(path).circuit).violations) {
        expect(violation.path).toBeTruthy();
        expect(violation.message.endsWith('.')).toBe(true);
      }
    },
  );
});

it('covers every semantic code with a fixture', () => {
  const covered = new Set(INVALID.flatMap(declaredCodes));
  const uncovered = SEMANTIC_CODES.filter((code) => !covered.has(code));

  expect(uncovered).toEqual([]);
});

it('rejects a fixture that invents a code', () => {
  const known = new Set<string>(VIOLATION_CODES);

  for (const path of INVALID) {
    const unknown = declaredCodes(path).filter((code) => !known.has(code));
    expect(unknown, `${name(path)} declares unknown codes`).toEqual([]);
  }
});

it('builds paths that match the backend, wire names and all', () => {
  const fixture = load(
    join(FIXTURES, 'invalid', 'semantic', 'classical_bit_out_of_range.json'),
  );

  const [violation] = validateCircuit(fixture.circuit).violations;

  expect(violation?.path).toBe('operations[0].classicalTarget.bit');
});

it('suppresses the bit check when the register does not resolve', () => {
  const fixture = load(
    join(FIXTURES, 'invalid', 'semantic', 'unknown_register_reference.json'),
  );

  expect(validateCircuit(fixture.circuit).codes).toEqual([
    'UNKNOWN_REGISTER_REFERENCE',
  ]);
});

it('reads controls even though the binding makes them optional', () => {
  // The one place the two generated bindings differ in shape: Python defaults
  // `controls` to [], TypeScript leaves it optional. A cx with the field absent
  // must still report a missing control rather than crashing or passing.
  const circuit: Circuit = {
    schemaVersion: '0.1.0',
    id: 'circ_1',
    qubits: [{ id: 'q_0', index: 0 }],
    classicalRegisters: [],
    operations: [{ id: 'op_0', kind: 'gate', name: 'cx', targets: ['q_0'] }],
  };

  expect(validateCircuit(circuit).codes).toEqual(['GATE_ARITY_MISMATCH']);
});
