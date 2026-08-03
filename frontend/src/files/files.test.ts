/**
 * The file adapter, driven by the shared fixtures.
 *
 * The point of the fixture cases below is not that the loader works — that is
 * `../serialization/`'s suite. It is that **import reaches the same verdict the
 * loader does**, which is the only thing standing between this module and the
 * second, laxer read path Milestone 5's exit criteria were written to prevent. A
 * document refused on refresh must be refused on import.
 *
 * A failing fixture means an implementation is wrong or an ADR changed. Editing
 * the fixture to match new output defeats the mechanism.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

import { describe, expect, it, vi } from 'vitest';

import type { Circuit } from '../model/circuit';
import { loadCircuit } from '../serialization';
import { ApiError } from '../api/client';
import {
  circuitFile,
  downloadCircuit,
  importCircuitFile,
  looksLikeQasm,
  readCircuitFile,
} from './index';

const FIXTURES = join(process.cwd(), '..', 'shared', 'fixtures');
const VERSION = join(FIXTURES, 'version');
const VALID = join(FIXTURES, 'valid');

if (!existsSync(VERSION)) {
  throw new Error(
    `Shared fixtures not found at ${VERSION}. Run vitest from frontend/.`,
  );
}

interface VersionFixture {
  readonly description: string;
  readonly document: unknown;
  readonly outcome: 'loaded' | 'refused';
  readonly violations: readonly string[];
}

interface ValidFixture {
  readonly description: string;
  readonly circuit: Circuit;
}

const names = (dir: string): string[] =>
  readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort();

const readVersion = (name: string): VersionFixture =>
  JSON.parse(readFileSync(join(VERSION, name), 'utf8')) as VersionFixture;

const readValid = (name: string): ValidFixture =>
  JSON.parse(readFileSync(join(VALID, name), 'utf8')) as ValidFixture;

const VERSION_NAMES = names(VERSION);
const VALID_NAMES = names(VALID);

describe('importing a circuit file', () => {
  it('has fixtures to run', () => {
    // A suite that silently found no fixtures would pass while asserting
    // nothing, which is the vacuity failure CLAUDE.md records.
    expect(VERSION_NAMES).toHaveLength(14);
    expect(VALID_NAMES).toHaveLength(5);
  });

  describe.each(VERSION_NAMES)('%s', (name) => {
    const fixture = readVersion(name);
    // The fixture holds a document; a file holds its text. Serializing here is
    // what makes this the import path rather than the loader path again.
    const outcome = readCircuitFile(JSON.stringify(fixture.document));

    it(fixture.description, () => {
      expect(outcome.ok).toBe(fixture.outcome === 'loaded');
    });

    it('reports the codes the fixture declares', () => {
      const codes = outcome.ok
        ? outcome.warnings.map((v) => v.code)
        : outcome.violations.map((v) => v.code);

      expect([...codes].sort()).toEqual([...fixture.violations].sort());
    });

    it('agrees with the loader it delegates to', () => {
      const direct = loadCircuit(fixture.document);

      expect(outcome.ok).toBe(direct.ok);
      if (outcome.ok && direct.ok) {
        expect(outcome.circuit).toEqual(direct.circuit);
      }
    });
  });
});

describe('exporting and re-importing', () => {
  it.each(VALID_NAMES)('round-trips %s unchanged', (name) => {
    const { circuit } = readValid(name);

    const outcome = readCircuitFile(circuitFile(circuit).text);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.circuit).toEqual(circuit);
    expect(outcome.warnings).toEqual([]);
  });
});

describe('the file a circuit produces', () => {
  const circuit = readValid('bell_state.json').circuit;

  it('names the file after the circuit', () => {
    expect(circuitFile({ ...circuit, name: 'Bell State' }).filename).toBe(
      'bell-state.json',
    );
  });

  it.each([
    ['Grover 3-qubit', 'grover-3-qubit.json'],
    ['  spaced  out  ', 'spaced-out.json'],
    ['Ψ preparation', 'preparation.json'],
    ['///', 'circuit.json'],
    ['', 'circuit.json'],
  ])('turns %o into %o', (name, filename) => {
    expect(circuitFile({ ...circuit, name }).filename).toBe(filename);
  });

  it('falls back when the circuit is unnamed', () => {
    const { name, ...unnamed } = circuit;
    void name;

    expect(circuitFile(unnamed).filename).toBe('circuit.json');
  });

  it('is indented and newline-terminated, because people read it', () => {
    const { text } = circuitFile(circuit);

    expect(text).toContain('\n  "');
    expect(text.endsWith('}\n')).toBe(true);
  });

  it('declares this build version', () => {
    const document = JSON.parse(circuitFile(circuit).text) as {
      schemaVersion: string;
    };

    expect(document.schemaVersion).toBe(circuit.schemaVersion);
  });
});

describe('a file that cannot be read', () => {
  it('reports malformed JSON as a shape failure', () => {
    const outcome = readCircuitFile('{ "qubits": ');

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.violations.map((v) => v.code)).toEqual(['SHAPE_INVALID']);
    expect(outcome.violations[0]?.message).toContain('not valid JSON');
  });

  it('reports an empty file rather than throwing', () => {
    expect(readCircuitFile('').ok).toBe(false);
  });

  it('refuses JSON that is not a circuit', () => {
    const outcome = readCircuitFile('[1, 2, 3]');

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.violations.map((v) => v.code)).toContain('SHAPE_INVALID');
  });

  it('returns every reason, not only the first', () => {
    const outcome = readCircuitFile(
      JSON.stringify({ schemaVersion: '0.1.0', id: 'c_0' }),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.violations.length).toBeGreaterThan(1);
  });
});

/**
 * jsdom implements neither `Blob.text` nor `Blob.arrayBuffer`, so the standard
 * read path does not exist in this environment.
 *
 * The shim is local rather than in `src/test/setup.ts` because a global one
 * would change every suite's idea of what a `Blob` can do, and hide the gap the
 * next person hits. **It also bounds what these two tests prove**: that
 * `importCircuitFile` delegates to `readCircuitFile` correctly, and nothing at
 * all about whether a browser can read a `File`. That is what the Definition of
 * Done's browser check is for.
 */
