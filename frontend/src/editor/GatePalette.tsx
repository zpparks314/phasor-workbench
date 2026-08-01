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
 * **Every gate in the spec is armable**, and so are measurement and barrier.
 * Multi-qubit gates arm exactly like single-qubit ones; what differs is what
 * happens on the canvas afterwards, and that sequence lives in `./pending`.
 *
 * **An entry the circuit cannot currently take is `aria-disabled`, not
 * `disabled`**, so arrowing across the palette still reaches it and announces
 * why. A `disabled` button is skipped in silence, which for a teaching tool is
 * the wrong kind of quiet. Measurement is the case that exists today: with no
 * classical register declared, a measurement has nowhere to write. Whether an
 * entry is available is the caller's judgement, since it depends on the circuit.
 */

import { useRef, useState } from 'react';

import {
  PALETTE,
  describeSignature,
  type PaletteEntry,
  type PaletteItem,
} from './palette';

export interface GatePaletteProps {
  readonly armed: PaletteItem | null;
  readonly onArm: (name: PaletteItem | null) => void;
  /**
   * Why an entry cannot be placed right now, or undefined when it can.
   *
   * Decided by the caller, which knows the circuit. A measurement has nowhere
   * to write when no classical register exists, and this is what gives UI.md's
   * `aria-disabled` rule a subject again.
   */
  readonly unavailable: (item: PaletteItem) => string | undefined;
}

const ENTRIES: readonly PaletteEntry[] = PALETTE.flatMap(
  (group) => group.entries,
);

export function GatePalette({
  armed,
  onArm,
  unavailable,
}: GatePaletteProps): React.JSX.Element {
  const [focused, setFocused] = useState(0);
  const buttons = useRef(new Map<PaletteItem, HTMLButtonElement>());

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
                    unavailable={unavailable(entry.name)}
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
  unavailable,
  tabbable,
  register,
  onArm,
}: {
  readonly entry: PaletteEntry;
  readonly armed: boolean;
  readonly unavailable: string | undefined;
  readonly tabbable: boolean;
  readonly register: (element: HTMLButtonElement | null) => void;
  readonly onArm: (name: PaletteItem | null) => void;
}): React.JSX.Element {
  // The signature is in the name rather than the tooltip alone: a multi-qubit
  // gate takes more clicks than a single-qubit one, and that is the difference
  // a user needs before arming it, not after. Measurement and barrier have no
  // signature to state; their arity is not a gate fact.
  const arity =
    entry.signature === undefined
      ? ''
      : ` ${describeSignature(entry.signature)}`;
  const label = `${entry.name} — ${entry.description}${arity}${
    unavailable === undefined ? '' : ` ${unavailable}`
  }`;

  return (
    <button
      ref={register}
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={armed}
      aria-disabled={unavailable === undefined ? undefined : true}
      tabIndex={tabbable ? 0 : -1}
      draggable={unavailable === undefined}
      onDragStart={() => {
        if (unavailable === undefined) onArm(entry.name);
      }}
      onClick={() => {
        if (unavailable === undefined) onArm(armed ? null : entry.name);
      }}
      className={[
        'rounded border px-1 font-mono text-sm',
        // Wide enough for "measurement" without stretching the single-letter
        // gates, which stay square so the palette still reads as a grid.
        entry.name.length > 4 ? 'h-10 w-full' : 'h-10 w-10',
        unavailable === undefined ? '' : 'cursor-not-allowed opacity-40',
        armed
          ? 'border-ink bg-ink text-surface'
          : 'border-ink-muted/40 bg-surface-raised text-ink',
      ].join(' ')}
    >
      {entry.name}
    </button>
  );
}
