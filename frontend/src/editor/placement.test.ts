import { describe, expect, it } from 'vitest';

import { deriveCycles } from '../cycles';
import type { Circuit } from '../model/circuit';
import { insertOperation } from '../state/edits';
import { barrier, circuitWith, gate, measurement } from '../state/testCircuits';
import {
  insertionIndexFor,
  operationAt,
  operationIdFromPath,
} from './placement';

function indexFor(circuit: Circuit, qubitId: string, column: number): number {
  return insertionIndexFor(circuit, deriveCycles(circuit), qubitId, column);
}

function build(circuit: Circuit, ...operations: Parameters<typeof gate>[]) {
  return operations.reduce(
    (built, args, index) => insertOperation(built, gate(...args), index),
    circuit,
  );
}

describe('insertionIndexFor', () => {
  it('places into an empty circuit at the front', () => {
    expect(indexFor(circuitWith(2), 'q_0', 0)).toBe(0);
  });

  it('appends after everything already on the wire', () => {
    const circuit = build(
      circuitWith(1),
      ['op_0', 'h', ['q_0']],
      ['op_1', 'x', ['q_0']],
    );

    expect(indexFor(circuit, 'q_0', 2)).toBe(2);
  });

  it('inserts between two operations on the same wire', () => {
    const circuit = build(
      circuitWith(1),
      ['op_0', 'h', ['q_0']],
      ['op_1', 'x', ['q_0']],
    );

    expect(indexFor(circuit, 'q_0', 1)).toBe(1);
  });

  it('inserts before everything when dropped at column 0', () => {
    const circuit = build(circuitWith(1), ['op_0', 'h', ['q_0']]);

    expect(indexFor(circuit, 'q_0', 0)).toBe(0);
  });

  /**
   * ADR-0003 makes the derivation invariant under reorderings that preserve data
   * dependencies, so where the new operation lands relative to operations on
   * other wires is unobservable and must not affect the index.
   */
  it('ignores operations on other wires', () => {
    const circuit = build(
      circuitWith(2),
      ['op_0', 'h', ['q_1']],
      ['op_1', 'x', ['q_1']],
      ['op_2', 'z', ['q_1']],
    );

    expect(indexFor(circuit, 'q_0', 0)).toBe(0);
  });

  it('counts a control as touching the wire', () => {
    const circuit = build(circuitWith(2), ['op_0', 'cx', ['q_1'], ['q_0']]);

    expect(indexFor(circuit, 'q_0', 1)).toBe(1);
  });

  it('places after a measurement already on the wire', () => {
    const circuit = insertOperation(
      circuitWith(1),
      measurement('op_0', 'q_0', 'c_0', 0),
      0,
    );

    expect(indexFor(circuit, 'q_0', 1)).toBe(1);
  });

  /**
   * A barrier sits on the boundary before its cycle. Dropping into that cycle
   * must land after it, or the user's constraint would silently apply to the
   * operation they placed to come after it.
   */
  describe('barriers', () => {
    const circuit = insertOperation(
      build(circuitWith(1), ['op_0', 'h', ['q_0']]),
      barrier('op_1', ['q_0']),
      1,
    );

    it('places after a barrier at the same column', () => {
      expect(indexFor(circuit, 'q_0', 1)).toBe(2);
    });

    it('places before a barrier when dropped ahead of it', () => {
      expect(indexFor(circuit, 'q_0', 0)).toBe(0);
    });
  });

  /**
   * The rule the whole interaction rests on: the drop column is a request, and
   * ASAP packing decides the result.
   */
  it('yields an index whose operation then packs left of the drop column', () => {
    const circuit = circuitWith(1);
    const index = indexFor(circuit, 'q_0', 5);
    const placed = insertOperation(circuit, gate('op_0', 'h', ['q_0']), index);

    expect(deriveCycles(placed).cycles[0]).toEqual(['op_0']);
  });
});

describe('operationAt', () => {
  const circuit = build(
    circuitWith(2),
    ['op_0', 'h', ['q_0']],
    ['op_1', 'cx', ['q_1'], ['q_0']],
  );
  const decomposition = deriveCycles(circuit);

  it('finds the operation occupying a cell', () => {
    expect(operationAt(circuit, decomposition, 'q_0', 0)?.id).toBe('op_0');
  });

  it('finds an operation by its control wire', () => {
    expect(operationAt(circuit, decomposition, 'q_0', 1)?.id).toBe('op_1');
  });

  it('returns nothing for an empty cell', () => {
    expect(operationAt(circuit, decomposition, 'q_1', 0)).toBeUndefined();
  });

  it('returns nothing past the end of the circuit', () => {
    expect(operationAt(circuit, decomposition, 'q_0', 9)).toBeUndefined();
  });
});

describe('operationIdFromPath', () => {
  const circuit = build(
    circuitWith(1),
    ['op_0', 'h', ['q_0']],
    ['op_1', 'x', ['q_0']],
  );

  it('resolves a violation path to the operation it names', () => {
    expect(operationIdFromPath(circuit, 'operations[1].targets[0]')).toBe(
      'op_1',
    );
  });

  it('resolves a bare operation path', () => {
    expect(operationIdFromPath(circuit, 'operations[0]')).toBe('op_0');
  });

  it('returns nothing for a path that names no operation', () => {
    expect(operationIdFromPath(circuit, 'qubits[0].index')).toBeUndefined();
  });

  it('returns nothing for an index past the end', () => {
    expect(operationIdFromPath(circuit, 'operations[9]')).toBeUndefined();
  });
});
