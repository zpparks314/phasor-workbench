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
import { deriveCycles, type Decomposition } from '../cycles';

/**
 * Where an operation dropped at `column` belongs in the list.
 *
 * Two constraints, and both are needed:
 *
 * - **after** the last operation on an involved wire that runs before the column
 * - **before** the first one that runs at or after it
 *
 * Either phrasing alone is enough only when list order and cycle order agree.
 * They agree along a single wire and **not across wires**: two measurements on
 * different qubits can appear in one order in the list and run in the other.
 * Taking only the first is then unsatisfiable -- it can point past a blocker --
 * and a barrier dragged beside two measurements lands on the wrong side of one
 * and stops constraining it. Taking only the second is always valid but pushes
 * the operation as late in the list as it can go.
 *
 * **Every qubit the operation uses has to be considered, not just its target.**
 * A `cx` occupies its control wire as surely as its target, so an index computed
 * from the target alone can place it before an operation on the control that it
 * must follow. The derivation then schedules it wherever the dependencies
 * actually allow, which shows up as a gate dragged right and landing far left.
 *
 * Operations touching none of those qubits are not considered. Their relative
 * order against this one is unobservable -- ADR-0003 makes the derivation
 * invariant under reorderings that preserve data dependencies.
 */
export function insertionIndexFor(
  circuit: Circuit,
  decomposition: Decomposition,
  qubitIds: readonly string[],
  column: number,
): number {
  const cycleOf = cyclesByOperation(decomposition);
  const barrierAt = new Map(
    decomposition.barriers.map((placement) => [
      placement.operationId,
      placement.beforeCycle,
    ]),
  );

  const involved = new Set(qubitIds);

  /**
   * A barrier sits on the boundary *before* its cycle, so one at exactly this
   * column already precedes anything in it. Treating it as following instead
   * would put the new operation under a constraint the user placed to apply to
   * what comes after.
   */
  const runsBefore = (operation: Operation): boolean => {
    if (operation.kind === 'barrier') {
      const before = barrierAt.get(operation.id);
      return before !== undefined && before <= column;
    }
    const cycle = cycleOf.get(operation.id);
    return cycle !== undefined && cycle < column;
  };

  let lastBefore = -1;
  let firstAfter = circuit.operations.length;

  circuit.operations.forEach((operation, index) => {
    if (!qubitsOf(operation).some((qubit) => involved.has(qubit))) return;

    if (runsBefore(operation)) lastBefore = index;
    else if (index < firstAfter) firstAfter = index;
  });

  return Math.min(firstAfter, lastBefore + 1);
}

/**
 * Where a moved operation belongs, as a `moveOperation` destination index.
 *
 * The same rule as `insertionIndexFor`, but computed against the circuit with
 * the operation *removed*. An operation left in place is its own predecessor --
 * it sits on the wire it is being moved along -- so it would position itself
 * relative to where it already is and never move.
 *
 * That the two agree is not a coincidence to rely on quietly: `moveOperation`
 * filters the operation out and splices it back at `toIndex`, so an index valid
 * for a list of `n - 1` is exactly the index it wants.
 */
export function moveDestinationIndex(
  circuit: Circuit,
  operationId: string,
  qubitIds: readonly string[],
  column: number,
): number {
  const without = {
    ...circuit,
    operations: circuit.operations.filter(
      (operation) => operation.id !== operationId,
    ),
  };

  return insertionIndexFor(without, deriveCycles(without), qubitIds, column);
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
export function qubitsOf(operation: Operation): readonly string[] {
  return operation.kind === 'gate'
    ? [...operation.targets, ...(operation.controls ?? [])]
    : operation.targets;
}

function touches(operation: Operation, qubitId: string): boolean {
  return qubitsOf(operation).includes(qubitId);
}
