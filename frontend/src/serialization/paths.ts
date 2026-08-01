/**
 * Locating a value inside a raw document.
 *
 * Mirrors `backend/src/phasor_workbench/serialization/paths.py`. A `Location` is
 * the sequence of keys and indices that reaches a value; `toPath` renders it in
 * the same `operations[3].targets[0]` form violations already use, so the project
 * has one vocabulary for pointing at something inside a circuit.
 *
 * **These paths are positional, and that is a constraint rather than a detail.**
 * ADR-0002 makes positions shift, so a location is only meaningful against the
 * document it was computed from. ADR-0008 section 3 is the consequence: preserved
 * fields cannot survive an edit, because editing moves the positions they name.
 */

export type Location = readonly (string | number)[];

/** Render a location as `operations[1].classicalTarget.bit`. */
export function toPath(location: Location): string {
  return location
    .map((step, index) =>
      typeof step === 'number'
        ? `[${String(step)}]`
        : index === 0
          ? step
          : `.${step}`,
    )
    .join('');
}

/** The container holding the value at `location`, or undefined if unreachable. */
function containerAt(document: unknown, location: Location): unknown {
  let current = document;

  for (const step of location.slice(0, -1)) {
    if (typeof step === 'number') {
      if (!Array.isArray(current)) return undefined;
      current = current[step];
    } else {
      if (!isRecord(current)) return undefined;
      current = current[step];
    }
  }

  return current;
}

/** Read the value at a location, or undefined if nothing is there. */
export function readAt(document: unknown, location: Location): unknown {
  const last = location.at(-1);
  const container = containerAt(document, location);
  if (last === undefined) return document;

  if (typeof last === 'number') {
    return Array.isArray(container) ? container[last] : undefined;
  }
  return isRecord(container) ? container[last] : undefined;
}

/** Remove the value at a location and return it. */
export function popAt(document: unknown, location: Location): unknown {
  const last = location.at(-1);
  const container = containerAt(document, location);
  if (last === undefined) return undefined;

  if (typeof last === 'number') {
    if (!Array.isArray(container)) return undefined;
    return container.splice(last, 1)[0];
  }
  if (!isRecord(container)) return undefined;

  const value = container[last];
  // Reflect rather than `delete container[last]`: the key is computed, and the
  // lint rule against dynamic delete exists because it deoptimizes the object.
  Reflect.deleteProperty(container, last);
  return value;
}

/**
 * Write a value at a location, creating nothing.
 *
 * A location that does not resolve is dropped rather than built out. It can only
 * arise from a document that changed shape since the location was computed, and
 * inventing the containers to reach it would graft a field onto a structure the
 * writer never saw.
 */
export function setAt(
  document: unknown,
  location: Location,
  value: unknown,
): void {
  const last = location.at(-1);
  const container = containerAt(document, location);
  if (last === undefined) return;

  if (typeof last === 'number') {
    if (Array.isArray(container) && last <= container.length) {
      container[last] = value;
    }
    return;
  }
  if (isRecord(container)) container[last] = value;
}

/** A JSON object, as opposed to an array or a primitive. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Render a value for a violation message.
 *
 * `JSON.stringify` is typed as returning `string` and returns `undefined` for
 * `undefined`, so every message that interpolates it directly can produce the
 * literal text "undefined" by accident. Naming the case is clearer than relying
 * on a `??` that the type checker believes is unreachable.
 */
export function quote(value: unknown): string {
  return value === undefined ? 'undefined' : JSON.stringify(value);
}

/**
 * Translate a JSON Pointer from a validator error into a `Location`.
 *
 * Ajv reports `/operations/0/targets/1`. Numeric segments become indices, which
 * is what lets `toPath` render them as `[1]` rather than `.1`.
 */
export function fromPointer(pointer: string): Location {
  if (pointer === '') return [];

  return pointer
    .slice(1)
    .split('/')
    .map((segment) => {
      const decoded = segment.replace(/~1/g, '/').replace(/~0/g, '~');
      return /^(0|[1-9][0-9]*)$/.test(decoded) ? Number(decoded) : decoded;
    });
}
