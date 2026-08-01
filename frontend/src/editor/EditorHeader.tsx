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
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onClear: () => void;
}

const BUTTON =
  'rounded border border-ink-muted/40 px-2 py-1 text-sm enabled:hover:border-ink disabled:opacity-40';

export function EditorHeader({
  canUndo,
  canRedo,
  undoLabel,
  redoLabel,
  operationCount,
  onUndo,
  onRedo,
  onClear,
}: EditorHeaderProps): React.JSX.Element {
  const [focused, setFocused] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  const controls = [
    { key: 'undo', enabled: canUndo },
    { key: 'redo', enabled: canRedo },
    { key: 'clear', enabled: operationCount > 0 },
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

      {/*
        A name that changes under a focused button is not reliably re-announced,
        so the question is stated outright as well. Same treatment as the qubit
        removal confirmation.
      */}
      <p role="status" className="text-sm text-ink-muted">
        {confirming
          ? `${clearLabel} Press again to confirm, Escape to cancel.`
          : ''}
      </p>
    </header>
  );
}