const fileContaining = (text: string, name: string): File => {
  const file = new File([text], name);
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(text) });
  return file;
};

describe('reading a chosen file', () => {
  it('loads a circuit from a File', async () => {
    const { circuit } = readValid('bell_state.json');

    const outcome = await importCircuitFile(
      fileContaining(circuitFile(circuit).text, 'bell.json'),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.circuit).toEqual(circuit);
  });

  it('reports a file that is not JSON', async () => {
    const file = fileContaining('OPENQASM 3.0;', 'circuit.qasm');

    expect((await importCircuitFile(file)).ok).toBe(false);
  });
});

describe('handing a circuit to the browser', () => {
  it('clicks an anchor carrying the filename, then revokes the URL', () => {
    vi.useFakeTimers();

    // jsdom implements neither, so they are defined before being spied on.
    // Same bound as the shim above: this asserts the filename wiring and the
    // revoke *ordering*, which are the parts that are mine to get wrong.
    for (const name of ['createObjectURL', 'revokeObjectURL']) {
      Object.defineProperty(URL, name, {
        value: () => undefined,
        writable: true,
        configurable: true,
      });
    }

    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:test');
    const revokeObjectURL = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined);

    const { circuit } = readValid('bell_state.json');
    const anchor = document.createElement('a');
    const click = vi.spyOn(anchor, 'click').mockImplementation(() => undefined);
    const target = {
      createElement: () => anchor,
    } as unknown as Document;

    downloadCircuit({ ...circuit, name: 'Bell State' }, target);

    expect(click).toHaveBeenCalledOnce();
    expect(anchor.download).toBe('bell-state.json');
    expect(anchor.href).toContain('blob:test');

    // Revoking before the browser has read the blob cancels the download, so
    // it must not have happened yet.
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test');

    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
    vi.useRealTimers();
  });
});

describe('telling the two formats apart', () => {
  it.each([
    ['OPENQASM 2.0;\nqreg q[1];', true],
    ['// a comment\n\nOPENQASM 2.0;', true],
    ['   \n  OPENQASM 2.0;', true],
    ['{"schemaVersion":"0.1.0"}', false],
    ['', false],
    ['// only comments\n', false],
  ])('reads %o as qasm=%o', (text, expected) => {
    expect(looksLikeQasm(text)).toBe(expected);
  });

  it('routes on content rather than on the file name', async () => {
    // A QASM program in a .json file is still QASM. Routing on the extension
    // would refuse it with a JSON parse error that explains nothing.
    const circuit = readValid('bell_state.json').circuit;
    const importQasm = vi.fn().mockResolvedValue(circuit);
    vi.doMock('../api/qasm', () => ({ importQasm }));
    vi.resetModules();
    const files = await import('./index');

    const outcome = await files.importCircuitFile(
      fileContaining('OPENQASM 2.0;\nqreg q[1];\n', 'misnamed.json'),
    );

    expect(importQasm).toHaveBeenCalledOnce();
    expect(outcome.ok).toBe(true);
    vi.doUnmock('../api/qasm');
    vi.resetModules();
  });
});

describe('importing OpenQASM', () => {
  const withImportQasm = async (implementation: () => Promise<unknown>) => {
    vi.doMock('../api/qasm', () => ({ importQasm: implementation }));
    vi.resetModules();
    const files = await import('./index');
    const outcome = await files.importCircuitFile(
      fileContaining('OPENQASM 2.0;\nqreg q[1];\n', 'circuit.qasm'),
    );
    vi.doUnmock('../api/qasm');
    vi.resetModules();
    return outcome;
  };

  it('returns the circuit the backend parsed', async () => {
    const circuit = readValid('bell_state.json').circuit;

    const outcome = await withImportQasm(() => Promise.resolve(circuit));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.circuit).toEqual(circuit);
  });

  it('keeps the line and column the parser reported', async () => {
    const outcome = await withImportQasm(() =>
      Promise.reject(
        new ApiError('REQUEST_MALFORMED', 'unreadable', 400, [
          {
            code: 'UNKNOWN_GATE_NAME',
            message: "'u3' is not a gate this build can represent.",
            path: 'line 4, column 1',
          },
        ]),
      ),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok || outcome.reason !== 'unreadable') return;
    expect(outcome.violations[0]?.message).toContain('line 4, column 1');
    expect(outcome.violations[0]?.code).toBe('UNKNOWN_GATE_NAME');
  });

  it('separates an unreachable backend from an unreadable file', async () => {
    // The distinction the whole outcome type exists for: one asks the user to
    // change their file, the other asks nothing of them at all.
    const outcome = await withImportQasm(() =>
      Promise.reject(
        new ApiError('BACKEND_UNAVAILABLE', 'Could not reach the backend.', 0),
      ),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('unreachable');
  });

  it('does not treat a non-ApiError as the user\u2019s fault', async () => {
    const outcome = await withImportQasm(() =>
      Promise.reject(new Error('boom')),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('unreachable');
  });
});
