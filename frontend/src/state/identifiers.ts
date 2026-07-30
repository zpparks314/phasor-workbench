/**
 * Minting stable identifiers.
 *
 * Deliberately not part of `edits.ts`. ADR-0007 section 1 makes an edit a pure
 * function of its arguments, and a function that mints an identifier is not one
 * -- it returns a different circuit on every call, so it cannot be asserted
 * against and the undo property test could not compare anything. Edits therefore
 * take identifiers as arguments, and callers mint them here.
 *
 * ADR-0002 makes identifiers opaque. Nothing may parse one, and nothing may
 * depend on their format.
 */

/** A fresh identifier, per CircuitModel.md's generation rule. */
export function newIdentifier(): string {
  return crypto.randomUUID();
}
