import { useEffect, useMemo, useState } from 'react';

import { getHealth } from './api/health';
import { ApiError } from './api/client';
import { CircuitEditor } from './editor/CircuitEditor';
import type { Circuit } from './model/circuit';
import { SCHEMA_VERSION } from './model/spec';
import { loadStoredCircuit } from './persistence';
import { newIdentifier } from './state';

type BackendState =
  | { status: 'checking' }
  | { status: 'connected'; version: string }
  | { status: 'unavailable'; message: string };

/**
 * Application shell.
 *
 * **It opens on whatever local storage restored, and on an empty circuit
 * otherwise.** The demo circuit is gone: it existed so the renderer had
 * something to draw before the editor could build anything, and both of its
 * successors now exist.
 *
 * A stored document that cannot be read is *not* silently discarded. It is
 * reported, and the editor opens empty beside the reason -- ADR-0008 section 5
 * and AGENTS.md both forbid swallowing it, and the likeliest causes are a
 * partial write or a build older than the document.
 *
 * The backend check stays because Architecture.md requires the frontend to remain
 * functional when the backend is down -- and Milestone 3 makes that easy to
 * demonstrate, since the editor makes no backend calls at all.
 */
export default function App() {
  const [backend, setBackend] = useState<BackendState>({ status: 'checking' });

  // Read once, on mount. The editor owns the circuit from then on, and a second
  // read would fight whatever the user has since edited.
  const restored = useMemo(() => loadStoredCircuit(), []);
  const circuit = restored.ok ? restored.circuit : emptyCircuit();

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
          Circuit editor — add qubits and registers, then place gates from the
          palette.
        </p>
      </header>

      <main className="flex-1 p-8">
        {/*
          Reported rather than discarded. "empty" is the ordinary first run and
          says nothing; the others mean a document was there and could not be
          read, which the user is entitled to know before building over it.
        */}
        {!restored.ok && restored.reason === 'unreadable' && (
          <p
            role="alert"
            className="mb-4 rounded border border-ink-muted/40 px-3 py-2 text-sm"
          >
            A saved circuit was found but could not be read, so the editor
            opened empty. Saving will replace it.
          </p>
        )}

        {/*
          Said before the first edit rather than at save time, which is what
          ADR-0008 section 3 requires. A circuit written by a newer build carries
          fields this one cannot interpret; they survive an untouched round trip
          and cannot survive an edit, because they are keyed to positions that
          editing moves. Warning at save would be warning after the decision.
        */}
        {restored.ok && restored.warnings.length > 0 && (
          <p
            role="alert"
            className="mb-4 rounded border border-ink-muted/40 px-3 py-2 text-sm"
          >
            This circuit was saved by a newer version of Phasor Workbench. It
            opens correctly, but parts this version does not understand will be
            dropped the next time you save.
          </p>
        )}

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

/** A circuit with nothing in it, which the canvas prompts the user to fill. */
function emptyCircuit(): Circuit {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newIdentifier(),
    qubits: [],
    classicalRegisters: [],
    operations: [],
  };
}
