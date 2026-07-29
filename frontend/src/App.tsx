import { useEffect, useState } from 'react';

import { getHealth } from './api/health';
import { ApiError } from './api/client';

type BackendState =
  | { status: 'checking' }
  | { status: 'connected'; version: string }
  | { status: 'unavailable'; message: string };

/**
 * Foundation shell. Its only job is to prove that the frontend builds and
 * can reach the backend -- Milestone 1's exit criterion.
 *
 * The circuit editor, gate palette, and visualizations arrive in Milestone 3.
 */
export default function App() {
  const [backend, setBackend] = useState<BackendState>({ status: 'checking' });

  useEffect(() => {
    const controller = new AbortController();

    getHealth(controller.signal)
      .then((health) => {
        setBackend({ status: 'connected', version: health.version });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setBackend({
          status: 'unavailable',
          message:
            error instanceof ApiError ? error.message : 'Unexpected failure.',
        });
      });

    return () => {
      controller.abort();
    };
  }, []);

  return (
    <main className="flex min-h-full flex-col items-center justify-center gap-6 bg-surface p-8 text-ink">
      <header className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight">
          Phasor Workbench
        </h1>
        <p className="mt-2 text-ink-muted">
          Foundation scaffolding. No circuit features are implemented yet.
        </p>
      </header>

      <section
        aria-labelledby="backend-status-heading"
        className="rounded-lg border border-ink-muted/20 bg-surface-raised px-6 py-4"
      >
        <h2 id="backend-status-heading" className="text-sm font-medium">
          Backend status
        </h2>
        <p className="mt-1 text-sm text-ink-muted" role="status">
          {backend.status === 'checking' && 'Checking…'}
          {backend.status === 'connected' &&
            `Connected — API version ${backend.version}`}
          {backend.status === 'unavailable' && backend.message}
        </p>
      </section>
    </main>
  );
}
