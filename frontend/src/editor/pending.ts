/**
 * A multi-qubit gate part-way through being placed.
 *
 * Placing a gate is a short sequence rather than a single action (UI.md): the
 * first click fixes a wire *and* a column, and each click after it contributes
 * one more wire until the signature is satisfied. Then the operation commits.
 *
 * **The sequence is driven by the signature, never by the gate's name or its
 * qubit total.** `swap` is two targets and no controls, `ccx` is one target and
 * two controls, and a gate added to `shared/spec/circuit.spec.json` gets its
 * sequence for free. Reading it off the name would be a second description of
 * the spec, which ADR-0004 exists to prevent.
 *
 * **Only the first click carries a column.** A gate occupies one column across
 * every wire it uses -- that is what makes it one entry in the canonical list --
 * so the column of a later click is not a second request to reconcile, it is
 * meaningless. Later clicks are read for their wire alone.
 *
 * Pure and DOM-free, like `./layout` and `./placement`, and for the same reason:
 * the whole sequence is assertable without rendering anything.
 */

import type { GateName, Operation } from '../model/circuit';
import type { GateSignature } from '../model/spec';
import type { QubitRole } from './layout';
import { defaultParameters } from './palette';

export interface PendingOperation {
  readonly name: GateName;
  readonly signature: GateSignature;
  /** The column the first click asked for. A request, not a result. */
  readonly column: number;
  /** Qubits assigned so far, targets first, in the order they were clicked. */
  readonly qubits: readonly string[];
}

export interface PendingAnchor {
  readonly qubitId: string;
  readonly role: QubitRole;
}

/** How many qubits the signature asks for in total. */
export function qubitsRequired(signature: GateSignature): number {
  return signature.targets + signature.controls;
}

/** Begin a placement with its first wire and the column it was asked for. */
export function beginPending(
  name: GateName,
  signature: GateSignature,
  qubitId: string,
  column: number,
): PendingOperation {
  return { name, signature, column, qubits: [qubitId] };
}

export function isSatisfied(pending: PendingOperation): boolean {
  return pending.qubits.length >= qubitsRequired(pending.signature);
}

/**
 * Whether a click on this wire assigns anything.
 *
 * **A wire already assigned is refused rather than assigned twice.** Committing
 * a `cx` whose control is its target produces `QUBIT_REUSED_IN_OPERATION`, and
 * unlike the intermediate invalid states ADR-0007 section 7 protects, the editor
 * offers no way out of it: `retargetOperation` throws for a multi-qubit
 * operation by design, and moving one only changes its column. The user would be
 * left with an operation they can only delete. The pending overlay draws the
 * taken wires, so the refusal is visible rather than a click that does nothing
 * for no stated reason.
 */
export function canAssign(pending: PendingOperation, qubitId: string): boolean {
  return !isSatisfied(pending) && !pending.qubits.includes(qubitId);
}

export function assignQubit(
  pending: PendingOperation,
  qubitId: string,
): PendingOperation {
  if (!canAssign(pending, qubitId)) {
    throw new Error(
      `Qubit ${qubitId} cannot be assigned to this pending ${pending.name}.`,
    );
  }
  return { ...pending, qubits: [...pending.qubits, qubitId] };
}

/** Each assigned qubit with the role its position gives it, targets first. */
export function pendingAnchors(
  pending: PendingOperation,
): readonly PendingAnchor[] {
  return pending.qubits.map((qubitId, position) => ({
    qubitId,
    role: position < pending.signature.targets ? 'target' : 'control',
  }));
}

/** What the next click assigns, or null once the signature is satisfied. */
export function nextRole(pending: PendingOperation): QubitRole | null {
  if (isSatisfied(pending)) return null;
  return pending.qubits.length < pending.signature.targets
    ? 'target'
    : 'control';
}

/**
 * What the status line says while a placement is outstanding.
 *
 * The count is stated rather than implied: a `ccx` needs two controls and
 * "Click a wire to place the control" would be a lie for the first of them.
 * This live region is how a screen reader learns the sequence is in progress at
 * all, since the cell cursor has not moved.
 */
export function describeRemaining(pending: PendingOperation): string | null {
  const role = nextRole(pending);
  if (role === null) return null;

  const assigned = pending.qubits.length;
  const remaining =
    role === 'target'
      ? pending.signature.targets - assigned
      : qubitsRequired(pending.signature) - assigned;

  return remaining === 1
    ? `Click a wire to place the ${role}`
    : `Click a wire to place ${String(remaining)} ${role}s`;
}

/**
 * The operation a satisfied placement commits.
 *
 * The identifier is an argument rather than minted here, for the reason
 * `state/edits.ts` gives: a function calling `crypto.randomUUID()` internally is
 * not pure and the undo property test would have nothing to compare.
 */
export function pendingOperation(
  pending: PendingOperation,
  id: string,
): Operation {
  if (!isSatisfied(pending)) {
    throw new Error(
      `Pending ${pending.name} needs ${String(qubitsRequired(pending.signature))} qubits and has ${String(pending.qubits.length)}.`,
    );
  }

  const anchors = pendingAnchors(pending);
  const targets = anchors
    .filter((anchor) => anchor.role === 'target')
    .map((anchor) => anchor.qubitId);

  const [first, ...rest] = targets;
  if (first === undefined) {
    throw new Error(`Gate ${pending.name} declares no targets.`);
  }

  return {
    id,
    kind: 'gate',
    name: pending.name,
    targets: [first, ...rest],
    controls: anchors
      .filter((anchor) => anchor.role === 'control')
      .map((anchor) => anchor.qubitId),
    parameters: defaultParameters(pending.signature),
  };
}
