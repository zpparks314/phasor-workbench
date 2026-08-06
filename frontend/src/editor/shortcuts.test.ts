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
  isTypingTarget,
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
  const canvas = 'canvas' as const;

  it.each([
    ['z with ctrl', press('z', { ctrlKey: true }), { kind: 'undo' }, canvas],
    ['z with cmd', press('z', { metaKey: true }), { kind: 'undo' }, canvas],
    // Capitals reach the handler when Shift is held, and Z is one of two keys
    // where that is the normal way to press it.
    [
      'Z with ctrl and shift',
      press('Z', { ctrlKey: true, shiftKey: true }),
      { kind: 'redo' },
      canvas,
    ],
    ['s with ctrl', press('s', { ctrlKey: true }), { kind: 'save' }, canvas],
    ['b', press('b'), { kind: 'cycleBarriers', direction: 1 }, canvas],
    [
      'B with shift',
      press('B', { shiftKey: true }),
      { kind: 'cycleBarriers', direction: -1 },
      canvas,
    ],
    [
      'ArrowUp',
      press('ArrowUp'),
      { kind: 'moveCursor', rows: -1, columns: 0 },
      canvas,
    ],
    [
      'ArrowRight',
      press('ArrowRight'),
      { kind: 'moveCursor', rows: 0, columns: 1 },
      canvas,
    ],
    [
      'ArrowLeft with ctrl',
      press('ArrowLeft', { ctrlKey: true }),
      { kind: 'nudgeSelection', rows: 0, columns: -1 },
      canvas,
    ],
    ['Home', press('Home'), { kind: 'cursorToEdge', edge: 'start' }, canvas],
    ['End', press('End'), { kind: 'cursorToEdge', edge: 'end' }, canvas],
    ['Enter', press('Enter'), { kind: 'activate' }, canvas],
    ['Space', press(' '), { kind: 'activate' }, canvas],
    ['Delete', press('Delete'), { kind: 'remove' }, canvas],
    ['Backspace', press('Backspace'), { kind: 'remove' }, canvas],
    ['Escape', press('Escape'), { kind: 'cancel' }, canvas],
    ['?', press('?'), { kind: 'shortcuts' }, 'global' as const],
  ])('reads %s as %o', (_name, keyPress, command, scope) => {
    expect(resolveShortcut(keyPress, scope)).toEqual(command);
  });

  /**
   * The bug that introduced `scope`: `?` resolved only when the grid held
   * focus, so pressing it anywhere else did nothing. Asserted in both
   * directions, because the fix is only correct if the canvas *also* stops
   * claiming it -- two listeners for one key would toggle the panel twice and
   * leave it exactly as it was.
   */
  it('gives ? to the global surface and not to the canvas', () => {
    expect(resolveShortcut(press('?'), 'global')).toEqual({
      kind: 'shortcuts',
    });
    expect(resolveShortcut(press('?'), 'canvas')).toBeUndefined();
  });

  /** And the reverse: a global listener must not inherit the canvas's keys. */
  it.each(['Delete', 'Escape', 'ArrowDown', 'Enter'])(
    'does not give %s to the global surface',
    (key) => {
      expect(resolveShortcut(press(key), 'global')).toBeUndefined();
    },
  );

  /**
   * An unclaimed press must come back as nothing rather than a no-op command:
   * that is what lets the canvas leave it to the browser instead of swallowing
   * every key it does not use.
   */
  it.each(['a', 'F5', 'Tab', 'PageDown'])('does not claim %s', (key) => {
    expect(resolveShortcut(press(key), 'canvas')).toBeUndefined();
    expect(resolveShortcut(press(key), 'global')).toBeUndefined();
  });
});

describe('precedence', () => {
  /**
   * The one genuine collision, and the reason order is documented as meaning
   * something. Both the nudge entry and the cursor entry match an arrow; the
   * nudge is listed first, so Ctrl + Left moves the operation.
   */
  it('gives Ctrl and an arrow to the nudge, not the cursor', () => {
    expect(
      resolveShortcut(press('ArrowLeft', { ctrlKey: true }), 'canvas'),
    ).toEqual({
      kind: 'nudgeSelection',
      rows: 0,
      columns: -1,
    });
    expect(resolveShortcut(press('ArrowLeft'), 'canvas')).toEqual({
      kind: 'moveCursor',
      rows: 0,
      columns: -1,
    });
  });

  /** Undo excludes Shift explicitly, so redo cannot be shadowed by reordering. */
  it('keeps undo and redo apart on Shift alone', () => {
    expect(resolveShortcut(press('z', { ctrlKey: true }), 'canvas')).toEqual({
      kind: 'undo',
    });
    expect(
      resolveShortcut(press('z', { ctrlKey: true, shiftKey: true }), 'canvas'),
    ).toEqual({ kind: 'redo' });
  });

  /**
   * `b` is a bare letter, so it must not fire while a modifier is held --
   * Ctrl + B is bold in a browser and Cmd + B is a bookmark bar.
   */
  it('leaves Ctrl and Cmd combinations of b alone', () => {
    expect(
      resolveShortcut(press('b', { ctrlKey: true }), 'canvas'),
    ).toBeUndefined();
    expect(
      resolveShortcut(press('b', { metaKey: true }), 'canvas'),
    ).toBeUndefined();
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

  /**
   * Every entry belongs to a surface that listens for it. Without this, adding
   * a third scope value would give the reference a row that nothing dispatches
   * — the exact drift the table exists to prevent, arriving by a new route.
   */
  it('scopes every entry to a surface that has a listener', () => {
    for (const shortcut of SHORTCUTS) {
      expect(['canvas', 'global']).toContain(shortcut.scope);
    }
  });
});

describe('the typing guard', () => {
  /**
   * The cost of a global binding. `?` is Shift + / on most layouts, so without
   * this it would swallow a question mark meant for one of the editor's fields.
   */
  it.each(['input', 'textarea', 'select'])('holds off inside a %s', (tag) => {
    expect(isTypingTarget(document.createElement(tag))).toBe(true);
  });

  it('does not hold off on the canvas or a button', () => {
    expect(isTypingTarget(document.createElement('div'))).toBe(false);
    expect(isTypingTarget(document.createElement('button'))).toBe(false);
  });

  /**
   * Set as an attribute, not through `contentEditable`: jsdom implements
   * neither that setter nor `isContentEditable`, so the guard checks the
   * attribute as well — which is also what handles a press landing on a *child*
   * of an editable region.
   */
  it('holds off inside anything contenteditable', () => {
    const region = document.createElement('div');
    region.setAttribute('contenteditable', 'true');
    const child = document.createElement('span');
    region.append(child);

    expect(isTypingTarget(region)).toBe(true);
    expect(isTypingTarget(child)).toBe(true);
  });

  it('does not hold off where editing is explicitly off', () => {
    const element = document.createElement('div');
    element.setAttribute('contenteditable', 'false');

    expect(isTypingTarget(element)).toBe(false);
  });

  /** A press with no target at all is not typing, and must not throw. */
  it('treats a missing target as not typing', () => {
    expect(isTypingTarget(null)).toBe(false);
  });
});
