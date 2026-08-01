import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { deriveCycles } from '../cycles';
import type { Circuit } from '../model/circuit';
import { insertOperation } from '../state/edits';
import { barrier, circuitWith, gate, measurement } from '../state/testCircuits';
import { validateCircuit } from '../validation';
import { CircuitCanvas, type CircuitCanvasProps } from './CircuitCanvas';
import { createDemoCircuit } from './demoCircuit';
import { targetGlyph } from './glyphs';
import { columnCenter, layoutCircuit, pendingConnector } from './layout';
import { describeCells } from './placement';

function draw(circuit: Circuit, overrides: Partial<CircuitCanvasProps> = {}) {
  const decomposition = deriveCycles(circuit);
  const layout = layoutCircuit(circuit, decomposition);
  const props: CircuitCanvasProps = {
    layout,
    cells: describeCells(
      circuit,
      decomposition,
      layout.wires.map((wire) => wire.qubitId),
      layout.columnCount,
    ),
    cursor: { row: 0, column: 0 },
    selection: null,
    armed: null,
    pending: null,
    dragging: null,
    settle: null,
    onCursorChange: vi.fn(),
    onActivate: vi.fn(),
    onSelectOperation: vi.fn(),
    onRemoveSelection: vi.fn(),
    onCancel: vi.fn(),
    onPickUp: vi.fn(),
    onDropDrag: vi.fn(),
    onNudgeSelection: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onCycleBarriers: vi.fn(),
    ...overrides,
  };

  return { ...render(<CircuitCanvas {...props} />), props, layout };
}

