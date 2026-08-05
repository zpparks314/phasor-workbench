/**
 * The editor's header: undo, redo, and clear.
 *
 * **The buttons say what they will do.** ADR-0007 attaches a label to every
 * history entry precisely so the controls can read "Undo place h on q0" rather
 * than "Undo" -- a generic label throws away information the model already
 * carries. Clear names its count for the same reason.
 *
 * **Undo and redo are `disabled`, not `aria-disabled`.** This is the opposite of
 * the palette's treatment and UI.md asks for both deliberately: an unavailable
 * gate has something to teach ("this needs a register to measure into"), while an
 * empty undo stack has nothing to say beyond its own emptiness. The roving focus
 * steps over them rather than stranding itself on a control that cannot be
 * focused.
 *
 * A `role="toolbar"` with a roving focus, so the header is one tab stop like
 * every other region. That is the standard ARIA pattern for a row of controls,
 * and it is what keeps `Tab` moving between regions rather than through them.
 *
 * Save and the save status belong here too, per UI.md's region diagram, and
 * arrive with local save.
 */

import { useRef, useState } from 'react';

export interface EditorHeaderProps {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** What undo would reverse, e.g. "Place h on q0". Null when disabled. */
  readonly undoLabel: string | null;
  readonly redoLabel: string | null;
  readonly operationCount: number;
  /** Null until the circuit has been saved at least once this session. */
  readonly savedAt: Date | null;
  /** Present only when the last save failed, and stated rather than hinted. */
  readonly saveError: string | null;
  /**
   * Present only when the last file operation failed.
   *
   * Import and OpenQASM export share it: both leave the canvas exactly as it
   * was, so one alert says so in one place. The message arrives complete --
   * what reassurance is appropriate depends on which operation failed, and the
   * caller is the only one that knows.
   */
  readonly fileError: string | null;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onClear: () => void;
  readonly onSave: () => void;
  readonly onExport: () => void;
  /** OpenQASM export. Asynchronous and backend-bound, unlike `onExport`. */
  readonly onExportQasm: () => void;
  /** Opens the file picker. Import itself is the editor's to apply. */
  readonly onImport: (file: File) => void;
}

const BUTTON =
  'rounded border border-ink-muted/40 px-2 py-1 text-sm enabled:hover:border-ink disabled:opacity-40';

