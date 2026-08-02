import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, request } from './client';

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(
  response: Partial<Response> & { json: () => Promise<unknown> },
) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
}

describe('request', () => {
  it('returns the parsed body on success', async () => {
    mockFetch({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ status: 'ok' }),
    });

    await expect(request('/health')).resolves.toEqual({ status: 'ok' });
  });

  it('translates a structured error body into an ApiError', async () => {
    mockFetch({
      ok: false,
      status: 422,
      json: () =>
        Promise.resolve({
          error: {
            code: 'CIRCUIT_INVALID',
            message: 'Circuit failed validation.',
            details: [{ code: 'UNKNOWN_QUBIT_REFERENCE', message: 'Bad ref' }],
          },
        }),
    });

    const error = await request('/circuits/validate').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('CIRCUIT_INVALID');
    expect((error as ApiError).details).toHaveLength(1);
    expect((error as ApiError).isUserFacing).toBe(true);
  });

  it('reports an unreachable backend rather than throwing a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed')));

    const error = await request('/health').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('BACKEND_UNAVAILABLE');
    expect((error as ApiError).isUserFacing).toBe(false);
  });

  /**
   * The dev-proxy case, and the reason it needs its own branch.
   *
   * With the Vite proxy in front of a backend that is not running, the proxy
   * answers 500 with an empty body -- so `fetch` resolves and the rejection
   * branch above never fires. Reporting the status code said "Request failed
   * with status 500", which is true about the transport and useless about the
   * cause.
   */
  it('treats a bodyless 5xx as an unreachable backend, not an internal error', async () => {
    mockFetch({
      ok: false,
      status: 500,
      json: () => Promise.reject(new SyntaxError('Unexpected end of JSON')),
    });

    const error = await request('/circuits/analyze').catch((e: unknown) => e);

    expect((error as ApiError).code).toBe('BACKEND_UNAVAILABLE');
    expect((error as ApiError).message).toMatch(/is it running/i);
  });

  /**
   * The other side of that line. A backend that threw still answers with JSON,
   * so it must stay an internal error -- collapsing both into "unreachable"
   * would hide real backend faults behind a message saying it is not running.
   */
  it('keeps a 500 that carries a body as an internal error', async () => {
    mockFetch({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ detail: 'Internal Server Error' }),
    });

    const error = await request('/circuits/analyze').catch((e: unknown) => e);

    expect((error as ApiError).code).toBe('INTERNAL_ERROR');
  });
});
