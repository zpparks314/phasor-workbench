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
    mockFetch({ ok: true, status: 200, json: () => Promise.resolve({ status: 'ok' }) });

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
});
