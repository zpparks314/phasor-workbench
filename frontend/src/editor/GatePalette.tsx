/**
 * The gate palette.
 *
 * Arming is a toggle: click a gate to arm it, click it again or press Escape to
 * disarm. That is the accessible and touch path, and dragging is an accelerator
 * over the same state -- a drag starts by arming, so both end in one placement
 * call rather than two code paths that must agree.
 *
 * **One tab stop for the whole palette, with a roving focus inside it.** UI.md
 * requires each region to be a single stop; eighteen gates each taking one would
 * mean eighteen presses to reach the canvas. Arrow keys move between gates, Tab
 * leaves the region.
 *
 * Gates this build cannot place are `aria-disabled` rather than `disabled`, which
 * keeps them focusable so arrowing across the palette reaches them and announces
 * why they are unavailable. A `disabled` button is skipped silently, which for a
 * teaching tool is the wrong kind of quiet.
 */

import { useRef, useState } from 'react';

import { PALETTE, type PaletteEntry } from './palette';
import type { GateName } from '../model/circuit';

export interface GatePaletteProps {
  readonly armed: GateName | null;
  readonly onArm: (name: GateName | null) => void;
}

const ENTRIES: readonly PaletteEntry[] = PALETTE.flatMap(
  (group) => group.entries,
);

export function GatePalette({
  armed,
  onArm,
}: GatePaletteProps): React.JSX.Element {
  const [focused, setFocused] = useState(0);
  const buttons = useRef(new Map<GateName, HTMLButtonElement>());

  function moveFocus(to: number): void {
    const next = Math.max(0, Math.min(to, ENTRIES.length - 1));
    const entry = ENTRIES[next];
    if (entry === undefined) return;

    setFocused(next);
    buttons.current.get(entry.name)?.focus();
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
      moveFocus(focused + (step[event.key] ?? 0));
    } else if (event.key === 'Home') {
      event.preventDefault();
      moveFocus(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      moveFocus(ENTRIES.length - 1);
    }
  }

  return (
    <nav
      aria-label="Gate palette"
      onKeyDown={handleKeyDown}
      className="flex flex-col gap-4"
    >
      {PALETTE.map((group) => (
        <section key={group.title}>
          <h2 className="mb-1 text-xs font-semibold tracking-wide text-ink-muted uppercase">
            {group.title}
          </h2>
          <ul className="flex flex-wrap gap-1">
            {group.entries.map((entry) => {
              const index = ENTRIES.indexOf(entry);

              return (
                <li key={entry.name}>
                  <GateButton
                    entry={entry}
                    armed={armed === entry.name}
                    tabbable={index === focused}
                    register={(element) => {
                      if (element === null) buttons.current.delete(entry.name);
                      else buttons.current.set(entry.name, element);
                    }}
                    onArm={(name) => {
                      setFocused(index);
                      onArm(name);
                    }}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}

function GateButton({
  entry,
  armed,
  tabbable,
  register,
  onArm,
}: {
  readonly entry: PaletteEntry;
  readonly armed: boolean;
  readonly tabbable: boolean;
  readonly register: (element: HTMLButtonElement | null) => void;
  readonly onArm: (name: GateName | null) => void;
}): React.JSX.Element {
  const label = entry.placeable
    ? `${entry.name} — ${entry.description}`
    : `${entry.name} — ${entry.description} Placing this needs control assignment, which is not built yet.`;

  return (
    <button
      ref={register}
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={armed}
      aria-disabled={!entry.placeable}
      tabIndex={tabbable ? 0 : -1}
      draggable={entry.placeable}
      onDragStart={() => {
        if (entry.placeable) onArm(entry.name);
      }}
      onClick={() => {
        if (entry.placeable) onArm(armed ? null : entry.name);
      }}
      className={[
        'h-10 w-10 rounded border font-mono text-sm',
        entry.placeable ? '' : 'cursor-not-allowed opacity-40',
        armed
          ? 'border-ink bg-ink text-surface'
          : 'border-ink-muted/40 bg-surface-raised text-ink',
      ].join(' ')}
    >
      {entry.name}
    </button>
  );
}
