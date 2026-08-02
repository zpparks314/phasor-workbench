/**
 * The single point of contact between the frontend and the backend.
 *
 * Architecture.md: the frontend communicates with the backend exclusively
 * through documented APIs. No other module should call fetch directly.
 */

import type { ApiErrorBody, ApiErrorCode, ApiErrorDetail } from './types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';
const API_PREFIX = '/api/v1';

/**
 * A failure the caller can render. Carries the backend's stable error code
 * and per-violation details so the UI can highlight specific problems.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: ApiErrorDetail[];

  constructor(
    code: ApiErrorCode,
    message: string,
    status: number,
    details: ApiErrorDetail[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  /**
   * True when the user's circuit is at fault rather than the request.
   * Only these should surface as inline editor feedback.
   */
  get isUserFacing(): boolean {
    return this.code === 'CIRCUIT_INVALID' || this.code === 'LIMIT_EXCEEDED';
  }
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = (value as { error?: unknown }).error;
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof (candidate as { code?: unknown }).code === 'string'
  );
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  signal?: AbortSignal;
}

export async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = 'GET', body, signal } = options;
  const url = `${API_BASE_URL}${API_PREFIX}${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal ? { signal } : {}),
    });
  } catch {
    // Network-level failure: the backend is unreachable, not misbehaving.
    throw new ApiError(
      'BACKEND_UNAVAILABLE',
      'Could not reach the backend. Is it running?',
      0,
      [],
    );
  }

  if (!response.ok) {
    const parsed: unknown = await response.json().catch(() => null);

    if (isApiErrorBody(parsed)) {
      throw new ApiError(
        parsed.error.code,
        parsed.error.message,
        response.status,
        parsed.error.details ?? [],
      );
    }

    /**
     * A 5xx with no JSON body at all means nothing answered.
     *
     * In development the Vite proxy stands between the browser and the
     * backend, and a proxy whose upstream is refusing connections replies
     * `500` with an empty body -- so `fetch` *succeeds* and the network-level
     * branch above never runs. Reporting the proxy's status code told the user
     * "Request failed with status 500", which describes the transport and
     * hides the only fact that matters: the backend is not running.
     *
     * The body is what separates the two. A backend that threw still answers
     * with JSON -- either this envelope, or FastAPI's own `{"detail": ...}` --
     * so it falls through to `INTERNAL_ERROR` below, where it belongs. Nothing
     * answering at all produces no body to parse.
     */
    if (response.status >= 500 && parsed === null) {
      throw new ApiError(
        'BACKEND_UNAVAILABLE',
        'Could not reach the backend. Is it running?',
        response.status,
      );
    }

    throw new ApiError(
      'INTERNAL_ERROR',
      `Request failed with status ${String(response.status)}.`,
      response.status,
    );
  }

  return (await response.json()) as T;
}
