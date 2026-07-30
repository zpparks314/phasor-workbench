/**
 * Cycle derivation, driven by the shared fixtures.
 *
 * The mirror of `backend/tests/test_cycles.py`, reading the same files. Fixture
 * tests pin specific decompositions, hand-computed from ADR-0003's algorithm.
 * Property tests assert the guarantees ADR-0003 states hold for every valid
 * circuit, over the decomposition fixtures and the `valid/` fixtures alike.
 *
 * A failing fixture is never repaired by accepting the new output.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

import { describe, expect, it } from 'vitest';

import type { Circuit, Operation } from '../model/circuit';
import { validateCircuit } from '../validation';
import { deriveCycles } from './index';

// Resolved from the working directory rather than `import.meta.url`, which is not
// a file URL under the jsdom environment. Vitest runs with the frontend project
// root as its cwd.
const FIXTURES = join(process.cwd(), '..', 'shared', 'fixtures');

if (!existsSync(FIXTURES)) {
  throw new Error(
    `Shared fixtures not found at ${FIXTURES}. ` +
      `Expected the frontend directory as cwd, but it is ${process.cwd()}.`,
  );
}

interface ExpectedDecomposition {
  readonly cycles: readonly (readonly string[])[];
  readonly barriers: readonly {
    readonly operationId: string;
    readonly beforeCycle: number;
    readonly qubits: readonly string[];
  }[];
  readonly depth: number;
}

interface Fixture {
  readonly description: string;
  readonly circuit: Circuit;
  readonly decomposition?: ExpectedDecomposition;
}

function fixturePaths(...segments: string[]): string[] {
  const directory = join(FIXTURES, ...segments);
  return readdirSync(directory)
    .filter((entry) => entry.endsWith('.json'))
    .sort()
    .map((entry) => join(directory, entry));
}

function load(path: string): Fixture {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const fixture = parsed as Fixture;

  expect(fixture.description, `${path} is missing a description`).toBeTruthy();

  return fixture;
}

const DECOMPOSITIONS = join(FIXTURES, 'decomposition');
const DECOMPOSITION = fixturePaths('decomposition');
const VALID = fixturePaths('valid');
const EVERY_CIRCUIT = [...DECOMPOSITION, ...VALID];

const name = (path: string): string => path.replace(/^.*[\\/]/, '');
const cases = (paths: string[]): (readonly [string, string])[] =>
  paths.map((path) => [name(path), path] as const);

/** Namespaced resource keys, for the contention property only. */
function resourcesOf(operation: Operation): string[] {
  if (operation.kind === 'gate') {
    return [...operation.targets, ...(operation.controls ?? [])].map(
      (qubit) => `qubit:${qubit}`,
    );
  }

  if (operation.kind === 'measurement') {
    const { register, bit } = operation.classicalTarget;
    return [`qubit:${operation.targets[0]}`, `bit:${register}:${String(bit)}`];
  }

  return operation.targets.map((qubit) => `qubit:${qubit}`);
}

it('finds the shared fixtures', () => {
  expect(DECOMPOSITION.length).toBeGreaterThan(0);
  expect(VALID.length).toBeGreaterThan(0);
});

describe('fixture decompositions', () => {
  it.each(cases(DECOMPOSITION))('matches %s', (_label, path) => {
    const expected = load(path).decomposition;
    const result = deriveCycles(load(path).circuit);

    expect(result.sortedCycles).toEqual(expected?.cycles);
    expect(result.barriers).toEqual(expected?.barriers);
    expect(result.depth).toBe(expected?.depth);
  });

  it.each(cases(DECOMPOSITION))(
    'uses a valid circuit in %s',
    (_label, path) => {
      // The derivation assumes validity, so a fixture violating it proves nothing.
      expect(validateCircuit(load(path).circuit).codes).toEqual([]);
    },
  );
});

it('is invariant under dependency-preserving reordering', () => {
  // ADR-0003 property 6, and the reason depth is objective.
  const first = deriveCycles(
    load(join(DECOMPOSITIONS, 'reordering_invariance_a.json')).circuit,
  );
  const second = deriveCycles(
    load(join(DECOMPOSITIONS, 'reordering_invariance_b.json')).circuit,
  );

  expect(first.sortedCycles).toEqual(second.sortedCycles);
  expect(first.depth).toBe(second.depth);
});

