/**
 * What validation reports.
 *
 * Mirrors `backend/src/phasor_workbench/validation/violations.py`. `code` and
 * `path` are contractual; `message` is human-readable and is allowed to differ
 * between the two implementations, because fixtures compare codes.
 *
 * Codes come from the generated spec. Nothing here may invent one.
 */

import { WARNING_CODES, type ViolationCode } from '../model/spec';

export interface Violation {
  readonly code: ViolationCode;
  readonly message: string;
  readonly path: string;
}

export interface ValidationResult {
  readonly violations: readonly Violation[];
  readonly errors: readonly Violation[];
  readonly warnings: readonly Violation[];
  /** Warnings do not invalidate a circuit; they accompany a valid one. */
  readonly isValid: boolean;
  /**
   * Sorted codes, for comparison against a fixture's declaration.
   *
   * Sorted rather than in report order: fixtures assert *which* violations a
   * circuit produces, and coupling them to the order rules happen to run in
   * would make reordering a rule a fixture change.
   *
   * A precomputed field where Python exposes a `codes()` method -- the same
   * value, spelled the way each language prefers.
   */
  readonly codes: readonly string[];
}

const isWarning = (violation: Violation): boolean =>
  WARNING_CODES.includes(violation.code);

export function createResult(
  violations: readonly Violation[],
): ValidationResult {
  const errors = violations.filter((violation) => !isWarning(violation));

  return {
    violations,
    errors,
    warnings: violations.filter(isWarning),
    isValid: errors.length === 0,
    codes: violations.map((violation) => violation.code).sort(),
  };
}
