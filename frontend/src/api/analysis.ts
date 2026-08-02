/**
 * Static circuit analysis: counts and depth, from the backend.
 *
 * The first endpoint the frontend calls with a circuit, and deliberately the
 * cheapest one -- it proves the whole round trip (serialise, post, parse, map
 * an error envelope) with a response the backend can compute from components
 * that already existed. Nothing here waits on Qiskit.
 *
 * **This is not the number the canvas uses.** The status line's depth comes
 * from the local `deriveCycles` and always will; a render must not wait on a
 * network call. This is the *backend's* answer to the same question, and the
 * two agreeing across a suite of shared fixtures is the reason the round trip
 * is worth proving with this endpoint rather than a bespoke ping.
 */

import { request } from './client';
import type { Circuit } from '../model/circuit';
import { deriveCycles } from '../cycles';
import type { AnalysisResponse } from './types';

/**
 * True when the client should answer locally instead of calling the backend.
 *
 * Read once at module load: Vite substitutes these at build time, so it cannot
 * change while the app runs, and re-reading it per call would suggest it can.
 */
const USE_MOCK = import.meta.env.VITE_USE_MOCK_API === 'true';

export function analyzeCircuit(
  circuit: Circuit,
  signal?: AbortSignal,
): Promise<AnalysisResponse> {
  if (USE_MOCK) return Promise.resolve(mockAnalysis(circuit));

  return request<AnalysisResponse>('/circuits/analyze', {
    method: 'POST',
    body: { circuit },
    ...(signal ? { signal } : {}),
  });
}

/**
 * The mock, computed rather than recorded -- and that is a departure from
 * Frontend.md worth stating rather than burying.
 *
 * Frontend.md describes `VITE_USE_MOCK_API` as serving *recorded* responses
 * checked against the backend's OpenAPI schema. That is the right design for
 * the simulation endpoints, whose responses the frontend cannot derive: a
 * statevector has to come from somewhere, and a recording is honest about
 * being a fixture.
 *
 * It is the wrong design here, because this response is a pure function of the
 * request. A recording would answer every circuit with one circuit's numbers,
 * so the panel would confidently display a depth belonging to something the
 * user is not looking at -- worse than showing nothing, in a tool whose whole
 * purpose is making a circuit legible.
 *
 * What this does **not** do is re-derive anything. `deriveCycles` is the same
 * function the canvas already calls, so there is no second opinion about depth
 * here -- only the counting, which is a `filter` and a `length`, lives in this
 * file. When the real endpoint is reachable it is the only source of these
 * numbers.
 */
export function mockAnalysis(circuit: Circuit): AnalysisResponse {
  const gates = circuit.operations.filter(
    (operation) => operation.kind === 'gate',
  );

  const gateBreakdown: Record<string, number> = {};
  for (const gate of gates) {
    gateBreakdown[gate.name] = (gateBreakdown[gate.name] ?? 0) + 1;
  }

  return {
    qubitCount: circuit.qubits.length,
    gateCount: gates.length,
    measurementCount: circuit.operations.filter(
      (operation) => operation.kind === 'measurement',
    ).length,
    depth: deriveCycles(circuit).depth,
    gateBreakdown,
  };
}
