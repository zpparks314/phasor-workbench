/**
 * Circuit state: the store, the edit vocabulary, and undo/redo.
 *
 * The circuit exists exactly once, in the store's present entry. Every component
 * derives what it shows from that one value, and every change to it goes through
 * an edit in `./edits` so that history and labelling cannot be bypassed. See
 * docs/Architecture.md and ADR-0007.
 *
 * Three modules, matching the three decisions:
 *
 * - `edits`       -- pure `Circuit -> Circuit` functions, one per authoring action
 * - `history`     -- a bounded stack of labeled snapshots, with coalescing
 * - `store`       -- the live circuit, selection, and the subscription surface
 *
 * Nothing here imports React, and this module has no backend counterpart: the
 * backend does not author circuits. ADR-0007 section 8 records why that asymmetry
 * is deliberate.
 */

export {
  addClassicalRegister,
  addQubit,
  clearOperations,
  insertOperation,
  isRetargetable,
  moveOperation,
  removeClassicalRegister,
  removeOperation,
  removeQubit,
  renameCircuit,
  retargetOperation,
  setParameters,
  setRegisterSize,
  type NewClassicalRegister,
  type NewQubit,
} from './edits';

export { MAX_HISTORY_DEPTH, type History, type HistoryEntry } from './history';

export { newIdentifier } from './identifiers';

export {
  createCircuitStore,
  type ApplyOptions,
  type CircuitStore,
  type CircuitStoreState,
} from './store';
