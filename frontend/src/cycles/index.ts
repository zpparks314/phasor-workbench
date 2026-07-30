/**
 * Cycle derivation: the decomposition specified in ADR-0003.
 *
 * Groups a circuit's flat operation list into concurrent cycles by
 * as-soon-as-possible packing over a per-resource frontier, evaluated in
 * canonical list order. Mirrors `backend/src/phasor_workbench/cycles/` and is
 * held to it by the fixtures in `shared/fixtures/decomposition/`.
 *
 * The editor consumes this for render columns, but does not own it -- ADR-0001
 * makes the derivation a specified component rather than a rendering detail, and
 * no component may store its output.
 *
 * **Assumes a valid circuit.** This is not a validation pass; run
 * `../validation` first. Given an invalid circuit it does not throw -- an
 * unresolvable qubit id is still a usable frontier key -- so it will happily
 * decompose a circuit that should not exist. A deliberate non-goal rather than
 * robustness.
 *
 * ADR-0003 states seven guaranteed properties and is explicit that they are
 * property *tests*, not runtime checks. They are asserted over every fixture in
 * `cycles.test.ts` and nothing here re-checks them.
 */

import type { Circuit, Operation } from '../model/circuit';
import {
  createDecomposition,
  type BarrierPlacement,
  type Decomposition,
} from './decomposition';

export type { BarrierPlacement, Decomposition } from './decomposition';

/**
 * Qubits and classical bits use separate structures rather than one map keyed by
 * a composed string.
 *
 * Identifiers are opaque and unrestricted, so a qubit legitimately named
 * `c_0#0` would collide with register `c_0` bit 0 under any naive delimiter
 * scheme. The temptation is stronger here than in Python, where a `(register,
 * bit)` tuple is a safe dict key and a JavaScript `Map` needs a primitive --
 * which is exactly how a bug would end up in one language only. Bits are keyed
 * by register, then by bit.
 */
type QubitFrontier = Map<string, number>;
type BitFrontier = Map<string, Map<number, number>>;

/** Pack every operation as early as its resources allow. */
export function deriveCycles(circuit: Circuit): Decomposition {
  const qubitFrontier: QubitFrontier = new Map();
  const bitFrontier: BitFrontier = new Map();
  const cycles: string[][] = [];
  const barriers: BarrierPlacement[] = [];

  for (const operation of circuit.operations) {
    if (operation.kind === 'barrier') {
      barriers.push(
        placeBarrier(operation.id, operation.targets, qubitFrontier),
      );
      continue;
    }

    const qubits = qubitResources(operation);
    const bit = bitResource(operation);

    const frontiers = qubits.map((qubit) => qubitFrontier.get(qubit) ?? 0);
    if (bit !== undefined) {
      frontiers.push(bitFrontier.get(bit.register)?.get(bit.bit) ?? 0);
    }

    // ADR-0003: max over an empty set is 0. Unreachable, because the schema
    // gives every operation at least one target.
    const index = frontiers.length > 0 ? Math.max(...frontiers) : 0;

    // Property 3 makes growth by more than one impossible, so this is a loop for
    // honesty rather than because an index can skip.
    while (cycles.length <= index) {
      cycles.push([]);
    }
    cycles[index]?.push(operation.id);

    for (const qubit of qubits) {
      qubitFrontier.set(qubit, index + 1);
    }
    if (bit !== undefined) {
      const bits = bitFrontier.get(bit.register) ?? new Map<number, number>();
      bits.set(bit.bit, index + 1);
      bitFrontier.set(bit.register, bits);
    }
  }

  return createDecomposition(cycles, barriers);
}

/**
 * Level the target frontier to its collective maximum without advancing it.
 *
 * Levelling is what makes every earlier operation on those qubits land in a
 * strictly earlier cycle than every later one. Not advancing is what keeps the
 * barrier itself out of the depth -- though levelling an unequal frontier does
 * delay later operations, and that delay is visible in the depth. See the
 * clarification in ADR-0003.
 */
function placeBarrier(
  operationId: string,
  targets: readonly string[],
  qubitFrontier: QubitFrontier,
): BarrierPlacement {
  const level = Math.max(
    ...targets.map((qubit) => qubitFrontier.get(qubit) ?? 0),
  );

  for (const qubit of targets) {
    qubitFrontier.set(qubit, level);
  }

  return { operationId, beforeCycle: level, qubits: [...targets] };
}

function qubitResources(operation: Operation): string[] {
  if (operation.kind === 'gate') {
    return [...operation.targets, ...(operation.controls ?? [])];
  }
  return [...operation.targets];
}

/**
 * Contention is tracked per bit, not per register.
 *
 * Per-register granularity would serialize independent measurements and overstate
 * depth for the common case of measuring every qubit into one register.
 */
function bitResource(
  operation: Operation,
): { readonly register: string; readonly bit: number } | undefined {
  if (operation.kind === 'measurement') {
    return operation.classicalTarget;
  }
  return undefined;
}
