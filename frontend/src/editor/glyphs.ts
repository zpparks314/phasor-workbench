/**
 * How each gate draws its target.
 *
 * Conventional circuit notation, so that a **box means exactly one thing: a
 * single-qubit gate**. Without that rule a `cz` target and an unrelated `rx`
 * sharing a column look like the same kind of object, and the connector between
 * them reads as joining all three wires.
 *
 * | Gate | Target |
 * |---|---|
 * | `cx`, `ccx` | crossed circle -- the connector forms its vertical bar |
 * | `cz` | filled dot, matching its control, because CZ is symmetric |
 * | `swap` | a cross at each end |
 * | `cy` | boxed `Y`, the convention for a controlled gate with no symbol |
 * | everything else | boxed, labelled with the gate name |
 *
 * Controls are always a filled dot and are not in this table.
 *
 * This is rendering knowledge, not a model fact, so it lives here rather than in
 * `shared/spec/circuit.spec.json` -- the same reasoning that keeps the palette's
 * grouping and descriptions local. Typing it as a total `Record<GateName, ...>`
 * means a gate added to the spec fails to compile until it has a symbol, which is
 * stronger than a test.
 *
 * Symbols carry no text, so the cell's accessible name in `placement.ts` remains
 * the thing that says "cx". Nothing here is the sole carrier of meaning.
 */

import type { GateName } from '../model/circuit';

export type TargetGlyph =
  | { readonly kind: 'box'; readonly label: string }
  | { readonly kind: 'crossed-circle' }
  | { readonly kind: 'dot' }
  | { readonly kind: 'swap' };

const boxed = (label: string): TargetGlyph => ({ kind: 'box', label });

export const TARGET_GLYPHS: Readonly<Record<GateName, TargetGlyph>> = {
  i: boxed('i'),
  h: boxed('h'),
  x: boxed('x'),
  y: boxed('y'),
  z: boxed('z'),
  s: boxed('s'),
  sdg: boxed('sdg'),
  t: boxed('t'),
  tdg: boxed('tdg'),
  rx: boxed('rx'),
  ry: boxed('ry'),
  rz: boxed('rz'),
  p: boxed('p'),
  cx: { kind: 'crossed-circle' },
  cy: boxed('Y'),
  cz: { kind: 'dot' },
  swap: { kind: 'swap' },
  ccx: { kind: 'crossed-circle' },
};

export function targetGlyph(name: GateName): TargetGlyph {
  return TARGET_GLYPHS[name];
}

/**
 * A crossed circle draws its own full cross rather than borrowing the connector
 * for the vertical bar. The connector terminates at the anchor centre, so
 * relying on it produced a half-drawn symbol.
 */
