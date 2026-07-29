/**
 * Types describing the API envelope defined in docs/API.md.
 *
 * Circuit Model types are deliberately absent -- they belong in shared/ and
 * arrive in Milestone 2. Nothing here should describe circuit structure.
 */

/** Machine-readable error codes. Clients branch on these, never on `message`. */
export type ApiErrorCode =
  | 'CIRCUIT_INVALID'
  | 'REQUEST_MALFORMED'
  | 'LIMIT_EXCEEDED'
  | 'RATE_LIMITED'
  | 'BACKEND_UNAVAILABLE'
  | 'SIMULATION_TIMEOUT'
  | 'INTERNAL_ERROR';

export interface ApiErrorDetail {
  code: string;
  message: string;
  /** Location of the problem within the submitted document. */
  path?: string;
}

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: ApiErrorDetail[];
  };
}

export interface HealthResponse {
  status: 'ok';
  version: string;
}
