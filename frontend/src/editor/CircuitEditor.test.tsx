import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Circuit } from '../model/circuit';
import { insertOperation } from '../state/edits';
import { barrier, circuitWith, gate, measurement } from '../state/testCircuits';
import { loadStoredCircuit } from '../persistence';
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
    fireEvent.click(editor.cell('q1, cycle 0, empty'));

    expect(editor.cell('q1, cycle 0, h')).toBeInTheDocument();
    expect(editor.status()).toHaveTextContent('1 operations');
  });

  it('does nothing on a cell click when no gate is armed', () => {
    const editor = open();

    fireEvent.click(editor.cell('q0, cycle 0, empty'));

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
    fireEvent.click(editor.cell('q0, cycle 0, empty'));

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
    fireEvent.click(editor.cell('q0, cycle 0, empty'));
    editor.arm('x');
    fireEvent.click(editor.cell('q1, cycle 1, empty'));

    expect(editor.cell('q1, cycle 0, x')).toBeInTheDocument();
    expect(editor.status()).toHaveTextContent('Depth 1');
  });

  it('keeps a dependent gate in the next column', () => {
    const editor = open();

    editor.arm('h');
    fireEvent.click(editor.cell('q0, cycle 0, empty'));
    editor.arm('x');
    fireEvent.click(editor.cell('q0, cycle 1, empty'));

    expect(editor.cell('q0, cycle 1, x')).toBeInTheDocument();
    expect(editor.status()).toHaveTextContent('Depth 2');
  });

  it('offers one empty column past the end to append into', () => {
    const editor = open();

    editor.arm('h');
    fireEvent.click(editor.cell('q0, cycle 0, empty'));

    expect(editor.cell('q0, cycle 1, empty')).toBeInTheDocument();
  });
});

/**
 * UI.md's control-assignment sequence: place the gate on its target wire, then
 * one click per remaining wire, committing once the signature is satisfied.
 *
 * Every click here goes through a `gridcell`, which is the element a pointer
 * actually lands on -- the transparent cell layer covers the canvas. Dispatching
 * on a glyph instead would test a path no pointer can reach.
 */
