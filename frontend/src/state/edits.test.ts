import { describe, expect, it } from 'vitest';

import {
  addClassicalRegister,
  addQubit,
  insertOperation,
  isRetargetable,
  moveOperation,
  operationsLostWithQubit,
  operationsLostWithRegister,
  removeClassicalRegister,
  removeOperation,
  removeQubit,
  renameCircuit,
  retargetOperation,
  setClassicalTarget,
  setParameters,
  setRegisterSize,
} from './edits';
import { validateCircuit } from '../validation';
import { barrier, circuitWith, gate, measurement } from './testCircuits';

describe('qubits', () => {
  it('appends at the next index', () => {
    const circuit = addQubit(circuitWith(2), { id: 'q_2', label: 'ancilla' });

    expect(circuit.qubits.at(-1)).toEqual({
      id: 'q_2',
      index: 2,
      label: 'ancilla',
    });
  });

  it('omits the label rather than storing undefined', () => {
    const circuit = addQubit(circuitWith(0), { id: 'q_0' });

    expect(circuit.qubits[0]).not.toHaveProperty('label');
  });

  it('renumbers the remaining qubits contiguously from 0', () => {
    const circuit = removeQubit(circuitWith(4), 'q_1');

    expect(circuit.qubits.map((q) => q.id)).toEqual(['q_0', 'q_2', 'q_3']);
    expect(circuit.qubits.map((q) => q.index)).toEqual([0, 1, 2]);
  });

  it('removes gates and measurements that act on the qubit', () => {
    const base = insertOperation(
      insertOperation(
        insertOperation(circuitWith(3), gate('op_0', 'h', ['q_0']), 0),
        gate('op_1', 'cx', ['q_2'], ['q_1']),
        1,
      ),
      measurement('op_2', 'q_1', 'c_0', 0),
      2,
    );

    const circuit = removeQubit(base, 'q_1');

    expect(circuit.operations.map((o) => o.id)).toEqual(['op_0']);
  });

  it('shrinks a barrier rather than removing it', () => {
    const base = insertOperation(
      circuitWith(3),
      barrier('op_0', ['q_0', 'q_1', 'q_2']),
      0,
    );

    const circuit = removeQubit(base, 'q_1');

    expect(circuit.operations[0]).toEqual({
      id: 'op_0',
      kind: 'barrier',
      targets: ['q_0', 'q_2'],
    });
  });

  it('drops a barrier left with no targets', () => {
    const base = insertOperation(circuitWith(1), barrier('op_0', ['q_0']), 0);

    expect(removeQubit(base, 'q_0').operations).toEqual([]);
  });

  it('leaves untouched operations identical by reference', () => {
    const untouched = gate('op_0', 'h', ['q_0']);
    const base = insertOperation(circuitWith(2), untouched, 0);

    expect(removeQubit(base, 'q_1').operations[0]).toBe(untouched);
  });

  it('rejects a qubit that does not exist', () => {
    expect(() => removeQubit(circuitWith(1), 'q_9')).toThrow('q_9');
  });
});

describe('classical registers', () => {
  it('adds a register', () => {
    const circuit = addClassicalRegister(circuitWith(1), {
      id: 'c_1',
      size: 3,
    });

    expect(circuit.classicalRegisters.at(-1)).toEqual({ id: 'c_1', size: 3 });
  });

  it('removes measurements writing into a removed register', () => {
    const base = insertOperation(
      insertOperation(circuitWith(2), gate('op_0', 'h', ['q_0']), 0),
      measurement('op_1', 'q_0', 'c_0', 0),
      1,
    );

    const circuit = removeClassicalRegister(base, 'c_0');

    expect(circuit.classicalRegisters).toEqual([]);
    expect(circuit.operations.map((o) => o.id)).toEqual(['op_0']);
  });

  it('rejects a register that does not exist', () => {
    expect(() => removeClassicalRegister(circuitWith(1), 'c_9')).toThrow('c_9');
  });
});

