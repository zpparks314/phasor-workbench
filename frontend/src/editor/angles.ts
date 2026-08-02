/**
 * Writing a radian value the way a physicist would say it.
 *
 * Pure, and in its own module rather than beside the inspector for the reason
 * every other `editor/*.ts` is: no DOM, so it is assertable directly, and a
 * component file that also exports a function defeats fast refresh.
 *
 * **This is a rendering, not a conversion.** UI.md forbids a hidden unit
 * conversion anywhere in the editor, and nothing here performs one -- the value
 * in, the value stored, and the value the input carries are one number in
 * radians. This only chooses how to *write* it, because `1.5707963267948966` is
 * an unreadable way to say a quarter turn in a tool whose purpose is legibility.
 */

/** Sixteenths of π, the finest fraction named rather than given as a decimal. */
const RESOLUTION = 16;

export function describeRadians(radians: number): string {
  if (!Number.isFinite(radians)) return 'not a number';
  if (radians === 0) return '0';

  const sixteenths = (radians * RESOLUTION) / Math.PI;

  // Anything that is not an exact fraction at this resolution is given as a
  // decimal multiple instead. Rounding to the nearest sixteenth would print a
  // clean "π/4" for a value that is not one, which is worse than a plain number
  // in a tool people are using to reason about phase.
  if (!Number.isInteger(sixteenths))
    return `${(radians / Math.PI).toFixed(3)}π`;

  const sign = sixteenths < 0 ? '-' : '';
  const magnitude = Math.abs(sixteenths);
  const divisor = RESOLUTION / gcd(magnitude, RESOLUTION);
  const multiple = magnitude / (RESOLUTION / divisor);

  const numerator = multiple === 1 ? 'π' : `${String(multiple)}π`;
  return divisor === 1
    ? `${sign}${numerator}`
    : `${sign}${numerator}/${String(divisor)}`;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
