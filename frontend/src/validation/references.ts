/**
 * The Reference rules from docs/CircuitModel.md.
 *
 * Mirrors `backend/src/phasor_workbench/validation/references.py`. Every
 * identifier an operation names must resolve. This is where an unconstrained
 * `IdentifierRef` is validated: resolution is strictly stronger than a length
 * check, because a resolved id already satisfied `Identifier` where it was
 * minted.
 */

import type {
  Circuit,
  MeasurementOperation,
  Operation,
} from '../model/circuit';
import * as paths from './paths';
import type { Violation } from './violations';

export function check(circuit: Circuit): Violation[] {
  const qubitIds = new Set(circuit.qubits.map((qubit) => qubit.id));
  const registerSizes = new Map(
    circuit.classicalRegisters.map((register) => [register.id, register.size]),
  );

  const violations: Violation[] = [];

  circuit.operations.forEach((operation, index) => {
    violations.push(...qubitReferences(operation, index, qubitIds));

    if (operation.kind === 'measurement') {
      violations.push(...classicalTarget(operation, index, registerSizes));
    }
  });

  return violations;
}

function qubitReferences(
  operation: Operation,
  index: number,
  qubitIds: ReadonlySet<string>,
): Violation[] {
  return paths
    .qubitReferences(operation, index)
    .filter((reference) => !qubitIds.has(reference.id))
    .map((reference) => ({
      code: 'UNKNOWN_QUBIT_REFERENCE' as const,
      message: `Operation references qubit '${reference.id}', which does not exist.`,
      path: reference.path,
    }));
}

function classicalTarget(
  operation: MeasurementOperation,
  index: number,
  registerSizes: ReadonlyMap<string, number>,
): Violation[] {
  const target = operation.classicalTarget;
  const size = registerSizes.get(target.register);

  if (size === undefined) {
    return [
      {
        code: 'UNKNOWN_REGISTER_REFERENCE',
        message:
          `Measurement writes to classical register '${target.register}', ` +
          'which is not declared.',
        path: `${paths.operation(index)}.classicalTarget.register`,
      },
    ];
  }

  // The bit range is meaningless without a register. Reporting both would make
  // one mistake look like two.
  if (target.bit >= size) {
    return [
      {
        code: 'CLASSICAL_BIT_OUT_OF_RANGE',
        message:
          `Bit ${String(target.bit)} is outside register '${target.register}', ` +
          `which has size ${String(size)} (valid bits 0 to ${String(size - 1)}).`,
        path: `${paths.operation(index)}.classicalTarget.bit`,
      },
    ];
  }

  return [];
}