describe('setRegisterSize', () => {
  it('resizes a register', () => {
    const circuit = setRegisterSize(circuitWith(1), 'c_0', 5);

    expect(circuit.classicalRegisters[0]?.size).toBe(5);
  });

  /**
   * ADR-0007 section 7: edits do not validate, and this is a state the user can
   * edit their way out of -- grow the register back, or remove the measurement.
   * `validateCircuit` reports CLASSICAL_BIT_OUT_OF_RANGE meanwhile. Refusing is
   * reserved for a state with no repair path, which this is not.
   */
  it('allows shrinking below a bit a measurement writes to', () => {
    const base = insertOperation(
      circuitWith(1, 4),
      measurement('op_0', 'q_0', 'c_0', 3),
      0,
    );

    const circuit = setRegisterSize(base, 'c_0', 1);

    expect(circuit.classicalRegisters[0]?.size).toBe(1);
    expect(circuit.operations).toHaveLength(1);
  });

  it('rejects a size below the schema floor of one bit', () => {
    expect(() => setRegisterSize(circuitWith(1), 'c_0', 0)).toThrow(/above 0/);
  });

  it('rejects a fractional size', () => {
    expect(() => setRegisterSize(circuitWith(1), 'c_0', 1.5)).toThrow(
      /above 0/,
    );
  });

  it('rejects a register that does not exist', () => {
    expect(() => setRegisterSize(circuitWith(1), 'c_9', 2)).toThrow('c_9');
  });
});

/**
 * What a removal confirmation is allowed to claim.
 *
 * Computed by running the edit rather than restating its rules, because the
 * rules are not obvious: a barrier over the qubit is shrunk rather than
 * removed, so it is not lost.
 */
describe('counting what a removal destroys', () => {
  it('counts gates and measurements on the qubit', () => {
    const base = insertOperation(
      insertOperation(circuitWith(2), gate('op_0', 'h', ['q_0']), 0),
      measurement('op_1', 'q_0', 'c_0', 0),
      1,
    );

    expect(operationsLostWithQubit(base, 'q_0')).toBe(2);
  });

  it('counts a gate controlled by the qubit, not only targeted on it', () => {
    const base = insertOperation(
      circuitWith(2),
      gate('op_0', 'cx', ['q_1'], ['q_0']),
      0,
    );

    expect(operationsLostWithQubit(base, 'q_0')).toBe(1);
  });

  it('does not count a barrier that merely shrinks', () => {
    const base = insertOperation(
      circuitWith(3),
      barrier('op_0', ['q_0', 'q_1']),
      0,
    );

    expect(operationsLostWithQubit(base, 'q_0')).toBe(0);
    expect(removeQubit(base, 'q_0').operations).toHaveLength(1);
  });

  it('counts a barrier left with no targets at all', () => {
    const base = insertOperation(circuitWith(2), barrier('op_0', ['q_0']), 0);

    expect(operationsLostWithQubit(base, 'q_0')).toBe(1);
  });

  it('counts measurements writing into the register', () => {
    const base = insertOperation(
      insertOperation(circuitWith(2), gate('op_0', 'h', ['q_0']), 0),
      measurement('op_1', 'q_0', 'c_0', 0),
      1,
    );

    expect(operationsLostWithRegister(base, 'c_0')).toBe(1);
  });

  it('counts nothing for an unused register', () => {
    expect(operationsLostWithRegister(circuitWith(2), 'c_0')).toBe(0);
  });
});

describe('operations', () => {
  it('inserts at a position in the canonical list', () => {
    const base = insertOperation(
      insertOperation(circuitWith(2), gate('op_0', 'h', ['q_0']), 0),
      gate('op_1', 'x', ['q_1']),
      1,
    );

    const circuit = insertOperation(base, gate('op_2', 'z', ['q_0']), 1);

    expect(circuit.operations.map((o) => o.id)).toEqual([
      'op_0',
      'op_2',
      'op_1',
    ]);
  });

  it('accepts an insertion at the end of the list', () => {
    const circuit = insertOperation(
      circuitWith(1),
      gate('op_0', 'h', ['q_0']),
      0,
    );

    expect(circuit.operations).toHaveLength(1);
  });

  it('rejects a position outside the list', () => {
    expect(() =>
      insertOperation(circuitWith(1), gate('op_0', 'h', ['q_0']), 2),
    ).toThrow('outside the valid range');
  });

  it('removes by identifier', () => {
    const base = insertOperation(circuitWith(1), gate('op_0', 'h', ['q_0']), 0);

    expect(removeOperation(base, 'op_0').operations).toEqual([]);
  });

  it('rejects removing an operation that does not exist', () => {
    expect(() => removeOperation(circuitWith(1), 'op_9')).toThrow('op_9');
  });
});

