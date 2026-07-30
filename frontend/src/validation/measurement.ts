/**
 * Measurement terminates a qubit.
 *
 * Mirrors `backend/src/phasor_workbench/validation/measurement.py`. The Semantic
 * group in docs/CircuitModel.md; its other rule -- a gate name outside the known
 * set -- is enforced by the schema's enum.
 *
 * **Barriers are exempt**, and that exemption is load-bearing rather than a
 * convenience: without it a full-width barrier placed after measurement would be
 * invalid, and an importer expanding OpenQASM's bare `barrier;` to every qubit
 * would turn valid input into invalid circuits.
 */

import type { Circuit, Operation } from '../model/circuit';
import * as paths from './paths';
import type { Violation } from './violations';

export function check(circuit: Circuit): Violation[] {
  const violations: Violation[] = [];
  const measuredBy = new Map<string, string>();

  circuit.operations.forEach((operation, index) => {
    if (operation.kind === 'barrier') {
      return;
    }

    const touched = [
      ...new Set(
        paths
          .qubitReferences(operation, index)
          .map((reference) => reference.id)
          .filter((id) => measuredBy.has(id)),
      ),
    ].sort();

    if (touched.length > 0) {
      violations.push({
        code: 'OPERATION_AFTER_MEASUREMENT',
        message: message(operation, touched, measuredBy),
        path: paths.operation(index),
      });
    }

    if (operation.kind === 'measurement') {
      paths.qubitReferences(operation, index).forEach((reference) => {
        if (!measuredBy.has(reference.id)) {
          measuredBy.set(reference.id, operation.id);
        }
      });
    }
  });

  return violations;
}

function message(
  operation: Operation,
  touched: readonly string[],
  measuredBy: ReadonlyMap<string, string>,
): string {
  const wires = touched.map((id) => `'${id}'`).join(', ');
  const by = touched.map((id) => `'${measuredBy.get(id) ?? ''}'`).join(', ');
  const subject = operation.kind === 'measurement' ? 'Measuring' : 'Acting on';

  return (
    `${subject} ${wires} is not allowed: already measured by ${by}. ` +
    'A measured qubit is terminal while mid-circuit measurement is deferred.'
  );
}
