/**
 * Choosing a built-in circuit to start from.
 *
 * **Beside `StructureControls` rather than in `ViewControls`.** That line is
 * `ViewControls`' own: structure controls change the document and are undoable,
 * view controls change only what is drawn. Loading an example replaces the
 * circuit in one undo step, so it belongs on the document side of it -- and not
 * inside `StructureControls` itself, whose roving toolbar is about the qubits
 * and registers of the circuit you already have.
 *
 * **A `<select>` and a button, not a list or a dialog.** The editor has no menu
 * or dialog pattern anywhere, and introducing one to place six items would be
 * the most expensive possible way to ask a small question. A native select is
 * already the pattern the inspector uses for a classical register, and it
 * arrives with keyboard and screen-reader support rather than needing it built.
 *
 * **Choosing does not load.** The select changes a choice; the button applies
 * it. Loading on change would make an arrow key destroy the circuit on the
 * canvas, which is the one thing a keyboard user does to read a list.
 *
 * Presentational, like every other component in here: `useExamples` fetches the
 * catalogue and the editor passes it down, so this can be rendered from a
 * fixture and has nothing to mock.
 */

import { useState } from 'react';

import type { ExampleEntry } from '../api/examples';
import type { ExamplesState } from './useExamples';

export interface ExamplePickerProps {
  readonly examples: ExamplesState;
  /** Applies the chosen example. Fetching the circuit is the editor's. */
  readonly onLoad: (entry: ExampleEntry) => void;
}

const CONTROL =
  'rounded border border-ink-muted/40 px-2 py-1 text-sm enabled:hover:border-ink disabled:opacity-40';

export function ExamplePicker({
  examples,
  onLoad,
}: ExamplePickerProps): React.JSX.Element {
  const [chosen, setChosen] = useState<string | null>(null);

  const entries = examples.status === 'ready' ? examples.entries : [];
  const unavailable = examples.status === 'unavailable';

  /**
   * The choice defaults to the first entry rather than being written into
   * state when the catalogue arrives. Deriving it means there is no effect to
   * synchronise and no moment where `chosen` names an entry that is not there.
   */
  const entry =
    entries.find((candidate) => candidate.id === chosen) ?? entries[0];
  const empty = entries.length === 0;

  return (
    <div className="flex items-center gap-2 text-sm">
      <label className="flex items-center gap-2">
        <span className="text-ink-muted uppercase">Examples</span>
        <select
          value={entry?.id ?? ''}
          disabled={empty}
          aria-label="Example circuit"
          onChange={(event) => {
            setChosen(event.target.value);
          }}
          className={CONTROL}
        >
          {empty ? (
            <option value="">{unavailable ? 'Unavailable' : 'Loading…'}</option>
          ) : (
            entries.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))
          )}
        </select>
      </label>

      <button
        type="button"
        disabled={entry === undefined}
        aria-label={
          entry === undefined
            ? 'Load example circuit'
            : `Load ${entry.name}, replacing the circuit`
        }
        title={
          entry === undefined
            ? 'Load example circuit'
            : `Load ${entry.name}, replacing the circuit`
        }
        onClick={() => {
          if (entry !== undefined) onLoad(entry);
        }}
        className={CONTROL}
      >
        Load
      </button>

      {/*
        The summary is shown rather than hidden in a title attribute: it is the
        part that teaches, and a tooltip is unreachable by keyboard and unread
        by most screen readers.
      */}
      {entry !== undefined && (
        <span className="text-ink-muted">{entry.summary}</span>
      )}

      {unavailable && (
        <span className="text-ink-muted">
          Example circuits need the backend, which could not be reached.
        </span>
      )}
    </div>
  );
}