describe('moveOperation', () => {
  const base = ['op_0', 'op_1', 'op_2'].reduce(
    (circuit, id, index) =>
      insertOperation(circuit, gate(id, 'h', [`q_${String(index)}`]), index),
    circuitWith(3),
  );

  it('places the operation at the requested index of the result', () => {
    expect(moveOperation(base, 'op_0', 2).operations.map((o) => o.id)).toEqual([
      'op_1',
      'op_2',
      'op_0',
    ]);
  });

  it('moves backwards as well as forwards', () => {
    expect(moveOperation(base, 'op_2', 0).operations.map((o) => o.id)).toEqual([
      'op_2',
      'op_0',
      'op_1',
    ]);
  });

  /**
   * ADR-0007 section 6. Remove-and-reinsert would mint a new identifier and break
   * selection and undo anchoring while producing a circuit that looks correct, so
   * this asserts reference identity rather than deep equality.
   */
  it('carries the same operation object across, preserving its identifier', () => {
    const moved = base.operations[0];
    expect(moveOperation(base, 'op_0', 2).operations[2]).toBe(moved);
  });

  it('rejects a destination outside the list', () => {
    expect(() => moveOperation(base, 'op_0', 3)).toThrow(
      'outside the valid range',
    );
  });

  /**
   * The store records nothing for an edit that returns its input, so a drag that
   * wanders without changing the order costs no undo step.
   */
  it('returns the circuit untouched when it is already there', () => {
    expect(moveOperation(base, 'op_1', 1)).toBe(base);
  });
});

describe('retargetOperation', () => {
  const base = insertOperation(circuitWith(2), gate('op_0', 'h', ['q_0']), 0);

  it('moves a single-qubit gate to another wire', () => {
    expect(retargetOperation(base, 'op_0', 'q_1').operations[0]).toMatchObject({
      targets: ['q_1'],
    });
  });

  it('preserves the identifier', () => {
    expect(retargetOperation(base, 'op_0', 'q_1').operations[0]?.id).toBe(
      'op_0',
    );
  });

  it('retargets a measurement, leaving its classical target alone', () => {
    const measured = insertOperation(
      circuitWith(2),
      measurement('op_0', 'q_0', 'c_0', 1),
      0,
    );

    expect(
      retargetOperation(measured, 'op_0', 'q_1').operations[0],
    ).toMatchObject({
      targets: ['q_1'],
      classicalTarget: { register: 'c_0', bit: 1 },
    });
  });

  /**
   * Moving a cx to another wire could mean the target, the control, or both.
   * Guessing would produce a circuit the user did not ask for, silently.
   */
  it('refuses an operation naming more than one qubit', () => {
    const controlled = insertOperation(
      circuitWith(3),
      gate('op_0', 'cx', ['q_1'], ['q_0']),
      0,
    );

    expect(() => retargetOperation(controlled, 'op_0', 'q_2')).toThrow(
      'ambiguous',
    );
  });

  it('refuses a two-target gate', () => {
    const swapped = insertOperation(
      circuitWith(3),
      gate('op_0', 'swap', ['q_0', 'q_1']),
      0,
    );

    expect(() => retargetOperation(swapped, 'op_0', 'q_2')).toThrow(
      'ambiguous',
    );
  });

  it('agrees with isRetargetable', () => {
    const single = gate('op_0', 'h', ['q_0']);
    const controlled = gate('op_1', 'cx', ['q_1'], ['q_0']);
    const spanning = gate('op_2', 'swap', ['q_0', 'q_1']);

    expect(isRetargetable(single)).toBe(true);
    expect(isRetargetable(controlled)).toBe(false);
    expect(isRetargetable(spanning)).toBe(false);
    expect(isRetargetable(barrier('op_3', ['q_0', 'q_1']))).toBe(false);
  });
});