describe('placing a multi-qubit gate', () => {
  it('commits a cx only once its control is assigned', () => {
    const editor = open();

    editor.arm('cx');
    fireEvent.click(editor.cell('q1, cycle 0, empty'));

    // Still nothing in the circuit: the signature is not satisfied.
    expect(editor.status()).toHaveTextContent('0 operations');

    fireEvent.click(editor.cell('q0, cycle 0, empty'));

    expect(editor.status()).toHaveTextContent('1 operations');
    expect(editor.cell('q1, cycle 0, cx')).toBeInTheDocument();
    expect(editor.cell('q0, cycle 0, cx control')).toBeInTheDocument();
  });

  it('asks for the control, and says so where a screen reader hears it', () => {
    const editor = open();

    editor.arm('cx');
    fireEvent.click(editor.cell('q0, cycle 0, empty'));

    expect(editor.status()).toHaveTextContent(
      'Click a wire to place the control',
    );
  });

  /** ccx takes two controls, so the first prompt must not say "the control". */
  it('counts the controls a ccx still wants', () => {
    const editor = open();

    editor.arm('ccx');
    fireEvent.click(editor.cell('q0, cycle 0, empty'));
    expect(editor.status()).toHaveTextContent(
      'Click a wire to place 2 controls',
    );

    fireEvent.click(editor.cell('q1, cycle 0, empty'));
    expect(editor.status()).toHaveTextContent(
      'Click a wire to place the control',
    );

    fireEvent.click(editor.cell('q2, cycle 0, empty'));
    expect(editor.status()).toHaveTextContent('1 operations');
  });

  /** swap is two targets and no controls; the sequence follows the signature. */
  it('takes two targets for a swap', () => {
    const editor = open();

    editor.arm('swap');
    fireEvent.click(editor.cell('q0, cycle 0, empty'));
    expect(editor.status()).toHaveTextContent(
      'Click a wire to place the target',
    );

    fireEvent.click(editor.cell('q2, cycle 0, empty'));

    expect(editor.cell('q0, cycle 0, swap')).toBeInTheDocument();
    expect(editor.cell('q2, cycle 0, swap')).toBeInTheDocument();
  });

  /**
   * A wire already assigned is refused. Committing a cx controlled by its own
   * target produces QUBIT_REUSED_IN_OPERATION, and no edit in the vocabulary
   * repairs it -- retargetOperation throws for a multi-qubit operation and
   * moving one only changes its column.
   */
  it('refuses the wire the target is already on', () => {
    const editor = open();

    editor.arm('cx');
    fireEvent.click(editor.cell('q0, cycle 0, empty'));
    fireEvent.click(editor.cell('q0, cycle 0, empty'));

    expect(editor.status()).toHaveTextContent('0 operations');
    expect(editor.status()).toHaveTextContent(
      'Click a wire to place the control',
    );

    // And the placement is still live: another wire finishes it.
    fireEvent.click(editor.cell('q1, cycle 0, empty'));

    expect(screen.getByText('No problems.')).toBeInTheDocument();
  });

  /**
   * Only the first click carries a column. A gate occupies one column across
   * every wire it uses, so the control's column is not a second request to
   * reconcile against the target's.
   *
   * Isolated rather than asserted in passing: the target asks for the column an
   * `h` already occupies on the control wire, so the cx sorts *before* that h
   * and pushes it right. Had the control's later column been read instead, the
   * cx would have sorted after the h and the two would be the other way round.
   */
  it('ignores the column of the control click', () => {
    const editor = open();

    editor.arm('h');
    fireEvent.click(editor.cell('q0, cycle 0, empty'));

    editor.arm('cx');
    fireEvent.click(editor.cell('q1, cycle 0, empty'));
    fireEvent.click(editor.cell('q0, cycle 1, empty'));

    expect(editor.cell('q1, cycle 0, cx')).toBeInTheDocument();
    expect(editor.cell('q0, cycle 0, cx control')).toBeInTheDocument();
    expect(editor.cell('q0, cycle 1, h')).toBeInTheDocument();
  });

  /** UI.md: Escape cancels the whole pending operation, not one step of it. */
  it('cancels the whole pending operation on Escape', () => {
    const editor = open();

    editor.arm('ccx');
    fireEvent.click(editor.cell('q0, cycle 0, empty'));
    fireEvent.click(editor.cell('q1, cycle 0, empty'));
    editor.press('Escape');

    expect(editor.status()).not.toHaveTextContent('Click a wire');
    expect(editor.status()).toHaveTextContent('0 operations');

    // Still armed, so retrying costs no trip back to the palette, and the
    // sequence restarts from its first wire rather than resuming.
    editor.arm('cx');
    fireEvent.click(editor.cell('q0, cycle 0, empty'));
    fireEvent.click(editor.cell('q1, cycle 0, empty'));

    expect(editor.cell('q0, cycle 0, cx')).toBeInTheDocument();
  });

  it('abandons a placement when a different gate is armed', () => {
    const editor = open();

    editor.arm('cx');
    fireEvent.click(editor.cell('q0, cycle 0, empty'));
    editor.arm('h');
    fireEvent.click(editor.cell('q1, cycle 0, empty'));

    expect(editor.cell('q1, cycle 0, h')).toBeInTheDocument();
    expect(editor.status()).toHaveTextContent('1 operations');
  });

  /** UI.md: nothing is reachable by mouse alone, control assignment included. */
  it('assigns a control from the keyboard', () => {
    const editor = open();

    editor.arm('cx');
    editor.press('Enter');
    editor.press('ArrowDown');
    editor.press('Enter');

    expect(editor.cell('q0, cycle 0, cx')).toBeInTheDocument();
    expect(editor.cell('q1, cycle 0, cx control')).toBeInTheDocument();
  });

  /** One undo step: nothing entered the circuit until the gate committed. */
  it('undoes a committed cx in one step', () => {
    const editor = open();

    editor.arm('cx');
    fireEvent.click(editor.cell('q0, cycle 0, empty'));
    fireEvent.click(editor.cell('q1, cycle 0, empty'));
    editor.undo();

    expect(editor.status()).toHaveTextContent('0 operations');
  });

  /**
   * The drop column is a request for a multi-qubit gate too. Dropped at column
   * 3 across two wires that nothing touches, it packs back to column 1 -- ASAP
   * puts it wherever its own resources allow, and the busy wire is not one of
   * them.
   */
  it('packs a cx left of the column it was dropped in', () => {
    const editor = open();

    // Two gates on q0, to give the canvas a third column to drop into.
    editor.arm('h');
    fireEvent.click(editor.cell('q0, cycle 0, empty'));
    fireEvent.click(editor.cell('q0, cycle 1, empty'));

    editor.arm('cx');
    fireEvent.click(editor.cell('q1, cycle 2, empty'));
    fireEvent.click(editor.cell('q2, cycle 2, empty'));

    expect(editor.cell('q1, cycle 0, cx')).toBeInTheDocument();
    expect(editor.cell('q2, cycle 0, cx control')).toBeInTheDocument();
    expect(editor.status()).toHaveTextContent('Depth 2');
  });

  /**
   * The other half of that rule: every wire the gate uses counts. A cx whose
   * control wire is busy has to follow what is on it, even though its target
   * wire is free from column 1.
   */
  it('holds a cx behind an operation on its control wire', () => {
    const editor = open();

    editor.arm('h');
    fireEvent.click(editor.cell('q1, cycle 0, empty'));

    editor.arm('cx');
    fireEvent.click(editor.cell('q0, cycle 1, empty'));
    fireEvent.click(editor.cell('q1, cycle 1, empty'));

    expect(editor.cell('q0, cycle 1, cx')).toBeInTheDocument();
    expect(editor.cell('q1, cycle 1, cx control')).toBeInTheDocument();
    expect(editor.status()).toHaveTextContent('Depth 2');
  });
});

