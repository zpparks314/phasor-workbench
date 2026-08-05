/**
 * The built-in example catalogue, which lives on the backend.
 *
 * Examples are authored as OpenQASM and parsed by the same importer a user's
 * file goes through -- `Roadmap.md`'s exit criterion, and the reason this is a
 * network call rather than a bundled JSON blob. Shipping the circuits in the
 * frontend would make them the only circuits in the app that never passed
 * through the import path, which is exactly the evidence they exist to be.
 *
 * **Two calls, not one.** The catalogue carries metadata and a circuit is
 * fetched when one is chosen. Six small circuits would fit in a single
 * response; [ADR-0009](../../../docs/decisions/ADR0009_CircuitCatalogue.md)
 * section 3 keeps them apart because a *generated* entry -- a QAOA layer count,
 * a VQE ansatz width -- has no single circuit to bundle, and the list's contract
 * should not have to change when one arrives.
 *
 * Throws `ApiError` like every other module here. The editor converts it, which
 * keeps transport-failure-to-user-message in one place.
 */

import type { Circuit } from '../model/circuit';
import { ApiError, request } from './client';

const USE_MOCK = import.meta.env.VITE_USE_MOCK_API === 'true';

/**
 * One catalogue entry.
 *
 * `parameters` is deliberately absent rather than declared and empty. ADR-0009
 * section 4 leaves room for generated entries to carry one, and a client that
 * ignores a field it does not know about keeps working when they do.
 */
export interface ExampleEntry {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly qubitCount: number;
  readonly operationCount: number;
}

interface CatalogueResponse {
  readonly examples: readonly ExampleEntry[];
}

interface CircuitResponse {
  readonly circuit: Circuit;
}

function unavailable(): ApiError {
  /**
   * No mock, for the reason OpenQASM import has none: a mock would need a copy
   * of the catalogue in the frontend, which is the duplication that keeping it
   * on the backend exists to avoid.
   */
  return new ApiError(
    'BACKEND_UNAVAILABLE',
    'Example circuits need the backend, and the app is running against mocks.',
    0,
  );
}

export async function fetchExamples(
  signal?: AbortSignal,
): Promise<readonly ExampleEntry[]> {
  if (USE_MOCK) throw unavailable();

  const response = await request<CatalogueResponse>('/examples', {
    ...(signal ? { signal } : {}),
  });

  return response.examples;
}

export async function fetchExample(
  id: string,
  signal?: AbortSignal,
): Promise<Circuit> {
  if (USE_MOCK) throw unavailable();

  const response = await request<CircuitResponse>(
    `/examples/${encodeURIComponent(id)}`,
    { ...(signal ? { signal } : {}) },
  );

  return response.circuit;
}
