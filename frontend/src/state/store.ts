/**
 * The circuit store: the one place the live circuit exists.
 *
 * Holds the history, applies edits through it, and exposes a snapshot the UI
 * reads. Nothing here imports React -- `subscribe` and `getState` are shaped for
 * `useSyncExternalStore`, and the React binding is a thin adapter written
 * separately. That is what makes this module testable without a DOM, and
 * replaceable in the sense AGENTS.md requires of every subsystem.
 *
 * `apply` takes an edit *function* rather than a named command, so adding an edit
 * to the vocabulary in `./edits` needs no change here. That is the extensibility
 * payoff of ADR-0007 section 1.
 */

import type { Circuit } from '../model/circuit';
import {
  canRedo,
  canUndo,
  commit,
  createHistory,
  endCoalescing,
  redo,
  undo,
  type History,
} from './history';

export interface CircuitStoreState {
  /** The live circuit. There is no other. */
  readonly circuit: Circuit;
  /** Null when nothing is selected, or when the selected operation is gone. */
  readonly selection: string | null;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** What undo would reverse, for labelling the control. Null when disabled. */
  readonly undoLabel: string | null;
  readonly redoLabel: string | null;
}

export interface ApplyOptions {
  /**
   * Marks this edit as one step of an ongoing interaction, e.g. `move:op_3`.
   *
   * Consecutive edits sharing a key collapse into one undo step. Call
   * `endCoalescing` when the interaction finishes.
   */
  readonly coalescingKey?: string;
}

export interface CircuitStore {
  getState(): CircuitStoreState;
  subscribe(listener: () => void): () => void;
  apply(
    label: string,
    edit: (circuit: Circuit) => Circuit,
    options?: ApplyOptions,
  ): void;
  endCoalescing(): void;
  undo(): void;
  redo(): void;
  select(operationId: string | null): void;
}

export function createCircuitStore(initial: Circuit): CircuitStore {
  let history: History = createHistory(initial);
  let selection: string | null = null;
  let snapshot: CircuitStoreState | null = null;
  const listeners = new Set<() => void>();

  /**
   * Cached so repeated reads return the same object.
   *
   * `useSyncExternalStore` compares snapshots by identity and re-renders forever
   * if a fresh object comes back every call.
   */
  function getState(): CircuitStoreState {
    snapshot ??= buildSnapshot(history, selection);
    return snapshot;
  }

  function changed(): void {
    snapshot = null;
    for (const listener of listeners) listener();
  }

  return {
    getState,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /**
     * The edit runs before anything is recorded, so an edit that throws leaves
     * the store exactly as it was rather than half-applied.
     *
     * An edit returning the circuit it was given records nothing. A no-op is not
     * an undo step, and offering one wastes a press.
     */
    apply(label, edit, options) {
      const next = edit(history.present.circuit);
      if (next === history.present.circuit) return;

      history = commit(history, next, label, options?.coalescingKey);
      changed();
    },

    endCoalescing() {
      const next = endCoalescing(history);
      if (next === history) return;
      history = next;
      changed();
    },

    undo() {
      const next = undo(history);
      if (next === history) return;
      history = next;
      changed();
    },

    redo() {
      const next = redo(history);
      if (next === history) return;
      history = next;
      changed();
    },

    select(operationId) {
      if (selection === operationId) return;
      selection = operationId;
      changed();
    },
  };
}

/**
 * Selection is resolved against the present circuit on every read.
 *
 * Undo can remove the operation a selection points at, and per ADR-0002 an
 * identifier is exactly the kind of reference that survives everything except its
 * object's deletion. Resolving on read means selection is derived state rather
 * than a second thing to keep in sync -- there is nothing to forget to update.
 */
function buildSnapshot(
  history: History,
  selection: string | null,
): CircuitStoreState {
  const circuit = history.present.circuit;
  const resolved =
    selection !== null &&
    circuit.operations.some((operation) => operation.id === selection)
      ? selection
      : null;

  const undoable = canUndo(history);
  const redoable = canRedo(history);

  return {
    circuit,
    selection: resolved,
    canUndo: undoable,
    canRedo: redoable,
    undoLabel: undoable ? history.present.label : null,
    redoLabel: redoable ? (history.future[0]?.label ?? null) : null,
  };
}
