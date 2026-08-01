/**
 * Adding and removing the circuit's qubits and classical registers.
 *
 * These are properties of the circuit rather than things placed in it, so they
 * are not in the palette -- UI.md is explicit about that, and the distinction is
 * the point: you place a gate *onto* a wire, you do not place the wire.
 *
 * **A region of its own, rather than controls drawn in the SVG gutter.** UI.md
 * asks for them "in the gutter header", and this sits directly above the gutter,
 * but it is deliberately not inside the canvas. The canvas is a `role="grid"`
 * composite widget with a single tab stop and `aria-activedescendant`; putting
 * focusable buttons inside it breaks that contract, and UI.md itself warns that
 * SVG accessibility mapping is unreliable enough not to bet on. Ordinary HTML
 * controls beside the grid cost nothing and are announced correctly.
 *
 * One tab stop with a roving focus, the same pattern as the palette and for the
 * same reason: a ten-qubit circuit should not put fifteen stops in the tab order.
 */

import { useRef, useState } from 'react';

export interface QubitControl {
  readonly id: string;
  readonly label: string;
  /** How many operations removal would destroy, for the confirmation. */
  readonly operationCount: number;
}

export interface RegisterControl extends QubitControl {
  readonly size: number;
}

export interface StructureControlsProps {
  readonly qubits: readonly QubitControl[];
  readonly registers: readonly RegisterControl[];
  readonly onAddQubit: () => void;
  readonly onRemoveQubit: (qubitId: string) => void;
  readonly onAddRegister: () => void;
  readonly onRemoveRegister: (registerId: string) => void;
  readonly onResizeRegister: (registerId: string, size: number) => void;
}

const CHIP =
  'inline-flex items-center gap-1 rounded border border-ink-muted/40 bg-surface-raised px-2 py-1 font-mono text-sm';
const ACTION =
  'rounded border border-ink-muted/40 px-2 py-1 text-sm hover:border-ink';

