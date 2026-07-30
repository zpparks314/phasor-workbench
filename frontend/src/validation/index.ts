/**
 * Circuit validation.
 *
 * Enforces the rules in docs/CircuitModel.md, and is the mirror of
 * `backend/src/phasor_workbench/validation/`. Returns every violation rather
 * than the first, so a user fixing a circuit does not have to do it one edit at
 * a time.
 *
 * **Semantic rules only.** This module takes a `Circuit` that is already the
 * right shape. There is no runtime shape validator on this side: TypeScript
 * types do not exist at runtime, the editor builds circuits through its own
 * code, and the backend validates regardless because it cannot trust its input.
 * That changes the first time the frontend reads a circuit it did not build --
 * Milestone 3's local save. See ADR-0005 section 6.
 *
 * Rule modules follow the groups in docs/CircuitModel.md, under the same names
 * as their Python counterparts:
 *
 * - `structure`   -- identifier uniqueness, qubit index integrity
 * - `references`  -- every named qubit, register, and bit resolves
 * - `operations`  -- arity, qubit reuse, parameters
 * - `measurement` -- nothing but a barrier follows a measured qubit
 *
 * Violation codes come from `../model/spec`, generated from
 * shared/spec/circuit.spec.json. Never hand-write a code string: the fixtures in
 * shared/fixtures/ name those codes, and the Python implementation must emit
 * exactly the same ones.
 *
 * Order between groups is not significant to callers -- `result.codes` is sorted
 * -- but references are checked before the rules that depend on resolution, so
 * one mistake produces one violation instead of a cascade.
 */

import type { Circuit } from '../model/circuit';
import * as measurement from './measurement';
import * as operations from './operations';
import * as references from './references';
import * as structure from './structure';
import { createResult, type ValidationResult } from './violations';

export type { ValidationResult, Violation } from './violations';

/** Check every semantic rule and report all violations found. */
export function validateCircuit(circuit: Circuit): ValidationResult {
  return createResult([
    ...structure.check(circuit),
    ...references.check(circuit),
    ...operations.check(circuit),
    ...measurement.check(circuit),
  ]);
}
