import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { GATE_SIGNATURES } from '../model/spec';
import { GatePalette } from './GatePalette';
import {
  PALETTE,
  defaultParameters,
  describeSignature,
  groupedGateNames,
} from './palette';

describe('the gate list', () => {
  /**
   * The list is generated data. A gate added to shared/spec/circuit.spec.json
   * must appear here, and this fails if one arrives without a group -- the
   * alternative is a hand-written array that silently falls behind the spec.
   */
  it('covers every gate in the spec exactly once', () => {
    expect([...groupedGateNames()].sort()).toEqual(
      Object.keys(GATE_SIGNATURES).sort(),
    );
  });

  it('carries each gate its signature from the spec', () => {
    for (const group of PALETTE) {
      for (const entry of group.entries) {
        expect(entry.signature).toBe(GATE_SIGNATURES[entry.name]);
      }
    }
  });
});

describe('describeSignature', () => {
  /**
   * Read off the signature rather than written per gate, so it cannot disagree
   * with the sequence `pending.ts` drives from that same signature.
   */
  it('names a controlled gate its target and its control', () => {
    expect(describeSignature(GATE_SIGNATURES.cx)).toBe('1 target, 1 control');
  });

  it('pluralises, so swap and ccx read correctly', () => {
    expect(describeSignature(GATE_SIGNATURES.swap)).toBe(
      '2 targets, 0 controls',
    );
    expect(describeSignature(GATE_SIGNATURES.ccx)).toBe('1 target, 2 controls');
  });
});

describe('defaultParameters', () => {
  it('defaults a rotation to a quarter turn in radians', () => {
    expect(defaultParameters(GATE_SIGNATURES.rx)).toEqual({
      theta: Math.PI / 2,
    });
  });

  it('gives a parameterless gate an empty map', () => {
    expect(defaultParameters(GATE_SIGNATURES.h)).toEqual({});
  });

  it("names p's parameter lambda, as the spec does", () => {
    expect(Object.keys(defaultParameters(GATE_SIGNATURES.p))).toEqual([
      'lambda',
    ]);
  });
});

describe('GatePalette', () => {
  it('arms a gate when clicked', () => {
    const onArm = vi.fn();
    render(<GatePalette armed={null} onArm={onArm} />);

    fireEvent.click(screen.getByRole('button', { name: /^h —/ }));

    expect(onArm).toHaveBeenCalledWith('h');
  });

  it('disarms when the armed gate is clicked again', () => {
    const onArm = vi.fn();
    render(<GatePalette armed="h" onArm={onArm} />);

    fireEvent.click(screen.getByRole('button', { name: /^h —/ }));

    expect(onArm).toHaveBeenCalledWith(null);
  });

  it('reports which gate is armed, not by colour alone', () => {
    render(<GatePalette armed="h" onArm={vi.fn()} />);

    expect(screen.getByRole('button', { name: /^h —/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  /**
   * Multi-qubit gates arm exactly like single-qubit ones. What differs is what
   * happens on the canvas afterwards, and no gate in the spec is unavailable
   * any more -- this is the assertion that the `aria-disabled` treatment is
   * gone rather than merely unused.
   */
  it('arms a multi-qubit gate like any other', () => {
    const onArm = vi.fn();
    render(<GatePalette armed={null} onArm={onArm} />);
    const cx = screen.getByRole('button', { name: /^cx —/ });

    expect(cx).not.toHaveAttribute('aria-disabled');

    fireEvent.click(cx);

    expect(onArm).toHaveBeenCalledWith('cx');
  });

  /** UI.md: the tooltip carries a description and the gate's signature. */
  it('announces how many wires a gate will ask for', () => {
    render(<GatePalette armed={null} onArm={vi.fn()} />);

    expect(screen.getByRole('button', { name: /^ccx —/ })).toHaveAccessibleName(
      /1 target, 2 controls/,
    );
  });

  /**
   * UI.md: each region is one tab stop. Eighteen gates each taking one would mean
   * eighteen presses to reach the canvas.
   */
  it('is a single tab stop with a roving focus', () => {
    render(<GatePalette armed={null} onArm={vi.fn()} />);
    const tabbable = screen
      .getAllByRole('button')
      .filter((button) => button.getAttribute('tabindex') === '0');

    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toHaveAccessibleName(/^i —/);
  });

  it('moves focus between gates with the arrow keys', () => {
    render(<GatePalette armed={null} onArm={vi.fn()} />);
    const palette = screen.getByRole('navigation', { name: 'Gate palette' });

    fireEvent.keyDown(palette, { key: 'ArrowRight' });

    expect(screen.getByRole('button', { name: /^x —/ })).toHaveFocus();
  });

  it('reaches the last gate with End', () => {
    render(<GatePalette armed={null} onArm={vi.fn()} />);
    const palette = screen.getByRole('navigation', { name: 'Gate palette' });

    fireEvent.keyDown(palette, { key: 'End' });

    expect(screen.getByRole('button', { name: /^ccx —/ })).toHaveFocus();
  });

  it('follows the armed gate, so tabbing back returns to it', () => {
    render(<GatePalette armed={null} onArm={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /^h —/ }));

    expect(screen.getByRole('button', { name: /^h —/ })).toHaveAttribute(
      'tabindex',
      '0',
    );
  });

  it('groups gates by what they do', () => {
    render(<GatePalette armed={null} onArm={vi.fn()} />);

    for (const title of ['Superposition', 'Rotation', 'Two-qubit']) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
  });
});