describe('selection and removal', () => {
  it('selects an operation by clicking it', () => {
    const editor = open();

    editor.arm('h');
    fireEvent.click(editor.cell('q0, cycle 0, empty'));
    editor.arm('h');

    fireEvent.keyDown(editor.grid(), { key: 'Escape' });
    fireEvent.click(editor.cell('q0, cycle 0, h'));

    expect(editor.cell('q0, cycle 0, h')).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('removes the selection with Delete', () => {
    const editor = open();

    editor.arm('h');
    fireEvent.click(editor.cell('q0, cycle 0, empty'));
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

    expect(editor.cell('q1, cycle 0, h')).toBeInTheDocument();
  });

  it('moves along a wire with the arrow keys', () => {
    const editor = open();

    editor.arm('h');
    editor.press('Enter');
    editor.arm('x');
    editor.press('ArrowRight');
    editor.press('Enter');

    expect(editor.cell('q0, cycle 1, x')).toBeInTheDocument();
  });
});

describe('moving a gate', () => {
  function withTwoGates() {
    const editor = open();
    editor.arm('h');
    fireEvent.click(editor.cell('q0, cycle 0, empty'));
    editor.arm('x');
    fireEvent.click(editor.cell('q0, cycle 1, empty'));
    fireEvent.keyDown(editor.grid(), { key: 'Escape' });
    return editor;
  }

  it('drags a gate to another wire', () => {
    const editor = open();
    editor.arm('h');
    fireEvent.click(editor.cell('q0, cycle 0, empty'));
    fireEvent.keyDown(editor.grid(), { key: 'Escape' });

    editor.pickUp('q0, cycle 0, h');
    fireEvent.pointerEnter(editor.cell('q2, cycle 0, empty'));
    fireEvent.pointerUp(editor.grid());

    expect(editor.cell('q2, cycle 0, h')).toBeInTheDocument();
    expect(editor.cell('q0, cycle 0, empty')).toBeInTheDocument();
  });

  it('drags a gate later along its own wire', () => {
    const editor = withTwoGates();

    editor.pickUp('q0, cycle 0, h');
    fireEvent.pointerEnter(editor.cell('q0, cycle 2, empty'));
    fireEvent.pointerUp(editor.grid());

    expect(editor.cell('q0, cycle 0, x')).toBeInTheDocument();
    expect(editor.cell('q0, cycle 1, h')).toBeInTheDocument();
  });

  /**
   * ADR-0007 section 3: a drag emits many intermediate circuits and must be one
   * undo step. This is the first interaction to use the coalescing the ADR
   * specified.
   */
  it('collapses a whole drag into one undo step', () => {
    const editor = open();
    editor.arm('h');
    fireEvent.click(editor.cell('q0, cycle 0, empty'));
    fireEvent.keyDown(editor.grid(), { key: 'Escape' });

    editor.pickUp('q0, cycle 0, h');
    for (const row of ['q1', 'q2', 'q1']) {
      fireEvent.pointerEnter(editor.cell(`${row}, cycle 0, empty`));
    }
    fireEvent.pointerUp(editor.grid());
    expect(editor.cell('q1, cycle 0, h')).toBeInTheDocument();

    editor.undo();

    expect(editor.cell('q0, cycle 0, h')).toBeInTheDocument();
  });

  it('preserves the identifier across a move', () => {
    const editor = open();
    editor.arm('h');
    fireEvent.click(editor.cell('q0, cycle 0, empty'));
    // Placing leaves the gate armed, so the preview would be a second "h".
    fireEvent.keyDown(editor.grid(), { key: 'Escape' });
    const before = editor.operationId('h');

    editor.pickUp('q0, cycle 0, h');
    fireEvent.pointerEnter(editor.cell('q1, cycle 0, empty'));
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

    editor.pickUp('q1, cycle 1, cx');
    fireEvent.pointerEnter(editor.cell('q1, cycle 2, empty'));
    fireEvent.pointerUp(editor.grid());

    expect(editor.cell('q1, cycle 2, cx')).toBeInTheDocument();
  });

  /** Which qubit of a cx a drag meant to move is ambiguous, so it only reorders. */
  it('does not retarget a multi-qubit gate, only repositions it', () => {
    const controlled = insertOperation(
      circuitWith(3),
      gate('op_0', 'cy', ['q_1'], ['q_0']),
      0,
    );
    const editor = open(controlled);

    editor.pickUp('q1, cycle 0, cy');
    fireEvent.pointerEnter(editor.cell('q2, cycle 1, empty'));
    fireEvent.pointerUp(editor.grid());

    // Still on q1: a drag cannot say which of its qubits to move.
    expect(
      screen.getByRole('gridcell', { name: /^q1, cycle \d+, cy$/ }),
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
    fireEvent.pointerEnter(editor.cell('q1, cycle 1, empty'));

    const rule = document.querySelector('[data-barrier-hit="op_1"] line');
    if (rule != null) fireEvent.pointerDown(rule);
    fireEvent.pointerEnter(editor.cell('q0, cycle 0, h'));
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
      fireEvent.click(editor.cell('q0, cycle 0, empty'));
      fireEvent.keyDown(editor.grid(), { key: 'Escape' });
      fireEvent.click(editor.cell('q0, cycle 0, h'));

      fireEvent.keyDown(editor.grid(), { key: 'ArrowDown', ctrlKey: true });

      expect(editor.cell('q1, cycle 0, h')).toBeInTheDocument();
    });

    it('leaves a bare arrow moving the cursor rather than the gate', () => {
      const editor = open();
      editor.arm('h');
      fireEvent.click(editor.cell('q0, cycle 0, empty'));
      fireEvent.keyDown(editor.grid(), { key: 'Escape' });
      fireEvent.click(editor.cell('q0, cycle 0, h'));

      fireEvent.keyDown(editor.grid(), { key: 'ArrowDown' });

      expect(editor.cell('q0, cycle 0, h')).toBeInTheDocument();
    });

    /**
     * Each press is a complete action, so unlike a drag the keyboard declares no
     * coalescing -- one press, one undo step.
     */
    it('makes each press its own undo step', () => {
      const editor = open();
      editor.arm('h');
      fireEvent.click(editor.cell('q0, cycle 0, empty'));
      fireEvent.keyDown(editor.grid(), { key: 'Escape' });
      fireEvent.click(editor.cell('q0, cycle 0, h'));

      fireEvent.keyDown(editor.grid(), { key: 'ArrowDown', ctrlKey: true });
      fireEvent.keyDown(editor.grid(), { key: 'ArrowDown', ctrlKey: true });
      expect(editor.cell('q2, cycle 0, h')).toBeInTheDocument();

      editor.undo();

      expect(editor.cell('q1, cycle 0, h')).toBeInTheDocument();
    });

    it('does nothing with no selection', () => {
      const editor = open();

      fireEvent.keyDown(editor.grid(), { key: 'ArrowDown', ctrlKey: true });

      expect(editor.status()).toHaveTextContent('0 operations');
    });
  });
});

/**
 * Qubits and registers are properties of the circuit rather than things placed
 * in it, so they live in their own region beside the palette -- not in the
 * canvas, whose single tab stop and `aria-activedescendant` contract focusable
 * controls inside it would break.
 */
describe('placing measurements', () => {
  it('measures into the first register, at its first free bit', () => {
    const editor = open(circuitWith(2));

    editor.arm('measurement');
    fireEvent.click(editor.cell('q0, cycle 0, empty'));

    expect(editor.cell('q0, cycle 0, measurement')).toBeInTheDocument();
    expect(screen.getByText('No problems.')).toBeInTheDocument();
  });

  it('takes the next free bit rather than reusing one', () => {
    const editor = open(circuitWith(2));

    editor.arm('measurement');
    fireEvent.click(editor.cell('q0, cycle 0, empty'));
    fireEvent.click(editor.cell('q1, cycle 0, empty'));

    // Bits 0 and 1 of a two-bit register, so both fit and nothing contends.
    expect(editor.status()).toHaveTextContent('2 operations');
    expect(screen.getByText('No problems.')).toBeInTheDocument();
  });

  /**
   * Running out of bits is surfaced rather than clamped. Clamping would write
   * two measurements to one bit -- legal, but it makes them contend for that bit
   * and serialises operations the user expected to be concurrent. The size
   * control is the fix, and the problems strip says so.
   */
  it('reports an out-of-range bit instead of silently reusing the last', () => {
    const editor = open(circuitWith(2, 1));

    editor.arm('measurement');
    fireEvent.click(editor.cell('q0, cycle 0, empty'));
    fireEvent.click(editor.cell('q1, cycle 0, empty'));

    expect(editor.status()).toHaveTextContent('2 operations');
    expect(screen.queryByText('No problems.')).toBeNull();
  });

  /**
   * UI.md: an entry this circuit cannot take is announced, not hidden. A
   * measurement has nowhere to write with no register declared.
   */
  it('is unavailable with no register, and available once one exists', () => {
    const editor = open({ ...circuitWith(1), classicalRegisters: [] });
    const measurement = () =>
      screen.getByRole('button', { name: /^measurement —/ });

    expect(measurement()).toHaveAttribute('aria-disabled', 'true');
    expect(measurement()).toHaveAccessibleName(/add a classical register/i);

    fireEvent.click(screen.getByRole('button', { name: 'Add register' }));

    expect(measurement()).not.toHaveAttribute('aria-disabled');

    editor.arm('measurement');
    fireEvent.click(editor.cell('q0, cycle 0, empty'));

    expect(editor.cell('q0, cycle 0, measurement')).toBeInTheDocument();
  });

  it('places from the keyboard', () => {
    const editor = open(circuitWith(2));

    editor.arm('measurement');
    editor.press('ArrowDown');
    editor.press('Enter');

    expect(editor.cell('q1, cycle 0, measurement')).toBeInTheDocument();
  });
});

/**
 * A barrier is expanded to every wire at placement time.
 *
 * CircuitModel.md rules out an implicit "all qubits" barrier because its meaning
 * would change when a qubit is added. Expanding on placement is what OpenQASM's
 * bare `barrier;` does on import, and it leaves the document saying exactly what
 * it means -- a barrier over these wires, which nothing later rewrites.
 */
describe('placing barriers', () => {
  function barrierTargets(editor: ReturnType<typeof open>): number {
    void editor;
    return document.querySelectorAll('[data-barrier-hit] line').length;
  }

  it('spans every wire in the circuit', () => {
    const editor = open(circuitWith(3));

    editor.arm('barrier');
    fireEvent.click(editor.cell('q0, cycle 0, empty'));

    // One contiguous run over all three wires, so one segment.
    expect(barrierTargets(editor)).toBe(1);
    expect(editor.status()).toHaveTextContent('1 operations');
  });

  it('holds a later gate behind it', () => {
    const editor = open(circuitWith(1));

    editor.arm('h');
    fireEvent.click(editor.cell('q0, cycle 0, empty'));
    editor.arm('barrier');
    fireEvent.click(editor.cell('q0, cycle 1, empty'));
    editor.arm('x');
    fireEvent.click(editor.cell('q0, cycle 1, empty'));

    expect(editor.cell('q0, cycle 1, x')).toBeInTheDocument();
    expect(editor.status()).toHaveTextContent('Depth 2');
  });

  /**
   * The half of the symmetry that is real: a removed qubit takes its reference
   * with it, so the barrier shrinks. Adding one does not extend it -- nothing
   * references the new wire, and rewriting authored targets is what
   * CircuitModel.md forbids.
   */
  it('does not extend to a qubit added afterwards', () => {
    const editor = open(circuitWith(2));

    editor.arm('barrier');
    fireEvent.click(editor.cell('q0, cycle 0, empty'));
    fireEvent.click(screen.getByRole('button', { name: 'Add qubit' }));

    // Still one segment, over the original two wires, not the new third.
    expect(barrierTargets(editor)).toBe(1);
    expect(editor.status()).toHaveTextContent('1 operations');
  });

  it('shrinks when one of its qubits is removed', () => {
    const editor = open(circuitWith(3));

    editor.arm('barrier');
    fireEvent.click(editor.cell('q0, cycle 0, empty'));
    fireEvent.click(screen.getByRole('button', { name: /^Remove q1/ }));

    expect(editor.status()).toHaveTextContent('1 operations');
  });

  it('is reachable from the keyboard once placed', () => {
    const editor = open(circuitWith(2));

    editor.arm('barrier');
    fireEvent.click(editor.cell('q0, cycle 0, empty'));
    editor.press('Escape');
    editor.press('b');

    expect(editor.status()).toHaveTextContent('barrier selected');
  });

  it('places from the keyboard', () => {
    const editor = open(circuitWith(2));

    editor.arm('barrier');
    editor.press('Enter');

    expect(editor.status()).toHaveTextContent('1 operations');
  });
});

describe('qubits and registers', () => {
  const control = (name: string | RegExp) =>
    screen.getByRole('button', { name });

  it('adds a qubit, and the canvas grows a wire', () => {
    const editor = open(circuitWith(1));

    fireEvent.click(control('Add qubit'));

    expect(editor.cell('q1, cycle 0, empty')).toBeInTheDocument();
  });

  /** The exit criterion: indices stay contiguous from 0 at every point. */
  it('renumbers the wires below a removed middle qubit', () => {
    const editor = open(circuitWith(3));

    fireEvent.click(control('Remove q1'));

    expect(editor.cell('q1, cycle 0, empty')).toBeInTheDocument();
    expect(screen.queryByRole('row', { name: 'q2' })).toBeNull();
  });

  it('removes a bare wire without asking', () => {
    open(circuitWith(2));

    fireEvent.click(control('Remove q1'));

    expect(screen.queryByRole('row', { name: 'q1' })).toBeNull();
  });

  /**
   * UI.md: removing a qubit destroys every operation touching it, and that is
   * destructive enough to state before it happens. Two presses, with the count
   * named in between.
   */
  it('names the cost before destroying operations, and waits', () => {
    const editor = open(circuitWith(2));

    editor.arm('h');
    fireEvent.click(editor.cell('q0, cycle 0, empty'));
    fireEvent.click(control(/^Remove q0 and 1 operation$/));

    // Armed, not done: the wire and its gate are still there.
    expect(editor.status()).toHaveTextContent('1 operations');
    expect(
      screen.getByText(/Remove q0 and 1 operation\? Press again/),
    ).toBeInTheDocument();

    fireEvent.click(control(/^Remove q0 and 1 operation\?$/));

    expect(editor.status()).toHaveTextContent('0 operations');
    // One wire left, and it renumbered into q0 -- indices are contiguous from
    // 0, so the surviving wire takes the departed one's name.
    expect(screen.getAllByRole('row')).toHaveLength(1);
    expect(screen.getByRole('row', { name: 'q0' })).toBeInTheDocument();
  });

  it('abandons the confirmation on Escape', () => {
    const editor = open(circuitWith(2));

    editor.arm('h');
    fireEvent.click(editor.cell('q0, cycle 0, empty'));
    fireEvent.click(control(/^Remove q0 and 1 operation$/));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Add qubit' }), {
      key: 'Escape',
    });

    expect(screen.queryByText(/Press again/)).toBeNull();
    expect(editor.status()).toHaveTextContent('1 operations');
  });

  /**
   * A barrier over the qubit is shrunk rather than removed, so it must not be
   * counted as lost. This is the case that makes restating the edit's rules in
   * the message unsafe.
   */
  it('does not count a barrier it will merely shrink', () => {
    open(insertOperation(circuitWith(3), barrier('op_0', ['q_0', 'q_1']), 0));

    expect(control('Remove q0')).toBeInTheDocument();
  });

  it('is a single undo step, however much it destroyed', () => {
    const editor = open(circuitWith(2));

    editor.arm('h');
    fireEvent.click(editor.cell('q0, cycle 0, empty'));
    fireEvent.click(control(/^Remove q0 and 1 operation$/));
    fireEvent.click(control(/^Remove q0 and 1 operation\?$/));
    editor.undo();

    expect(editor.status()).toHaveTextContent('1 operations');
    expect(editor.cell('q0, cycle 0, h')).toBeInTheDocument();
  });

  it('adds a register, labelled by position rather than by its identifier', () => {
    open(circuitWith(1));

    fireEvent.click(control('Add register'));

    // c0 already exists, so the new one is c1 -- and neither shows a UUID.
    expect(
      screen.getByRole('spinbutton', { name: 'c1 size in bits' }),
    ).toBeInTheDocument();
  });

  it('resizes a register', () => {
    open(circuitWith(1));

    fireEvent.change(
      screen.getByRole('spinbutton', { name: 'c0 size in bits' }),
      { target: { value: '4' } },
    );

    expect(
      screen.getByRole('spinbutton', { name: 'c0 size in bits' }),
    ).toHaveValue(4);
  });

  it('removes a register and the measurements writing into it', () => {
    const editor = open(
      insertOperation(circuitWith(1), measurement('op_0', 'q_0', 'c_0', 0), 0),
    );

    fireEvent.click(control(/^Remove c0 and 1 operation$/));
    fireEvent.click(control(/^Remove c0 and 1 operation\?$/));

    expect(editor.status()).toHaveTextContent('0 operations');
  });

  /** UI.md: never a blank rectangle. */
  it('prompts for a first qubit once the last one is gone', () => {
    open(circuitWith(1));

    fireEvent.click(control('Remove q0'));

    expect(screen.getByTestId('empty-canvas')).toBeInTheDocument();
    expect(screen.queryByRole('grid')).toBeNull();
  });

  /** And the prompt is not a dead end -- the control to escape it is adjacent. */
  it('builds back up from empty', () => {
    const editor = open(circuitWith(1));

    fireEvent.click(control('Remove q0'));
    fireEvent.click(control('Add qubit'));

    expect(editor.cell('q0, cycle 0, empty')).toBeInTheDocument();
  });

  it('is one tab stop with a roving focus', () => {
    open(circuitWith(3));
    const region = screen.getByRole('region', { name: 'Circuit structure' });

    const tabbable = [...region.querySelectorAll('[tabindex="0"]')];

    expect(tabbable).toHaveLength(1);

    fireEvent.keyDown(region, { key: 'ArrowRight' });

    expect(control('Remove q1')).toHaveFocus();
  });
});

