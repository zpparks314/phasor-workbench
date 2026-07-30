/**
 * The edit vocabulary: every way a circuit may change.
 *
 * Each function is pure -- it takes a circuit, returns a new one, mutates
 * nothing, and depends on nothing but its arguments. That is ADR-0007 section 1,
 * and everything else in this module follows from it: snapshots are cheap because
 * unchanged objects are shared by reference, and the history property test is
 * possible because an edit applied to the same input twice gives the same output.
 *
 * Identifiers are arguments rather than minted here. See `./identifiers`.
 *
 * **Edits do not validate.** A circuit that fails semantic validation is a
 * legitimate intermediate state -- assembling a controlled gate passes through
 * one, and so does declaring a register after the measurement that names it.
 * `validateCircuit` reports on the result and the UI surfaces it. See ADR-0007
 * section 7.
 *
 * What edits *do* reject is an unresolvable reference, because that is a bug in
 * the caller rather than a state a user can reach: removing an operation that is
 * not there means the caller is working from a stale circuit, and returning the
 * input unchanged would hide it. Per CLAUDE.md, fail predictably rather than
 * silently.
 */

import type {
  Circuit,
  ClassicalRegister,
  Operation,
  Qubit,
} from '../model/circuit';

export interface NewQubit {
  readonly id: string;
  readonly label?: string;
}

export interface NewClassicalRegister {
  readonly id: string;
  readonly size: number;
  readonly label?: string;
}

/** Append a qubit at the next index, keeping indices contiguous from 0. */
export function addQubit(circuit: Circuit, qubit: NewQubit): Circuit {
  const added: Qubit = {
    id: qubit.id,
    index: circuit.qubits.length,
    ...(qubit.label !== undefined && { label: qubit.label }),
  };
  return { ...circuit, qubits: [...circuit.qubits, added] };
}

/**
 * Remove a qubit, everything that acts on it, and renumber what remains.
 *
 * Gates and measurements naming the qubit are removed outright -- a `cx` with one
 * qubit is not a smaller gate, it is nothing.
 *
 * **A barrier is shrunk rather than removed.** It is an authoring constraint over
 * a set of qubits, and the constraint on the others survives one of them leaving.
 * A barrier left with no targets is dropped, since empty targets are
 * shape-invalid.
 *
 * Indices are renumbered because CircuitModel.md requires contiguity from 0.
 * Labels are what the user reads; indices are structure.
 */
export function removeQubit(circuit: Circuit, qubitId: string): Circuit {
  requireQubit(circuit, qubitId);

  return {
    ...circuit,
    qubits: circuit.qubits
      .filter((qubit) => qubit.id !== qubitId)
      .map((qubit, index) => ({ ...qubit, index })),
    operations: circuit.operations.flatMap((operation) =>
      withoutQubit(operation, qubitId),
    ),
  };
}

export function addClassicalRegister(
  circuit: Circuit,
  register: NewClassicalRegister,
): Circuit {
  const added: ClassicalRegister = {
    id: register.id,
    size: register.size,
    ...(register.label !== undefined && { label: register.label }),
  };
  return {
    ...circuit,
    classicalRegisters: [...circuit.classicalRegisters, added],
  };
}

/** Remove a register and every measurement writing into it. */
export function removeClassicalRegister(
  circuit: Circuit,
  registerId: string,
): Circuit {
  if (!circuit.classicalRegisters.some((r) => r.id === registerId)) {
    throw new Error(`No classical register with id ${registerId}.`);
  }

  return {
    ...circuit,
    classicalRegisters: circuit.classicalRegisters.filter(
      (register) => register.id !== registerId,
    ),
    operations: circuit.operations.filter(
      (operation) =>
        operation.kind !== 'measurement' ||
        operation.classicalTarget.register !== registerId,
    ),
  };
}

/**
 * Insert an operation at a position in the canonical list.
 *
 * The index is a position in the flat list, not a render column. Translating a
 * drop column into an index is the editor's job -- see the placement rule in
 * UI.md -- and the derivation decides where the operation actually appears.
 */
