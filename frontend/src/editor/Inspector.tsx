/**
 * The selected operation's editable properties, and nothing when nothing is
 * selected.
 *
 * **Deliberately general rather than an angle box.** UI.md settled this: a
 * rotation's angle and a measurement's register and bit are both per-operation
 * properties, they were both on the deferred list, and one panel that grows a
 * section per property is the alternative to a control per property scattered
 * around the editor. Anything per-operation added later belongs here.
 *
 * This component decides nothing about the circuit. It reads the operation it is
 * given and calls back; every change goes through the edit vocabulary in
 * `state/edits.ts`, so history and labelling cannot be bypassed. It holds no
 * copy of the operation either -- the props are re-derived from the store's one
 * circuit on every render, per ADR-0001.
 *
 * **Values are radians and are never converted.** UI.md forbids a hidden unit
 * conversion, so the input, the slider, and the stored number are one value in
 * one unit. The `π` caption beside the input is a *rendering* of that same
 * radian value, not a second unit -- it is there because `1.5707963267948966` is
 * an unreadable way to say a quarter turn in a tool whose stated purpose is
 * making quantum mechanics legible.
 *
 * **Nothing here refuses input.** An empty or non-finite angle reaches the
 * circuit and is reported by `validateCircuit` as `PARAMETER_NOT_FINITE` in the
 * problems strip, which is UI.md's rule for the whole editor: a state the user
 * can edit their way out of is reported, not prevented.
 */

import type { ClassicalTarget, Operation } from '../model/circuit';
import { GATE_SIGNATURES } from '../model/spec';
import { describeRadians } from './angles';

export interface RegisterChoice {
  readonly id: string;
  readonly label: string;
  readonly size: number;
}

export interface InspectorProps {
  /** The selected operation, or null. Re-derived every render, never stored. */
  readonly operation: Operation | null;
  readonly registers: readonly RegisterChoice[];
  /** Radians, always. Every call coalesces into the entry `onCommit` closes. */
  readonly onParameterChange: (parameter: string, radians: number) => void;
  /**
   * The interaction finished -- pointer released, field blurred.
   *
   * Separate from `onParameterChange` rather than a flag on it, because a
   * commit has no value to write: the last change already wrote it, and
   * re-applying would push an identical second entry onto the history and cost
   * an undo step that undoes nothing.
   */
  readonly onParameterCommit: () => void;
  readonly onClassicalTargetChange: (target: ClassicalTarget) => void;
}

const FIELD =
  'w-full rounded border border-ink-muted/40 bg-surface px-2 py-1 text-sm';

export function Inspector({
  operation,
  registers,
  onParameterChange,
  onParameterCommit,
  onClassicalTargetChange,
}: InspectorProps): React.JSX.Element {
  return (
    <section
      aria-label="Inspector"
      className="flex w-56 flex-col gap-3 text-sm"
    >
      <h2 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
        Inspector
      </h2>
      {operation === null ? (
        <p className="text-ink-muted">Select an operation to edit it.</p>
      ) : (
        <Properties
          operation={operation}
          registers={registers}
          onParameterChange={onParameterChange}
          onParameterCommit={onParameterCommit}
          onClassicalTargetChange={onClassicalTargetChange}
        />
      )}
    </section>
  );
}

function Properties({
  operation,
  registers,
  onParameterChange,
  onParameterCommit,
  onClassicalTargetChange,
}: InspectorProps & { operation: Operation }): React.JSX.Element {
  const heading = (
    <p className="font-mono">
      {operation.kind === 'gate' ? operation.name : operation.kind}
    </p>
  );

  if (operation.kind === 'measurement') {
    return (
      <>
        {heading}
        <MeasurementTarget
          target={operation.classicalTarget}
          registers={registers}
          onChange={onClassicalTargetChange}
        />
      </>
    );
  }

  // A barrier carries no editable property at all. UI.md leaves "extend to all
  // wires" as a future addition and it is deliberately not built here: a barrier
  // is captured at placement and never rewritten, so the action needs its own
  // decision rather than an input.
  const parameters =
    operation.kind === 'gate' ? GATE_SIGNATURES[operation.name].parameters : [];

  if (parameters.length === 0) {
    return (
      <>
        {heading}
        <p className="text-ink-muted">No editable properties.</p>
      </>
    );
  }

  return (
    <>
      {heading}
      {parameters.map((parameter) => (
        <AngleField
          key={parameter}
          name={parameter}
          radians={
            operation.kind === 'gate'
              ? operation.parameters?.[parameter]
              : undefined
          }
          onChange={onParameterChange}
          onCommit={onParameterCommit}
        />
      ))}
    </>
  );
}

