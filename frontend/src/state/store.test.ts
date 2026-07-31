import { describe, expect, it, vi } from 'vitest';

import type { Circuit } from '../model/circuit';
import {
  addClassicalRegister,
  addQubit,
  insertOperation,
  moveOperation,
  removeClassicalRegister,
  removeOperation,
  removeQubit,
  renameCircuit,
  setParameters,
} from './edits';
import { createCircuitStore } from './store';
import { barrier, circuitWith, gate, measurement } from './testCircuits';

const start = circuitWith(2);

describe('reading', () => {
  it('starts with no history and nothing selected', () => {
    const state = createCircuitStore(start).getState();

    expect(state.circuit).toBe(start);
    expect(state).toMatchObject({
      selection: null,
      canUndo: false,
      canRedo: false,
      undoLabel: null,
      redoLabel: null,
    });
  });

  /** useSyncExternalStore compares snapshots by identity and loops otherwise. */
  it('returns the same snapshot object until something changes', () => {
    const store = createCircuitStore(start);
    const first = store.getState();

    expect(store.getState()).toBe(first);

    store.apply('Add a qubit', (c) => addQubit(c, { id: 'q_2' }));

    expect(store.getState()).not.toBe(first);
  });

  it('notifies subscribers, and stops after unsubscribing', () => {
    const store = createCircuitStore(start);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.apply('Add a qubit', (c) => addQubit(c, { id: 'q_2' }));
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.apply('Add another', (c) => addQubit(c, { id: 'q_3' }));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('applying edits', () => {
  it('labels what undo would reverse', () => {
    const store = createCircuitStore(start);
    store.apply('Place H on q0', (c) =>
      insertOperation(c, gate('op_0', 'h', ['q_0']), 0),
    );

    expect(store.getState()).toMatchObject({
      canUndo: true,
      undoLabel: 'Place H on q0',
      redoLabel: null,
    });

    store.undo();

    expect(store.getState()).toMatchObject({
      canUndo: false,
      undoLabel: null,
      redoLabel: 'Place H on q0',
    });
  });

  it('leaves the store untouched when an edit throws', () => {
    const store = createCircuitStore(start);
    const before = store.getState();

    expect(() => {
      store.apply('Remove a ghost', (c) => removeOperation(c, 'op_missing'));
    }).toThrow('op_missing');

    expect(store.getState()).toBe(before);
  });

  it('records nothing for an edit that returns its input', () => {
    const store = createCircuitStore(start);

    store.apply('Do nothing', (c) => c);

    expect(store.getState().canUndo).toBe(false);
  });

  it('collapses a coalescing run into one undo step', () => {
    const store = createCircuitStore(
      insertOperation(
        insertOperation(start, gate('op_0', 'h', ['q_0']), 0),
        gate('op_1', 'x', ['q_1']),
        1,
      ),
    );
    const before = store.getState().circuit;

    for (const to of [1, 0, 1]) {
      store.apply('Move H', (c) => moveOperation(c, 'op_0', to), {
        coalescingKey: 'move:op_0',
      });
    }
    store.endCoalescing();

    store.undo();

    expect(store.getState().circuit).toBe(before);
    expect(store.getState().canUndo).toBe(false);
  });
});

describe('selection', () => {
  const withGate = insertOperation(start, gate('op_0', 'h', ['q_0']), 0);

  it('holds an operation identifier', () => {
    const store = createCircuitStore(withGate);
    store.select('op_0');

    expect(store.getState().selection).toBe('op_0');
  });

  /**
   * ADR-0007 section 4. Selection is derived state resolved on read, so undo
   * removing the selected operation cannot leave a reference pointing at nothing.
   */
  it('clears when the selected operation stops existing', () => {
    const store = createCircuitStore(withGate);
    store.select('op_0');
    store.apply('Remove H', (c) => removeOperation(c, 'op_0'));

    expect(store.getState().selection).toBeNull();
  });

  it('comes back when redo restores the operation', () => {
    const store = createCircuitStore(withGate);
    store.select('op_0');
    store.apply('Remove H', (c) => removeOperation(c, 'op_0'));
    store.undo();

    expect(store.getState().selection).toBe('op_0');
  });
});

/**
 * ADR-0007's safety argument, made checkable: undo restores exactly what was
 * there, for every edit type, in any order.
 *
 * This is the whole reason snapshots were chosen over commands with inverses --
 * there is no inverse that could be subtly wrong -- and it is the same
 * property-testing discipline ADR-0003 established for the cycle derivation.
 */
describe('undo restores the exact prior circuit', () => {
  const EDIT_COUNT = 60;

  it.each([1, 2, 3, 4, 5])(
    'holds over a random edit sequence (seed %i)',
    (seed) => {
      const random = mulberry32(seed);
      const initial = circuitWith(3, 4);
      const store = createCircuitStore(initial);
      const checkpoints: Circuit[] = [];

      // A checkpoint per recorded *history step*, not per attempted edit. An
      // edit that returns its input records nothing -- `moveOperation` does
      // exactly that when asked to move an operation where it already is -- so
      // counting attempts would undo further than the history goes.
      for (let n = 0; n < EDIT_COUNT; n += 1) {
        const before = store.getState().circuit;
        applyRandomEdit(store, random, n);
        if (store.getState().circuit !== before) checkpoints.push(before);
      }

      // Guard against a vacuous pass: a generator that produced only trivial
      // edits, or none, would satisfy every assertion below without testing
      // anything. The sequence must have built a circuit worth undoing.
      //
      // The seeds are fixed and the generator deterministic, so this cannot
      // flake. The weakest seed reaches 9 operations and the rest exceed 12; a
      // future change to the weights dropping below this should be looked at
      // rather than accommodated.
      expect(store.getState().canUndo).toBe(true);
      expect(store.getState().circuit).not.toEqual(initial);
      expect(
        Math.max(...checkpoints.map((c) => c.operations.length)),
      ).toBeGreaterThan(8);

      for (let n = checkpoints.length - 1; n >= 0; n -= 1) {
        store.undo();
        expect(store.getState().circuit).toEqual(checkpoints[n]);
      }

      expect(store.getState().canUndo).toBe(false);
      expect(store.getState().circuit).toEqual(initial);
    },
  );
});

type Store = ReturnType<typeof createCircuitStore>;

interface Choice {
  /**
   * Relative likelihood.
   *
   * Weights are not decoration. Uniform choice let structural edits dominate --
   * `removeQubit` deletes every operation on its wire, so with a handful of
   * qubits it repeatedly flattened the circuit and the sequence never grew past
   * three operations. The property still held, but only over circuits too small
   * to be worth asserting on. The vacuity guard above is what caught it.
   */
  readonly weight: number;
  readonly run: () => void;
}

/**
 * Pick an edit that is applicable to the current circuit and apply it.
 *
 * Preconditions are checked rather than caught: an edit throwing here would mean
 * this generator is wrong, and swallowing it would let the property pass
 * vacuously.
 */
function applyRandomEdit(store: Store, random: () => number, n: number): void {
  const circuit = store.getState().circuit;
  const id = `gen_${String(n)}`;
  const choices: Choice[] = [
    {
      weight: 2,
      run: () => {
        store.apply('Add qubit', (c) => addQubit(c, { id }));
      },
    },
    {
      weight: 1,
      run: () => {
        store.apply('Add register', (c) =>
          addClassicalRegister(c, { id, size: 2 }),
        );
      },
    },
    {
      weight: 1,
      run: () => {
        store.apply('Rename', (c) => renameCircuit(c, id));
      },
    },
  ];

  if (circuit.qubits.length > 0) {
    const target = pick(circuit.qubits, random).id;
    const at = Math.floor(random() * (circuit.operations.length + 1));

    choices.push(
      {
        weight: 6,
        run: () => {
          store.apply('Place gate', (c) =>
            insertOperation(c, gate(id, 'rx', [target]), at),
          );
        },
      },
      {
        weight: 3,
        run: () => {
          store.apply('Place barrier', (c) =>
            insertOperation(c, barrier(id, [target]), at),
          );
        },
      },
      {
        weight: 1,
        run: () => {
          store.apply('Remove qubit', (c) => removeQubit(c, target));
        },
      },
    );

    if (circuit.classicalRegisters.length > 0) {
      const register = pick(circuit.classicalRegisters, random);
      choices.push({
        weight: 3,
        run: () => {
          store.apply('Measure', (c) =>
            insertOperation(
              c,
              measurement(id, target, register.id, register.size - 1),
              at,
            ),
          );
        },
      });
    }
  }

  if (circuit.classicalRegisters.length > 0) {
    const register = pick(circuit.classicalRegisters, random).id;
    choices.push({
      weight: 1,
      run: () => {
        store.apply('Remove register', (c) =>
          removeClassicalRegister(c, register),
        );
      },
    });
  }

  if (circuit.operations.length > 0) {
    const operation = pick(circuit.operations, random);
    const to = Math.floor(random() * circuit.operations.length);

    choices.push(
      {
        weight: 3,
        run: () => {
          store.apply('Remove operation', (c) =>
            removeOperation(c, operation.id),
          );
        },
      },
      {
        weight: 4,
        run: () => {
          store.apply('Move operation', (c) =>
            moveOperation(c, operation.id, to),
          );
        },
      },
    );

    if (operation.kind === 'gate') {
      choices.push({
        weight: 3,
        run: () => {
          store.apply('Set parameter', (c) =>
            setParameters(c, operation.id, { theta: random() }),
          );
        },
      });
    }
  }

  pickWeighted(choices, random).run();
}

function pickWeighted(
  choices: readonly Choice[],
  random: () => number,
): Choice {
  const total = choices.reduce((sum, choice) => sum + choice.weight, 0);
  let remaining = random() * total;

  for (const choice of choices) {
    remaining -= choice.weight;
    if (remaining < 0) return choice;
  }

  const last = choices.at(-1);
  if (last === undefined) {
    throw new Error('Cannot pick from an empty collection.');
  }
  return last;
}

function pick<T>(items: readonly T[], random: () => number): T {
  const chosen = items[Math.floor(random() * items.length)];
  if (chosen === undefined) {
    throw new Error('Cannot pick from an empty collection.');
  }
  return chosen;
}

/** A seeded generator, so a failing case is reproducible from its seed. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
