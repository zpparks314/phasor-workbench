import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EditorHeader, type EditorHeaderProps } from './EditorHeader';

function show(overrides: Partial<EditorHeaderProps> = {}) {
  const props: EditorHeaderProps = {
    canUndo: true,
    canRedo: true,
    undoLabel: 'Place h on q0',
    redoLabel: 'Remove operation',
    operationCount: 3,
    savedAt: null,
    saveError: null,
    fileError: null,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onClear: vi.fn(),
    onSave: vi.fn(),
    onExport: vi.fn(),
    onImport: vi.fn(),
    ...overrides,
  };

  return { ...render(<EditorHeader {...props} />), props };
}

const button = (name: string | RegExp) => screen.getByRole('button', { name });

describe('labelling', () => {
  /**
   * ADR-0007 attaches a label to every history entry precisely so the control
   * can say what it will do. A generic "Undo" throws that away.
   */
  it('names what undo would reverse', () => {
    show();

    expect(button(/^Undo place h on q0$/)).toBeInTheDocument();
  });

  it('names what redo would repeat', () => {
    show();

    expect(button(/^Redo remove operation$/)).toBeInTheDocument();
  });

  /** History labels stand alone in a list; here one is a clause in a sentence. */
  it('lowercases the label so it reads as one sentence', () => {
    show({ undoLabel: 'Place h on q0' });

    expect(button(/^Undo place/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Undo Place/ })).toBeNull();
  });

  it('falls back to a bare verb with nothing to undo', () => {
    show({ canUndo: false, undoLabel: null });

    expect(button('Undo')).toBeInTheDocument();
  });

  it('names the count clear would destroy', () => {
    show({ operationCount: 3 });

    expect(button('Clear 3 operations')).toBeInTheDocument();
  });

  it('does not say "1 operations"', () => {
    show({ operationCount: 1 });

    expect(button('Clear 1 operation')).toBeInTheDocument();
  });
});

