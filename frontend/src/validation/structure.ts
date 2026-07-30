/**
 * The Structural rules from docs/CircuitModel.md.
 *
 * Mirrors `backend/src/phasor_workbench/validation/structure.py`. Identifier
 * length bounds, negative indices, and register sizes are schema concerns and
 * are not re-checked here.
 */

import type { Circuit } from '../model/circuit';
import * as paths from './paths';
import type { Violation } from './violations';

export function check(circuit: Circuit): Violation[] {
  return [
    ...duplicateQubitIds(circuit),
    ...duplicateRegisterIds(circuit),
    ...duplicateOperationIds(circuit),
    ...qubitIndices(circuit),
  ];
}

function duplicateQubitIds(circuit: Circuit): Violation[] {
  const violations: Violation[] = [];
  const seen = new Set<string>();

  circuit.qubits.forEach((qubit, index) => {
    if (seen.has(qubit.id)) {
      violations.push({
        code: 'DUPLICATE_IDENTIFIER',
        message: `Qubit id '${qubit.id}' is declared more than once.`,
        path: paths.qubit(index, 'id'),
      });
    }
    seen.add(qubit.id);
  });

  return violations;
}

function duplicateRegisterIds(circuit: Circuit): Violation[] {
  const violations: Violation[] = [];
  const seen = new Set<string>();

  circuit.classicalRegisters.forEach((register, index) => {
    if (seen.has(register.id)) {
      violations.push({
        code: 'DUPLICATE_IDENTIFIER',
        message: `Classical register id '${register.id}' is declared more than once.`,
        path: paths.register(index, 'id'),
      });
    }
    seen.add(register.id);
  });

  return violations;
}

function duplicateOperationIds(circuit: Circuit): Violation[] {
  const violations: Violation[] = [];
  const seen = new Set<string>();

  circuit.operations.forEach((operation, index) => {
    if (seen.has(operation.id)) {
      violations.push({
        code: 'DUPLICATE_IDENTIFIER',
        message: `Operation id '${operation.id}' is declared more than once.`,
        path: `${paths.operation(index)}.id`,
      });
    }
    seen.add(operation.id);
  });

  return violations;
}

/**
 * Indices must be a contiguous run from 0, in any declaration order.
 *
 * Order is not required because `index` carries the position on the wire stack;
 * the array's own order is incidental. A duplicate necessarily implies a gap, so
 * a duplicate is reported alone to keep one defect to one violation.
 */
function qubitIndices(circuit: Circuit): Violation[] {
  const violations: Violation[] = [];
  const owners = new Map<number, string>();

  circuit.qubits.forEach((qubit, position) => {
    const owner = owners.get(qubit.index);

    if (owner === undefined) {
      owners.set(qubit.index, qubit.id);
      return;
    }

    violations.push({
      code: 'DUPLICATE_QUBIT_INDEX',
      message:
        `Qubit index ${String(qubit.index)} is used by both ` +
        `'${owner}' and '${qubit.id}'.`,
      path: paths.qubit(position, 'index'),
    });
  });

  if (violations.length > 0) {
    return violations;
  }

  const missing: number[] = [];
  for (let index = 0; index < circuit.qubits.length; index += 1) {
    if (!owners.has(index)) {
      missing.push(index);
    }
  }

  if (missing.length > 0) {
    violations.push({
      code: 'QUBIT_INDEX_GAP',
      message:
        'Qubit indices must run contiguously from 0. ' +
        `Missing: ${missing.map(String).join(', ')}.`,
      path: 'qubits',
    });
  }

  return violations;
}