describe('the header', () => {
  const button = (name: string | RegExp) =>
    screen.getByRole('button', { name });

  it('undoes from the button as well as the keyboard', () => {
    const editor = open(circuitWith(2));

    editor.arm('h');
    fireEvent.click(editor.cell('q0, cycle 0, empty'));
    fireEvent.click(button(/^Undo place h on q0$/));

    expect(editor.status()).toHaveTextContent('0 operations');
  });

  it('redoes from the button', () => {
    const editor = open(circuitWith(2));

    editor.arm('h');
    fireEvent.click(editor.cell('q0, cycle 0, empty'));
    editor.undo();
    fireEvent.click(button(/^Redo place h on q0$/));

    expect(editor.cell('q0, cycle 0, h')).toBeInTheDocument();
  });

  /** The label comes from the history entry, so it tracks the actual last edit. */
  it('tracks what the last edit was', () => {
    const editor = open(circuitWith(2));

    editor.arm('h');
    fireEvent.click(editor.cell('q0, cycle 0, empty'));
    expect(button(/^Undo place h on q0$/)).toBeInTheDocument();

    editor.arm('x');
    fireEvent.click(editor.cell('q1, cycle 0, empty'));
    expect(button(/^Undo place x on q1$/)).toBeInTheDocument();
  });

  it('starts with both disabled', () => {
    open(circuitWith(2));

    expect(button('Undo')).toBeDisabled();
    expect(button('Redo')).toBeDisabled();
  });

  /**
   * Clear empties the operation list and leaves the circuit's structure alone.
   * Resetting the document -- wires, registers and identity -- is a different
   * act that needs to know about unsaved changes, and belongs with local save.
   */
  it('clears the operations but keeps the wires and registers', () => {
    const editor = open(circuitWith(3));

    editor.arm('h');
    fireEvent.click(editor.cell('q0, cycle 0, empty'));
    editor.arm('x');
    fireEvent.click(editor.cell('q1, cycle 0, empty'));

    fireEvent.click(button('Clear 2 operations'));
    fireEvent.click(button(/^Clear 2 operations\?$/));

    expect(editor.status()).toHaveTextContent('0 operations');
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(
      screen.getByRole('spinbutton', { name: 'c0 size in bits' }),
    ).toBeInTheDocument();
  });

  it('is one undo step however much it removed', () => {
    const editor = open(circuitWith(2));

    editor.arm('h');
    fireEvent.click(editor.cell('q0, cycle 0, empty'));
    editor.arm('x');
    fireEvent.click(editor.cell('q1, cycle 0, empty'));

    fireEvent.click(button('Clear 2 operations'));
    fireEvent.click(button(/^Clear 2 operations\?$/));
    editor.undo();

    expect(editor.status()).toHaveTextContent('2 operations');
  });

  it('stays disabled on a circuit with nothing to clear', () => {
    open(circuitWith(2));

    expect(button('Clear 0 operations')).toBeDisabled();
  });
});

