/**
 * What every key press in the editor means, in one list.
 *
 * **This is the source, not a description of one.** The canvas dispatches by
 * calling `resolveShortcut`, and the `?` reference renders these same entries, so
 * a key that behaves differently from what the reference claims is not a state
 * this module can be in. A help panel written by hand would have been a third
 * copy of the same facts, beside the `if`/`else` chain that used to live in
 * `CircuitCanvas` and the table in UI.md.
 *
 * **One entry is one rule *and* one row.** That is the constraint that makes the
 * two uses agree, and it is why an entry resolves a *family* of presses rather
 * than a single key: the four arrows are one rule to a reader ("move the cell
 * cursor") and four presses to a dispatcher, so the entry claims all four and
 * computes which. Splitting them would give the reference four rows nobody wants
 * to read; merging them for display only would put an editorial layer between the
 * list and the panel, which is the drift this exists to prevent.
 *
 * **Order is precedence**, exactly as it was when this was a chain of `if`s:
 * `resolveShortcut` returns the first entry that claims the press. `Ctrl` + an
 * arrow moves the selected operation and a bare arrow moves the cursor, so the
 * first must be listed above the second. `shortcuts.test.ts` pins that.
 *
 * **DOM-free**, like `layout.ts`, `placement.ts` and `pending.ts`, and for the
 * same reason: the logic is testable without rendering anything, and the
 * component stays thin enough to read. `KeyPress` is the four fields a decision
 * can be made from, which a React `KeyboardEvent` already satisfies structurally.
 *
 * **Scope is per entry, and it is not decoration.** Every binding used to be
 * canvas-scoped, which meant it fired only while the grid held focus. That was
 * fine for the ten that act on a cell or a selection and wrong for `?`, which
 * did nothing at all until you had clicked the canvas — reported as a bug on
 * 2026-08-05, correctly. A key whose whole job is helping someone who is lost is
 * the worst possible one to hide behind a focus requirement, and the argument
 * that it should match the others had the reasoning backwards: the others are
 * scoped because they need a cursor, not because scoping is the house style.
 *
 * So `scope` says which surface listens, `resolveShortcut` takes it as an
 * argument, and neither surface can silently claim the other's keys. Adding a
 * second global binding means weighing it against the input guard in
 * `CircuitEditor`, which is exactly the thought that should be forced.
 */

/** The fields a key decision is made from. A `KeyboardEvent` satisfies this. */
export interface KeyPress {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}

/**
 * What a press asked for, with its argument.
 *
 * A union rather than a bare name because half of these carry one: which
 * direction to step, how far to move. Returning `{ kind: 'moveCursor' }` and
 * leaving the caller to re-read the key would put a second key switch back in
 * the component, which is the thing being removed.
 */
export type Command =
  | { readonly kind: 'undo' }
  | { readonly kind: 'redo' }
  | { readonly kind: 'save' }
  | { readonly kind: 'cycleBarriers'; readonly direction: 1 | -1 }
  | {
      readonly kind: 'nudgeSelection';
      readonly rows: number;
      readonly columns: number;
    }
  | {
      readonly kind: 'moveCursor';
      readonly rows: number;
      readonly columns: number;
    }
  | { readonly kind: 'cursorToEdge'; readonly edge: 'start' | 'end' }
  | { readonly kind: 'activate' }
  | { readonly kind: 'remove' }
  | { readonly kind: 'cancel' }
  | { readonly kind: 'shortcuts' };

/**
 * Which surface listens for an entry.
 *
 * `canvas` fires only while the grid holds focus, which is right for anything
 * acting on the cell cursor or the selection — there is no sensible answer to
 * "move the cursor" from inside the header. `global` fires wherever you are, and
 * costs an input guard, so it is for keys that must work when you are lost.
 */
export type ShortcutScope = 'canvas' | 'global';

