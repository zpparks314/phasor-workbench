import { useEffect, useMemo, useState } from 'react';

import { getHealth } from './api/health';
import { ApiError } from './api/client';
import { CircuitEditor } from './editor/CircuitEditor';
import { createDemoCircuit } from './editor/demoCircuit';

type BackendState =
  | { status: 'checking' }
  | { status: 'connected'; version: string }
  | { status: 'unavailable'; message: string };

/**
 * Application shell.
 *
 * The circuit canvas renders here read-only; the palette, placement, and the
 * three-region layout specified in docs/UI.md arrive with the interaction work.
 *
 * The backend check stays because Architecture.md requires the frontend to remain
 * functional when the backend is down -- and Milestone 3 makes that easy to
 * demonstrate, since the editor makes no backend calls at all.
 */
export default function App() {
  const [backend, setBackend] = useState<BackendState>({ status: 'checking' });
  const circuit = useMemo(() => createDemoCircuit(), []);

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
    <div className="flex min-h-full flex-col bg-surface text-ink">
      <header className="border-b border-ink-muted/20 px-8 py-4">
        <h1 className="text-xl font-semibold tracking-tight">
          Phasor Workbench
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Circuit editor — rendering only. Placement arrives next.
        </p>
      </header>

      <main className="flex-1 p-8">
        <CircuitEditor initialCircuit={circuit} />
      </main>

      <footer className="border-t border-ink-muted/20 px-8 py-3">
        <p className="text-sm text-ink-muted" role="status">
          {backend.status === 'checking' && 'Checking backend…'}
          {backend.status === 'connected' &&
            `Backend connected — API version ${backend.version}`}
          {backend.status === 'unavailable' && `Backend: ${backend.message}`}
        </p>
      </footer>
    </div>
  );
}
