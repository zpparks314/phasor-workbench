/**
 * What the derivation returns.
 *
 * Mirrors `backend/src/phasor_workbench/cycles/decomposition.py`. Specified in
 * ADR-0003, never stored and never serialized as part of a circuit -- ADR-0001
 * makes the operation list canonical and this a derived view, so every consumer
 * computes it on demand and discards it.
 */

/**
 * Where a barrier sits, for a renderer drawing on a column boundary.
 *
 * `beforeCycle` may equal `depth`, meaning the trailing edge of the circuit. A
 * barrier occupies no cycle of its own.
 */
export interface BarrierPlacement {
  readonly operationId: string;
  readonly beforeCycle: number;
  readonly qubits: readonly string[];
}

/**
 * Operations grouped into cycles, plus where the barriers fell.
 *
 * Cycle indices run from 0 to `depth - 1` with no gaps and no empty cycles.
 * Barriers appear only in `barriers`, never inside a cycle.
 */
export interface Decomposition {
  readonly cycles: readonly (readonly string[])[];
  readonly barriers: readonly BarrierPlacement[];
  /** Derived from `cycles`, so the two cannot disagree. */
  readonly depth: number;
  /**
   * Each cycle's ids sorted, for comparison against a fixture.
   *
   * ADR-0003 property 5 states that consumers must not depend on the order of
   * operation ids within a cycle. A fixture asserting the order the rules happen
   * to produce would be asserting something outside the contract, and a
   * legitimate reordering would break it.
   *
   * A precomputed field where Python exposes a `sorted_cycles()` method -- the
   * same value, spelled the way each language prefers.
   */
  readonly sortedCycles: readonly (readonly string[])[];
}

export function createDecomposition(
  cycles: readonly (readonly string[])[],
  barriers: readonly BarrierPlacement[],
): Decomposition {
  return {
    cycles,
    barriers,
    depth: cycles.length,
    sortedCycles: cycles.map((cycle) => [...cycle].sort()),
  };
}