describe('rendering', () => {
  it('draws one wire per qubit, labelled', () => {
    draw(circuitWith(3));

    for (const label of ['q0', 'q1', 'q2']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('draws a gate carrying its name as text, not only colour', () => {
    draw(insertOperation(circuitWith(1), gate('op_0', 'h', ['q_0']), 0));

    expect(screen.getByText('h')).toBeInTheDocument();
  });

  /**
   * A box means exactly one thing: a single-qubit gate. That rule is what stops
   * an unrelated gate sharing a column from reading as part of a multi-qubit
   * operation, and it only holds if multi-qubit targets are never boxed.
   */
  describe('conventional notation', () => {
    const glyphOf = (container: HTMLElement, id: string): string | null =>
      container
        .querySelector(`[data-operation-id="${id}"] [data-glyph]`)
        ?.getAttribute('data-glyph') ?? null;

    it('boxes a single-qubit gate', () => {
      const { container } = draw(
        insertOperation(circuitWith(1), gate('op_0', 'h', ['q_0']), 0),
      );

      expect(glyphOf(container, 'op_0')).toBe('box');
    });

    it('draws a cx target as a crossed circle', () => {
      const { container } = draw(
        insertOperation(
          circuitWith(2),
          gate('op_0', 'cx', ['q_1'], ['q_0']),
          0,
        ),
      );

      expect(glyphOf(container, 'op_0')).toBe('crossed-circle');
    });

    /**
     * The connector terminates at the anchor centre, so borrowing it for the
     * vertical bar drew only the upper half of the cross. Both strokes are the
     * glyph's own.
     */
    it('draws the full cross, not the half the connector would reach', () => {
      const { container } = draw(
        insertOperation(
          circuitWith(2),
          gate('op_0', 'cx', ['q_1'], ['q_0']),
          0,
        ),
      );

      const circle = container.querySelector(
        '[data-glyph="crossed-circle"] circle',
      );
      const strokes = [
        ...container.querySelectorAll('[data-glyph="crossed-circle"] line'),
      ];
      const centre = Number(circle?.getAttribute('cy'));
      const radius = Number(circle?.getAttribute('r'));

      expect(strokes).toHaveLength(2);

      const vertical = strokes.find(
        (line) => line.getAttribute('x1') === line.getAttribute('x2'),
      );
      expect(Number(vertical?.getAttribute('y1'))).toBeCloseTo(centre - radius);
      expect(Number(vertical?.getAttribute('y2'))).toBeCloseTo(centre + radius);
    });

    it('draws a cz target as a dot, matching its control', () => {
      const { container } = draw(
        insertOperation(
          circuitWith(2),
          gate('op_0', 'cz', ['q_1'], ['q_0']),
          0,
        ),
      );

      expect(glyphOf(container, 'op_0')).toBe('dot');
    });

    it('draws both ends of a swap as crosses', () => {
      const { container } = draw(
        insertOperation(
          circuitWith(2),
          gate('op_0', 'swap', ['q_0', 'q_1']),
          0,
        ),
      );

      expect(
        container.querySelectorAll(
          '[data-operation-id="op_0"] [data-glyph="swap"]',
        ),
      ).toHaveLength(2);
    });

    it('boxes a controlled gate with no symbol of its own', () => {
      const { container } = draw(
        insertOperation(
          circuitWith(2),
          gate('op_0', 'cy', ['q_1'], ['q_0']),
          0,
        ),
      );

      expect(glyphOf(container, 'op_0')).toBe('box');
      expect(screen.getByText('Y')).toBeInTheDocument();
    });

    it('never boxes a multi-qubit target', () => {
      for (const name of ['cx', 'cz', 'swap', 'ccx'] as const) {
        expect(targetGlyph(name).kind).not.toBe('box');
      }
    });
  });

  it('draws a barrier as a dashed rule', () => {
    const { container } = draw(
      insertOperation(circuitWith(2), barrier('op_0', ['q_0', 'q_1']), 0),
    );

    const line = container
      .querySelector('[data-operation-id="op_0"]')
      ?.querySelector('line');

    expect(line?.getAttribute('stroke-dasharray')).toBe('4 4');
  });

  it('draws a control dot for every control', () => {
    const { container } = draw(
      insertOperation(
        circuitWith(3),
        gate('op_0', 'ccx', ['q_2'], ['q_0', 'q_1']),
        0,
      ),
    );

    expect(
      container.querySelectorAll('[data-operation-lines="op_0"] circle'),
    ).toHaveLength(2);
  });

  /**
   * A gate spanning q0 to q2 packs into the same cycle as an unrelated gate on
   * q1, because the intervening wire is not one of its resources. Whichever drew
   * last would cross the other, so connectors are a layer beneath every glyph
   * rather than being ordered per operation.
   */
  it('draws every connector beneath every glyph', () => {
    const spanning = insertOperation(
      circuitWith(3),
      gate('op_0', 'cz', ['q_2'], ['q_0']),
      0,
    );
    const { container } = draw(
      insertOperation(spanning, gate('op_1', 'h', ['q_1']), 1),
    );

    const nodes = [
      ...container.querySelectorAll(
        '[data-operation-lines], [data-operation-id]',
      ),
    ];
    const isLines = (node: Element): boolean =>
      node.hasAttribute('data-operation-lines');

    const lastLines = nodes.reduce(
      (last, node, index) => (isLines(node) ? index : last),
      -1,
    );
    const firstGlyph = nodes.findIndex((node) => !isLines(node));

    expect(lastLines).toBeGreaterThanOrEqual(0);
    expect(firstGlyph).toBeGreaterThanOrEqual(0);
    expect(lastLines).toBeLessThan(firstGlyph);
  });

  it('places both operations in the same column when they do not contend', () => {
    const spanning = insertOperation(
      circuitWith(3),
      gate('op_0', 'cz', ['q_2'], ['q_0']),
      0,
    );
    const circuit = insertOperation(spanning, gate('op_1', 'h', ['q_1']), 1);
    const { layout } = draw(circuit);

    expect(layout.operations[0]?.x).toBe(layout.operations[1]?.x);
    expect(layout.depth).toBe(1);
  });

  it('renders an empty circuit without failing', () => {
    const { container } = draw(circuitWith(0, 1));

    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('renders a measurement and its bit index', () => {
    draw(
      insertOperation(circuitWith(1), measurement('op_0', 'q_0', 'c_0', 1), 0),
    );

    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('marks the selected operation', () => {
    const { container } = draw(
      insertOperation(circuitWith(1), gate('op_0', 'h', ['q_0']), 0),
      { selection: 'op_0' },
    );

    expect(
      container
        .querySelector('[data-operation-id="op_0"]')
        ?.getAttribute('data-selected'),
    ).toBe('true');
  });

  it('previews the armed gate at the cursor', () => {
    draw(circuitWith(2), { armed: 'h', cursor: { row: 1, column: 0 } });

    expect(screen.getByTestId('placement-preview')).toBeInTheDocument();
  });

  it('shows no preview when nothing is armed', () => {
    draw(circuitWith(2));

    expect(screen.queryByTestId('placement-preview')).toBeNull();
  });
});

/**
 * A gate part-way through having its wires assigned.
 *
 * The rule this section protects is the notation's: a box means exactly one
 * thing, a single-qubit gate. A preview that drew every armed gate as a labelled
 * box would promise a `cx` a shape it is not about to get, and would teach the
 * wrong thing in the one place the editor is explaining itself.
 */
describe('a pending multi-qubit placement', () => {
  /** Assigned wires resolved to geometry, as CircuitEditor hands them over. */
  function pendingOver(
    layout: ReturnType<typeof layoutCircuit>,
    name: 'cx' | 'swap' | 'ccx',
    assigned: readonly (readonly [string, 'target' | 'control'])[],
    nextRole: 'target' | 'control' | null,
  ) {
    return {
      name,
      x: columnCenter(0, layout.metrics),
      anchors: assigned.flatMap(([qubitId, role]) => {
        const wire = layout.wires.find((w) => w.qubitId === qubitId);
        return wire === undefined ? [] : [{ qubitId, role, y: wire.y }];
      }),
      connector: [],
      nextRole,
    };
  }

  it('previews a cx as its own glyph rather than a labelled box', () => {
    const { container } = draw(circuitWith(2), {
      armed: 'cx',
      cursor: { row: 0, column: 0 },
    });

    const preview = screen.getByTestId('placement-preview');

    expect(
      preview.querySelector('[data-glyph]')?.getAttribute('data-glyph'),
    ).toBe(targetGlyph('cx').kind);
    expect(
      container.querySelector('[data-testid="placement-preview"] text'),
    ).toBeNull();
  });

  it('previews the next wire as a control once the target is assigned', () => {
    const { layout } = draw(circuitWith(2), {
      armed: 'cx',
      cursor: { row: 1, column: 0 },
      pending: pendingOver(
        layoutCircuit(circuitWith(2), deriveCycles(circuitWith(2))),
        'cx',
        [['q_0', 'target']],
        'control',
      ),
    });

    expect(screen.getByTestId('placement-preview')).toHaveAttribute(
      'data-role',
      'control',
    );
    expect(layout.wires).toHaveLength(2);
  });

  it('draws the wires assigned so far, controls as solid dots', () => {
    const circuit = circuitWith(3);
    const layout = layoutCircuit(circuit, deriveCycles(circuit));

    const { container } = draw(circuit, {
      armed: 'ccx',
      pending: pendingOver(
        layout,
        'ccx',
        [
          ['q_0', 'target'],
          ['q_2', 'control'],
        ],
        'control',
      ),
    });

    const placement = container.querySelector(
      '[data-testid="pending-placement"]',
    );

    expect(placement?.querySelectorAll('[data-glyph="control"]')).toHaveLength(
      1,
    );
    expect(
      placement?.querySelector('[data-glyph="crossed-circle"]'),
    ).not.toBeNull();
  });

  /**
   * The connector breaks where it crosses a wire the operation does not name,
   * mid-placement as much as after it. Assigning the wrong control is the
   * mistake this sequence exists to make visible, and a line drawn straight
   * through q1 would say the gate acts on it.
   */
  it('breaks its connector over a wire it does not name', () => {
    const circuit = circuitWith(3);
    const layout = layoutCircuit(circuit, deriveCycles(circuit));
    const anchors = [
      { qubitId: 'q_0', role: 'target' as const, y: layout.wires[0]?.y ?? 0 },
      { qubitId: 'q_2', role: 'control' as const, y: layout.wires[2]?.y ?? 0 },
    ];

    expect(pendingConnector(anchors, layout)).toHaveLength(2);
  });

  it('runs unbroken where it crosses nothing', () => {
    const circuit = circuitWith(2);
    const layout = layoutCircuit(circuit, deriveCycles(circuit));
    const anchors = [
      { qubitId: 'q_0', role: 'target' as const, y: layout.wires[0]?.y ?? 0 },
      { qubitId: 'q_1', role: 'control' as const, y: layout.wires[1]?.y ?? 0 },
    ];

    expect(pendingConnector(anchors, layout)).toHaveLength(1);
  });

  it('draws nothing when no placement is pending', () => {
    const { container } = draw(circuitWith(2));

    expect(
      container.querySelector('[data-testid="pending-placement"]'),
    ).toBeNull();
  });
});

/**
 * The one animation in the editor that explains something. Placement packs a
 * gate left of where it was dropped, which is correct and would otherwise look
 * like a bug: position is a consequence of data dependencies, not a coordinate
 * the user chose.
 */
describe('the settle animation', () => {
  const circuit = insertOperation(
    circuitWith(1),
    gate('op_0', 'h', ['q_0']),
    0,
  );

  it('slides an operation from the column it was requested in', () => {
    const { container, layout } = draw(circuit, {
      settle: { operationId: 'op_0', fromColumn: 4, nonce: 1 },
    });

    const settling = container.querySelector('.settling');
    const from = settling?.getAttribute('style') ?? '';
    const distance =
      columnCenter(4, layout.metrics) - (layout.operations[0]?.x ?? 0);

    expect(settling).not.toBeNull();
    expect(from).toContain(`${String(distance)}px`);
  });

  it('animates the connector with the glyph, not just the box', () => {
    const spanning = insertOperation(
      circuitWith(2),
      gate('op_0', 'cx', ['q_1'], ['q_0']),
      0,
    );
    const { container } = draw(spanning, {
      settle: { operationId: 'op_0', fromColumn: 3, nonce: 1 },
    });

    expect(container.querySelectorAll('.settling')).toHaveLength(2);
  });

  /** Animating a move of no distance would flash for no reason. */
  it('does not animate when the derivation agreed with the request', () => {
    const { container } = draw(circuit, {
      settle: { operationId: 'op_0', fromColumn: 0, nonce: 1 },
    });

    expect(container.querySelector('.settling')).toBeNull();
  });

  it('animates nothing when no settle is pending', () => {
    const { container } = draw(circuit);

    expect(container.querySelector('.settling')).toBeNull();
  });

  it('leaves other operations alone', () => {
    const two = insertOperation(
      insertOperation(circuitWith(2), gate('op_0', 'h', ['q_0']), 0),
      gate('op_1', 'x', ['q_1']),
      1,
    );
    const { container } = draw(two, {
      settle: { operationId: 'op_0', fromColumn: 4, nonce: 1 },
    });

    // Only op_0's two layers, not op_1's.
    expect(container.querySelectorAll('.settling')).toHaveLength(2);
  });
});

describe('drag and nudge', () => {
  const circuit = insertOperation(
    circuitWith(2),
    gate('op_0', 'h', ['q_0']),
    0,
  );

  /**
   * Dispatched on the cell, because that is what a browser hits. The cells are a
   * transparent layer over the whole canvas, so a press aimed at a gate lands on
   * the cell above it -- a test that dispatched on the glyph would exercise a
   * path the browser can never reach.
   */
  it('picks up from the cell under the pointer', () => {
    const { props } = draw(circuit);

    fireEvent.pointerDown(
      screen.getByRole('gridcell', { name: 'q0, column 1, h' }),
    );

    expect(props.onPickUp).toHaveBeenCalledWith('op_0');
  });

  it('picks up nothing from an empty cell', () => {
    const { props } = draw(circuit);

    fireEvent.pointerDown(
      screen.getByRole('gridcell', { name: 'q1, column 1, empty' }),
    );

    expect(props.onPickUp).not.toHaveBeenCalled();
  });

  /**
   * A barrier is in no cell -- it sits on the boundary between columns and
   * appears in no cycle -- so the cell layer can never hand one back. Its hit
   * target is the only surface that knows where it is.
   */
  it('picks up a barrier from its rule, which no cell can offer', () => {
    const { container, props } = draw(
      insertOperation(circuitWith(2), barrier('op_1', ['q_0', 'q_1']), 0),
    );

    const line = container
      .querySelector('[data-barrier-hit="op_1"]')
      ?.querySelector('line');
    if (line != null) fireEvent.pointerDown(line);

    expect(props.onPickUp).toHaveBeenCalledWith('op_1');
  });

  it('ends the drag on pointer up', () => {
    const { props } = draw(circuit);

    fireEvent.pointerUp(screen.getByRole('grid'));

    expect(props.onDropDrag).toHaveBeenCalled();
  });

  it('nudges the selection with Ctrl and an arrow', () => {
    const { props } = draw(circuit, { selection: 'op_0' });

    fireEvent.keyDown(screen.getByRole('grid'), {
      key: 'ArrowDown',
      ctrlKey: true,
    });

    expect(props.onNudgeSelection).toHaveBeenCalledWith(1, 0);
    expect(props.onCursorChange).not.toHaveBeenCalled();
  });

  it('cycles barriers with b, and backwards with Shift', () => {
    const { props } = draw(circuit);
    const grid = screen.getByRole('grid');

    fireEvent.keyDown(grid, { key: 'b' });
    fireEvent.keyDown(grid, { key: 'B', shiftKey: true });

    expect(props.onCycleBarriers).toHaveBeenNthCalledWith(1, 1);
    expect(props.onCycleBarriers).toHaveBeenNthCalledWith(2, -1);
  });

  it('leaves Ctrl+B alone, which browsers use', () => {
    const { props } = draw(circuit);

    fireEvent.keyDown(screen.getByRole('grid'), { key: 'b', ctrlKey: true });

    expect(props.onCycleBarriers).not.toHaveBeenCalled();
  });

  it('undoes and redoes from the keyboard', () => {
    const { props } = draw(circuit);
    const grid = screen.getByRole('grid');

    fireEvent.keyDown(grid, { key: 'z', ctrlKey: true });
    fireEvent.keyDown(grid, { key: 'z', ctrlKey: true, shiftKey: true });

    expect(props.onUndo).toHaveBeenCalled();
    expect(props.onRedo).toHaveBeenCalled();
  });
});

describe('grid semantics', () => {
  it('exposes a row per qubit and a cell per position', () => {
    const circuit = insertOperation(
      circuitWith(2),
      gate('op_0', 'h', ['q_0']),
      0,
    );
    draw(circuit);

    expect(screen.getAllByRole('row')).toHaveLength(2);
    // depth 1, plus the empty column past the end
    expect(screen.getAllByRole('gridcell')).toHaveLength(4);
  });

  it('names each cell by wire, column, and contents', () => {
    draw(insertOperation(circuitWith(1), gate('op_0', 'h', ['q_0']), 0));

    expect(
      screen.getByRole('gridcell', { name: 'q0, column 1, h' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('gridcell', { name: 'q0, column 2, empty' }),
    ).toBeInTheDocument();
  });

  it("names a control cell as the gate's control", () => {
    draw(
      insertOperation(circuitWith(2), gate('op_0', 'cx', ['q_1'], ['q_0']), 0),
    );

    expect(
      screen.getByRole('gridcell', { name: 'q0, column 1, cx control' }),
    ).toBeInTheDocument();
  });

  /**
   * One tab stop, not one per cell. A forty-gate circuit must not put forty stops
   * in the tab order, which is why the cursor moves by aria-activedescendant.
   */
  it('is a single focusable element addressing the active cell', () => {
    const circuit = insertOperation(
      circuitWith(3),
      gate('op_0', 'h', ['q_0']),
      0,
    );
    draw(circuit, { cursor: { row: 2, column: 1 } });
    const grid = screen.getByRole('grid');

    expect(grid).toHaveAttribute('tabindex', '0');
    expect(grid).toHaveAttribute('aria-activedescendant', 'cell-2-1');
    expect(
      screen.getByRole('gridcell', { name: 'q2, column 2, empty' }),
    ).toHaveAttribute('id', 'cell-2-1');
  });

  /**
   * Removing an operation shrinks columnCount, so a cursor parked past the end
   * would name a cell that no longer exists -- and assistive technology has
   * nothing to announce for a dangling activedescendant.
   */
  it('clamps a cursor pointing past the end of the grid', () => {
    draw(circuitWith(2), { cursor: { row: 9, column: 9 } });

    expect(screen.getByRole('grid')).toHaveAttribute(
      'aria-activedescendant',
      'cell-1-0',
    );
    expect(
      screen.getByRole('gridcell', { name: 'q1, column 1, empty' }),
    ).toHaveAttribute('id', 'cell-1-0');
  });

  it('describes the circuit as a whole', () => {
    draw(
      insertOperation(
        insertOperation(circuitWith(2), gate('op_0', 'h', ['q_0']), 0),
        gate('op_1', 'cx', ['q_1'], ['q_0']),
        1,
      ),
    );

    expect(screen.getByRole('grid')).toHaveAccessibleName(
      'Quantum circuit with 2 qubits, 1 classical register, 2 operations, 0 barriers, depth 2',
    );
  });
});

describe('keyboard', () => {
  const press = (key: string): void => {
    fireEvent.keyDown(screen.getByRole('grid'), { key });
  };

  it('moves the cursor with the arrow keys', () => {
    const { props } = draw(circuitWith(3));

    press('ArrowDown');

    expect(props.onCursorChange).toHaveBeenCalledWith({ row: 1, column: 0 });
  });

  it('clamps at the edges rather than wrapping', () => {
    const { props } = draw(circuitWith(2));

    press('ArrowUp');
    press('ArrowLeft');

    expect(props.onCursorChange).toHaveBeenNthCalledWith(1, {
      row: 0,
      column: 0,
    });
    expect(props.onCursorChange).toHaveBeenNthCalledWith(2, {
      row: 0,
      column: 0,
    });
  });

  it('jumps to the last column with End', () => {
    const circuit = insertOperation(
      circuitWith(1),
      gate('op_0', 'h', ['q_0']),
      0,
    );
    const { props, layout } = draw(circuit);

    press('End');

    expect(props.onCursorChange).toHaveBeenCalledWith({
      row: 0,
      column: layout.columnCount - 1,
    });
  });

  it('activates the cursor cell with Enter', () => {
    const { props } = draw(circuitWith(2), { cursor: { row: 1, column: 0 } });

    press('Enter');

    expect(props.onActivate).toHaveBeenCalledWith({ row: 1, column: 0 });
  });

  it('removes the selection with Delete', () => {
    const { props } = draw(circuitWith(1));

    press('Delete');

    expect(props.onRemoveSelection).toHaveBeenCalled();
  });

  it('cancels with Escape', () => {
    const { props } = draw(circuitWith(1));

    press('Escape');

    expect(props.onCancel).toHaveBeenCalled();
  });
});

describe('pointer', () => {
  it('activates the cell that was clicked', () => {
    const { props } = draw(circuitWith(2));

    fireEvent.click(
      screen.getByRole('gridcell', { name: 'q1, column 1, empty' }),
    );

    expect(props.onCursorChange).toHaveBeenCalledWith({ row: 1, column: 0 });
    expect(props.onActivate).toHaveBeenCalledWith({ row: 1, column: 0 });
  });

  /**
   * The cell layer is transparent rectangles covering the canvas, so anything
   * clickable drawn underneath it is unreachable. The barrier's hit target sits
   * above the cells for that reason, and is wide because a 2px dashed rule is not
   * a click target.
   */
  it('selects a barrier by clicking its rule', () => {
    const { container, props } = draw(
      insertOperation(circuitWith(2), barrier('op_0', ['q_0', 'q_1']), 0),
    );

    const line = container
      .querySelector('[data-barrier-hit="op_0"]')
      ?.querySelector('line');
    if (line != null) fireEvent.click(line);

    expect(props.onSelectOperation).toHaveBeenCalledWith('op_0');
  });

  it('moves the cursor on hover, so the preview follows the mouse', () => {
    const { props } = draw(circuitWith(2), { armed: 'h' });

    fireEvent.pointerEnter(
      screen.getByRole('gridcell', { name: 'q1, column 1, empty' }),
    );

    expect(props.onCursorChange).toHaveBeenCalledWith({ row: 1, column: 0 });
  });
});

describe('removing by mouse', () => {
  it('offers a remove button on the selected gate', () => {
    const { props } = draw(
      insertOperation(circuitWith(1), gate('op_0', 'h', ['q_0']), 0),
      { selection: 'op_0' },
    );

    fireEvent.click(screen.getByTestId('remove-affordance'));

    expect(props.onRemoveSelection).toHaveBeenCalled();
  });

  it('offers one on a selected barrier too', () => {
    draw(insertOperation(circuitWith(2), barrier('op_0', ['q_0', 'q_1']), 0), {
      selection: 'op_0',
    });

    expect(screen.getByTestId('remove-affordance')).toBeInTheDocument();
  });

  it('shows none when nothing is selected', () => {
    draw(insertOperation(circuitWith(1), gate('op_0', 'h', ['q_0']), 0));

    expect(screen.queryByTestId('remove-affordance')).toBeNull();
  });

  /** Delete already covers the keyboard; a second control would add a tab stop. */
  it('is hidden from assistive technology as a redundant path', () => {
    draw(insertOperation(circuitWith(1), gate('op_0', 'h', ['q_0']), 0), {
      selection: 'op_0',
    });

    expect(screen.getByTestId('remove-affordance')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });

  /** A drag is an accelerator over the same armed state, not a second path. */
  it('places on drop, through the same activation as a click', () => {
    const { props } = draw(circuitWith(2), { armed: 'h' });
    const cell = screen.getByRole('gridcell', { name: 'q1, column 1, empty' });

    fireEvent.dragOver(cell);
    fireEvent.drop(cell);

    expect(props.onActivate).toHaveBeenCalledWith({ row: 1, column: 0 });
  });
});

describe('the demo circuit', () => {
  it('is valid', () => {
    expect(validateCircuit(createDemoCircuit()).codes).toEqual([]);
  });

  it('draws every one of its operations', () => {
    const circuit = createDemoCircuit();
    const { container } = draw(circuit);

    expect(container.querySelectorAll('[data-operation-id]')).toHaveLength(
      circuit.operations.length,
    );
  });

  it('exercises a connector crossing an uninvolved wire', () => {
    const circuit = createDemoCircuit();
    const spanning = layoutCircuit(
      circuit,
      deriveCycles(circuit),
    ).operations.find((operation) => operation.operationId === 'op_3');

    expect(spanning?.connector).toHaveLength(2);
  });
});
