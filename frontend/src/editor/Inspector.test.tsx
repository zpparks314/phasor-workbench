import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Operation } from '../model/circuit';
import { Inspector, type InspectorProps } from './Inspector';

function show(overrides: Partial<InspectorProps> = {}) {
  const props: InspectorProps = {
    operation: null,
    registers: [
      { id: 'c_0', label: 'c0', size: 2 },
      { id: 'c_1', label: 'c1', size: 4 },
    ],
    onParameterChange: vi.fn(),
    onParameterCommit: vi.fn(),
    onClassicalTargetChange: vi.fn(),
    ...overrides,
  };

  return { ...render(<Inspector {...props} />), props };
}

const rx = (theta: number): Operation => ({
  id: 'op_0',
  kind: 'gate',
  name: 'rx',
  targets: ['q_0'],
  parameters: { theta },
});

const measurement = (register: string, bit: number): Operation => ({
  id: 'op_1',
  kind: 'measurement',
  targets: ['q_0'],
  classicalTarget: { register, bit },
});

describe('what it shows', () => {
  it('says nothing is selected when nothing is', () => {
    show();

    expect(screen.getByText(/select an operation/i)).toBeInTheDocument();
  });

  /**
   * The panel is general, not an angle box: it has to have something to say
   * about every operation kind, or selecting an `h` looks like a broken panel.
   */
  it('reports a gate with no parameters as having none', () => {
    show({
      operation: { id: 'op_2', kind: 'gate', name: 'h', targets: ['q_0'] },
    });

    expect(screen.getByText(/no editable properties/i)).toBeInTheDocument();
  });

  it('reports a barrier as having none', () => {
    show({ operation: { id: 'op_3', kind: 'barrier', targets: ['q_0'] } });

    expect(screen.getByText(/no editable properties/i)).toBeInTheDocument();
  });

  /**
   * Driven by the gate's signature in the generated spec, never by its name.
   * `p` takes `lambda` where the rotations take `theta`, and a hand-written
   * mapping would be a second copy of `circuit.spec.json`.
   */
  it('names the parameter the signature declares', () => {
    show({
      operation: {
        id: 'op_4',
        kind: 'gate',
        name: 'p',
        targets: ['q_0'],
        parameters: { lambda: 0 },
      },
    });

    expect(
      screen.getByRole('spinbutton', { name: /lambda/i }),
    ).toBeInTheDocument();
  });

  /**
   * Two controls over one value need two distinguishable names, or a screen
   * reader user cannot tell which one they have landed on.
   */
  it('gives the slider and the field different accessible names', () => {
    show({ operation: rx(0) });

    expect(
      screen.getByRole('slider', { name: 'Adjust theta' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('spinbutton', { name: /theta \(radians\)/i }),
    ).toBeInTheDocument();
  });
});

describe('editing an angle', () => {
  const angleInput = () => screen.getByRole('spinbutton', { name: /theta/i });

  it('reports a typed value in radians, unconverted', () => {
    const { props } = show({ operation: rx(0) });

    fireEvent.change(angleInput(), { target: { value: '1.5' } });

    expect(props.onParameterChange).toHaveBeenCalledWith('theta', 1.5);
  });

  /**
   * UI.md's rule for every input in the editor: a state the user can edit their
   * way out of is reported by `validateCircuit`, not refused at the control.
   * Coercing an emptied field to 0 would author a valid circuit nobody asked
   * for; NaN surfaces as PARAMETER_NOT_FINITE and says what actually happened.
   */
  it('passes an emptied field through as NaN rather than zero', () => {
    const { props } = show({ operation: rx(1) });

    fireEvent.change(angleInput(), { target: { value: '' } });

    expect(props.onParameterChange).toHaveBeenCalledWith('theta', Number.NaN);
  });

  it('commits on blur so typing costs one undo step', () => {
    const { props } = show({ operation: rx(0) });

    fireEvent.change(angleInput(), { target: { value: '1' } });
    fireEvent.change(angleInput(), { target: { value: '1.5' } });
    fireEvent.blur(angleInput());

    expect(props.onParameterChange).toHaveBeenCalledTimes(2);
    expect(props.onParameterCommit).toHaveBeenCalledTimes(1);
  });

  it('drives the same parameter from the slider', () => {
    const { props } = show({ operation: rx(0) });

    fireEvent.change(screen.getByRole('slider', { name: 'Adjust theta' }), {
      target: { value: String(Math.PI) },
    });

    expect(props.onParameterChange).toHaveBeenCalledWith('theta', Math.PI);
  });

  /**
   * The slider is a convenience over a subrange; the value is not. A `rz` by
   * 7π is a legitimate circuit, so an out-of-range angle must survive being
   * displayed -- an input that clamped it would silently rewrite the circuit
   * just by rendering.
   */
  it('does not write back a value outside the slider range', () => {
    const { props } = show({ operation: rx(7 * Math.PI) });

    expect(angleInput()).toHaveValue(7 * Math.PI);
    expect(props.onParameterChange).not.toHaveBeenCalled();
  });
});

describe('editing a measurement target', () => {
  it('offers every declared register', () => {
    show({ operation: measurement('c_0', 0) });

    expect(screen.getByRole('option', { name: /c0/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /c1/ })).toBeInTheDocument();
  });

  /** The whole point of the control: placement can only reach the first. */
  it('retargets at the second register', () => {
    const { props } = show({ operation: measurement('c_0', 0) });

    fireEvent.change(screen.getByRole('combobox', { name: /register/i }), {
      target: { value: 'c_1' },
    });

    expect(props.onClassicalTargetChange).toHaveBeenCalledWith({
      register: 'c_1',
      bit: 0,
    });
  });

  it('changes the bit', () => {
    const { props } = show({ operation: measurement('c_1', 0) });

    fireEvent.change(screen.getByRole('spinbutton', { name: /bit/i }), {
      target: { value: '3' },
    });

    expect(props.onClassicalTargetChange).toHaveBeenCalledWith({
      register: 'c_1',
      bit: 3,
    });
  });

  /**
   * Permitted and reported, not clamped -- the same circuit is reachable by
   * shrinking the register, so clamping here would make its legality depend on
   * which control produced it.
   */
  it('allows a bit past the end and says so', () => {
    const { props } = show({ operation: measurement('c_0', 5) });

    expect(props.onClassicalTargetChange).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(/past the end of c0/i);
  });

  it('refuses a negative bit, which is shape-invalid', () => {
    const { props } = show({ operation: measurement('c_0', 0) });

    fireEvent.change(screen.getByRole('spinbutton', { name: /bit/i }), {
      target: { value: '-1' },
    });

    expect(props.onClassicalTargetChange).not.toHaveBeenCalled();
  });
});

/** The π caption is `./angles`, and asserted in `angles.test.ts`. */
it('shows the angle written relative to π', () => {
  show({ operation: rx(Math.PI / 2) });

  expect(screen.getByText('π/2')).toBeInTheDocument();
});
