/**
 * Running a circuit: the final state, and measurement counts.
 *
 * Two calls with deliberately different shapes, because the operations are
 * different in kind. A statevector is a property the circuit *has*, so it is
 * fetched the way analysis is. Sampling is an experiment you *run*, with a shot
 * count and a seed, so it takes arguments and happens when asked.
 *
 * **The mock is recorded here, not computed**, which is the opposite of
 * `./analysis.ts` and the same rule. Frontend.md draws the line at whether the
 * frontend could derive the answer: analysis it can, so computing keeps the
 * mock honest for any circuit; a statevector it cannot, because that would mean
 * shipping a simulator. A recorded fixture is the honest alternative, and the
 * flag is a developer's own -- it defaults to false and lives in `.env`.
 */

import { request } from './client';
import type { Circuit } from '../model/circuit';
import type { SampleResponse, StatevectorResponse } from './types';

/** Read once: Vite substitutes at build time, so it cannot change at runtime. */
const USE_MOCK = import.meta.env.VITE_USE_MOCK_API === 'true';

/** API.md's default, and what the run control offers. */
export const DEFAULT_SHOTS = 1024;

export function simulateStatevector(
  circuit: Circuit,
  signal?: AbortSignal,
): Promise<StatevectorResponse> {
  if (USE_MOCK) return Promise.resolve(MOCK_STATEVECTOR);

  return request<StatevectorResponse>('/simulations/statevector', {
    method: 'POST',
    body: { circuit },
    ...(signal ? { signal } : {}),
  });
}

export function sampleCircuit(
  circuit: Circuit,
  shots: number = DEFAULT_SHOTS,
  signal?: AbortSignal,
): Promise<SampleResponse> {
  if (USE_MOCK) return Promise.resolve(MOCK_SAMPLE);

  return request<SampleResponse>('/simulations/sample', {
    method: 'POST',
    body: { circuit, options: { shots } },
    ...(signal ? { signal } : {}),
  });
}

/**
 * A Bell state, recorded from the real endpoint.
 *
 * Deliberately recognisable rather than plausible-looking: a developer running
 * against the mock should be able to tell at a glance that the panel is showing
 * a fixture and not their circuit. The sampled numbers are off 50/50 on purpose
 * -- a mock that returned exactly 512/512 would hide the shot noise the panel
 * exists to make visible.
 */
const MOCK_STATEVECTOR: StatevectorResponse = {
  qubitCount: 2,
  amplitudes: [
    { basisState: '00', real: 0.7071067811865475, imaginary: 0 },
    { basisState: '01', real: 0, imaginary: 0 },
    { basisState: '10', real: 0, imaginary: 0 },
    { basisState: '11', real: 0.7071067811865475, imaginary: 0 },
  ],
  probabilities: [
    { basisState: '00', probability: 0.4999999999999999 },
    { basisState: '11', probability: 0.4999999999999999 },
  ],
};

const MOCK_SAMPLE: SampleResponse = {
  shots: DEFAULT_SHOTS,
  seed: 42,
  counts: { '00': 515, '11': 509 },
  probabilities: { '00': 0.5029296875, '11': 0.4970703125 },
};
