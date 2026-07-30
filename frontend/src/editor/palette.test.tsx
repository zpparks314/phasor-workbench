import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { GATE_SIGNATURES } from '../model/spec';
import { GatePalette } from './GatePalette';
import { PALETTE, defaultParameters, groupedGateNames } from './palette';

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

  it('marks single-qubit gates placeable and multi-qubit gates not yet', () => {
    const placeable = PALETTE.flatMap((group) =>
      group.entries.filter((entry) => entry.placeable).map((e) => e.name),
    );

    expect(placeable).toContain('h');
    expect(placeable).toContain('rx');
    expect(placeable).not.toContain('cx');
    expect(placeable).not.toContain('swap');
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
   * Shown rather than hidden: the model supports them, this step cannot place
   * them. `aria-disabled` rather than `disabled` so arrowing across the palette
   * still reaches them and announces why -- a `disabled` button is skipped in
   * silence.
   */
  it('marks a gate needing control assignment unavailable, and says why', () => {
    render(<GatePalette armed={null} onArm={vi.fn()} />);
    const cx = screen.getByRole('button', { name: /^cx —/ });

    expect(cx).toHaveAttribute('aria-disabled', 'true');
    expect(cx).toHaveAccessibleName(/control assignment/);
  });

  it('does not arm a gate it cannot place', () => {
    const onArm = vi.fn();
    render(<GatePalette armed={null} onArm={onArm} />);

    fireEvent.click(screen.getByRole('button', { name: /^cx —/ }));

    expect(onArm).not.toHaveBeenCalled();
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

  it('reaches an unavailable gate when arrowing past it', () => {
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
