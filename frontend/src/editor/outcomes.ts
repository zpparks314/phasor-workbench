/**
 * Combining exact and sampled probabilities into one ranked list.
 *
 * Pure and DOM-free, in its own module like `./angles` and for the same
 * reasons: the ranking and truncation rules are where this can be quietly
 * wrong, and they are worth asserting directly rather than through a rendered
 * panel.
 */

export interface Outcome {
  /** Classical bit string. Qubit 0 is the rightmost bit -- Simulation.md. */
  readonly basisState: string;
  /** From the statevector. Absent when the state was not available. */
  readonly exact: number | undefined;
  /** From a sampled run. Absent when no sample has been taken. */
  readonly sampled: number | undefined;
}

export interface OutcomeList {
  readonly shown: readonly Outcome[];
  /** How many fell outside the cap, and the largest probability among them. */
  readonly hidden: number;
  readonly hiddenBelow: number;
}

/**
 * Sixteen rows, which is what a side panel can show without scrolling.
 *
 * A 12-qubit circuit can have 4,096 non-negligible outcomes and a list that
 * long conveys nothing a person can read. The count of what is hidden is
 * carried rather than dropped, because "and 4,080 more" is the fact that stops
 * the top of the list being mistaken for the whole of it.
 */
export const MAX_OUTCOMES = 16;

/**
 * Merge the two sources, rank by significance, and truncate.
 *
 * **A union rather than an intersection.** An outcome the state gives weight to
 * may go unobserved in a finite number of shots, and a sampled outcome may be
 * one the exact probabilities dropped as negligible. Showing only what both
 * agree on would hide precisely the disagreements the comparison exists to
 * reveal.
 *
 * Ranked by whichever probability is larger, so an outcome that is significant
 * in *either* source survives truncation. Ranking by the exact value alone
 * would drop a sampled outlier off the bottom of the list, which is the one
 * thing most worth seeing.
 */
export function mergeOutcomes(
  exact: Readonly<Record<string, number>>,
  sampled: Readonly<Record<string, number>>,
  limit: number = MAX_OUTCOMES,
): OutcomeList {
  const states = [...new Set([...Object.keys(exact), ...Object.keys(sampled)])];

  const ranked = states
    .map<Outcome>((basisState) => ({
      basisState,
      exact: exact[basisState],
      sampled: sampled[basisState],
    }))
    .sort((a, b) => {
      const byWeight = significance(b) - significance(a);
      // Ties broken by basis state so the order is stable rather than
      // dependent on object key order, which would let rows jump between
      // renders that changed nothing.
      return byWeight !== 0
        ? byWeight
        : a.basisState.localeCompare(b.basisState);
    });

  const shown = ranked.slice(0, limit);
  const rest = ranked.slice(limit);

  return {
    shown,
    hidden: rest.length,
    hiddenBelow: rest.length === 0 ? 0 : Math.max(...rest.map(significance)),
  };
}

function significance(outcome: Outcome): number {
  return Math.max(outcome.exact ?? 0, outcome.sampled ?? 0);
}

/** `{ "00": 0.5 }` from the statevector response's list form. */
export function exactProbabilities(
  probabilities:
    readonly { basisState: string; probability: number }[] | undefined,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const entry of probabilities ?? []) {
    result[entry.basisState] = entry.probability;
  }
  return result;
}
