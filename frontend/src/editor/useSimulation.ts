/**
 * The circuit's final state, live; and its measurement counts, on request.
 *
 * In `editor/` rather than `api/` for the reason `useAnalysis` is: `api/` is
 * the module permitted to call `fetch` and imports no framework.
 *
 * **The two halves are triggered differently on purpose.** A statevector is a
 * property the circuit has, so it follows edits the way analysis does. Sampling
 * is an experiment, so it happens when asked -- and running 1024 shots on every
 * keystroke would also mean an unseeded run whose numbers change for reasons
 * the user did not cause.
 *
 * **A sample is discarded the moment the circuit changes.** This is the part
 * most likely to be got wrong: counts from the previous circuit shown beside a
 * statevector from the current one is a comparison of two different circuits,
 * presented as though it were theory against experiment. Stale-but-plausible is
 * worse than absent, because nothing about it looks wrong.
 *
 * That comparison is by **reference**, which is correct only because the store
 * hands out a stable snapshot -- `useCircuitStore` caches it, since
 * `useSyncExternalStore` re-renders forever otherwise. A caller that built a
 * fresh circuit object on every render would lose its sample immediately, and
 * the failure would look like the run silently not happening. A test doing
 * exactly that is what surfaced this, and the alternative -- deep equality on
 * every render -- would cost more than the coupling is worth while the one
 * caller is the store.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '../api/client';
import {
  DEFAULT_SHOTS,
  sampleCircuit,
  simulateStatevector,
} from '../api/simulation';
import type { SampleResponse, StatevectorResponse } from '../api/types';
import type { Circuit } from '../model/circuit';

const DEBOUNCE_MS = 300;

export type StatevectorState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly result: StatevectorResponse }
  /** The circuit is at fault; the problems strip already names the reasons. */
  | { readonly status: 'rejected' }
  /** Too many qubits to return a state. Not an error, and not the user's fault. */
  | { readonly status: 'tooLarge'; readonly message: string }
  | { readonly status: 'unavailable'; readonly message: string };

export type SampleState =
  | { readonly status: 'idle' }
  | { readonly status: 'running' }
  | { readonly status: 'ready'; readonly result: SampleResponse }
  | { readonly status: 'failed'; readonly message: string };

export interface Simulation {
  readonly statevector: StatevectorState;
  readonly sample: SampleState;
  readonly runSample: () => void;
}

export function useSimulation(circuit: Circuit): Simulation {
  const [statevector, setStatevector] = useState<StatevectorState>({
    status: 'loading',
  });
  const [sample, setSample] = useState<SampleState>({ status: 'idle' });

  /**
   * The circuit the current sample describes.
   *
   * A ref rather than state: it is compared during the effect that clears the
   * sample, and storing it in state would make that effect depend on a value
   * it also sets.
   */
  const sampledCircuit = useRef<Circuit | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void simulateStatevector(circuit, controller.signal)
        .then((result) => {
          setStatevector({ status: 'ready', result });
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setStatevector(describeFailure(error));
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [circuit]);

  // Drop a sample the moment its circuit stops being the current one.
  useEffect(() => {
    if (sampledCircuit.current !== null && sampledCircuit.current !== circuit) {
      sampledCircuit.current = null;
      setSample({ status: 'idle' });
    }
  }, [circuit]);

  const runSample = useCallback(() => {
    setSample({ status: 'running' });

    void sampleCircuit(circuit, DEFAULT_SHOTS)
      .then((result) => {
        sampledCircuit.current = circuit;
        setSample({ status: 'ready', result });
      })
      .catch((error: unknown) => {
        sampledCircuit.current = null;
        setSample({
          status: 'failed',
          message:
            error instanceof ApiError ? error.message : 'The run failed.',
        });
      });
  }, [circuit]);

  return { statevector, sample, runSample };
}

/**
 * Which kind of failure this was, which decides how the panel phrases it.
 *
 * `LIMIT_EXCEEDED` is deliberately not an error state: the circuit is fine and
 * the user did nothing wrong, there is simply more state than a response can
 * carry. Telling them their circuit is invalid would be false.
 */
function describeFailure(error: unknown): StatevectorState {
  if (!(error instanceof ApiError)) {
    return { status: 'unavailable', message: 'Simulation is unavailable.' };
  }
  if (error.code === 'LIMIT_EXCEEDED') {
    return { status: 'tooLarge', message: error.message };
  }
  if (error.isUserFacing) {
    return { status: 'rejected' };
  }
  return { status: 'unavailable', message: error.message };
}
