import { describe, expect, it } from 'vitest';

import { GATE_SIGNATURES } from '../model/spec';
import {
  assignQubit,
  beginPending,
  canAssign,
  describeRemaining,
  isSatisfied,
  nextRole,
  pendingAnchors,
  pendingOperation,
  qubitsRequired,
  type PendingOperation,
} from './pending';
import type { GateName } from '../model/circuit';

function begin(name: GateName, qubitId: string, column = 0): PendingOperation {
  return beginPending(name, GATE_SIGNATURES[name], qubitId, column);
}

/** Click through a whole sequence, as the canvas does one cell at a time. */
function assignAll(
  name: GateName,
  qubits: readonly [string, ...string[]],
  column = 0,
): PendingOperation {
  const [first, ...rest] = qubits;
  return rest.reduce(
    (pending, qubitId) => assignQubit(pending, qubitId),
    begin(name, first, column),
  );
}

describe('how many wires a gate asks for', () => {
  /**
   * The sequence is driven by the signature, never by the gate's name or its
   * qubit total. A gate added to the shared spec gets its sequence for free.
   */
  it('counts targets and controls together', () => {
    expect(qubitsRequired(GATE_SIGNATURES.h)).toBe(1);
    expect(qubitsRequired(GATE_SIGNATURES.cx)).toBe(2);
    expect(qubitsRequired(GATE_SIGNATURES.swap)).toBe(2);
    expect(qubitsRequired(GATE_SIGNATURES.ccx)).toBe(3);
  });

  it('satisfies a single-qubit gate on its first click', () => {
    expect(isSatisfied(begin('h', 'q_0'))).toBe(true);
  });

  it('leaves a two-qubit gate outstanding after one click', () => {
    expect(isSatisfied(begin('cx', 'q_0'))).toBe(false);
  });
});

describe('assigning wires', () => {
  it('takes targets before controls', () => {
    expect(nextRole(begin('cx', 'q_0'))).toBe('control');
  });

  /** swap is two targets and no controls -- the second click is a target. */
  it('takes a second target for swap rather than a control', () => {
    expect(nextRole(begin('swap', 'q_0'))).toBe('target');
  });

  it('gives each assigned wire the role its position earns', () => {
    expect(pendingAnchors(assignAll('ccx', ['q_0', 'q_1', 'q_2']))).toEqual([
      { qubitId: 'q_0', role: 'target' },
      { qubitId: 'q_1', role: 'control' },
      { qubitId: 'q_2', role: 'control' },
    ]);
  });

  it('reports nothing left once the signature is satisfied', () => {
    const done = assignAll('cx', ['q_0', 'q_1']);

    expect(nextRole(done)).toBeNull();
    expect(describeRemaining(done)).toBeNull();
  });
});

/**
 * A wire already assigned is refused rather than taken twice.
 *
 * Allowing it commits a `cx` controlled by its own target, which validation
 * reports as QUBIT_REUSED_IN_OPERATION -- but no edit in the vocabulary can
 * repair it, since `retargetOperation` throws for a multi-qubit operation by
 * design and moving one only changes its column. The user would be left with an
 * operation they can only delete.
 */
describe('refusing a wire that is already assigned', () => {
  it('refuses the wire the target is already on', () => {
    expect(canAssign(begin('cx', 'q_0'), 'q_0')).toBe(false);
  });

  it('accepts any other wire', () => {
    expect(canAssign(begin('cx', 'q_0'), 'q_1')).toBe(true);
  });

  it('refuses every wire once the signature is satisfied', () => {
    expect(canAssign(assignAll('cx', ['q_0', 'q_1']), 'q_2')).toBe(false);
  });

  it('throws rather than silently duplicating, if a caller ignores canAssign', () => {
    expect(() => assignQubit(begin('cx', 'q_0'), 'q_0')).toThrow(/cannot be/);
  });
});

describe('the status line prompt', () => {
  it('states the count when more than one wire is wanted', () => {
    expect(describeRemaining(begin('ccx', 'q_0'))).toBe(
      'Click a wire to place 2 controls',
    );
  });

  it('names the role alone when one wire is wanted', () => {
    expect(describeRemaining(assignAll('ccx', ['q_0', 'q_1']))).toBe(
      'Click a wire to place the control',
    );
  });

  it('asks for a target where the next wire is one', () => {
    expect(describeRemaining(begin('swap', 'q_0'))).toBe(
      'Click a wire to place the target',
    );
  });
});

describe('the operation a satisfied placement commits', () => {
  it('splits the assigned wires into targets and controls', () => {
    expect(pendingOperation(assignAll('cx', ['q_1', 'q_0']), 'op_0')).toEqual({
      id: 'op_0',
      kind: 'gate',
      name: 'cx',
      targets: ['q_1'],
      controls: ['q_0'],
      parameters: {},
    });
  });

  it('gives swap both wires as targets', () => {
    expect(pendingOperation(assignAll('swap', ['q_0', 'q_1']), 'op_0')).toEqual(
      {
        id: 'op_0',
        kind: 'gate',
        name: 'swap',
        targets: ['q_0', 'q_1'],
        controls: [],
        parameters: {},
      },
    );
  });

  it('carries both of a ccx control wires', () => {
    const operation = pendingOperation(
      assignAll('ccx', ['q_0', 'q_1', 'q_2']),
      'op_0',
    );

    expect(operation).toMatchObject({
      targets: ['q_0'],
      controls: ['q_1', 'q_2'],
    });
  });

  /** The identifier is an argument, so the edit stays pure. See state/edits.ts. */
  it('takes its identifier rather than minting one', () => {
    expect(pendingOperation(assignAll('cx', ['q_0', 'q_1']), 'given').id).toBe(
      'given',
    );
  });

  it('refuses to commit before the signature is satisfied', () => {
    expect(() => pendingOperation(begin('cx', 'q_0'), 'op_0')).toThrow(
      /needs 2 qubits/,
    );
  });
});
