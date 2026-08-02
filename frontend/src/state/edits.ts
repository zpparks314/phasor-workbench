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
  ClassicalTarget,
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

/**
 * How many operations removing this qubit would destroy.
 *
 * Runs the edit and counts the difference rather than reimplementing its rules,
 * so the number a confirmation shows cannot drift from what the edit does. The
 * rules are not obvious enough to restate safely: a barrier over the qubit is
 * *shrunk* rather than removed, and so is not lost, unless it named only this
 * qubit and is left with no targets.
 */
export function operationsLostWithQubit(
  circuit: Circuit,
  qubitId: string,
): number {
  return (
    circuit.operations.length - removeQubit(circuit, qubitId).operations.length
  );
}

/** How many operations removing this register would destroy. */
export function operationsLostWithRegister(
  circuit: Circuit,
  registerId: string,
): number {
  return (
    circuit.operations.length -
    removeClassicalRegister(circuit, registerId).operations.length
  );
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

/**
 * Resize a register.
 *
 * **Shrinking below a bit a measurement already writes to is allowed**, and
 * `validateCircuit` reports it as `CLASSICAL_BIT_OUT_OF_RANGE`. That is
 * ADR-0007 section 7 working as intended rather than an oversight: the state is
 * one the user can edit their way out of, by growing the register back or
 * removing the measurement. Refusing here would be the treatment reserved for a
 * state with no repair path -- which is why the editor refuses to assign one
 * wire twice to a pending gate, and does not refuse this.
 *
 * The schema puts the floor at 1; a register of no bits is shape-invalid.
 */
export function setRegisterSize(
  circuit: Circuit,
  registerId: string,
  size: number,
): Circuit {
  const index = circuit.classicalRegisters.findIndex(
    (register) => register.id === registerId,
  );
  const register = circuit.classicalRegisters[index];
  if (register === undefined) {
    throw new Error(`No classical register with id ${registerId}.`);
  }
  if (!Number.isInteger(size) || size < 1) {
    throw new Error(
      `Register size ${String(size)} must be an integer above 0.`,
    );
  }

  const classicalRegisters = [...circuit.classicalRegisters];
  classicalRegisters[index] = { ...register, size };
  return { ...circuit, classicalRegisters };
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

  // Already there. Returning the input means the store records nothing, so a
  // drag that wanders without changing the order does not cost an undo step.
  if (index === toIndex) return circuit;

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

/**
 * Point a measurement at a different register and bit.
 *
 * The counterpart to `setParameters` for the other operation kind that carries
 * an editable property, and the edit that finally makes a second register
 * reachable -- placement always writes into the first.
 *
 * What it refuses and what it permits follows `setRegisterSize` exactly, and the
 * line is ADR-0007 section 7's: refuse what no later edit could repair, report
 * what the user can edit their way out of.
 *
 * - An unknown register is refused. Nothing in the document would name it, so
 *   the result is a dangling reference the user has no control to fix -- the
 *   same reason this function throws on an unknown operation id.
 * - A **bit beyond the register's size is permitted**, and `validateCircuit`
 *   reports `CLASSICAL_BIT_OUT_OF_RANGE`. Growing the register or choosing
 *   another bit repairs it, which is precisely the state `setRegisterSize`
 *   already allows to be created from the other direction. Refusing here would
 *   make the same circuit legal or illegal depending on which control produced
 *   it.
 * - A negative or non-integer bit is refused, because the schema's `minimum: 0`
 *   integer makes it shape-invalid rather than semantically wrong, and a
 *   shape-invalid document is one this build cannot re-read.
 */
export function setClassicalTarget(
  circuit: Circuit,
  operationId: string,
  target: ClassicalTarget,
): Circuit {
  const { operation, index } = locate(circuit, operationId);
  if (operation.kind !== 'measurement') {
    throw new Error(
      `Operation ${operationId} is a ${operation.kind}; only measurements carry a classical target.`,
    );
  }
  if (!circuit.classicalRegisters.some((r) => r.id === target.register)) {
    throw new Error(`No classical register with id ${target.register}.`);
  }
  if (!Number.isInteger(target.bit) || target.bit < 0) {
    throw new Error(
      `Bit ${String(target.bit)} must be an integer of 0 or above.`,
    );
  }

  const operations = [...circuit.operations];
  operations[index] = { ...operation, classicalTarget: { ...target } };
  return { ...circuit, operations };
}

/**
 * Move an operation onto a different qubit, preserving its identifier.
 *
 * Only for operations naming exactly one qubit. Retargeting a `cx` is ambiguous
 * -- moving it to another wire could mean moving the target, the control, or
 * both -- and guessing would silently produce a circuit the user did not ask
 * for. Multi-qubit retargeting needs its own interaction before it needs an
 * edit.
 *
 * Distinct from `moveOperation`, which changes position in the list. Dragging a
 * gate to a different column and to a different wire are two different changes
 * that a single gesture happens to combine.
 */
export function retargetOperation(
  circuit: Circuit,
  operationId: string,
  qubitId: string,
): Circuit {
  const { operation, index } = locate(circuit, operationId);
  const controls = operation.kind === 'gate' ? (operation.controls ?? []) : [];

  if (operation.targets.length !== 1 || controls.length > 0) {
    throw new Error(
      `Operation ${operationId} names more than one qubit; retargeting it is ambiguous.`,
    );
  }

  const operations = [...circuit.operations];
  operations[index] = { ...operation, targets: [qubitId] };
  return { ...circuit, operations };
}

/** Whether `retargetOperation` accepts this operation. */
export function isRetargetable(operation: Operation): boolean {
  const controls = operation.kind === 'gate' ? (operation.controls ?? []) : [];
  return operation.targets.length === 1 && controls.length === 0;
}

/**
 * Remove every operation, leaving the qubits and registers in place.
 *
 * **Deliberately not "new circuit".** Emptying the operation list is an ordinary
 * edit: it is one snapshot, one undo step, and the circuit it produces is one the
 * user could have reached by deleting each operation. Resetting the *document* --
 * dropping the wires, the registers and the identity along with them -- is a
 * different kind of act, and it needs to know whether there are unsaved changes.
 * That belongs with local save, not here.
 */
export function clearOperations(circuit: Circuit): Circuit {
  return { ...circuit, operations: [] };
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