export interface Shortcut {
  /** As written for a reader: "Ctrl/Cmd + Z". Never platform-detected. */
  readonly keys: string;
  readonly description: string;
  /** The reference groups by this, in first-appearance order. */
  readonly group: string;
  readonly scope: ShortcutScope;
  /** The command this press means, or nothing if this entry does not claim it. */
  readonly resolve: (press: KeyPress) => Command | undefined;
}

/** How far each arrow moves, shared by the cursor and the nudge. */
const ARROWS: Readonly<
  Record<string, { readonly rows: number; readonly columns: number }>
> = {
  ArrowUp: { rows: -1, columns: 0 },
  ArrowDown: { rows: 1, columns: 0 },
  ArrowLeft: { rows: 0, columns: -1 },
  ArrowRight: { rows: 0, columns: 1 },
};

const accel = (press: KeyPress): boolean => press.ctrlKey || press.metaKey;

/**
 * Every shortcut the canvas honours, in precedence order.
 *
 * Adding one here gives it both a binding and a row in the reference. There is
 * nowhere else to register it, and nowhere else to document it.
 */
export const SHORTCUTS: readonly Shortcut[] = [
  {
    keys: 'Ctrl/Cmd + Z',
    description: 'Undo the last edit',
    group: 'The circuit',
    scope: 'canvas',
    resolve: (press) =>
      accel(press) && !press.shiftKey && press.key.toLowerCase() === 'z'
        ? { kind: 'undo' }
        : undefined,
  },
  {
    keys: 'Ctrl/Cmd + Shift + Z',
    description: 'Redo the last undone edit',
    group: 'The circuit',
    scope: 'canvas',
    resolve: (press) =>
      accel(press) && press.shiftKey && press.key.toLowerCase() === 'z'
        ? { kind: 'redo' }
        : undefined,
  },
  {
    // preventDefault matters more here than anywhere else: without it the
    // browser opens its own save dialogue over the editor.
    keys: 'Ctrl/Cmd + S',
    description: 'Save the circuit to this browser',
    group: 'The circuit',
    scope: 'canvas',
    resolve: (press) =>
      accel(press) && press.key.toLowerCase() === 's'
        ? { kind: 'save' }
        : undefined,
  },
  {
    /*
      Barriers sit on the boundary between cycles and are in no cell, so no
      amount of arrowing reaches one. A command rather than a cursor position.
      Shift + arrow was the obvious alternative and is deliberately left free --
      it conventionally extends selection, which multi-select will want -- and
      Alt + arrow is Back and Forward in two browsers.
    */
    keys: 'B / Shift + B',
    description: 'Select the next / previous barrier',
    group: 'Moving around',
    scope: 'canvas',
    resolve: (press) =>
      !accel(press) && press.key.toLowerCase() === 'b'
        ? { kind: 'cycleBarriers', direction: press.shiftKey ? -1 : 1 }
        : undefined,
  },
  {
    // Above the bare arrows, and the order is load-bearing: this claims the
    // press first, so Ctrl + Left moves the operation rather than the cursor.
    // Each press is a complete action and declares no coalescing, unlike a
    // drag -- one press, one undo step.
    keys: 'Ctrl/Cmd + Arrow keys',
    description: 'Move the selected operation',
    group: 'Building',
    scope: 'canvas',
    resolve: (press) => {
      const arrow = ARROWS[press.key];
      return arrow !== undefined && accel(press)
        ? { kind: 'nudgeSelection', ...arrow }
        : undefined;
    },
  },
  {
    keys: 'Arrow keys',
    description: 'Move the cell cursor',
    group: 'Moving around',
    scope: 'canvas',
    resolve: (press) => {
      const arrow = ARROWS[press.key];
      return arrow !== undefined && !accel(press)
        ? { kind: 'moveCursor', ...arrow }
        : undefined;
    },
  },
  {
    keys: 'Home / End',
    description: 'First / last cycle on this wire',
    group: 'Moving around',
    scope: 'canvas',
    resolve: (press) => {
      if (accel(press)) return undefined;
      if (press.key === 'Home') return { kind: 'cursorToEdge', edge: 'start' };
      if (press.key === 'End') return { kind: 'cursorToEdge', edge: 'end' };
      return undefined;
    },
  },
  {
    keys: 'Enter / Space',
    description: 'Place the armed gate, or select what is under the cursor',
    group: 'Building',
    scope: 'canvas',
    resolve: (press) =>
      press.key === 'Enter' || press.key === ' '
        ? { kind: 'activate' }
        : undefined,
  },
  {
    keys: 'Delete / Backspace',
    description: 'Remove the selected operation',
    group: 'Building',
    scope: 'canvas',
    resolve: (press) =>
      press.key === 'Delete' || press.key === 'Backspace'
        ? { kind: 'remove' }
        : undefined,
  },
  {
    /*
      One job per press, most specific first: cancel a pending multi-qubit
      gate, else disarm the palette, else clear the selection. Doing all three
      at once makes the two the user did not mean invisible. Which of them
      applies is the editor's to decide, not this module's.
    */
    keys: 'Escape',
    description: 'Cancel a placement, disarm the gate, or clear the selection',
    group: 'Building',
    scope: 'canvas',
    resolve: (press) =>
      press.key === 'Escape' ? { kind: 'cancel' } : undefined,
  },
  {
    keys: '?',
    description: 'Show or hide this list',
    group: 'Help',
    scope: 'global',
    resolve: (press) => (press.key === '?' ? { kind: 'shortcuts' } : undefined),
  },
];

