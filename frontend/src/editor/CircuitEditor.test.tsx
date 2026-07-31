import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { Circuit } from '../model/circuit';
import { insertOperation } from '../state/edits';
import { barrier, circuitWith, gate } from '../state/testCircuits';
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
    /**
     * Press on a cell, as a browser would.
     *
     * The transparent cell layer covers the canvas, so a press aimed at a gate
     * lands on the cell above it. Dispatching on the glyph instead would test a
     * path no pointer can reach -- which is exactly how the drag shipped broken.
     */
    pickUp: (cellName: string) => {
      fireEvent.pointerDown(screen.getByRole('gridcell', { name: cellName }));
    },
    operationId: (label: string) =>
      within(screen.getByRole('grid'))
        .getByText(label)
        .closest('[data-operation-id]')
        ?.getAttribute('data-operation-id') ?? null,
    undo: () => {
      fireEvent.keyDown(screen.getByRole('grid'), { key: 'z', ctrlKey: true });
    },
    redo: () => {
      fireEvent.keyDown(screen.getByRole('grid'), {
        key: 'z',
        ctrlKey: true,
        shiftKey: true,
      });
    },
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

describe('moving a gate', () => {
  function withTwoGates() {
    const editor = open();
    editor.arm('h');
    fireEvent.click(editor.cell('q0, column 1, empty'));
    editor.arm('x');
    fireEvent.click(editor.cell('q0, column 2, empty'));
    fireEvent.keyDown(editor.grid(), { key: 'Escape' });
    return editor;
  }

  it('drags a gate to another wire', () => {
    const editor = open();
    editor.arm('h');
    fireEvent.click(editor.cell('q0, column 1, empty'));
    fireEvent.keyDown(editor.grid(), { key: 'Escape' });

    editor.pickUp('q0, column 1, h');
    fireEvent.pointerEnter(editor.cell('q2, column 1, empty'));
    fireEvent.pointerUp(editor.grid());

    expect(editor.cell('q2, column 1, h')).toBeInTheDocument();
    expect(editor.cell('q0, column 1, empty')).toBeInTheDocument();
  });

  it('drags a gate later along its own wire', () => {
    const editor = withTwoGates();

    editor.pickUp('q0, column 1, h');
    fireEvent.pointerEnter(editor.cell('q0, column 3, empty'));
    fireEvent.pointerUp(editor.grid());

    expect(editor.cell('q0, column 1, x')).toBeInTheDocument();
    expect(editor.cell('q0, column 2, h')).toBeInTheDocument();
  });

  /**
   * ADR-0007 section 3: a drag emits many intermediate circuits and must be one
   * undo step. This is the first interaction to use the coalescing the ADR
   * specified.
   */
  it('collapses a whole drag into one undo step', () => {
    const editor = open();
    editor.arm('h');
    fireEvent.click(editor.cell('q0, column 1, empty'));
    fireEvent.keyDown(editor.grid(), { key: 'Escape' });

    editor.pickUp('q0, column 1, h');
    for (const row of ['q1', 'q2', 'q1']) {
      fireEvent.pointerEnter(editor.cell(`${row}, column 1, empty`));
    }
    fireEvent.pointerUp(editor.grid());
    expect(editor.cell('q1, column 1, h')).toBeInTheDocument();

    editor.undo();

    expect(editor.cell('q0, column 1, h')).toBeInTheDocument();
  });

  it('preserves the identifier across a move', () => {
    const editor = open();
    editor.arm('h');
    fireEvent.click(editor.cell('q0, column 1, empty'));
    // Placing leaves the gate armed, so the preview would be a second "h".
    fireEvent.keyDown(editor.grid(), { key: 'Escape' });
    const before = editor.operationId('h');

    editor.pickUp('q0, column 1, h');
    fireEvent.pointerEnter(editor.cell('q1, column 1, empty'));
    fireEvent.pointerUp(editor.grid());

    expect(editor.operationId('h')).toBe(before);
  });

  /**
   * Regression, end to end. The index was computed from the target wire alone,
   * so a cx whose target wire was empty found no predecessor and moved to the
   * front of the list -- dragged right, it landed far left.
   */
  it('drags a two-qubit gate rightwards without it flying to the left', () => {
    const controlled = insertOperation(
      insertOperation(
        insertOperation(circuitWith(2), gate('op_0', 'h', ['q_0']), 0),
        gate('op_1', 'cx', ['q_1'], ['q_0']),
        1,
      ),
      gate('op_2', 'x', ['q_0']),
      2,
    );
    const editor = open(controlled);

    editor.pickUp('q1, column 2, cx');
    fireEvent.pointerEnter(editor.cell('q1, column 3, empty'));
    fireEvent.pointerUp(editor.grid());

    expect(editor.cell('q1, column 3, cx')).toBeInTheDocument();
  });

  /** Which qubit of a cx a drag meant to move is ambiguous, so it only reorders. */
  it('does not retarget a multi-qubit gate, only repositions it', () => {
    const controlled = insertOperation(
      circuitWith(3),
      gate('op_0', 'cy', ['q_1'], ['q_0']),
      0,
    );
    const editor = open(controlled);

    editor.pickUp('q1, column 1, cy');
    fireEvent.pointerEnter(editor.cell('q2, column 2, empty'));
    fireEvent.pointerUp(editor.grid());

    // Still on q1: a drag cannot say which of its qubits to move.
    expect(
      screen.getByRole('gridcell', { name: /^q1, column \d+, cy$/ }),
    ).toBeInTheDocument();
  });

  /**
   * A barrier is in no cell, so pick-up cannot come from the cell layer. Before
   * its hit target handled pointer-down, keyboard nudging worked and dragging
   * did nothing at all.
   */
  it('drags a barrier along the circuit', () => {
    const withBarrier = insertOperation(
      insertOperation(circuitWith(2), gate('op_0', 'h', ['q_0']), 0),
      barrier('op_1', ['q_0', 'q_1']),
      1,
    );
    const editor = open(withBarrier);

    const ruleX = (): string | null =>
      document
        .querySelector('[data-barrier-hit="op_1"] line')
        ?.getAttribute('x1') ?? null;

    const before = ruleX();
    expect(before).not.toBeNull();

    // Park the cursor away from the destination first: a drag applies only when
    // the destination cell changes, and the cursor starts on the first cell.
    fireEvent.pointerEnter(editor.cell('q1, column 2, empty'));

    const rule = document.querySelector('[data-barrier-hit="op_1"] line');
    if (rule != null) fireEvent.pointerDown(rule);
    fireEvent.pointerEnter(editor.cell('q0, column 1, h'));
    fireEvent.pointerUp(editor.grid());

    // Dragged ahead of the h, so its boundary moves to the leading edge.
    expect(Number(ruleX())).toBeLessThan(Number(before));
    expect(editor.status()).toHaveTextContent('2 operations');
  });

  /**
   * A barrier is in no cell, so arrowing can never reach one. Before `b` existed
   * a barrier was selectable by mouse alone, which UI.md forbids.
   */
  describe('reaching a barrier from the keyboard', () => {
    function withBarriers() {
      const circuit = [
        gate('op_0', 'h', ['q_0']),
        barrier('op_1', ['q_0', 'q_1']),
        gate('op_2', 'x', ['q_0']),
        barrier('op_3', ['q_0', 'q_1']),
      ].reduce<Circuit>(
        (built, operation, index) => insertOperation(built, operation, index),
        circuitWith(2),
      );
      return open(circuit);
    }

    it('selects a barrier with b', () => {
      const editor = withBarriers();

      editor.press('b');

      expect(editor.status()).toHaveTextContent('barrier selected');
    });

    it('steps to the next barrier on a second press', () => {
      const editor = withBarriers();
      const at = (): string | null =>
        document
          .querySelector('[data-operation-id][data-selected="true"]')
          ?.getAttribute('data-operation-id') ?? null;

      editor.press('b');
      const first = at();
      editor.press('b');

      expect(first).not.toBeNull();
      expect(at()).not.toBe(first);
    });

    it('wraps around rather than stopping at the end', () => {
      const editor = withBarriers();
      const at = (): string | null =>
        document
          .querySelector('[data-operation-id][data-selected="true"]')
          ?.getAttribute('data-operation-id') ?? null;

      editor.press('b');
      const first = at();
      editor.press('b');
      editor.press('b');

      expect(at()).toBe(first);
    });

    it('does nothing in a circuit with no barriers', () => {
      const editor = open();

      editor.press('b');

      expect(editor.status()).not.toHaveTextContent('selected');
    });

    /** The whole point: a barrier can now be removed without a pointer. */
    it('removes a barrier by keyboard alone', () => {
      const editor = withBarriers();

      editor.press('b');
      editor.press('Delete');

      expect(editor.status()).toHaveTextContent('3 operations');
    });

    it('moves a barrier once selected', () => {
      const editor = withBarriers();

      editor.press('b');
      const before = document
        .querySelector('[data-barrier-hit] line')
        ?.getAttribute('x1');

      fireEvent.keyDown(editor.grid(), { key: 'ArrowLeft', ctrlKey: true });

      expect(
        document.querySelector('[data-barrier-hit] line')?.getAttribute('x1'),
      ).not.toBe(before);
    });
  });

  describe('by keyboard', () => {
    it('moves the selection with Ctrl and an arrow', () => {
      const editor = open();
      editor.arm('h');
      fireEvent.click(editor.cell('q0, column 1, empty'));
      fireEvent.keyDown(editor.grid(), { key: 'Escape' });
      fireEvent.click(editor.cell('q0, column 1, h'));

      fireEvent.keyDown(editor.grid(), { key: 'ArrowDown', ctrlKey: true });

      expect(editor.cell('q1, column 1, h')).toBeInTheDocument();
    });

    it('leaves a bare arrow moving the cursor rather than the gate', () => {
      const editor = open();
      editor.arm('h');
      fireEvent.click(editor.cell('q0, column 1, empty'));
      fireEvent.keyDown(editor.grid(), { key: 'Escape' });
      fireEvent.click(editor.cell('q0, column 1, h'));

      fireEvent.keyDown(editor.grid(), { key: 'ArrowDown' });

      expect(editor.cell('q0, column 1, h')).toBeInTheDocument();
    });

    /**
     * Each press is a complete action, so unlike a drag the keyboard declares no
     * coalescing -- one press, one undo step.
     */
    it('makes each press its own undo step', () => {
      const editor = open();
      editor.arm('h');
      fireEvent.click(editor.cell('q0, column 1, empty'));
      fireEvent.keyDown(editor.grid(), { key: 'Escape' });
      fireEvent.click(editor.cell('q0, column 1, h'));

      fireEvent.keyDown(editor.grid(), { key: 'ArrowDown', ctrlKey: true });
      fireEvent.keyDown(editor.grid(), { key: 'ArrowDown', ctrlKey: true });
      expect(editor.cell('q2, column 1, h')).toBeInTheDocument();

      editor.undo();

      expect(editor.cell('q1, column 1, h')).toBeInTheDocument();
    });

    it('does nothing with no selection', () => {
      const editor = open();

      fireEvent.keyDown(editor.grid(), { key: 'ArrowDown', ctrlKey: true });

      expect(editor.status()).toHaveTextContent('0 operations');
    });
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
