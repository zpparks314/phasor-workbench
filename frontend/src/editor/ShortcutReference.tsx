/**
 * The `?` reference: every shortcut the editor binds, read from the same list it
 * binds them from.
 *
 * **Nothing here is written down twice.** The rows come from `./shortcuts`,
 * which is also what `CircuitCanvas` dispatches through, so this panel cannot
 * claim a key the editor does not honour. That is the whole of the exit
 * criterion; a hand-written table would have satisfied the visible half of it
 * and none of the useful half.
 *
 * **A disclosure, not a dialog.** UI.md records that the editor has no menu or
 * dialog pattern anywhere and declined to introduce one to place six examples; a
 * modal here would be the first, and it brings focus trapping, `aria-modal` and
 * its own `Escape` semantics — which would collide with the `Escape` the canvas
 * already gives three meanings. A `<details>` costs none of that, and a shortcut
 * list is something you read *beside* the circuit rather than instead of it.
 *
 * **It carries its own control, and that is not redundant.** `?` is handled on
 * the canvas like every other row of the table, so a person focused in the
 * header has no key that reaches this. The summary is an ordinary tab stop, so
 * they have `Tab` instead — which matters most for the one panel whose job is
 * helping someone who is lost.
 */

import { useEffect, useRef } from 'react';

import { shortcutGroups } from './shortcuts';

export interface ShortcutReferenceProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function ShortcutReference({
  open,
  onOpenChange,
}: ShortcutReferenceProps): React.JSX.Element {
  const summary = useRef<HTMLElement>(null);

  /**
   * Opening by `?` moves focus to the summary.
   *
   * The press happens on the canvas, so without this the panel appears below a
   * grid that still holds focus and a screen reader says nothing about it. Focus
   * is not taken when it closes: the canvas is where the user was, and dragging
   * focus back would fight them.
   */
  useEffect(() => {
    if (open) summary.current?.focus();
  }, [open]);

  return (
    <details
      open={open}
      onToggle={(event) => {
        onOpenChange(event.currentTarget.open);
      }}
      className="text-sm"
    >
      <summary ref={summary} className="cursor-pointer text-ink-muted">
        Keyboard shortcuts
      </summary>

      {/*
        A description list rather than a table: two columns of plain pairs is
        what this is, and `dl` announces each key with its meaning without a
        reader having to track a header row.
      */}
      <div className="mt-2 flex flex-col gap-4">
        {shortcutGroups().map(({ group, shortcuts }) => (
          <section key={group} aria-label={group}>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {group}
            </h3>
            <dl className="flex flex-col gap-1">
              {shortcuts.map((shortcut) => (
                <div key={shortcut.keys} className="flex items-baseline gap-3">
                  <dt className="w-52 shrink-0 font-mono text-xs">
                    {shortcut.keys}
                  </dt>
                  <dd>{shortcut.description}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </details>
  );
}
