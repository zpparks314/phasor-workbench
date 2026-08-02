import { describe, expect, it } from 'vitest';

import { exactProbabilities, mergeOutcomes } from './outcomes';

describe('mergeOutcomes', () => {
  it('pairs the two sources on one row', () => {
    const { shown } = mergeOutcomes(
      { '00': 0.5, '11': 0.5 },
      { '00': 0.516, '11': 0.484 },
    );

    expect(shown).toEqual([
      { basisState: '00', exact: 0.5, sampled: 0.516 },
      { basisState: '11', exact: 0.5, sampled: 0.484 },
    ]);
  });

  /**
   * A union, not an intersection. An outcome the state gives weight to can go
   * unobserved in a finite number of shots, and showing only what both agree
   * on would hide exactly the disagreements the comparison exists to reveal.
   */
  it('keeps an outcome the shots never produced', () => {
    const { shown } = mergeOutcomes({ '00': 0.5, '11': 0.5 }, { '00': 1 });

    expect(shown.map((o) => o.basisState)).toEqual(['00', '11']);
    expect(shown[1]).toMatchObject({ exact: 0.5, sampled: undefined });
  });

  it('keeps a sampled outcome the exact probabilities dropped', () => {
    const { shown } = mergeOutcomes({ '00': 1 }, { '01': 0.002 });

    expect(shown.map((o) => o.basisState)).toEqual(['00', '01']);
    expect(shown[1]).toMatchObject({ exact: undefined, sampled: 0.002 });
  });

  /**
   * Ranked by whichever source is larger. Ranking by the exact value alone
   * would push a sampled outlier off the bottom of the list, which is the one
   * row most worth seeing.
   */
  it('ranks by the larger of the two, so an outlier survives truncation', () => {
    const exact = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [String(i).padStart(2, '0'), 0.04]),
    );
    const { shown } = mergeOutcomes(exact, { '99': 0.3 });

    expect(shown[0]).toMatchObject({ basisState: '99', sampled: 0.3 });
  });

  it('truncates to the limit and counts what is left', () => {
    const many = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [
        String(i).padStart(2, '0'),
        1 / 40,
      ]),
    );

    const { shown, hidden } = mergeOutcomes(many, {}, 16);

    expect(shown).toHaveLength(16);
    expect(hidden).toBe(24);
  });

  it('reports the largest probability among the hidden ones', () => {
    const { hidden, hiddenBelow } = mergeOutcomes(
      { a: 0.5, b: 0.3, c: 0.15, d: 0.05 },
      {},
      2,
    );

    expect(hidden).toBe(2);
    expect(hiddenBelow).toBeCloseTo(0.15);
  });

  it('reports nothing hidden when everything fits', () => {
    const { hidden, hiddenBelow } = mergeOutcomes({ '0': 1 }, {});

    expect(hidden).toBe(0);
    expect(hiddenBelow).toBe(0);
  });

  /**
   * Ties broken by basis state, so the order does not depend on object key
   * order -- otherwise rows could jump between renders that changed nothing.
   */
  it('orders ties deterministically', () => {
    const first = mergeOutcomes({ '11': 0.5, '00': 0.5 }, {});
    const second = mergeOutcomes({ '00': 0.5, '11': 0.5 }, {});

    expect(first.shown.map((o) => o.basisState)).toEqual(['00', '11']);
    expect(second.shown.map((o) => o.basisState)).toEqual(['00', '11']);
  });

  it('handles having neither source', () => {
    expect(mergeOutcomes({}, {}).shown).toEqual([]);
  });
});

describe('exactProbabilities', () => {
  it('keys the response list by basis state', () => {
    expect(
      exactProbabilities([
        { basisState: '00', probability: 0.5 },
        { basisState: '11', probability: 0.5 },
      ]),
    ).toEqual({ '00': 0.5, '11': 0.5 });
  });

  /** The field is absent when includeProbabilities was false. */
  it('treats an absent list as no probabilities', () => {
    expect(exactProbabilities(undefined)).toEqual({});
  });
});
