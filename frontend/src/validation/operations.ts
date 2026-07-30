/**
 * The Operational rules from docs/CircuitModel.md.
 *
 * Mirrors `backend/src/phasor_workbench/validation/operations.py`. Arity and
 * parameter names come from the generated signatures in
 * shared/spec/circuit.spec.json, never from a table here -- that duplication is
 * what ADR-0005 exists to remove.
 */

import type { Circuit, GateOperation, Operation } from '../model/circuit';
import { GATE_SIGNATURES } from '../model/spec';
import * as paths from './paths';
import type { Violation } from './violations';

export function check(circuit: Circuit): Violation[] {
  const violations: Violation[] = [];

  circuit.operations.forEach((operation, index) => {
    violations.push(...repeatedQubits(operation, index));

    if (operation.kind === 'gate') {
      violations.push(...arity(operation, index));
      violations.push(...parameters(operation, index));
    }
  });

  return violations;
}

/**
 * No qubit may appear twice in one operation, across targets and controls.
 *
 * Covers a barrier naming the same wire twice as well as a controlled gate whose
 * control is also its target.
 */
function repeatedQubits(operation: Operation, index: number): Violation[] {
  const violations: Violation[] = [];
  const seen = new Set<string>();

  paths.qubitReferences(operation, index).forEach((reference) => {
    if (seen.has(reference.id)) {
      violations.push({
        code: 'QUBIT_REUSED_IN_OPERATION',
        message:
          `Operation '${operation.id}' names qubit '${reference.id}' ` +
          'more than once.',
        path: reference.path,
      });
    }
    seen.add(reference.id);
  });

  return violations;
}

function arity(operation: GateOperation, index: number): Violation[] {
  const signature = GATE_SIGNATURES[operation.name];
  const controls = operation.controls ?? [];
  const violations: Violation[] = [];

  if (operation.targets.length !== signature.targets) {
    violations.push({
      code: 'GATE_ARITY_MISMATCH',
      message:
        `Gate '${operation.name}' takes ${String(signature.targets)} ` +
        `target(s), but ${String(operation.targets.length)} were given.`,
      path: `${paths.operation(index)}.targets`,
    });
  }

  if (controls.length !== signature.controls) {
    violations.push({
      code: 'GATE_ARITY_MISMATCH',
      message:
        `Gate '${operation.name}' takes ${String(signature.controls)} ` +
        `control(s), but ${String(controls.length)} were given.`,
      path: `${paths.operation(index)}.controls`,
    });
  }

  return violations;
}

function parameters(operation: GateOperation, index: number): Violation[] {
  const required = GATE_SIGNATURES[operation.name].parameters;
  const supplied = operation.parameters ?? {};
  const suppliedNames = Object.keys(supplied);
  const violations: Violation[] = [];

  required
    .filter((name) => !suppliedNames.includes(name))
    .sort()
    .forEach((name) => {
      violations.push({
        code: 'PARAMETER_MISSING',
        message:
          `Gate '${operation.name}' requires parameter '${name}', ` +
          'which is absent.',
        path: `${paths.operation(index)}.parameters`,
      });
    });

  suppliedNames
    .filter((name) => !required.includes(name))
    .sort()
    .forEach((name) => {
      violations.push({
        code: 'PARAMETER_UNKNOWN',
        message: `Gate '${operation.name}' does not take a parameter named '${name}'.`,
        path: `${paths.operation(index)}.parameters.${name}`,
      });
    });

  // Only recognized parameters, so a single bad field reports one defect rather
  // than both "unknown" and "not finite".
  required
    .filter((name) => suppliedNames.includes(name))
    .sort()
    .forEach((name) => {
      const value = supplied[name];
      if (value !== undefined && !Number.isFinite(value)) {
        violations.push({
          code: 'PARAMETER_NOT_FINITE',
          message: `Parameter '${name}' must be a finite number, got ${String(value)}.`,
          path: `${paths.operation(index)}.parameters.${name}`,
        });
      }
    });

  return violations;
}
