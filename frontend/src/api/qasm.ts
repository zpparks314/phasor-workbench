/**
 * OpenQASM import, which happens on the backend.
 *
 * `Architecture.md` gives import/export to the backend, and OpenQASM is the
 * first import that actually needs it: a Circuit Model document *is* JSON, so
 * reading one is `serialization/`'s loader, but QASM is a foreign grammar and
 * the parser for it lives in `importers/qasm/`.
 *
 * **This makes OpenQASM the first import that can fail because the backend is
 * down** -- a state JSON import cannot reach, and one the caller has to
 * distinguish, because "your file is wrong" and "we could not check your file"
 * ask the user for completely different things.
 *
 * Throws `ApiError` like every other module here rather than returning a
 * result; `files/` converts it, which keeps the mapping from transport failure
 * to user-facing outcome in one place.
 */

import type { Circuit } from '../model/circuit';
import { ApiError, request } from './client';

const USE_MOCK = import.meta.env.VITE_USE_MOCK_API === 'true';

interface ImportResponse {
  readonly circuit: Circuit;
}

export async function importQasm(
  source: string,
  signal?: AbortSignal,
): Promise<Circuit> {
  /**
   * There is deliberately no mock.
   *
   * Every other mock answers a question the frontend could answer itself --
   * `mockAnalysis` recomputes counts it already has. Parsing OpenQASM is not
   * such a question: a mock would need a second parser in the frontend, which
   * is precisely the duplication keeping the real one on the backend avoids.
   * Saying so is better than returning a canned circuit that ignores the file.
   */
  if (USE_MOCK) {
    throw new ApiError(
      'BACKEND_UNAVAILABLE',
      'OpenQASM import needs the backend, and the app is running against mocks.',
      0,
    );
  }

  const response = await request<ImportResponse>('/circuits/import/qasm', {
    method: 'POST',
    body: { source },
    ...(signal ? { signal } : {}),
  });

  return response.circuit;
}
