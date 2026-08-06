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
 * **The scope is the canvas**, which is where every row of UI.md's shortcut table
 * already applied — `Ctrl/Cmd + Z` and `Ctrl/Cmd + S` included. `?` follows the
 * same rule rather than becoming the one global key, and the reference carries
 * its own control so it stays reachable from anywhere by `Tab`.
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

export interface Shortcut {
  /** As written for a reader: "Ctrl/Cmd + Z". Never platform-detected. */
  readonly keys: string;
  readonly description: string;
  /** The reference groups by this, in first-appearance order. */
  readonly group: string;
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
    resolve: (press) =>
      accel(press) && !press.shiftKey && press.key.toLowerCase() === 'z'
        ? { kind: 'undo' }
        : undefined,
  },
  {
    keys: 'Ctrl/Cmd + Shift + Z',
    description: 'Redo the last undone edit',
    group: 'The circuit',
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
    resolve: (press) =>
      press.key === 'Enter' || press.key === ' '
        ? { kind: 'activate' }
        : undefined,
  },
  {
    keys: 'Delete / Backspace',
    description: 'Remove the selected operation',
    group: 'Building',
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
    resolve: (press) =>
      press.key === 'Escape' ? { kind: 'cancel' } : undefined,
  },
  {
    keys: '?',
    description: 'Show or hide this list',
    group: 'Help',
    resolve: (press) => (press.key === '?' ? { kind: 'shortcuts' } : undefined),
  },
];

/**
 * What a press means, or nothing if the editor does not claim it.
 *
 * First match wins, so the list's order is its precedence. Returning `undefined`
 * rather than a no-op command is what lets the caller leave an unclaimed press to
 * the browser.
 */
export function resolveShortcut(press: KeyPress): Command | undefined {
  for (const shortcut of SHORTCUTS) {
    const command = shortcut.resolve(press);
    if (command !== undefined) return command;
  }
  return undefined;
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