it('leaves depth alone for an inert barrier', () => {
  // In the Bell state the frontier is already level where the barrier sits.
  const annotated = deriveCycles(
    load(join(DECOMPOSITIONS, 'bell_state.json')).circuit,
  );
  const bare = deriveCycles(
    load(join(DECOMPOSITIONS, 'bell_state_without_barrier.json')).circuit,
  );

  expect(annotated.depth).toBe(bare.depth);
  expect(annotated.sortedCycles).toEqual(bare.sortedCycles);
  expect(annotated.barriers).toHaveLength(1);
  expect(bare.barriers).toEqual([]);
});

it('delays operations for a constraining barrier', () => {
  // The necessary counterpart: a barrier incapable of changing depth would be
  // incapable of constraining anything. See the clarification in ADR-0003.
  const fixture = load(
    join(DECOMPOSITIONS, 'barrier_levels_unequal_frontiers.json'),
  );
  const without: Circuit = {
    ...fixture.circuit,
    operations: fixture.circuit.operations.filter(
      (operation) => operation.kind !== 'barrier',
    ),
  };

  const annotated = deriveCycles(fixture.circuit);
  const bare = deriveCycles(without);

  expect(annotated.depth).toBe(3);
  expect(bare.depth).toBe(2);
  expect(annotated.barriers[0]?.beforeCycle).toBe(2);
});

it('reports a trailing barrier on the edge', () => {
  const result = deriveCycles(
    load(join(DECOMPOSITIONS, 'trailing_barrier.json')).circuit,
  );

  expect(result.barriers[0]?.beforeCycle).toBe(result.depth);
});

describe('ADR-0003 properties, over every circuit available', () => {
  it.each(cases(EVERY_CIRCUIT))('is pure for %s', (_label, path) => {
    const circuit = load(path).circuit;

    expect(deriveCycles(circuit)).toEqual(deriveCycles(circuit));
  });

  it.each(cases(EVERY_CIRCUIT))(
    'has no intra-cycle contention in %s',
    (_label, path) => {
      const circuit = load(path).circuit;
      const byId = new Map(circuit.operations.map((op) => [op.id, op]));

      deriveCycles(circuit).cycles.forEach((cycle, index) => {
        const claimed = new Set<string>();
        for (const operationId of cycle) {
          const operation = byId.get(operationId);
          expect(operation).toBeDefined();
          for (const resource of resourcesOf(operation as Operation)) {
            expect(claimed.has(resource), `cycle ${String(index)}`).toBe(false);
            claimed.add(resource);
          }
        }
      });
    },
  );

  it.each(cases(EVERY_CIRCUIT))(
    'has contiguous non-empty cycles in %s',
    (_label, path) => {
      const result = deriveCycles(load(path).circuit);

      for (const cycle of result.cycles) {
        expect(cycle.length).toBeGreaterThan(0);
      }
      expect(result.depth).toBe(result.cycles.length);
    },
  );

  it.each(cases(EVERY_CIRCUIT))(
    'places every operation exactly once in %s',
    (_label, path) => {
      const circuit = load(path).circuit;
      const result = deriveCycles(circuit);

      const placed = result.cycles.flatMap((cycle) => [...cycle]);
      const scheduled = circuit.operations
        .filter((operation) => operation.kind !== 'barrier')
        .map((operation) => operation.id);
      const barriers = circuit.operations
        .filter((operation) => operation.kind === 'barrier')
        .map((operation) => operation.id);

      expect([...placed].sort()).toEqual([...scheduled].sort());
      expect(new Set(placed).size).toBe(placed.length);
      expect(result.barriers.map((placement) => placement.operationId)).toEqual(
        barriers,
      );
    },
  );

  it.each(cases(EVERY_CIRCUIT))(
    'keeps barrier placements within %s',
    (_label, path) => {
      const result = deriveCycles(load(path).circuit);

      for (const placement of result.barriers) {
        expect(placement.beforeCycle).toBeGreaterThanOrEqual(0);
        expect(placement.beforeCycle).toBeLessThanOrEqual(result.depth);
        expect(placement.qubits.length).toBeGreaterThan(0);
      }
    },
  );
});