/**
 * One radian-valued parameter, as a number input and a slider over the same
 * value.
 *
 * Two controls rather than one because they answer different questions. The
 * number is how you say *exactly* 0.7853981633974483; the slider is how you find
 * out what the gate does as the angle sweeps, which is the understanding-first
 * goal in CLAUDE.md rather than decoration. A slider drag coalesces into a
 * single undo step, so exploring an angle does not fill the history with a
 * hundred entries -- the mechanism is ADR-0007's and already carries gate drags.
 *
 * The slider spans a full turn each way. Angles outside it stay reachable by
 * typing, and the input is not clamped: `rz` by 7π is a legitimate circuit.
 */
function AngleField({
  name,
  radians,
  onChange,
  onCommit,
}: {
  readonly name: string;
  readonly radians: number | undefined;
  readonly onChange: InspectorProps['onParameterChange'];
  readonly onCommit: InspectorProps['onParameterCommit'];
}): React.JSX.Element {
  const value = radians ?? Number.NaN;
  const inSliderRange =
    Number.isFinite(value) && Math.abs(value) <= 2 * Math.PI;

  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1">
        <span className="text-ink-muted">
          {name} <span className="font-mono">(radians)</span>
        </span>
        <input
          type="number"
          step="any"
          // An empty input is a missing parameter, not zero. Coercing it would
          // silently author `theta: 0` -- a valid circuit nobody asked for --
          // where NaN surfaces as PARAMETER_NOT_FINITE and says what happened.
          value={Number.isFinite(value) ? value : ''}
          // Typing coalesces the same way dragging does: "1.57" is four
          // keystrokes and should cost one undo step, not four.
          onChange={(event) => {
            onChange(
              name,
              event.target.value === ''
                ? Number.NaN
                : event.target.valueAsNumber,
            );
          }}
          onBlur={onCommit}
          className={`${FIELD} font-mono`}
        />
      </label>

      <input
        type="range"
        min={-2 * Math.PI}
        max={2 * Math.PI}
        step={Math.PI / 64}
        value={inSliderRange ? value : 0}
        // Named for what it does, not for what it holds. Two controls over one
        // value are two controls a screen reader has to tell apart, and
        // "theta (radians)" twice is indistinguishable; the role announces
        // "slider" already, so the name must not repeat it either.
        aria-label={`Adjust ${name}`}
        // Every step applies, so the canvas follows the drag; they collapse
        // into one history entry, and the pointer/keyboard release commits.
        onChange={(event) => {
          onChange(name, event.target.valueAsNumber);
        }}
        onPointerUp={onCommit}
        onBlur={onCommit}
        className="w-full"
      />

      {/*
        aria-hidden: the input already announces the authoritative number, and a
        screen reader reading both would hear one value twice in two forms.
      */}
      <p className="text-xs text-ink-muted" aria-hidden="true">
        {describeRadians(value)}
      </p>
    </div>
  );
}

/**
 * Which register and bit a measurement writes into.
 *
 * This is the control that makes a second register reachable at all -- placement
 * always writes into the first register's lowest free bit, and until now nothing
 * could change it.
 *
 * The bit is not clamped to the register's size. Choosing one past the end is
 * reported as `CLASSICAL_BIT_OUT_OF_RANGE` and repaired by growing the register
 * or picking another bit, which is exactly the state `setRegisterSize` already
 * allows from the other direction; clamping would make the same circuit legal or
 * illegal depending on which control produced it.
 */
function MeasurementTarget({
  target,
  registers,
  onChange,
}: {
  readonly target: ClassicalTarget;
  readonly registers: readonly RegisterChoice[];
  readonly onChange: (target: ClassicalTarget) => void;
}): React.JSX.Element {
  const register = registers.find((choice) => choice.id === target.register);

  return (
    <>
      <label className="flex flex-col gap-1">
        <span className="text-ink-muted">Register</span>
        <select
          value={target.register}
          onChange={(event) => {
            onChange({ register: event.target.value, bit: target.bit });
          }}
          className={FIELD}
        >
          {registers.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.label} ({String(choice.size)} bits)
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-ink-muted">Bit</span>
        <input
          type="number"
          min={0}
          value={target.bit}
          onChange={(event) => {
            const bit = event.target.valueAsNumber;
            // Refused rather than reported, unlike an out-of-range bit: the
            // schema floors this at an integer 0, so a negative or fractional
            // bit is shape-invalid and `setClassicalTarget` throws on it.
            if (Number.isInteger(bit) && bit >= 0) {
              onChange({ register: target.register, bit });
            }
          }}
          className={`${FIELD} font-mono`}
        />
      </label>

      {register !== undefined && target.bit >= register.size && (
        <p role="status" className="text-xs text-ink-muted">
          Bit {String(target.bit)} is past the end of {register.label}. Grow the
          register or choose a lower bit.
        </p>
      )}
    </>
  );
}
