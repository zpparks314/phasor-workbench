/**
 * The `?` reference.
 *
 * The test that matters is the last one: **every entry in the table appears**.
 * That is the half of the exit criterion a hand-written panel would have failed
 * silently — it would have looked right on the day it was written and drifted
 * the first time a key changed. Driving the assertion from `SHORTCUTS` rather
 * than from a list written here is what makes it a guard rather than a snapshot.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ShortcutReference } from './ShortcutReference';
import { SHORTCUTS, shortcutGroups } from './shortcuts';

describe('the disclosure', () => {
  /**
   * Asserted on the element's own `open`, not on what is in the DOM. A native
   * `details` does the hiding, and jsdom does not implement it -- checking for
   * absent content here would pass in Node while proving nothing about a
   * browser, which is the shape of test AGENTS.md warns about.
   */
  it('is collapsed until asked for', () => {
    render(<ShortcutReference open={false} onOpenChange={vi.fn()} />);

    const summary = screen.getByText('Keyboard shortcuts', {
      selector: 'summary',
    });
    expect(summary).toBeInTheDocument();
    expect(summary.closest('details')).not.toHaveAttribute('open');
  });

  /**
   * A tab stop of its own, deliberately. `?` is handled on the canvas like every
   * other shortcut, so someone focused in the header has no key that reaches
   * this -- and this is the one panel whose job is helping a person who is lost.
   */
  it('reports its own open and close', () => {
    const onOpenChange = vi.fn();
    render(<ShortcutReference open={false} onOpenChange={onOpenChange} />);

    const details = screen
      .getByText('Keyboard shortcuts', { selector: 'summary' })
      .closest('details');
    if (details === null) throw new Error('no details element');

    details.open = true;
    fireEvent(details, new Event('toggle'));

    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  /**
   * Opened by `?`, the press happened on the canvas, so without this the panel
   * appears below a grid that still holds focus and a reader says nothing.
   */
  it('takes focus when it opens', () => {
    render(<ShortcutReference open onOpenChange={vi.fn()} />);

    expect(
      screen.getByText('Keyboard shortcuts', { selector: 'summary' }),
    ).toHaveFocus();
  });
});

describe('what it lists', () => {
  /**
   * The anti-drift assertion. Not a fixed list: it reads the same table the
   * canvas dispatches from, so a shortcut added without a row here fails, and a
   * row here that no key produces cannot exist.
   */
  it('shows every shortcut the editor binds, with its description', () => {
    render(<ShortcutReference open onOpenChange={vi.fn()} />);

    expect(SHORTCUTS.length).toBeGreaterThan(0);
    for (const shortcut of SHORTCUTS) {
      expect(screen.getByText(shortcut.keys)).toBeInTheDocument();
      expect(screen.getByText(shortcut.description)).toBeInTheDocument();
    }
  });

  it('puts each shortcut under its own group heading', () => {
    render(<ShortcutReference open onOpenChange={vi.fn()} />);

    for (const { group, shortcuts } of shortcutGroups()) {
      const section = screen.getByRole('region', { name: group });
      for (const shortcut of shortcuts) {
        expect(section).toHaveTextContent(shortcut.keys);
      }
    }
  });
});
