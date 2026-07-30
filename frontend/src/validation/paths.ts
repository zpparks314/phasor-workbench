/**
 * Locating a problem within the submitted document.
 *
 * Mirrors `backend/src/phasor_workbench/validation/paths.py`, and must produce
 * byte-identical paths for the same defect. Format is documented in
 * docs/API.md: `operations[4].targets[0]`.
 *
 * The frontend has an easier time of this than Python, whose generated models
 * rename `classicalTarget` and alias it back on the wire. Here the field names
 * already are the wire names.
 */

import type { Operation } from '../model/circuit';

export function operation(index: number): string {
  return `operations[${String(index)}]`;
}

export function qubit(index: number, field: string): string {
  return `qubits[${String(index)}].${field}`;
}

export function register(index: number, field: string): string {
  return `classicalRegisters[${String(index)}].${field}`;
}

export interface QubitReference {
  readonly id: string;
  readonly path: string;
}

/**
 * Every qubit an operation names: targets first, then controls, in document
 * order.
 *
 * `controls` is optional in the generated TypeScript but defaulted in Python,
 * so this is one of the few places the two bindings genuinely differ in shape.
 * The empty fallback is what keeps the two implementations agreeing.
 */
export function qubitReferences(
  op: Operation,
  index: number,
): QubitReference[] {
  const references: QubitReference[] = op.targets.map((target, position) => ({
    id: target,
    path: `${operation(index)}.targets[${String(position)}]`,
  }));

  if (op.kind === 'gate') {
    const controls: readonly string[] = op.controls ?? [];
    controls.forEach((control, position) => {
      references.push({
        id: control,
        path: `${operation(index)}.controls[${String(position)}]`,
      });
    });
  }

  return references;
}
