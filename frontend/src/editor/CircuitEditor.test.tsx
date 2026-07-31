import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { Circuit } from '../model/circuit';
import { circuitWith } from '../state/testCircuits';
import { CircuitEditor } from './CircuitEditor';

function open(circuit: Circuit = circuitWith(3)) {
  render(<CircuitEditor initialCircuit={circuit} />);

  return {
    arm: (gate: string) => {
      fireEvent.click(
        screen.getByRole('button', { name: new RegExp(`^${gate} —`) }),
      );
    },
    cell: (name: string) => screen.getByRole('gridcell', { name }),
    grid: () => screen.getByRole('grid'),
    press: (key: string) => {
      fireEvent.keyDown(screen.getByRole('grid'), { key });
    },
    status: () => screen.getByText(/^Depth /),
  };
}

describe('placing a gate', () => {
  it('places the armed gate where the cell was clicked', () => {
    const editor = open();

    editor.arm('h');
    fireEvent.click(editor.cell('q1, column 1, empty'));

    expect(editor.cell('q1, column 1, h')).toBeInTheDocument();
    expect(editor.status()).toHaveTextContent('1 operations');
  });

  it('does nothing on a cell click when no gate is armed', () => {
    const editor = open();

    fireEvent.click(editor.cell('q0, column 1, empty'));

    expect(editor.status()).toHaveTextContent('0 operations');
  });

  it('reports what is armed', () => {
    const editor = open();

    editor.arm('rx');

    expect(editor.status()).toHaveTextContent('placing rx');
  });

  it('places a parameterised gate with its default rather than prompting', () => {
    const editor = open();

    editor.arm('rx');
    fireEvent.click(editor.cell('q0, column 1, empty'));

    // A missing or unrecognised parameter would be reported here.
    expect(screen.getByText('No problems.')).toBeInTheDocument();
  });

  /**
   * The rule the whole interaction rests on, end to end. Dropping far to the
   * right of an empty wire packs the gate back to column 1 -- position is a
   * consequence of dependencies, not a coordinate the user set.
   */
  it('packs a gate left of the column it was dropped in', () => {
    const editor = open();

    editor.arm('h');
    fireEvent.click(editor.cell('q0, column 1, empty'));
    editor.arm('x');
    fireEvent.click(editor.cell('q1, column 2, empty'));

    expect(editor.cell('q1, column 1, x')).toBeInTheDocument();
    expect(editor.status()).toHaveTextContent('Depth 1');
  });

  it('keeps a dependent gate in the next column', () => {
    const editor = open();

    editor.arm('h');
    fireEvent.click(editor.cell('q0, column 1, empty'));
    editor.arm('x');
    fireEvent.click(editor.cell('q0, column 2, empty'));

    expect(editor.cell('q0, column 2, x')).toBeInTheDocument();
    expect(editor.status()).toHaveTextContent('Depth 2');
  });

  it('offers one empty column past the end to append into', () => {
    const editor = open();

    editor.arm('h');
    fireEvent.click(editor.cell('q0, column 1, empty'));

    expect(editor.cell('q0, column 2, empty')).toBeInTheDocument();
  });
});

describe('selection and removal', () => {
  it('selects an operation by clicking it', () => {
    const editor = open();

    editor.arm('h');
    fireEvent.click(editor.cell('q0, column 1, empty'));
    editor.arm('h');

    fireEvent.keyDown(editor.grid(), { key: 'Escape' });
    fireEvent.click(editor.cell('q0, column 1, h'));

    expect(editor.cell('q0, column 1, h')).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('removes the selection with Delete', () => {
    const editor = open();

    editor.arm('h');
    fireEvent.click(editor.cell('q0, column 1, empty'));
    editor.press('Delete');

    expect(editor.status()).toHaveTextContent('0 operations');
  });

  it('does nothing on Delete with nothing selected', () => {
    const editor = open();

    editor.press('Delete');

    expect(editor.status()).toHaveTextContent('0 operations');
  });

  it('disarms and clears the selection on Escape', () => {
    const editor = open();

    editor.arm('h');
    editor.press('Escape');

    expect(editor.status()).not.toHaveTextContent('placing');
  });
});

describe('keyboard placement', () => {
  /** UI.md: nothing is reachable by mouse alone. */
  it('places a gate without touching the canvas with a pointer', () => {
    const editor = open();

    editor.arm('h');
    editor.press('ArrowDown');
    editor.press('Enter');

    expect(editor.cell('q1, column 1, h')).toBeInTheDocument();
  });

  it('moves along a wire with the arrow keys', () => {
    const editor = open();

    editor.arm('h');
    editor.press('Enter');
    editor.arm('x');
    editor.press('ArrowRight');
    editor.press('Enter');

    expect(editor.cell('q0, column 2, x')).toBeInTheDocument();
  });
});

describe('problems', () => {
  it('reports nothing for a valid circuit', () => {
    open();

    expect(screen.getByText('No problems.')).toBeInTheDocument();
  });

  it('surfaces a violation and clears it when fixed', () => {
    const broken: Circuit = {
      ...circuitWith(2),
      qubits: [
        { id: 'q_0', index: 0 },
        { id: 'q_1', index: 4 },
      ],
    };
    const editor = open(broken);

    expect(screen.getByText(/QUBIT_INDEX_GAP/)).toBeInTheDocument();
    expect(editor.status()).toBeInTheDocument();
  });

  /**
   * The only route to an operation the canvas could not draw: every qubit
   * reference dangling means there is no cell to click.
   */
  it('selects an undrawable operation from the problems strip', () => {
    const broken: Circuit = {
      ...circuitWith(1),
      operations: [
        {
          id: 'op_ghost',
          kind: 'gate',
          name: 'h',
          targets: ['q_missing'],
          controls: [],
          parameters: {},
        },
      ],
    };
    open(broken);

    const problem = screen.getByText(/UNKNOWN_QUBIT_REFERENCE/);
    expect(problem).toBeInTheDocument();

    // It is not on the canvas, so this is the only way to reach it.
    expect(screen.queryByRole('gridcell', { name: /h$/ })).toBeNull();
    fireEvent.click(problem);
  });
});

describe('regions', () => {
  it('lays out the palette, the canvas, and the problems strip', () => {
    open();

    expect(
      screen.getByRole('navigation', { name: 'Gate palette' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('grid')).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'Problems' }),
    ).toBeInTheDocument();
  });
});