/** UI.md: undo and redo are disabled, not hidden, when their stack is empty. */
describe('availability', () => {
  it('disables undo with an empty stack', () => {
    show({ canUndo: false, undoLabel: null });

    expect(button('Undo')).toBeDisabled();
  });

  it('disables redo with an empty stack', () => {
    show({ canRedo: false, redoLabel: null });

    expect(button('Redo')).toBeDisabled();
  });

  it('disables clear on a circuit with no operations', () => {
    show({ operationCount: 0 });

    expect(button('Clear 0 operations')).toBeDisabled();
  });

  it('is still shown rather than hidden', () => {
    // Labels are null alongside an empty stack, as the store reports them.
    show({
      canUndo: false,
      canRedo: false,
      undoLabel: null,
      redoLabel: null,
      operationCount: 0,
    });

    for (const name of [/^Undo$/, /^Redo$/, /^Clear/, /^Save circuit$/]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  /** Saving an unchanged circuit is harmless; a disabled Save reads as "nothing
   * worth saving", which is a different and wrong claim. */
  it('leaves save enabled even with nothing to undo or clear', () => {
    show({ canUndo: false, canRedo: false, operationCount: 0 });

    expect(screen.getByRole('button', { name: 'Save circuit' })).toBeEnabled();
  });
});

describe('clearing', () => {
  it('takes two presses, and does nothing on the first', () => {
    const { props } = show({ operationCount: 3 });

    fireEvent.click(button('Clear 3 operations'));

    expect(props.onClear).not.toHaveBeenCalled();
    expect(screen.getByText(/Press again to confirm/)).toBeInTheDocument();

    fireEvent.click(button(/^Clear 3 operations\?$/));

    expect(props.onClear).toHaveBeenCalledOnce();
  });

  it('abandons the confirmation on Escape', () => {
    const { props } = show();

    fireEvent.click(button('Clear 3 operations'));
    fireEvent.keyDown(screen.getByRole('toolbar'), { key: 'Escape' });

    expect(screen.queryByText(/Press again/)).toBeNull();

    fireEvent.click(button('Clear 3 operations'));

    // Back to the first press, so this one only re-arms.
    expect(props.onClear).not.toHaveBeenCalled();
  });
});

/**
 * One tab stop per region, per UI.md. A toolbar with a roving focus is the
 * standard ARIA pattern for it.
 */
describe('the roving focus', () => {
  it('exposes exactly one tab stop', () => {
    show();

    const tabbable = screen
      .getAllByRole('button')
      .filter((control) => control.getAttribute('tabindex') === '0');

    expect(tabbable).toHaveLength(1);
  });

  it('moves between controls with the arrow keys', () => {
    show();

    fireEvent.keyDown(screen.getByRole('toolbar'), { key: 'ArrowRight' });

    expect(button(/^Redo/)).toHaveFocus();
  });

  /**
   * A `disabled` button cannot take focus, so a roving index resting on one
   * would leave the region with no way in at all.
   */
  it('never puts the tab stop on a disabled control', () => {
    show({ canUndo: false, undoLabel: null });

    expect(button('Undo')).toHaveAttribute('tabindex', '-1');
    expect(button(/^Redo/)).toHaveAttribute('tabindex', '0');
  });

  it('steps over a disabled control rather than landing on it', () => {
    show({ canRedo: false, redoLabel: null });

    fireEvent.keyDown(screen.getByRole('toolbar'), { key: 'ArrowRight' });

    expect(button('Clear 3 operations')).toHaveFocus();
  });
});

describe('exporting', () => {
  const picker = () => screen.getByRole('combobox', { name: 'Export format' });

  /**
   * A picker and a button, replacing the two buttons this shipped as. The
   * choice is still the user's -- import can route on a file's content, export
   * has no such evidence -- but it costs one header slot instead of two, which
   * is what the responsive task needed. See UI.md, *Files*.
   */
  it('offers both formats from one control', () => {
    show();

    expect(picker()).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'JSON' })).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: 'OpenQASM 2.0' }),
    ).toBeInTheDocument();
  });

  it('defaults to JSON and exports it', () => {
    const { props } = show();

    fireEvent.click(button(/Export circuit as a JSON file/));

    expect(props.onExport).toHaveBeenCalledWith('json');
  });

  it('exports OpenQASM once that is chosen', () => {
    const { props } = show();

    fireEvent.change(picker(), { target: { value: 'qasm' } });
    fireEvent.click(button(/Export circuit as an OpenQASM 2.0 file/));

    expect(props.onExport).toHaveBeenCalledWith('qasm');
  });

  /**
   * Choosing does not export, the same rule the examples picker follows: an
   * arrow key through a list must not write a file.
   */
  it('does not export on choosing alone', () => {
    const { props } = show();

    fireEvent.change(picker(), { target: { value: 'qasm' } });

    expect(props.onExport).not.toHaveBeenCalled();
  });

  /**
   * The button says which format it will write. Two controls acting on one
   * decision have to be readable as a pair, or a screen-reader user cannot
   * check what the button currently means.
   */
  it('renames the button to match the choice', () => {
    show();

    expect(button(/Export circuit as a JSON file/)).toBeInTheDocument();

    fireEvent.change(picker(), { target: { value: 'qasm' } });

    expect(
      button(/Export circuit as an OpenQASM 2.0 file/),
    ).toBeInTheDocument();
  });

  it('is reachable by the roving focus', () => {
    show();
    const toolbar = screen.getByRole('toolbar');

    // undo -> redo -> clear -> save -> format
    for (let step = 0; step < 4; step += 1) {
      fireEvent.keyDown(toolbar, { key: 'ArrowRight' });
    }

    expect(picker()).toHaveFocus();
  });

  /**
   * And the roving focus gives the arrows back once it is there. A `select`
   * changes its value with them; without the guard, adding this control would
   * have made the format unreachable by keyboard -- worse than the two buttons
   * it replaced.
   */
  it('leaves the arrow keys to the picker itself', () => {
    show();
    const toolbar = screen.getByRole('toolbar');

    for (let step = 0; step < 4; step += 1) {
      fireEvent.keyDown(toolbar, { key: 'ArrowRight' });
    }
    expect(picker()).toHaveFocus();

    fireEvent.keyDown(picker(), { key: 'ArrowRight', bubbles: true });

    expect(picker()).toHaveFocus();
  });
});