export function StructureControls({
  qubits,
  registers,
  onAddQubit,
  onRemoveQubit,
  onAddRegister,
  onRemoveRegister,
  onResizeRegister,
}: StructureControlsProps): React.JSX.Element {
  const [focused, setFocused] = useState(0);
  /**
   * Which qubit is one press from being removed.
   *
   * Held by identifier rather than index, for the reason ADR-0007 section 4
   * gives about selection: an index shifts when the circuit changes underneath
   * it, and a stale one would arm the confirmation over a different qubit.
   */
  const [confirming, setConfirming] = useState<string | null>(null);
  const controls = useRef(new Map<string, HTMLElement>());

  // Flat, in the order they appear, so the roving focus follows the eye.
  const order = [
    ...qubits.map((qubit) => `remove-qubit:${qubit.id}`),
    'add-qubit',
    ...registers.flatMap((register) => [
      `size:${register.id}`,
      `remove-register:${register.id}`,
    ]),
    'add-register',
  ];

  function moveFocus(to: number): void {
    const next = Math.max(0, Math.min(to, order.length - 1));
    const key = order[next];
    if (key === undefined) return;

    setFocused(next);
    controls.current.get(key)?.focus();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>): void {
    // A number input owns its own left/right and up/down: those change the
    // value. Stealing them would make the size uneditable from the keyboard.
    if (event.target instanceof HTMLInputElement) return;

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
      moveFocus(order.length - 1);
    } else if (event.key === 'Escape' && confirming !== null) {
      event.preventDefault();
      setConfirming(null);
    }
  }

  const register = (key: string) => (element: HTMLElement | null) => {
    if (element === null) controls.current.delete(key);
    else controls.current.set(key, element);
  };

  const tabbable = (key: string): 0 | -1 =>
    order.indexOf(key) === focused ? 0 : -1;

  const focus = (key: string) => () => {
    const index = order.indexOf(key);
    if (index >= 0) setFocused(index);
  };

  /**
   * Removing a qubit destroys every operation touching it, and removing a
   * register destroys every measurement writing into it. Both are destructive
   * enough to state before they happen rather than after, so both take two
   * presses with the count named in between.
   *
   * **No confirmation when there is nothing to lose.** A bare wire or an unused
   * register is not a destructive removal, and a prompt that always appears is
   * one people learn to dismiss without reading.
   */
  function requestRemove(
    control: QubitControl,
    remove: (id: string) => void,
  ): void {
    if (control.operationCount === 0 || confirming === control.id) {
      setConfirming(null);
      remove(control.id);
      return;
    }
    setConfirming(control.id);
  }

  const pending = [...qubits, ...registers].find(
    (control) => control.id === confirming,
  );

  return (
    <section
      aria-label="Circuit structure"
      onKeyDown={handleKeyDown}
      className="flex flex-wrap items-center gap-x-4 gap-y-2"
    >
      <Group title="Qubits">
        {qubits.map((qubit) => (
          <span key={qubit.id} className={CHIP}>
            {qubit.label}
            <button
              ref={register(`remove-qubit:${qubit.id}`)}
              type="button"
              tabIndex={tabbable(`remove-qubit:${qubit.id}`)}
              aria-label={removeLabel(qubit, confirming === qubit.id)}
              title={removeLabel(qubit, confirming === qubit.id)}
              onFocus={focus(`remove-qubit:${qubit.id}`)}
              onClick={() => {
                requestRemove(qubit, onRemoveQubit);
              }}
              className={
                confirming === qubit.id
                  ? 'rounded bg-ink px-1 text-xs text-surface'
                  : 'px-1 text-xs opacity-60 hover:opacity-100'
              }
            >
              {confirming === qubit.id ? 'Confirm' : '×'}
            </button>
          </span>
        ))}

        <button
          ref={register('add-qubit')}
          type="button"
          tabIndex={tabbable('add-qubit')}
          onFocus={focus('add-qubit')}
          onClick={onAddQubit}
          className={ACTION}
        >
          Add qubit
        </button>
      </Group>

      <Group title="Registers">
        {registers.map((lane) => (
          <span key={lane.id} className={CHIP}>
            {lane.label}
            {/*
              A number input rather than a pair of stepper buttons: it is one
              focusable element instead of two, and arrow keys already adjust it
              natively, so the keyboard path costs no code. The schema floors a
              register at one bit.
            */}
            <input
              ref={register(`size:${lane.id}`)}
              type="number"
              min={1}
              value={lane.size}
              tabIndex={tabbable(`size:${lane.id}`)}
              aria-label={`${lane.label} size in bits`}
              onFocus={focus(`size:${lane.id}`)}
              onChange={(event) => {
                const size = Number(event.target.value);
                if (Number.isInteger(size) && size >= 1) {
                  onResizeRegister(lane.id, size);
                }
              }}
              className="w-12 rounded border border-ink-muted/40 bg-surface px-1 text-sm"
            />
            <button
              ref={register(`remove-register:${lane.id}`)}
              type="button"
              tabIndex={tabbable(`remove-register:${lane.id}`)}
              aria-label={removeLabel(lane, confirming === lane.id)}
              title={removeLabel(lane, confirming === lane.id)}
              onFocus={focus(`remove-register:${lane.id}`)}
              onClick={() => {
                requestRemove(lane, onRemoveRegister);
              }}
              className={
                confirming === lane.id
                  ? 'rounded bg-ink px-1 text-xs text-surface'
                  : 'px-1 text-xs opacity-60 hover:opacity-100'
              }
            >
              {confirming === lane.id ? 'Confirm' : '×'}
            </button>
          </span>
        ))}

        <button
          ref={register('add-register')}
          type="button"
          tabIndex={tabbable('add-register')}
          onFocus={focus('add-register')}
          onClick={onAddRegister}
          className={ACTION}
        >
          Add register
        </button>
      </Group>

      {/*
        The button's own name carries the question, but a name that changes
        under a focused element is not reliably re-announced. This states it
        outright, and is the only thing a screen reader is guaranteed to hear.
      */}
      <p role="status" className="w-full text-sm text-ink-muted">
        {pending === undefined
          ? ''
          : `${removeLabel(pending, true)} Press again to confirm, Escape to cancel.`}
      </p>
    </section>
  );
}

function removeLabel(control: QubitControl, confirming: boolean): string {
  if (control.operationCount === 0) return `Remove ${control.label}`;

  const operations = `${String(control.operationCount)} ${
    control.operationCount === 1 ? 'operation' : 'operations'
  }`;

  return confirming
    ? `Remove ${control.label} and ${operations}?`
    : `Remove ${control.label} and ${operations}`;
}

function Group({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <h2 className="mr-1 text-xs font-semibold tracking-wide text-ink-muted uppercase">
        {title}
      </h2>
      {children}
    </div>
  );
}
