import { describe, expect, it } from 'vitest';

import { renameCircuit } from './edits';
import {
  MAX_HISTORY_DEPTH,
  canRedo,
  canUndo,
  commit,
  createHistory,
  endCoalescing,
  redo,
  undo,
  type History,
} from './history';
import { circuitWith } from './testCircuits';

const start = circuitWith(1);

function named(
  history: History,
  name: string,
  coalescingKey?: string,
): History {
  return commit(
    history,
    renameCircuit(history.present.circuit, name),
    `Rename to ${name}`,
    coalescingKey,
  );
}

describe('commit', () => {
  it('makes the new circuit present and keeps the old one in the past', () => {
    const history = named(createHistory(start), 'a');

    expect(history.present.circuit.name).toBe('a');
    expect(history.past).toHaveLength(1);
    expect(history.past[0]?.circuit).toBe(start);
  });

  it('clears the redo stack', () => {
    const undone = undo(named(named(createHistory(start), 'a'), 'b'));
    expect(canRedo(undone)).toBe(true);

    expect(canRedo(named(undone, 'c'))).toBe(false);
  });

  it('discards the oldest entry beyond the depth bound', () => {
    let history = createHistory(start);
    for (let i = 0; i <= MAX_HISTORY_DEPTH; i += 1) {
      history = named(history, `edit ${String(i)}`);
    }

    expect(history.past).toHaveLength(MAX_HISTORY_DEPTH);
    expect(history.past[0]?.circuit.name).toBe('edit 0');
  });
});

describe('undo and redo', () => {
  it('restores the previous circuit', () => {
    const history = undo(named(createHistory(start), 'a'));

    expect(history.present.circuit).toBe(start);
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(true);
  });

  it('round-trips back to the undone circuit', () => {
    const history = named(createHistory(start), 'a');

    expect(redo(undo(history)).present.circuit).toBe(history.present.circuit);
  });

  it('returns the same history when there is nothing to undo', () => {
    const history = createHistory(start);

    expect(undo(history)).toBe(history);
    expect(redo(history)).toBe(history);
  });
});

describe('coalescing', () => {
  it('pushes one entry for the first transient edit', () => {
    const history = named(createHistory(start), 'a', 'move:op_0');

    expect(history.past).toHaveLength(1);
  });

  it('replaces the present entry for subsequent edits with the same key', () => {
    let history = named(createHistory(start), 'a', 'move:op_0');
    history = named(history, 'b', 'move:op_0');
    history = named(history, 'c', 'move:op_0');

    expect(history.past).toHaveLength(1);
    expect(history.present.circuit.name).toBe('c');
    expect(undo(history).present.circuit).toBe(start);
  });

  it('starts a new entry when the key changes', () => {
    let history = named(createHistory(start), 'a', 'move:op_0');
    history = named(history, 'b', 'move:op_1');

    expect(history.past).toHaveLength(2);
  });

  /**
   * The case the seal exists for: dragging the same operation twice must be two
   * undo steps, and without ending the run the second drag would merge into the
   * first.
   */
  it('does not merge across an ended interaction', () => {
    let history = named(createHistory(start), 'a', 'move:op_0');
    history = endCoalescing(history);
    history = named(history, 'b', 'move:op_0');

    expect(history.past).toHaveLength(2);
  });

  it('does not merge across an undo', () => {
    let history = named(createHistory(start), 'a', 'move:op_0');
    history = named(undo(history), 'b', 'move:op_0');

    expect(history.past).toHaveLength(1);
    expect(history.present.circuit.name).toBe('b');
    expect(undo(history).present.circuit).toBe(start);
  });

  it('is a no-op to end a run that is not open', () => {
    const history = named(createHistory(start), 'a');

    expect(endCoalescing(history)).toBe(history);
  });
});
