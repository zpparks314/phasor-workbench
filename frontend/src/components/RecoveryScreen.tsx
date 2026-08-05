/**
 * What the application shows once it has stopped being an application.
 *
 * The fallback for the root `./ErrorBoundary`. Everything else in this project
 * that fails does so *inside* a working editor -- a save that could not be
 * written, a file that could not be read, a backend that did not answer -- and
 * reports through the header's alerts, which UI.md keeps to two on purpose. This
 * is not a third of those, and it deliberately does not try to be: when the
 * render itself threw, the header is gone with everything else, and there is no
 * surface left to extend.
 *
 * Three things it has to do, in order of how easy each is to get wrong.
 *
 * **Say what happened.** "Something went wrong" is the silence AGENTS.md
 * forbids, dressed as a message. The error's own text is shown, and its stack
 * sits one disclosure away -- a person filing a bug about a circuit that will
 * not draw needs it, and hiding it behind a build flag means the only builds
 * that can report the problem are the ones nobody is running.
 *
 * **Say what survived.** Nothing here has touched the working set, and a person
 * looking at a crashed editor will assume otherwise. Stating it is the same
 * reassurance a failed import gets.
 *
 * **Offer a way out that is not a loop.** This is the part worth reading before
 * changing anything below. The editor opens on whatever browser storage
 * restored, so if the crash is *caused* by the saved circuit -- a document this
 * build's layout cannot draw -- then reloading brings the same crash back, every
 * time, and the application is bricked for that browser with the user's work
 * sealed inside it. Reload alone is therefore not an escape. Discarding the
 * saved circuit is, and destroying someone's only copy to rescue them is not a
 * trade worth making silently, so the download comes first.
 *
 * **The download is the raw stored text, unparsed.** It cannot go through
 * `serialization/`: the premise of this screen is that the document may be one
 * this build cannot handle, and re-serialising it through the code that just
 * crashed would either fail again or hand back something other than what was
 * stored. Bytes out, exactly as they went in.
 */

import { useEffect, useRef, useState } from 'react';

import { downloadFile } from '../files';
import { clearStoredCircuit, readStoredDocument } from '../persistence';

export interface RecoveryScreenProps {
  readonly error: Error;
  /** Injected by tests. Reloading is what jsdom has no implementation of. */
  readonly reload?: () => void;
}

const BUTTON =
  'rounded border border-ink-muted/40 px-3 py-1.5 text-sm hover:border-ink';

export function RecoveryScreen({
  error,
  reload = () => {
    globalThis.location.reload();
  },
}: RecoveryScreenProps): React.JSX.Element {
  /**
   * Read once, on mount. The document cannot change while this screen is up --
   * nothing is running that could write it -- and re-reading on every render
   * would put a storage access in a render path.
   */
  const [saved] = useState(readStoredDocument);
  const [confirming, setConfirming] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  /**
   * Focus lands on `body` when the element holding it is unmounted, which is
   * exactly what a caught error does to the whole tree. Without this, a keyboard
   * user meets the crash screen from the top of the document with no indication
   * that anything changed.
   */
  useEffect(() => {
    heading.current?.focus();
  }, []);

  function discard(): void {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    clearStoredCircuit();
    reload();
  }

  const discardLabel = confirming
    ? 'Discard the saved circuit and reload?'
    : 'Discard the saved circuit and reload';

  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-surface p-8 text-ink">
      <main className="flex w-full max-w-2xl flex-col gap-4">
        <h1
          ref={heading}
          tabIndex={-1}
          className="text-xl font-semibold tracking-tight"
        >
          Phasor Workbench stopped unexpectedly
        </h1>

        {/*
          The buttons stay outside the alert. `role="alert"` is an assertive live
          region, and controls inside one get re-announced whenever their labels
          change -- which the discard button's does, on its way to confirming.
        */}
        <div
          role="alert"
          className="flex flex-col gap-2 rounded border border-ink-muted/40 px-4 py-3 text-sm"
        >
          <p>
            The editor hit an error while drawing and could not continue:{' '}
            <span className="font-mono">{error.message}</span>
          </p>
          <p className="text-ink-muted">
            Your saved circuit has not been changed by this.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={reload} className={BUTTON}>
            Reload
          </button>
        </div>

        {/*
          Only when there is something stored, because without it neither the
          loop nor the rescue exists -- an editor that opens empty and crashes
          will not stop crashing by being given an emptier one, and offering to
          discard nothing would be a control that does nothing.
        */}
        {saved !== null && (
          <section
            aria-label="Recover the saved circuit"
            className="flex flex-col gap-2 rounded border border-ink-muted/40 px-4 py-3 text-sm"
          >
            <p>
              If reloading brings you straight back here, the saved circuit is
              what this build cannot draw. Download it first — it is the only
              copy — then discard it to open an empty canvas.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  downloadFile({
                    filename: 'saved-circuit.json',
                    text: saved,
                    type: 'application/json',
                  });
                }}
                className={BUTTON}
              >
                Download the saved circuit
              </button>

              {/*
                Two presses, as every destructive control in the editor takes.
                There is no history on this screen and no second copy behind it,
                so this is the most irreversible button in the application.
              */}
              <button
                type="button"
                aria-label={discardLabel}
                onClick={discard}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && confirming) {
                    event.preventDefault();
                    setConfirming(false);
                  }
                }}
                className={
                  confirming
                    ? `${BUTTON} border-ink bg-ink text-surface`
                    : BUTTON
                }
              >
                {confirming ? 'Confirm discard' : 'Discard and reload'}
              </button>
            </div>
            {/*
              A name that changes under a focused button is not reliably
              re-announced, so the question is stated as well -- the same
              treatment the header's Clear confirmation gets.
            */}
            {confirming && (
              <p role="status" className="text-ink-muted">
                {discardLabel} Press again to confirm, Escape to cancel.
              </p>
            )}
          </section>
        )}

        {/*
          Not hidden behind a development flag. A stack is what makes a report
          about a circuit that will not draw actionable, and gating it on the
          build would leave it available only where nobody is running into the
          problem.
        */}
        <details className="text-sm text-ink-muted">
          <summary className="cursor-pointer">Technical detail</summary>
          <pre className="mt-2 overflow-x-auto rounded bg-surface-raised p-3 text-xs">
            {error.stack ?? `${error.name}: ${error.message}`}
          </pre>
        </details>
      </main>
    </div>
  );
}