export function insertOperation(
  circuit: Circuit,
  operation: Operation,
  index: number,
): Circuit {
  requirePosition(index, circuit.operations.length);

  const operations = [...circuit.operations];
  operations.splice(index, 0, operation);
  return { ...circuit, operations };
}

export function removeOperation(
  circuit: Circuit,
  operationId: string,
): Circuit {
  locate(circuit, operationId);

  return {
    ...circuit,
    operations: circuit.operations.filter(
      (operation) => operation.id !== operationId,
    ),
  };
}

/**
 * Reorder an operation to a new position, preserving its identifier.
 *
 * `toIndex` is the position the operation occupies in the *returned* circuit.
 *
 * ADR-0007 section 6 requires this to reorder rather than remove and reinsert.
 * The operation object is carried across untouched, so identity is preserved by
 * construction rather than by remembering to copy the id -- an id minted here
 * would silently break selection and undo anchoring while producing a circuit
 * that looks right.
 */
export function moveOperation(
  circuit: Circuit,
  operationId: string,
  toIndex: number,
): Circuit {
  const { operation, index } = locate(circuit, operationId);
  requirePosition(toIndex, circuit.operations.length - 1);

  const operations = circuit.operations.filter((_, at) => at !== index);
  operations.splice(toIndex, 0, operation);
  return { ...circuit, operations };
}

/**
 * Replace a gate's parameters wholesale.
 *
 * Parameters are in radians, per CircuitModel.md. Which ones a gate requires is
 * `validateCircuit`'s business, not this function's.
 */
export function setParameters(
  circuit: Circuit,
  operationId: string,
  parameters: Readonly<Record<string, number>>,
): Circuit {
  const { operation, index } = locate(circuit, operationId);
  if (operation.kind !== 'gate') {
    throw new Error(
      `Operation ${operationId} is a ${operation.kind}; only gates carry parameters.`,
    );
  }

  const operations = [...circuit.operations];
  operations[index] = { ...operation, parameters: { ...parameters } };
  return { ...circuit, operations };
}

/** Metadata only -- the name never affects execution. */
export function renameCircuit(circuit: Circuit, name: string): Circuit {
  return { ...circuit, name };
}

function withoutQubit(operation: Operation, qubitId: string): Operation[] {
  if (operation.kind === 'barrier') {
    if (!operation.targets.includes(qubitId)) return [operation];
    const targets = nonEmpty(
      operation.targets.filter((target) => target !== qubitId),
    );
    return targets === undefined ? [] : [{ ...operation, targets }];
  }

  return touches(operation, qubitId) ? [] : [operation];
}

function touches(operation: Operation, qubitId: string): boolean {
  if (operation.targets.includes(qubitId)) return true;
  return operation.kind === 'gate'
    ? (operation.controls ?? []).includes(qubitId)
    : false;
}

/** The schema types `targets` as a non-empty tuple, so narrowing is required. */
function nonEmpty(
  targets: readonly string[],
): [string, ...string[]] | undefined {
  const [first, ...rest] = targets;
  return first === undefined ? undefined : [first, ...rest];
}

function locate(
  circuit: Circuit,
  operationId: string,
): { readonly operation: Operation; readonly index: number } {
  const index = circuit.operations.findIndex(
    (operation) => operation.id === operationId,
  );
  const operation = circuit.operations[index];
  if (operation === undefined) {
    throw new Error(`No operation with id ${operationId}.`);
  }
  return { operation, index };
}

function requireQubit(circuit: Circuit, qubitId: string): void {
  if (!circuit.qubits.some((qubit) => qubit.id === qubitId)) {
    throw new Error(`No qubit with id ${qubitId}.`);
  }
}

function requirePosition(index: number, highest: number): void {
  if (!Number.isInteger(index) || index < 0 || index > highest) {
    throw new Error(
      `Position ${String(index)} is outside the valid range 0..${String(highest)}.`,
    );
  }
}
