import { describe, expect, it } from 'vitest';

import { describeRadians } from './angles';

/**
 * A rendering of the radian value, never a second unit -- UI.md forbids a
 * hidden conversion, and the assertions below are all in radians in and π out.
 */
describe('describeRadians', () => {
  it.each([
    [0, '0'],
    [Math.PI, 'π'],
    [Math.PI / 2, 'π/2'],
    [Math.PI / 4, 'π/4'],
    [Math.PI / 8, 'π/8'],
    [Math.PI / 16, 'π/16'],
    [-Math.PI / 2, '-π/2'],
    [(3 * Math.PI) / 4, '3π/4'],
    [2 * Math.PI, '2π'],
    [-2 * Math.PI, '-2π'],
  ])('writes %s relative to π', (radians, expected) => {
    expect(describeRadians(radians)).toBe(expected);
  });

  /**
   * The case that decides the whole design. Rounding to the nearest sixteenth
   * would print a confident "π/4" for a value that is not π/4, and this is a
   * tool people use to reason about phase -- a plain decimal is the honest
   * answer where a clean fraction would be a lie.
   */
  it('falls back to a decimal multiple rather than rounding to a fraction', () => {
    expect(describeRadians(1)).toBe('0.318π');
    expect(describeRadians(Math.PI / 4 + 0.01)).not.toContain('/4');
  });

  it('says so rather than inventing a value for NaN', () => {
    expect(describeRadians(Number.NaN)).toBe('not a number');
  });

  it('says so for an infinite value too', () => {
    expect(describeRadians(Number.POSITIVE_INFINITY)).toBe('not a number');
  });
});
