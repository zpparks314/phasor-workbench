import { request } from './client';
import type { HealthResponse } from './types';

/**
 * Liveness check. Used to prove frontend and backend can communicate,
 * which is Milestone 1's exit criterion.
 */
export function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return request<HealthResponse>('/health', signal ? { signal } : {});
}