describe('setParameters', () => {
  const base = insertOperation(circuitWith(1), gate('op_0', 'rx', ['q_0']), 0);

  it('replaces a gate parameter map', () => {
    const circuit = setParameters(base, 'op_0', { theta: Math.PI / 2 });

    expect(circuit.operations[0]).toMatchObject({
      parameters: { theta: Math.PI / 2 },
    });
  });

  it("copies the map rather than aliasing the caller's", () => {
    const parameters = { theta: 1 };
    const circuit = setParameters(base, 'op_0', parameters);
    parameters.theta = 2;

    expect(circuit.operations[0]).toMatchObject({ parameters: { theta: 1 } });
  });

  it('refuses an operation that cannot carry parameters', () => {
    const withBarrier = insertOperation(
      circuitWith(1),
      barrier('op_1', ['q_0']),
      0,
    );

    expect(() => setParameters(withBarrier, 'op_1', {})).toThrow(
      'only gates carry parameters',
    );
  });
});

describe('setClassicalTarget', () => {
  const base = insertOperation(
    addClassicalRegister(circuitWith(1), { id: 'c_1', size: 4 }),
    measurement('op_0', 'q_0', 'c_0', 0),
    0,
  );

  it('retargets a measurement at another register', () => {
    const circuit = setClassicalTarget(base, 'op_0', {
      register: 'c_1',
      bit: 2,
    });

    expect(circuit.operations[0]).toMatchObject({
      classicalTarget: { register: 'c_1', bit: 2 },
    });
  });

  it("copies the target rather than aliasing the caller's", () => {
    const target = { register: 'c_1', bit: 1 };
    const circuit = setClassicalTarget(base, 'op_0', target);
    target.bit = 3;

    expect(circuit.operations[0]).toMatchObject({
      classicalTarget: { bit: 1 },
    });
  });

  /**
   * The mirror of `setRegisterSize` allowing a shrink below a written bit. The
   * same circuit is reachable from either control, so refusing it here would
   * make its legality depend on which one produced it. `validateCircuit`
   * reports CLASSICAL_BIT_OUT_OF_RANGE and both repairs stay available.
   */
  it('allows a bit beyond the register size', () => {
    const circuit = setClassicalTarget(base, 'op_0', {
      register: 'c_0',
      bit: 9,
    });

    expect(circuit.operations[0]).toMatchObject({
      classicalTarget: { bit: 9 },
    });
    expect(validateCircuit(circuit).violations.map((v) => v.code)).toContain(
      'CLASSICAL_BIT_OUT_OF_RANGE',
    );
  });

  it('refuses an operation that carries no classical target', () => {
    const withGate = insertOperation(
      circuitWith(1),
      gate('op_1', 'h', ['q_0']),
      0,
    );

    expect(() =>
      setClassicalTarget(withGate, 'op_1', { register: 'c_0', bit: 0 }),
    ).toThrow('only measurements carry a classical target');
  });

  // Refused rather than reported, unlike the out-of-range bit above: nothing in
  // the document names this register, so no control the user has could repair
  // the dangling reference.
  it('refuses a register that does not exist', () => {
    expect(() =>
      setClassicalTarget(base, 'op_0', { register: 'c_9', bit: 0 }),
    ).toThrow('c_9');
  });

  it.each([-1, 1.5])('refuses a shape-invalid bit (%s)', (bit) => {
    expect(() =>
      setClassicalTarget(base, 'op_0', { register: 'c_0', bit }),
    ).toThrow('must be an integer');
  });
});

describe('purity', () => {
  it('leaves the input circuit untouched', () => {
    const before = circuitWith(2);
    const snapshot = structuredClone(before);

    addQubit(before, { id: 'q_2' });
    insertOperation(before, gate('op_0', 'h', ['q_0']), 0);
    renameCircuit(before, 'renamed');

    expect(before).toEqual(snapshot);
  });

  it('returns the same result for the same input', () => {
    const before = circuitWith(2);

    expect(addQubit(before, { id: 'q_2' })).toEqual(
      addQubit(before, { id: 'q_2' }),
    );
  });
});
