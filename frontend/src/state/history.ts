/**
 * Undo and redo: a bounded stack of labeled snapshots.
 *
 * Specified by ADR-0007 section 2. An entry is the circuit an edit produced plus
 * a label describing that edit, which is what lets the UI offer "Undo place H"
 * rather than "Undo".
 *
 * Snapshots rather than commands with inverses, decided on correctness: an
 * inverse that is subtly wrong makes undo produce a *different* circuit rather
 * than fail, and every future edit type would owe one. Restoring a past value
 * cannot be subtly wrong. The memory cost is small because edits share unchanged
 * objects by reference, so an entry retains only what its edit changed.
 *
 * Nothing here is a second representation of the circuit. Exactly one circuit is
 * live -- `present.circuit` -- and entries in `past` and `future` are inert past
 * values that nothing renders, validates, or writes to. See ADR-0007 section 5.
 */

import type { Circuit } from '../model/circuit';

/**
 * How many edits can be undone.
 *
 * Exceeding it discards the oldest entry. That is the one lossy thing here, and
 * it is a documented contract rather than something discovered when a long
 * session stops undoing.
 */
export const MAX_HISTORY_DEPTH = 100;

export interface HistoryEntry {
  /** What the edit did, e.g. "Place H on q0". */
  readonly label: string;
  readonly circuit: Circuit;
  /**
   * Set while an interaction is still producing intermediate states.
   *
   * Present only on `present`; sealed off everywhere else, so a run of
   * transient edits can never merge into an entry an interaction has finished
   * with, or across an undo.
   */
  readonly coalescingKey?: string;
}

export interface History {
  readonly past: readonly HistoryEntry[];
  /** The live entry. Every consumer reads this circuit and no other. */
  readonly present: HistoryEntry;
  readonly future: readonly HistoryEntry[];
}

export function createHistory(
  circuit: Circuit,
  label = 'New circuit',
): History {
  return { past: [], present: { label, circuit }, future: [] };
}

/**
 * Record a new circuit, coalescing into the present entry when asked to.
 *
 * A `coalescingKey` matching the present entry's replaces it rather than pushing,
 * so a drag that emits twenty intermediate circuits is one undo step. The key is
 * supplied by the interaction, which knows where a gesture begins and ends.
 * Merging by elapsed time instead would make undo granularity depend on how fast
 * the user moved.
 */
export function commit(
  history: History,
  circuit: Circuit,
  label: string,
  coalescingKey?: string,
): History {
  if (
    coalescingKey !== undefined &&
    history.present.coalescingKey === coalescingKey
  ) {
    return { ...history, present: { label, circuit, coalescingKey } };
  }

  const entry: HistoryEntry = {
    label,
    circuit,
    ...(coalescingKey !== undefined && { coalescingKey }),
  };

  return {
    past: [...history.past, seal(history.present)].slice(-MAX_HISTORY_DEPTH),
    present: entry,
    future: [],
  };
}

/**
 * End a run of coalescing edits, so the next one starts a new entry.
 *
 * Called when an interaction finishes -- mouse up, or the keyboard equivalent.
 * Without it, dragging the same operation twice would merge into one undo step.
 */
export function endCoalescing(history: History): History {
  if (history.present.coalescingKey === undefined) return history;
  return { ...history, present: seal(history.present) };
}

/**
 * Step back one entry, or return the history unchanged when there is none.
 *
 * An exhausted stack is not an error, unlike an unresolvable operation id in
 * `./edits`. Pressing Ctrl+Z once more than there is history is an ordinary thing
 * a user does; the UI disables the control and the model stays put.
 */
export function undo(history: History): History {
  const previous = history.past[history.past.length - 1];
  if (previous === undefined) return history;

  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [seal(history.present), ...history.future],
  };
}

export function redo(history: History): History {
  const [next, ...rest] = history.future;
  if (next === undefined) return history;

  return {
    past: [...history.past, seal(history.present)].slice(-MAX_HISTORY_DEPTH),
    present: next,
    future: rest,
  };
}

export function canUndo(history: History): boolean {
  return history.past.length > 0;
}

export function canRedo(history: History): boolean {
  return history.future.length > 0;
}

/** Drop the coalescing key, leaving the value it described untouched. */
function seal(entry: HistoryEntry): HistoryEntry {
  return { label: entry.label, circuit: entry.circuit };
}
