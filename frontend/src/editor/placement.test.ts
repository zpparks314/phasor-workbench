import { describe, expect, it } from 'vitest';

import { deriveCycles } from '../cycles';
import type { Circuit } from '../model/circuit';
import { insertOperation, moveOperation } from '../state/edits';
import { barrier, circuitWith, gate, measurement } from '../state/testCircuits';
import {
  insertionIndexFor,
  moveDestinationIndex,
  operationAt,
  operationIdFromPath,
} from './placement';

function indexFor(
  circuit: Circuit,
  qubits: string | readonly string[],
  column: number,
): number {
  const ids = typeof qubits === 'string' ? [qubits] : qubits;
  return insertionIndexFor(circuit, deriveCycles(circuit), ids, column);
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

describe('moveDestinationIndex', () => {
  const circuit = build(
    circuitWith(1),
    ['op_0', 'h', ['q_0']],
    ['op_1', 'x', ['q_0']],
    ['op_2', 'z', ['q_0']],
  );

  /**
   * Computed against the circuit with the operation removed. Left in place it
   * would be its own predecessor -- it sits on the wire it is moving along -- and
   * would position itself relative to where it already is.
   */
  it('moves an operation to the end of its wire', () => {
    expect(moveDestinationIndex(circuit, 'op_0', ['q_0'], 3)).toBe(2);
  });

  it('moves an operation to the front', () => {
    expect(moveDestinationIndex(circuit, 'op_2', ['q_0'], 0)).toBe(0);
  });

  it('is a no-op index when the column has not changed', () => {
    expect(moveDestinationIndex(circuit, 'op_1', ['q_0'], 1)).toBe(1);
  });

  it('produces an index moveOperation actually honours', () => {
    const index = moveDestinationIndex(circuit, 'op_0', ['q_0'], 3);
    const moved = moveOperation(circuit, 'op_0', index);

    expect(moved.operations.map((o) => o.id)).toEqual(['op_1', 'op_2', 'op_0']);
  });

  it('ignores operations on other wires', () => {
    const wide = build(
      circuitWith(2),
      ['op_0', 'h', ['q_0']],
      ['op_1', 'x', ['q_1']],
      ['op_2', 'z', ['q_1']],
    );

    expect(moveDestinationIndex(wide, 'op_0', ['q_0'], 5)).toBe(0);
  });

  /**
   * Regression. A cx occupies its control wire as surely as its target, and an
   * index computed from the target alone ignored everything on the control.
   *
   * Here the target wire q1 is empty, so scanning it alone found no predecessor
   * and returned 0 -- moving the cx to the *front* of the list. The derivation
   * then scheduled it at column 0, so dragging the gate right sent it far left.
   */
  describe('a multi-qubit operation counts every qubit it uses', () => {
    const circuit = build(
      circuitWith(2),
      ['op_0', 'h', ['q_0']],
      ['op_1', 'cx', ['q_1'], ['q_0']],
      ['op_2', 'x', ['q_0']],
    );

    it('lands where it was dragged rather than at the front', () => {
      const qubits = ['q_1', 'q_0'];
      const index = moveDestinationIndex(circuit, 'op_1', qubits, 2);
      const moved = moveOperation(circuit, 'op_1', index);
      const cycles = deriveCycles(moved);

      expect(cycles.cycles[2]).toEqual(['op_1']);
    });

    it('would have gone to the front counting the target alone', () => {
      // The old behaviour, kept as the contrast that makes the fix legible.
      expect(moveDestinationIndex(circuit, 'op_1', ['q_1'], 2)).toBe(0);
      expect(moveDestinationIndex(circuit, 'op_1', ['q_1', 'q_0'], 2)).toBe(2);
    });

    it('still moves to the front when that is what was asked', () => {
      const index = moveDestinationIndex(circuit, 'op_1', ['q_1', 'q_0'], 0);

      expect(index).toBe(0);
    });
  });

  /**
   * Regression. List order and cycle order agree along one wire and disagree
   * across wires, so "after the last operation before the column" could point
   * *past* an operation that has to follow.
   *
   * Here the two measurements are listed q0 then q1, but run in the opposite
   * order -- q1's lands a cycle earlier because nothing delays it. Scanning for
   * the last one before the column found the q1 measurement, later in the list,
   * and put the barrier after both. The barrier then no longer constrained the
   * q0 measurement, which visibly moved on its own.
   */
  describe('list order and cycle order disagree across wires', () => {
    const circuit: Circuit = {
      ...circuitWith(2),
      operations: [
        gate('op_0', 'h', ['q_0']),
        gate('op_1', 'x', ['q_0']),
        barrier('op_2', ['q_0', 'q_1']),
        measurement('op_3', 'q_0', 'c_0', 0),
        measurement('op_4', 'q_1', 'c_0', 1),
      ],
    };

    it('confirms the two measurements do run out of list order', () => {
      const without = {
        ...circuit,
        operations: circuit.operations.filter((o) => o.id !== 'op_2'),
      };
      const cycles = deriveCycles(without);
      const cycleOf = (id: string): number =>
        cycles.cycles.findIndex((ids) => ids.includes(id));

      // op_3 is listed first but runs later than op_4.
      expect(cycleOf('op_3')).toBeGreaterThan(cycleOf('op_4'));
    });

    it('keeps the barrier ahead of the operation it must precede', () => {
      const index = moveDestinationIndex(circuit, 'op_2', ['q_0', 'q_1'], 2);
      const moved = moveOperation(circuit, 'op_2', index);
      const order = moved.operations.map((o) => o.id);

      expect(order.indexOf('op_2')).toBeLessThan(order.indexOf('op_3'));
    });

    it('still delays the measurement it was placed to delay', () => {
      const index = moveDestinationIndex(circuit, 'op_2', ['q_0', 'q_1'], 2);
      const cycles = deriveCycles(moveOperation(circuit, 'op_2', index));
      const cycleOf = (id: string): number =>
        cycles.cycles.findIndex((ids) => ids.includes(id));

      expect(cycleOf('op_3')).toBe(cycleOf('op_4'));
    });
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
