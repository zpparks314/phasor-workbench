/**
 * Translating a position on screen into a position in the canonical list.
 *
 * The circuit is a flat ordered list; columns are derived by as-soon-as-possible
 * packing (ADR-0001, ADR-0003). So a drop is not a coordinate to store -- it is a
 * request that has to become a list index, after which the derivation decides
 * where the operation actually appears.
 *
 * **The drop column is a request, not a result.** Re-deriving may place the
 * operation earlier than where it was dropped, because ASAP packing pulls it left
 * onto whatever cycle its resources allow: an `h` dropped at column 5 of an empty
 * wire lands in column 0. That is correct, and UI.md requires it to be shown
 * rather than hidden -- the settle animation is what teaches that position is a
 * consequence of dependencies. The tool for holding an operation later is a
 * barrier.
 *
 * Pure and DOM-free, like `./layout`, and for the same reason.
 */

import type { Circuit, Operation } from '../model/circuit';
import type { Decomposition } from '../cycles';

/**
 * Where an operation dropped at `column` on `qubitId` belongs in the list.
 *
 * Immediately after the last operation touching that qubit which sits before the
 * column, and therefore before the first one at or after it. A qubit's operations
 * are strictly ordered in the derivation, so that boundary is unambiguous.
 *
 * Operations that do not touch the qubit are not considered. Their relative order
 * against the new one is unobservable -- ADR-0003 makes the derivation invariant
 * under reorderings that preserve data dependencies.
 */
export function insertionIndexFor(
  circuit: Circuit,
  decomposition: Decomposition,
  qubitId: string,
  column: number,
): number {
  const cycleOf = cyclesByOperation(decomposition);
  const barrierAt = new Map(
    decomposition.barriers.map((placement) => [
      placement.operationId,
      placement.beforeCycle,
    ]),
  );

  let predecessor = -1;

  circuit.operations.forEach((operation, index) => {
    if (!touches(operation, qubitId)) return;

    if (operation.kind === 'barrier') {
      // A barrier sits on the boundary *before* its cycle, so one at exactly this
      // column already precedes anything in it. Inserting ahead of it instead
      // would silently put the new operation under a constraint the user placed
      // to apply to what comes after.
      const before = barrierAt.get(operation.id);
      if (before !== undefined && before <= column) predecessor = index;
      return;
    }

    const cycle = cycleOf.get(operation.id);
    if (cycle !== undefined && cycle < column) predecessor = index;
  });

  return predecessor + 1;
}

/**
 * The operation occupying a cell, if any.
 *
 * Used for selecting by clicking a gate rather than a gap. A cell holds at most
 * one operation: two operations in one cycle cannot contend for a qubit, which
 * ADR-0001 notes holds by construction rather than by a validation rule.
 */
export function operationAt(
  circuit: Circuit,
  decomposition: Decomposition,
  qubitId: string,
  column: number,
): Operation | undefined {
  const ids = new Set(decomposition.cycles[column] ?? []);

  return circuit.operations.find(
    (operation) => ids.has(operation.id) && touches(operation, qubitId),
  );
}

/**
 * Locate an operation from a validation path such as `operations[3].targets[0]`.
 *
 * Parsing a *path* is legitimate; parsing an identifier is not (ADR-0002). Paths
 * are positional and are recomputed with every validation run, which is why a
 * violation must never be cached across an edit.
 */
export function operationIdFromPath(
  circuit: Circuit,
  path: string,
): string | undefined {
  const match = /^operations\[(\d+)\]/.exec(path);
  if (match?.[1] === undefined) return undefined;

  return circuit.operations[Number(match[1])]?.id;
}

export interface CellContent {
  readonly operationId: string | undefined;
  /** Reads into the cell's accessible name, so it says what is there. */
  readonly description: string;
}

/**
 * What sits in every cell of the grid, row by row.
 *
 * Built here rather than in the canvas so the canvas stays a renderer with
 * nothing to decide, and so the grid's accessible names are testable without a
 * DOM. Barriers are absent by construction -- they sit on boundaries between
 * columns, not in cells.
 */
export function describeCells(
  circuit: Circuit,
  decomposition: Decomposition,
  qubitIds: readonly string[],
  columnCount: number,
): CellContent[][] {
  return qubitIds.map((qubitId) =>
    Array.from({ length: columnCount }, (_, column) => {
      const operation = operationAt(circuit, decomposition, qubitId, column);
      if (operation === undefined) {
        return { operationId: undefined, description: 'empty' };
      }

      return {
        operationId: operation.id,
        description: describeOperation(operation, qubitId),
      };
    }),
  );
}

function describeOperation(operation: Operation, qubitId: string): string {
  if (operation.kind === 'measurement') return 'measurement';
  if (operation.kind === 'barrier') return 'barrier';

  return operation.targets.includes(qubitId)
    ? operation.name
    : `${operation.name} control`;
}

function cyclesByOperation(decomposition: Decomposition): Map<string, number> {
  const cycles = new Map<string, number>();
  decomposition.cycles.forEach((cycle, index) => {
    for (const id of cycle) cycles.set(id, index);
  });
  return cycles;
}

/**
 * Every qubit an operation names, targets and controls alike.
 *
 * A fourth spelling of this idea -- `cycles/` extracts resources for scheduling,
 * `validation/paths.ts` pairs them with document paths, `state/edits.ts` uses it
 * to decide what a removed qubit destroys. Each wants a different shape, so they
 * are not one function pretending otherwise.
 */
function touches(operation: Operation, qubitId: string): boolean {
  if (operation.targets.includes(qubitId)) return true;
  return operation.kind === 'gate'
    ? (operation.controls ?? []).includes(qubitId)
    : false;
}