export function EditorHeader({
  canUndo,
  canRedo,
  undoLabel,
  redoLabel,
  operationCount,
  savedAt,
  saveError,
  fileError,
  onUndo,
  onRedo,
  onClear,
  onSave,
  onExport,
  onExportQasm,
  onImport,
}: EditorHeaderProps): React.JSX.Element {
  const [focused, setFocused] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const picker = useRef<HTMLInputElement>(null);

  const controls = [
    { key: 'undo', enabled: canUndo },
    { key: 'redo', enabled: canRedo },
    { key: 'clear', enabled: operationCount > 0 },
    // Always enabled. Saving an unchanged circuit is harmless, and a disabled
    // save invites the reading that there is nothing worth saving.
    { key: 'save', enabled: true },
    // Export is enabled for an empty circuit too, on the same reasoning: an
    // empty circuit is a valid document, not a missing one.
    { key: 'export', enabled: true },
    { key: 'exportQasm', enabled: true },
    { key: 'import', enabled: true },
  ];

  /**
   * The roving tab stop never lands on a disabled control.
   *
   * A `disabled` button cannot take focus, so a roving index pointing at one
   * leaves the region with no way in -- Tab reaches nothing and the header
   * becomes unreachable. Resolved on read, like every other derived thing here.
   */
  const tabbableKey =
    controls.find((control, index) => index === focused && control.enabled)
      ?.key ?? controls.find((control) => control.enabled)?.key;

  function moveFocus(from: number, step: number): void {
    for (let index = from + step; index >= 0 && index < controls.length;) {
      const control = controls[index];
      if (control !== undefined && control.enabled) {
        setFocused(index);
        buttons.current.get(control.key)?.focus();
        return;
      }
      index += step;
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>): void {
    const step: Record<string, number> = {
      ArrowRight: 1,
      ArrowDown: 1,
      ArrowLeft: -1,
      ArrowUp: -1,
    };

    if (event.key in step) {
      event.preventDefault();
      moveFocus(focused, step[event.key] ?? 0);
    } else if (event.key === 'Escape' && confirming) {
      event.preventDefault();
      setConfirming(false);
    }
  }

  const register = (key: string) => (element: HTMLButtonElement | null) => {
    if (element === null) buttons.current.delete(key);
    else buttons.current.set(key, element);
  };

  const focus = (key: string) => () => {
    const index = controls.findIndex((control) => control.key === key);
    if (index >= 0) setFocused(index);
  };

  const operations = `${String(operationCount)} ${
    operationCount === 1 ? 'operation' : 'operations'
  }`;
  const clearLabel = confirming
    ? `Clear ${operations}?`
    : `Clear ${operations}`;

  // "Undo place h on q0", not "Undo Place h on q0". History labels are written
  // to stand alone in a list, so they start capitalised; here one is a clause
  // inside a sentence.
  const describe = (verb: string, label: string | null): string =>
    label === null
      ? verb
      : `${verb} ${label.charAt(0).toLowerCase()}${label.slice(1)}`;

  /** The last saved time, which UI.md asks the header to show. */
  const saveStatus = (at: Date | null): string =>
    at === null
      ? ''
      : `Saved at ${at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

  return (
    <header
      role="toolbar"
      aria-label="Circuit actions"
      aria-orientation="horizontal"
      onKeyDown={handleKeyDown}
      className="flex items-center gap-2"
    >
      <button
        ref={register('undo')}
        type="button"
        disabled={!canUndo}
        tabIndex={tabbableKey === 'undo' ? 0 : -1}
        aria-label={describe('Undo', undoLabel)}
        title={describe('Undo', undoLabel)}
        onFocus={focus('undo')}
        onClick={onUndo}
        className={BUTTON}
      >
        Undo
      </button>

      <button
        ref={register('redo')}
        type="button"
        disabled={!canRedo}
        tabIndex={tabbableKey === 'redo' ? 0 : -1}
        aria-label={describe('Redo', redoLabel)}
        title={describe('Redo', redoLabel)}
        onFocus={focus('redo')}
        onClick={onRedo}
        className={BUTTON}
      >
        Redo
      </button>

      {/*
        Two presses, with the count named in between, matching how removing a
        qubit behaves. This is the most destructive control in the editor, and
        the fact that one undo reverses it is not a reason to make it a single
        press -- a user who did not mean it has to notice first.
      */}
      <button
        ref={register('clear')}
        type="button"
        disabled={operationCount === 0}
        tabIndex={tabbableKey === 'clear' ? 0 : -1}
        aria-label={clearLabel}
        title={clearLabel}
        onFocus={focus('clear')}
        onClick={() => {
          if (confirming) {
            setConfirming(false);
            onClear();
          } else {
            setConfirming(true);
          }
        }}
        className={
          confirming ? `${BUTTON} border-ink bg-ink text-surface` : BUTTON
        }
      >
        {confirming ? 'Confirm' : 'Clear'}
      </button>

      <button
        ref={register('save')}
        type="button"
        tabIndex={tabbableKey === 'save' ? 0 : -1}
        aria-label="Save circuit"
        title="Save circuit (Ctrl/Cmd + S)"
        onFocus={focus('save')}
        onClick={onSave}
        className={BUTTON}
      >
        Save
      </button>

      <button
        ref={register('export')}
        type="button"
        tabIndex={tabbableKey === 'export' ? 0 : -1}
        aria-label="Export circuit as a JSON file"
        title="Export circuit as a JSON file"
        onFocus={focus('export')}
        onClick={onExport}
        className={BUTTON}
      >
        Export JSON
      </button>

      {/*
        A separate control rather than a format picker on one button. Import
        can route on content because the file already says what it is; export
        has no such evidence, so the choice is the user's and is better made
        visible than hidden behind a menu.
      */}
      <button
        ref={register('exportQasm')}
        type="button"
        tabIndex={tabbableKey === 'exportQasm' ? 0 : -1}
        aria-label="Export circuit as an OpenQASM 2.0 file"
        title="Export circuit as an OpenQASM 2.0 file"
        onFocus={focus('exportQasm')}
        onClick={onExportQasm}
        className={BUTTON}
      >
        Export QASM
      </button>

      {/*
        The button opens the picker rather than the input being visible, because
        a bare file input cannot be labelled or styled consistently across
        browsers. The input stays in the DOM and hidden -- `display: none` on it
        is fine, since it is never the thing focused.
      */}
      <button
        ref={register('import')}
        type="button"
        tabIndex={tabbableKey === 'import' ? 0 : -1}
        aria-label="Import a circuit from a JSON or OpenQASM file, replacing this one"
        title="Import a circuit from a JSON or OpenQASM file, replacing this one"
        onFocus={focus('import')}
        onClick={() => picker.current?.click()}
        className={BUTTON}
      >
        Import
      </button>

      <input
        ref={picker}
        type="file"
        // A hint for the picker, not a gate: `files/` routes on content, so a
        // QASM program in a differently-named file still imports.
        accept="application/json,.json,.qasm"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file !== undefined) onImport(file);
          // Cleared so that choosing the same file twice fires `change` twice.
          // Without this, re-importing a file the user has just edited on disk
          // does nothing at all, silently.
          event.target.value = '';
        }}
      />

      {/*
        A name that changes under a focused button is not reliably re-announced,
        so the question is stated outright as well. Same treatment as the qubit
        removal confirmation.
      */}
      <p role="status" className="text-sm text-ink-muted">
        {confirming
          ? `${clearLabel} Press again to confirm, Escape to cancel.`
          : saveStatus(savedAt)}
      </p>

      {/*
        A failed save is persistent and non-blocking, and says the circuit is
        still in memory. Silence would let someone close the tab believing their
        work was safe, which UI.md forbids and AGENTS.md forbids more generally.
        `alert` rather than `status`: this is not a passing update.
      */}
      {saveError !== null && (
        <p
          role="alert"
          className="rounded border border-ink-muted/40 px-2 py-1 text-sm"
        >
          {saveError} The circuit is still open and unsaved.
        </p>
      )}

      {/*
        A rejected file leaves the circuit untouched, and saying so is the point
        -- otherwise the alert reads as "your work is gone". Not routed to the
        problems strip: that surface is about the circuit on the canvas, and a
        file that never loaded has nothing there to point at. See UI.md, Files.
      */}
      {fileError !== null && (
        <p
          role="alert"
          className="rounded border border-ink-muted/40 px-2 py-1 text-sm"
        >
          {fileError}
        </p>
      )}
    </header>
  );
}
