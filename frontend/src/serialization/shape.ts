/**
 * Separating fields this build does not recognize from content it cannot read.
 *
 * Mirrors `backend/src/phasor_workbench/serialization/unknown.py`, and rests on
 * the same distinction ADR-0006 does. An unknown *field* is inert: removing it
 * and keeping it aside loses nothing, because nothing in this build was going to
 * read it. An unknown *gate* or *operation kind* is not inert -- the first has no
 * signature to validate against, and the second leaves the cycle derivation
 * unable to extract resources, which makes the circuit's depth undefined.
 *
 * This is also the typed surface over `model/validator.ts`, which is generated
 * and deliberately untyped. Unknown-ness is decided by the compiled schema rather
 * than by a second description of it -- the same property the backend gets from
 * Pydantic, and the reason ADR-0008 chose a generated validator over a
 * hand-written checker.
 *
 * **Operations are validated one at a time, against the subtype their `kind`
 * names.** This is not a stylistic choice. `oneOf` plus `$ref` loses branch
 * attribution in Ajv's output -- `schemaPath` reads `#/additionalProperties`
 * whichever branch produced it -- so the branches that do not match report the
 * fields they do not share as unknown. Validating a gate against the whole
 * `Operation` union and stripping what comes back deletes its `name`, `controls`
 * and `parameters`. See ADR-0008 section 2.
 */

import type { Circuit } from '../model/circuit';
import { GATE_SIGNATURES } from '../model/spec';
import {
  OPERATION_DISCRIMINATOR,
  OPERATION_KINDS,
  validateBarrier,
  validateDocument,
  validateGate,
  validateMeasurement,
} from '../model/validator';
import type { Violation } from '../validation/violations';
import {
  fromPointer,
  isRecord,
  popAt,
  quote,
  toPath,
  type Location,
} from './paths';

/** What the generated validator exposes, given meaning here. */
interface CompiledValidator {
  (data: unknown): boolean;
  errors?: readonly ValidatorError[] | null;
}

interface ValidatorError {
  readonly instancePath: string;
  readonly keyword: string;
  readonly message?: string;
  readonly params: { readonly additionalProperty?: string };
}

const validateOperation: Readonly<Record<string, CompiledValidator>> = {
  gate: validateGate as CompiledValidator,
  measurement: validateMeasurement as CompiledValidator,
  barrier: validateBarrier as CompiledValidator,
};

const validateShell = validateDocument as CompiledValidator;

const KNOWN_KINDS: readonly string[] = OPERATION_KINDS;
const KIND: string = OPERATION_DISCRIMINATOR;

export interface PreservedField {
  /** Rendered as `operations[3].duration`, for display and for re-grafting. */
  readonly path: string;
  readonly location: Location;
  readonly value: unknown;
}

export interface StripResult {
  readonly document: Record<string, unknown>;
  readonly preserved: readonly PreservedField[];
  /** Shape errors that are not unknown fields, so stripping cannot help. */
  readonly failures: readonly Violation[];
}

// Removing an unknown field cannot create a new one, so one pass is enough. The
// bound exists so a surprise cannot become an infinite loop.
const MAX_PASSES = 8;

/** Remove every unrecognized field, keeping it aside with its location. */
export function stripUnknownFields(
  document: Record<string, unknown>,
): StripResult {
  const working = structuredClone(document);
  const preserved: PreservedField[] = [];

  const sweep = (
    validator: CompiledValidator,
    value: unknown,
    base: Location,
  ): readonly Violation[] => {
    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
      if (validator(value)) return [];

      const errors = validator.errors ?? [];
      const extra = errors.filter(
        (error) => error.keyword === 'additionalProperties',
      );
      const other = errors.filter(
        (error) => error.keyword !== 'additionalProperties',
      );

      if (extra.length === 0) return shapeViolations(other, base);

      for (const error of extra) {
        const key = error.params.additionalProperty;
        if (key === undefined) continue;

        const location = [...base, ...fromPointer(error.instancePath), key];
        preserved.push({
          path: toPath(location),
          location,
          value: popAt(value, [...fromPointer(error.instancePath), key]),
        });
      }
    }

    return [
      {
        code: 'SHAPE_INVALID',
        message: 'Gave up removing unrecognized fields after too many passes.',
        path: toPath(base),
      },
    ];
  };

  const failures = [...sweep(validateShell, working, [])];

  const operations = working['operations'];
  if (Array.isArray(operations)) {
    operations.forEach((operation, index) => {
      if (!isRecord(operation)) return;
      const validator = validateOperation[String(operation[KIND])];
      // An unknown kind is reported by `unknownContent`, not stripped.
      if (validator === undefined) return;
      failures.push(...sweep(validator, operation, ['operations', index]));
    });
  }

  return { document: working, preserved, failures };
}

