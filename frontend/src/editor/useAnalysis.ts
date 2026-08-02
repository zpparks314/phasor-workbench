/**
 * The backend's analysis of the current circuit, kept roughly in step with it.
 *
 * In `editor/` rather than `api/` because it is React: `api/` is the module
 * permitted to call `fetch` and imports no framework, the same split
 * `state/useCircuitStore.ts` keeps between the headless store and its adapter.
 *
 * **Debounced, and that is not premature optimisation.** Every edit produces a
 * new circuit, and dragging the angle slider produces one per pointer move --
 * a request each would be hundreds in a second, every one of them obsolete
 * before it returned. The wait is the interval after the user stops, so a
 * deliberate edit still feels immediate.
 *
 * **In-flight requests are aborted, not merely ignored.** Responses can arrive
 * out of order, and a slow answer about an old circuit overwriting a fast
 * answer about the current one would display a depth belonging to a circuit
 * that no longer exists.
 */

import { useEffect, useState } from 'react';

import { ApiError } from '../api/client';
import { analyzeCircuit } from '../api/analysis';
import type { AnalysisResponse } from '../api/types';
import type { Circuit } from '../model/circuit';

const DEBOUNCE_MS = 300;

export type AnalysisState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly analysis: AnalysisResponse }
  /** The circuit is at fault. The problems strip already names the reasons. */
  | { readonly status: 'rejected' }
  /** The backend is at fault, or absent. Never blame the user for this. */
  | { readonly status: 'unavailable'; readonly message: string };

export function useAnalysis(circuit: Circuit): AnalysisState {
  const [state, setState] = useState<AnalysisState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void analyzeCircuit(circuit, controller.signal)
        .then((analysis) => {
          setState({ status: 'ready', analysis });
        })
        .catch((error: unknown) => {
          // An abort is this effect being superseded, not a failure. Reporting
          // it would flash an error every time the user typed another digit.
          if (controller.signal.aborted) return;

          setState(
            error instanceof ApiError && error.isUserFacing
              ? { status: 'rejected' }
              : {
                  status: 'unavailable',
                  message:
                    error instanceof ApiError
                      ? error.message
                      : 'Analysis is unavailable.',
                },
          );
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [circuit]);

  return state;
}