/**
 * What a press means on one surface, or nothing if that surface does not claim
 * it.
 *
 * First match wins, so the list's order is its precedence. Returning `undefined`
 * rather than a no-op command is what lets the caller leave an unclaimed press to
 * the browser.
 *
 * `scope` is required rather than defaulted. A default would make the safe
 * choice invisible at the call site, and the whole point of the field is that
 * every listener states which keys are its own — a global listener silently
 * inheriting the canvas's would fire `Delete` from inside the header.
 */
export function resolveShortcut(
  press: KeyPress,
  scope: ShortcutScope,
): Command | undefined {
  for (const shortcut of SHORTCUTS) {
    if (shortcut.scope !== scope) continue;
    const command = shortcut.resolve(press);
    if (command !== undefined) return command;
  }
  return undefined;
}

/**
 * Should a press be left to whatever the user is typing into?
 *
 * The cost of a global binding, and the reason `scope` makes you think before
 * adding one. `?` is `Shift` + `/` on most layouts, so without this it would
 * swallow a question mark meant for a field — and the editor has a register
 * size, an angle and a bit index that all take typed input.
 *
 * Kept beside the table rather than in the component, because it is a fact about
 * global shortcuts rather than about the editor.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return true;

  // Both, and neither is redundant. `isContentEditable` is the canonical API
  // and inherits correctly, but jsdom does not implement it, so a test for this
  // branch would fail in Node while the browser was fine. `closest` handles the
  // inheritance the attribute check would otherwise miss -- a press inside a
  // child of an editable region.
  return (
    target.isContentEditable ||
    target.closest('[contenteditable]:not([contenteditable="false"])') !== null
  );
}

/**
 * The shortcuts by group, in the order the groups first appear.
 *
 * Derived rather than declared, so a new entry needs no second edit to reach the
 * reference and a group cannot end up listed but empty.
 */
export function shortcutGroups(): readonly {
  readonly group: string;
  readonly shortcuts: readonly Shortcut[];
}[] {
  const groups: { group: string; shortcuts: Shortcut[] }[] = [];

  for (const shortcut of SHORTCUTS) {
    const existing = groups.find((entry) => entry.group === shortcut.group);
    if (existing === undefined) {
      groups.push({ group: shortcut.group, shortcuts: [shortcut] });
    } else {
      existing.shortcuts.push(shortcut);
    }
  }

  return groups;
}