/**
 * Turn validator errors into SHAPE_INVALID violations with document paths.
 *
 * An `additionalProperties` error is reported against the object *containing*
 * the offending key, with the key itself in `params`. Pydantic instead locates
 * the key directly, so without appending it here the two implementations would
 * disagree about where an unknown field is -- the frontend blaming the whole
 * document for one stray property. Fixtures compare codes rather than paths, so
 * this divergence was found by diffing the two loaders directly.
 */
export function shapeViolations(
  errors: readonly ValidatorError[],
  base: Location = [],
): Violation[] {
  return errors.map((error) => {
    const key = error.params.additionalProperty;
    const located = [...base, ...fromPointer(error.instancePath)];

    return {
      code: 'SHAPE_INVALID',
      message: `${error.message ?? 'is invalid'}.`,
      path: toPath(key === undefined ? located : [...located, key]),
    };
  });
}

/**
 * Does this document have the shape of a circuit?
 *
 * The whole document, operations included. Used in strict mode, where an
 * unrecognized field is an error rather than something to set aside.
 */
export function validateShape(document: unknown): readonly Violation[] {
  if (!isRecord(document)) {
    return [
      {
        code: 'SHAPE_INVALID',
        message: `A circuit document must be a JSON object, got ${describe(document)}.`,
        path: '',
      },
    ];
  }

  const violations: Violation[] = [];
  if (!validateShell(document)) {
    violations.push(...shapeViolations(validateShell.errors ?? []));
  }

  const operations = document['operations'];
  if (Array.isArray(operations)) {
    operations.forEach((operation, index) => {
      const base: Location = ['operations', index];
      if (!isRecord(operation)) {
        violations.push({
          code: 'SHAPE_INVALID',
          message: `An operation must be a JSON object, got ${describe(operation)}.`,
          path: toPath(base),
        });
        return;
      }

      const validator = validateOperation[String(operation[KIND])];
      if (validator === undefined) {
        violations.push({
          code: 'SHAPE_INVALID',
          message:
            `Operation kind ${quote(operation[KIND])} is not one of ` +
            `${[...KNOWN_KINDS].sort().join(', ')}.`,
          path: toPath([...base, KIND]),
        });
        return;
      }

      if (!validator(operation)) {
        violations.push(...shapeViolations(validator.errors ?? [], base));
      }
    });
  }

  return violations;
}

/**
 * Report gates and operation kinds this build cannot interpret.
 *
 * Only meaningful in tolerant mode. In strict mode the same defects are ordinary
 * schema failures and report as SHAPE_INVALID, which is the right answer there:
 * a document claiming *this* version with an unknown gate is malformed, not
 * ahead of us. See ADR-0006.
 */
export function unknownContent(
  document: Record<string, unknown>,
): readonly Violation[] {
  const operations = document['operations'];
  if (!Array.isArray(operations)) return [];

  const knownGates = Object.keys(GATE_SIGNATURES);
  const violations: Violation[] = [];

  operations.forEach((operation, index) => {
    if (!isRecord(operation)) return;

    const kind = operation[KIND];
    if (typeof kind !== 'string' || !KNOWN_KINDS.includes(kind)) {
      violations.push({
        code: 'UNKNOWN_OPERATION_KIND',
        message:
          `Operation kind ${quote(kind)} is not one of ` +
          `${[...KNOWN_KINDS].sort().join(', ')}. A newer version added it, and ` +
          `this build cannot schedule an operation it does not know.`,
        path: `operations[${String(index)}].${KIND}`,
      });
      return;
    }

    const name = operation['name'];
    if (
      kind === 'gate' &&
      (typeof name !== 'string' || !knownGates.includes(name))
    ) {
      violations.push({
        code: 'UNKNOWN_GATE_NAME',
        message:
          `Gate ${quote(name)} is not in this build's gate ` +
          `set. A newer version added it, and this build has neither a signature ` +
          `to validate it against nor a definition to execute it.`,
        path: `operations[${String(index)}].name`,
      });
    }
  });

  return violations;
}

/** A circuit is whatever survives the shape check; the cast is that guarantee. */
export function asCircuit(document: Record<string, unknown>): Circuit {
  return document as unknown as Circuit;
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  return Array.isArray(value) ? 'array' : typeof value;
}
