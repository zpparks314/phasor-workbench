/**
 * The shortcut table.
 *
 * Two things are worth testing here and one of them is easy to miss. The first
 * is that each entry resolves the presses it claims. The second is **precedence**
 * — the list replaced a chain of `if`s, and a chain's ordering was visible while
 * a list's is not, so the one case where two entries both match is pinned rather
 * than left to whoever next reorders the array.
 *
 * That the *canvas* honours every entry is asserted in `CircuitCanvas.test.tsx`,
 * and that the *reference* shows every entry in `ShortcutReference.test.tsx`.
 * Between them the table cannot claim something neither surface delivers, which
 * is the whole point of there being one table.
 */

import { describe, expect, it } from 'vitest';

import {
  SHORTCUTS,
  resolveShortcut,
  shortcutGroups,
  type KeyPress,
} from './shortcuts';

function press(key: string, modifiers: Partial<KeyPress> = {}): KeyPress {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...modifiers,
  };
}

describe('resolving a press', () => {
  it.each([
    ['z with ctrl', press('z', { ctrlKey: true }), { kind: 'undo' }],
    ['z with cmd', press('z', { metaKey: true }), { kind: 'undo' }],
    // Capitals reach the handler when Shift is held, and Z is one of two keys
    // where that is the normal way to press it.
    [
      'Z with ctrl and shift',
      press('Z', { ctrlKey: true, shiftKey: true }),
      { kind: 'redo' },
    ],
    ['s with ctrl', press('s', { ctrlKey: true }), { kind: 'save' }],
    ['b', press('b'), { kind: 'cycleBarriers', direction: 1 }],
    [
      'B with shift',
      press('B', { shiftKey: true }),
      {
        kind: 'cycleBarriers',
        direction: -1,
      },
    ],
    ['ArrowUp', press('ArrowUp'), { kind: 'moveCursor', rows: -1, columns: 0 }],
    [
      'ArrowRight',
      press('ArrowRight'),
      { kind: 'moveCursor', rows: 0, columns: 1 },
    ],
    [
      'ArrowLeft with ctrl',
      press('ArrowLeft', { ctrlKey: true }),
      { kind: 'nudgeSelection', rows: 0, columns: -1 },
    ],
    ['Home', press('Home'), { kind: 'cursorToEdge', edge: 'start' }],
    ['End', press('End'), { kind: 'cursorToEdge', edge: 'end' }],
    ['Enter', press('Enter'), { kind: 'activate' }],
    ['Space', press(' '), { kind: 'activate' }],
    ['Delete', press('Delete'), { kind: 'remove' }],
    ['Backspace', press('Backspace'), { kind: 'remove' }],
    ['Escape', press('Escape'), { kind: 'cancel' }],
    ['?', press('?'), { kind: 'shortcuts' }],
  ])('reads %s as %o', (_name, keyPress, command) => {
    expect(resolveShortcut(keyPress)).toEqual(command);
  });

  /**
   * An unclaimed press must come back as nothing rather than a no-op command:
   * that is what lets the canvas leave it to the browser instead of swallowing
   * every key it does not use.
   */
  it.each(['a', 'F5', 'Tab', 'PageDown'])('does not claim %s', (key) => {
    expect(resolveShortcut(press(key))).toBeUndefined();
  });
});

describe('precedence', () => {
  /**
   * The one genuine collision, and the reason order is documented as meaning
   * something. Both the nudge entry and the cursor entry match an arrow; the
   * nudge is listed first, so Ctrl + Left moves the operation.
   */
  it('gives Ctrl and an arrow to the nudge, not the cursor', () => {
    expect(resolveShortcut(press('ArrowLeft', { ctrlKey: true }))).toEqual({
      kind: 'nudgeSelection',
      rows: 0,
      columns: -1,
    });
    expect(resolveShortcut(press('ArrowLeft'))).toEqual({
      kind: 'moveCursor',
      rows: 0,
      columns: -1,
    });
  });

  /** Undo excludes Shift explicitly, so redo cannot be shadowed by reordering. */
  it('keeps undo and redo apart on Shift alone', () => {
    expect(resolveShortcut(press('z', { ctrlKey: true }))).toEqual({
      kind: 'undo',
    });
    expect(
      resolveShortcut(press('z', { ctrlKey: true, shiftKey: true })),
    ).toEqual({ kind: 'redo' });
  });

  /**
   * `b` is a bare letter, so it must not fire while a modifier is held --
   * Ctrl + B is bold in a browser and Cmd + B is a bookmark bar.
   */
  it('leaves Ctrl and Cmd combinations of b alone', () => {
    expect(resolveShortcut(press('b', { ctrlKey: true }))).toBeUndefined();
    expect(resolveShortcut(press('b', { metaKey: true }))).toBeUndefined();
  });
});

describe('the list as documentation', () => {
  /** A row with no keys or no description is a row that teaches nothing. */
  it('gives every entry something to display', () => {
    for (const shortcut of SHORTCUTS) {
      expect(shortcut.keys).not.toBe('');
      expect(shortcut.description).not.toBe('');
      expect(shortcut.group).not.toBe('');
    }
  });

  /** The reference keys its rows by this, so a duplicate would drop one. */
  it('describes each key combination once', () => {
    const keys = SHORTCUTS.map((shortcut) => shortcut.keys);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('groups without losing or duplicating an entry', () => {
    const grouped = shortcutGroups().flatMap((entry) => entry.shortcuts);

    expect(grouped).toHaveLength(SHORTCUTS.length);
    expect(new Set(grouped).size).toBe(SHORTCUTS.length);
  });

  it('keeps each group contiguous and in first-appearance order', () => {
    const groups = shortcutGroups().map((entry) => entry.group);
    const firstAppearance = [...new Set(SHORTCUTS.map((s) => s.group))];

    expect(groups).toEqual(firstAppearance);
  });
});
