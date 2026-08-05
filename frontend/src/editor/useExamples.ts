/**
 * The example catalogue, fetched once.
 *
 * A hook beside `useAnalysis` and `useSimulation` rather than a fetch inside
 * `ExamplePicker`, because that is the split the editor already uses: the
 * components here are presentational and take what they draw as props, and the
 * hooks own talking to the backend. A component that fetches its own data is
 * the one thing in `editor/` that could not be rendered from a fixture.
 *
 * **Fetched once, not per circuit.** Unlike analysis, this answer does not
 * depend on what is on the canvas, so there is nothing to debounce and nothing
 * to re-request. The empty dependency list is the whole policy.
 */

import { useEffect, useState } from 'react';

import type { ExampleEntry } from '../api/examples';
import { fetchExamples } from '../api/examples';

export type ExamplesState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly entries: readonly ExampleEntry[] }
  /**
   * The backend is at fault, or absent. Kept distinct from an empty catalogue:
   * "nothing answered" is not "there is nothing", the same distinction import
   * draws, and a picker showing an empty list would state the wrong one.
   */
  | { readonly status: 'unavailable' };

export function useExamples(): ExamplesState {
  const [state, setState] = useState<ExamplesState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();

    void fetchExamples(controller.signal)
      .then((entries) => {
        if (!controller.signal.aborted) setState({ status: 'ready', entries });
      })
      .catch(() => {
        // An abort is this component unmounting, not a failure.
        if (!controller.signal.aborted) setState({ status: 'unavailable' });
      });

    return () => {
      controller.abort();
    };
  }, []);

  return state;
}