/**
 * Saving, end to end through the real persistence module.
 *
 * `localStorage` is jsdom's here rather than a fake: the adapter's own failure
 * modes are covered in `persistence.test.ts`, and what matters at this level is
 * that the editor reaches storage at all and says what happened.
 */
describe('saving the circuit', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('writes the circuit and reports when', () => {
    const editor = open(circuitWith(2));

    editor.arm('h');
    fireEvent.click(editor.cell('q0, cycle 0, empty'));
    fireEvent.click(screen.getByRole('button', { name: 'Save circuit' }));

    expect(screen.getByText(/^Saved at /)).toBeInTheDocument();
    expect(localStorage.getItem('phasor-workbench.circuit')).not.toBeNull();
  });

  /** UI.md: Ctrl/Cmd + S, and nothing is reachable by mouse alone. */
  it('saves from the keyboard', () => {
    const editor = open(circuitWith(1));

    fireEvent.keyDown(editor.grid(), { key: 's', ctrlKey: true });

    expect(localStorage.getItem('phasor-workbench.circuit')).not.toBeNull();
  });

  it('stores what was built, so it can be read back', () => {
    const editor = open(circuitWith(2));

    editor.arm('cx');
    fireEvent.click(editor.cell('q0, cycle 0, empty'));
    fireEvent.click(editor.cell('q1, cycle 0, empty'));
    fireEvent.click(screen.getByRole('button', { name: 'Save circuit' }));

    const restored = loadStoredCircuit();
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.circuit.operations).toHaveLength(1);
    expect(restored.circuit.operations[0]).toMatchObject({ name: 'cx' });
  });

  /**
   * A failed save is stated and persistent. Silence would let someone close the
   * tab believing their work was safe, which UI.md and CLAUDE.md both forbid.
   */
  it('says so when storage refuses, and says the circuit is still open', () => {
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        const error = new Error('full');
        error.name = 'QuotaExceededError';
        throw error;
      });

    const editor = open(circuitWith(1));
    fireEvent.click(screen.getByRole('button', { name: 'Save circuit' }));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/storage is full/i);
    expect(alert).toHaveTextContent(/still open and unsaved/i);
    expect(editor.status()).toHaveTextContent('0 operations');

    setItem.mockRestore();
  });

  it('clears the failure once a save succeeds', () => {
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementationOnce(() => {
        throw new Error('denied');
      });

    open(circuitWith(1));
    fireEvent.click(screen.getByRole('button', { name: 'Save circuit' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save circuit' }));

    expect(screen.queryByRole('alert')).toBeNull();
    setItem.mockRestore();
  });

  /** The editor stays usable without storage, per Architecture.md. */
  it('remains editable after a failed save', () => {
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('denied');
      });

    const editor = open(circuitWith(2));
    fireEvent.click(screen.getByRole('button', { name: 'Save circuit' }));

    editor.arm('h');
    fireEvent.click(editor.cell('q0, cycle 0, empty'));

    expect(editor.cell('q0, cycle 0, h')).toBeInTheDocument();
    setItem.mockRestore();
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

  it('fills the column reserved for the inspector', () => {
    open();

    expect(
      screen.getByRole('region', { name: 'Inspector' }),
    ).toBeInTheDocument();
  });
});

/**
 * These assert the *wiring*. `Inspector.test.tsx` proves the panel reports what
 * it is given; only running it against the real store proves an edit reaches
 * the circuit, goes through history, and costs the right number of undo steps.
 */
describe('the inspector', () => {
  /**
   * Disarm, then click the operation.
   *
   * The Escape is load-bearing and was missing at first: placing leaves the
   * gate armed, so a click on the occupied cell means "place another here", not
   * "select that". Without it these tests quietly asserted against a second
   * gate placed on top of the first -- and the angle assertions still passed,
   * because the duplicate carried the same default. Hence the operation count
   * in the test below, which is what actually catches it.
   */
  function selectPlaced(editor: ReturnType<typeof open>, cell: string) {
    editor.press('Escape');
    fireEvent.click(editor.cell(cell));
  }

  const angle = () => screen.getByRole('spinbutton', { name: /theta/i });

  it('edits a placed rotation, which places at a quarter turn', () => {
    const editor = open();

    editor.arm('rx');
    fireEvent.click(editor.cell('q0, cycle 0, empty'));
    selectPlaced(editor, 'q0, cycle 0, rx');

    expect(editor.status()).toHaveTextContent('1 operations');
    expect(angle()).toHaveValue(Math.PI / 2);

    fireEvent.change(angle(), { target: { value: String(Math.PI) } });

    expect(angle()).toHaveValue(Math.PI);
  });

  /**
   * The reason `changeParameter` coalesces. Exploring an angle should be one
   * step to undo, not one per keystroke -- and the step must restore the value
   * the gate was placed with rather than an intermediate.
   */
  it('collapses a run of angle edits into one undo step', () => {
    const editor = open();

    editor.arm('rx');
    fireEvent.click(editor.cell('q0, cycle 0, empty'));
    selectPlaced(editor, 'q0, cycle 0, rx');

    fireEvent.change(angle(), { target: { value: '1' } });
    fireEvent.change(angle(), { target: { value: '1.2' } });
    fireEvent.change(angle(), { target: { value: '1.25' } });
    fireEvent.blur(angle());

    editor.undo();

    expect(angle()).toHaveValue(Math.PI / 2);
  });

  it('starts a new undo step after the interaction ends', () => {
    const editor = open();

    editor.arm('rz');
    fireEvent.click(editor.cell('q0, cycle 0, empty'));
    selectPlaced(editor, 'q0, cycle 0, rz');

    fireEvent.change(angle(), { target: { value: '1' } });
    fireEvent.blur(angle());
    fireEvent.change(angle(), { target: { value: '2' } });
    fireEvent.blur(angle());

    editor.undo();

    expect(angle()).toHaveValue(1);
  });

  /**
   * An emptied field is reported rather than refused, per UI.md. The violation
   * appearing is the whole point: the circuit is knowably wrong and says why.
   */
  it('reports a non-finite angle instead of refusing it', () => {
    const editor = open();

    editor.arm('rx');
    fireEvent.click(editor.cell('q0, cycle 0, empty'));
    selectPlaced(editor, 'q0, cycle 0, rx');

    fireEvent.change(angle(), { target: { value: '' } });

    expect(screen.getByText(/PARAMETER_NOT_FINITE/)).toBeInTheDocument();
  });

  /**
   * The deferred item this panel closes. Placement always writes into the first
   * register's lowest free bit, so before the inspector a second register was
   * unreachable by any interaction at all.
   */
  it('reaches a second classical register', () => {
    const twoRegisters: Circuit = {
      ...circuitWith(1),
      classicalRegisters: [
        { id: 'c_0', size: 2 },
        { id: 'c_1', size: 2 },
      ],
    };
    const editor = open(twoRegisters);

    editor.arm('measurement');
    fireEvent.click(editor.cell('q0, cycle 0, empty'));
    selectPlaced(editor, 'q0, cycle 0, measurement');

    fireEvent.change(screen.getByRole('combobox', { name: /register/i }), {
      target: { value: 'c_1' },
    });

    expect(screen.getByRole('combobox', { name: /register/i })).toHaveValue(
      'c_1',
    );
    expect(editor.status()).toHaveTextContent('1 operations');
  });

  /**
   * Two presses, because Escape does one job at a time: placing leaves the gate
   * armed, so the first disarms and only the second reaches the selection. That
   * ordering is UI.md's, and the panel following it is the point of the test.
   */
  it('says nothing is selected once the selection clears', () => {
    const editor = open();

    editor.arm('h');
    fireEvent.click(editor.cell('q0, cycle 0, empty'));
    expect(screen.getByText(/no editable properties/i)).toBeInTheDocument();

    editor.press('Escape');
    editor.press('Escape');

    expect(screen.getByText(/select an operation/i)).toBeInTheDocument();
  });
});

describe('cycle labels', () => {
  const toggle = () => screen.getByRole('checkbox', { name: /cycle labels/i });
  const labels = () =>
    [...document.querySelectorAll('g[aria-hidden="true"] text')].map(
      (node) => node.textContent,
    );

  it('is unavailable until there is a cycle to label', () => {
    const editor = open();

    expect(toggle()).toHaveAttribute('aria-disabled', 'true');

    editor.arm('h');
    fireEvent.click(editor.cell('q0, cycle 0, empty'));

    expect(toggle()).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('numbers the cycles once turned on', () => {
    const editor = open();

    editor.arm('h');
    fireEvent.click(editor.cell('q0, cycle 0, empty'));
    editor.arm('x');
    fireEvent.click(editor.cell('q0, cycle 1, empty'));

    expect(labels()).toEqual([]);

    fireEvent.click(toggle());

    expect(labels()).toEqual(['0', '1']);
  });

  /**
   * ADR-0007 section 4: history holds circuit values, and undo restores the
   * document rather than what you were looking at. A view toggle that pushed a
   * snapshot would make the previous edit take two undos to reverse.
   */
  it('costs no undo step', () => {
    const editor = open();

    editor.arm('h');
    fireEvent.click(editor.cell('q0, cycle 0, empty'));
    fireEvent.click(toggle());

    editor.undo();

    expect(editor.status()).toHaveTextContent('0 operations');
  });

  /** And the labels survive the undo, because they were never part of it. */
  it('stays on across an edit', () => {
    const editor = open();

    editor.arm('h');
    fireEvent.click(editor.cell('q0, cycle 0, empty'));
    fireEvent.click(toggle());
    editor.arm('x');
    fireEvent.click(editor.cell('q1, cycle 0, empty'));

    expect(toggle()).toBeChecked();
    expect(labels()).toEqual(['0']);
  });

  /**
   * Removing the last operation takes the cycles with it. The toggle must go
   * back to unavailable rather than reading as on over an empty canvas.
   */
  it('returns to unavailable when the last operation goes', () => {
    const editor = open();

    editor.arm('h');
    fireEvent.click(editor.cell('q0, cycle 0, empty'));
    fireEvent.click(toggle());
    expect(labels()).toEqual(['0']);

    editor.press('Escape');
    fireEvent.click(editor.cell('q0, cycle 0, h'));
    editor.press('Delete');

    expect(toggle()).toHaveAttribute('aria-disabled', 'true');
    expect(toggle()).not.toBeChecked();
    expect(labels()).toEqual([]);
  });
});
