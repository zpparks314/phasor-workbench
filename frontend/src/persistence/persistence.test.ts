/**
 * The `localStorage` adapter.
 *
 * The interesting cases are all failures, because ADR-0008 section 5 is a list of
 * ways browser storage misbehaves. A fake adapter is used rather than jsdom's
 * `localStorage`, since the point is to make it throw on demand — which is
 * exactly what a real one does and what no test could otherwise arrange.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

import { describe, expect, it } from 'vitest';

import { circuitWith, gate } from '../state/testCircuits';
import { insertOperation } from '../state/edits';
import { SCHEMA_VERSION } from '../model/spec';
import {
  STORAGE_KEY,
  clearStoredCircuit,
  loadStoredCircuit,
  saveCircuit,
  type StorageAdapter,
} from './index';

/** An in-memory store that can be told to misbehave. */
function fakeStorage(initial: Record<string, string> = {}): StorageAdapter {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

function quotaExceeded(): StorageAdapter {
  return {
    ...fakeStorage(),
    setItem: () => {
      const error = new Error('exceeded the quota');
      error.name = 'QuotaExceededError';
      throw error;
    },
  };
}

describe('saving', () => {
  it('stores the circuit under one key', () => {
    const storage = fakeStorage();

    const outcome = saveCircuit(circuitWith(2), storage);

    expect(outcome.ok).toBe(true);
    expect(storage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it("writes this build's version, not whatever the circuit carried", () => {
    const storage = fakeStorage();

    saveCircuit({ ...circuitWith(1), schemaVersion: '0.99.0' }, storage);

    const stored = JSON.parse(storage.getItem(STORAGE_KEY) ?? '{}') as {
      schemaVersion?: string;
    };
    expect(stored.schemaVersion).toBe(SCHEMA_VERSION);
  });

  /** Quota is worth distinguishing: it is the one failure a user can act on. */
  it('reports a full store as full', () => {
    expect(saveCircuit(circuitWith(1), quotaExceeded())).toEqual({
      ok: false,
      reason: 'full',
    });
  });

  it('reports an absent store as unavailable', () => {
    expect(saveCircuit(circuitWith(1), null)).toEqual({
      ok: false,
      reason: 'unavailable',
    });
  });

  it('reports any other write failure as unavailable', () => {
    const storage: StorageAdapter = {
      ...fakeStorage(),
      setItem: () => {
        throw new Error('denied');
      },
    };

    expect(saveCircuit(circuitWith(1), storage)).toEqual({
      ok: false,
      reason: 'unavailable',
    });
  });
});

describe('restoring', () => {
  it('round-trips a circuit through storage', () => {
    const storage = fakeStorage();
    const circuit = insertOperation(
      circuitWith(2),
      gate('op_0', 'h', ['q_0']),
      0,
    );

    saveCircuit(circuit, storage);
    const outcome = loadStoredCircuit(storage);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.circuit.operations).toHaveLength(1);
    expect(outcome.circuit.qubits).toHaveLength(2);
  });

  /** First run. Not a failure, and must not be reported as one. */
  it('reports nothing stored as empty', () => {
    expect(loadStoredCircuit(fakeStorage())).toEqual({
      ok: false,
      reason: 'empty',
    });
  });

  it('reports an absent store as unavailable', () => {
    expect(loadStoredCircuit(null)).toEqual({
      ok: false,
      reason: 'unavailable',
    });
  });

  it('reports a read that throws as unavailable', () => {
    const storage: StorageAdapter = {
      ...fakeStorage(),
      getItem: () => {
        throw new Error('denied');
      },
    };

    expect(loadStoredCircuit(storage)).toEqual({
      ok: false,
      reason: 'unavailable',
    });
  });

  /** A partial write or a hand edit through devtools. */
  it('reports malformed JSON rather than throwing', () => {
    const outcome = loadStoredCircuit(
      fakeStorage({ [STORAGE_KEY]: '{not json' }),
    );

    expect(outcome).toMatchObject({ ok: false, reason: 'unreadable' });
    if (outcome.ok || outcome.reason !== 'unreadable') return;
    expect(outcome.violations[0]?.code).toBe('SHAPE_INVALID');
  });

  /**
   * The reason this goes through the loader at all: a stored document was
   * written by *some* build, and is no more trustworthy than a file.
   */
  it("refuses a document that is not a circuit, with the loader's reasons", () => {
    const outcome = loadStoredCircuit(
      fakeStorage({ [STORAGE_KEY]: JSON.stringify({ nonsense: true }) }),
    );

    expect(outcome).toMatchObject({ ok: false, reason: 'unreadable' });
    if (outcome.ok || outcome.reason !== 'unreadable') return;
    expect(outcome.violations.length).toBeGreaterThan(0);
  });

  it("surfaces the loader's warnings for a newer-minor document", () => {
    const outcome = loadStoredCircuit(
      fakeStorage({
        [STORAGE_KEY]: JSON.stringify({
          ...circuitWith(1),
          schemaVersion: '0.99.0',
          flavour: 'from the future',
        }),
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.warnings.map((warning) => warning.code)).toEqual([
      'SCHEMA_VERSION_NEWER_MINOR',
    ]);
  });
});

describe('clearing', () => {
  it('forgets the working set', () => {
    const storage = fakeStorage();
    saveCircuit(circuitWith(1), storage);

    clearStoredCircuit(storage);

    expect(loadStoredCircuit(storage)).toEqual({ ok: false, reason: 'empty' });
  });

  it('does nothing when there is no store to clear', () => {
    expect(() => {
      clearStoredCircuit(null);
    }).not.toThrow();
  });

  it('swallows a removal that throws, having nothing to report', () => {
    const storage: StorageAdapter = {
      ...fakeStorage(),
      removeItem: () => {
        throw new Error('denied');
      },
    };

    expect(() => {
      clearStoredCircuit(storage);
    }).not.toThrow();
  });
});

describe('browser storage detection', () => {
  /**
   * Reading `window.localStorage` throws in some private-browsing modes, before
   * any read or write. A truthiness check is the intuitive version and it throws.
   */
  it('treats an access that throws as no storage at all', async () => {
    const original = Object.getOwnPropertyDescriptor(
      globalThis,
      'localStorage',
    );
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('access denied');
      },
    });

    const { browserStorage } = await import('./index');
    expect(browserStorage()).toBeNull();

    if (original !== undefined) {
      Object.defineProperty(globalThis, 'localStorage', original);
    }
  });
});

describe('the module boundary', () => {
  /** Frontend.md: nothing outside persistence/ touches browser storage. */
  it('is the only module naming localStorage', () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
          walk(path);
        } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
          // Source only. Tests reach for `localStorage` to arrange and assert,
          // which is not the coupling this rule exists to prevent.
          if (readFileSync(path, 'utf8').includes('localStorage')) {
            offenders.push(path);
          }
        }
      }
    };
    walk(join(process.cwd(), 'src'));

    for (const path of offenders) {
      expect(path).toMatch(/persistence/);
    }
  });
});
