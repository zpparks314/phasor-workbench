import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { deriveCycles } from '../cycles';
import type { Circuit } from '../model/circuit';
import { insertOperation } from '../state/edits';
import { barrier, circuitWith, gate, measurement } from '../state/testCircuits';
import { validateCircuit } from '../validation';
import { CircuitCanvas, type CircuitCanvasProps } from './CircuitCanvas';
import { targetGlyph } from './glyphs';
import { columnCenter, layoutCircuit, pendingConnector } from './layout';
import { describeCells } from './placement';
import {
  SHORTCUTS,
  resolveShortcut,
  type KeyPress,
  type Shortcut,
} from './shortcuts';

/**
 * The example catalogue never resolves here.
 *
 * These tests are not about examples, and a catalogue that settles mid-test
 * would update state outside `act` -- 97 warnings across this file before the
 * stub. `ExamplePicker.test.tsx` drives the picker directly from props, which
 * is what the presentational split is for.
 */
vi.mock('../api/examples', () => ({
  fetchExamples: () => new Promise(() => undefined),
  fetchExample: () => new Promise(() => undefined),
}));

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
    showCycleLabels: false,
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
    onSave: vi.fn(),
    onShowShortcuts: vi.fn(),
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

  /**
   * UI.md: a circuit with no qubits shows a prompt, never a blank rectangle.
   *
   * This previously asserted only that an SVG rendered without throwing, which
   * was the right check while no qubit could be removed and the state was
   * unreachable. An empty `role="grid"` is worse than blank once it is
   * reachable: `aria-activedescendant` would name a cell that does not exist.
   */
  it('prompts for a first qubit instead of drawing an empty grid', () => {
    const { container } = draw(circuitWith(0, 1));

    expect(screen.getByTestId('empty-canvas')).toHaveTextContent(/no qubits/i);
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.queryByRole('grid')).toBeNull();
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

describe('previewing the non-gate operations', () => {
  it('previews a measurement as the meter it will become', () => {
    draw(circuitWith(2), { armed: 'measurement' });

    expect(
      screen.getByTestId('placement-preview').querySelector('[data-glyph]'),
    ).toHaveAttribute('data-glyph', 'meter');
  });

  /**
   * Full width, because that is what placing one does: a barrier is expanded to
   * every wire at placement time. A preview spanning only the cursor's wire
   * would promise something the commit does not deliver.
   */
  it('previews a barrier across every wire', () => {
    const { layout } = draw(circuitWith(3), {
      armed: 'barrier',
      cursor: { row: 1, column: 0 },
    });

    const preview = screen.getByTestId('barrier-preview');
    const top = layout.wires[0]?.y ?? 0;
    const bottom = layout.wires[2]?.y ?? 0;

    expect(Number(preview.getAttribute('y1'))).toBeLessThan(top);
    expect(Number(preview.getAttribute('y2'))).toBeGreaterThan(bottom);
  });

  /** A barrier sits on the boundary before a column, not centred in it. */
  it('previews a barrier on the boundary, not in the cell', () => {
    const { layout } = draw(circuitWith(2), {
      armed: 'barrier',
      cursor: { row: 0, column: 1 },
    });

    expect(
      Number(screen.getByTestId('barrier-preview').getAttribute('x1')),
    ).toBeLessThan(columnCenter(1, layout.metrics));
  });

  it('shows no gate preview while a barrier is armed', () => {
    draw(circuitWith(2), { armed: 'barrier' });

    expect(screen.queryByTestId('placement-preview')).toBeNull();
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
      screen.getByRole('gridcell', { name: 'q0, cycle 0, h' }),
    );

    expect(props.onPickUp).toHaveBeenCalledWith('op_0');
  });

  it('picks up nothing from an empty cell', () => {
    const { props } = draw(circuit);

    fireEvent.pointerDown(
      screen.getByRole('gridcell', { name: 'q1, cycle 0, empty' }),
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
      screen.getByRole('gridcell', { name: 'q0, cycle 0, h' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('gridcell', { name: 'q0, cycle 1, empty' }),
    ).toBeInTheDocument();
  });

  it("names a control cell as the gate's control", () => {
    draw(
      insertOperation(circuitWith(2), gate('op_0', 'cx', ['q_1'], ['q_0']), 0),
    );

    expect(
      screen.getByRole('gridcell', { name: 'q0, cycle 0, cx control' }),
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
      screen.getByRole('gridcell', { name: 'q2, cycle 1, empty' }),
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
      screen.getByRole('gridcell', { name: 'q1, cycle 0, empty' }),
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

  it('opens the shortcut reference with ?', () => {
    const { props } = draw(circuitWith(1));

    press('?');

    expect(props.onShowShortcuts).toHaveBeenCalled();
  });

  /**
   * A press the table does not claim is left to the browser rather than
   * swallowed, which is what `resolveShortcut` returning `undefined` is for.
   */
  it('leaves a key it does not bind alone', () => {
    const { props } = draw(circuitWith(2));

    press('a');

    for (const value of Object.values(props)) {
      if (vi.isMockFunction(value)) expect(value).not.toHaveBeenCalled();
    }
  });
});

/**
 * Every row of `./shortcuts` reaches a handler on the canvas.
 *
 * This is the half of the Milestone 5 criterion that a `?` panel cannot check
 * for itself. The panel proves the table is *displayed*; this proves the same
 * table is what the editor is *bound to*, so a row cannot describe a key that
 * does nothing. Both read `SHORTCUTS` rather than a list written beside them,
 * which is what makes them guards rather than snapshots.
 *
 * It derives its presses instead of listing them: a shortcut added with a key
 * outside `KEYS` fails here with "no press found", which is a nudge to extend
 * the candidates rather than a silent gap in the coverage.
 */
describe('every shortcut in the table', () => {
  const KEYS = [
    'z',
    'Z',
    's',
    'b',
    'B',
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'Home',
    'End',
    'Enter',
    ' ',
    'Delete',
    'Backspace',
    'Escape',
    '?',
  ];
  const MODIFIERS: Partial<KeyPress>[] = [
    {},
    { shiftKey: true },
    { ctrlKey: true },
    { metaKey: true },
    { ctrlKey: true, shiftKey: true },
  ];

  /** A press this entry claims *and* wins, so firing it exercises this row. */
  function pressFor(shortcut: Shortcut): KeyPress {
    for (const key of KEYS) {
      for (const modifiers of MODIFIERS) {
        const candidate: KeyPress = {
          key,
          ctrlKey: false,
          metaKey: false,
          shiftKey: false,
          ...modifiers,
        };
        const claimed = shortcut.resolve(candidate);
        if (claimed === undefined) continue;
        // An entry shadowed by an earlier one would otherwise be tested through
        // the wrong handler and pass while being unreachable.
        if (
          JSON.stringify(resolveShortcut(candidate)) === JSON.stringify(claimed)
        ) {
          return candidate;
        }
      }
    }
    throw new Error(`no press found for "${shortcut.keys}"`);
  }

  it.each(SHORTCUTS.map((shortcut) => [shortcut.keys, shortcut] as const))(
    'reaches a handler for %s',
    (_keys, shortcut) => {
      // A circuit with an operation, so no entry is a no-op for want of one.
      const circuit = insertOperation(
        circuitWith(2),
        gate('op_0', 'h', ['q_0']),
        0,
      );
      const { props } = draw(circuit, { selection: 'op_0' });
      const { key, ...modifiers } = pressFor(shortcut);

      fireEvent.keyDown(screen.getByRole('grid'), { key, ...modifiers });

      const called = Object.values(props).filter(
        (value) => vi.isMockFunction(value) && value.mock.calls.length > 0,
      );
      expect(called.length).toBeGreaterThan(0);
    },
  );
});

describe('pointer', () => {
  it('activates the cell that was clicked', () => {
    const { props } = draw(circuitWith(2));

    fireEvent.click(
      screen.getByRole('gridcell', { name: 'q1, cycle 0, empty' }),
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
      screen.getByRole('gridcell', { name: 'q1, cycle 0, empty' }),
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
    const cell = screen.getByRole('gridcell', { name: 'q1, cycle 0, empty' });

    fireEvent.dragOver(cell);
    fireEvent.drop(cell);

    expect(props.onActivate).toHaveBeenCalledWith({ row: 1, column: 0 });
  });
});

/**
 * One circuit exercising every glyph kind at once.
 *
 * This was `editor/demoCircuit.ts` until local save gave the editor something
 * real to open on. Its scaffolding job is over; its *testing* job — proving the
 * canvas draws a whole circuit rather than each glyph in isolation — is not, so
 * it lives here now, built from the same helpers as every other fixture.
 */
describe('a circuit using every glyph', () => {
  const everyGlyph = (): Circuit => {
    const operations = [
      gate('op_0', 'h', ['q_0']),
      gate('op_1', 'cx', ['q_1'], ['q_0']),
      // Carries its parameter explicitly: the helper defaults to none, and rx
      // without theta is PARAMETER_MISSING.
      { ...gate('op_2', 'rx', ['q_2']), parameters: { theta: Math.PI / 2 } },
      // Spans an idle wire: the connector must break where it crosses q_1.
      gate('op_3', 'cz', ['q_2'], ['q_0']),
      barrier('op_4', ['q_0', 'q_1', 'q_2']),
      measurement('op_5', 'q_0', 'c_0', 0),
      measurement('op_6', 'q_1', 'c_0', 1),
    ];

    return operations.reduce(
      (circuit, operation, index) => insertOperation(circuit, operation, index),
      circuitWith(3),
    );
  };

  it('is valid', () => {
    expect(validateCircuit(everyGlyph()).codes).toEqual([]);
  });

  it('draws every one of its operations', () => {
    const circuit = everyGlyph();
    const { container } = draw(circuit);

    expect(container.querySelectorAll('[data-operation-id]')).toHaveLength(
      circuit.operations.length,
    );
  });

  it('breaks a connector where it crosses an uninvolved wire', () => {
    const circuit = everyGlyph();
    const spanning = layoutCircuit(
      circuit,
      deriveCycles(circuit),
    ).operations.find((operation) => operation.operationId === 'op_3');

    expect(spanning?.connector).toHaveLength(2);
  });
});

/**
 * The labels are `aria-hidden`, so they are unreachable by role or name and
 * these read the SVG text nodes directly -- which is the honest way to assert
 * something whose entire contract is "visible, and invisible to a reader".
 */
describe('cycle labels', () => {
  function labels(container: HTMLElement): string[] {
    return [...container.querySelectorAll('g[aria-hidden="true"] text')].map(
      (node) => node.textContent,
    );
  }

  function twoCycles(): Circuit {
    return insertOperation(
      insertOperation(circuitWith(2), gate('op_0', 'h', ['q_0']), 0),
      gate('op_1', 'x', ['q_0']),
      1,
    );
  }

  it('draws nothing when the toggle is off', () => {
    const { container } = draw(twoCycles(), { showCycleLabels: false });

    expect(labels(container)).toEqual([]);
  });

  it('numbers the cycles from zero', () => {
    const { container } = draw(twoCycles(), { showCycleLabels: true });

    expect(labels(container)).toEqual(['0', '1']);
  });

  /**
   * The constraint that matters. `columnCount` is `depth + 1` because the
   * canvas offers an empty column past the end to append into -- labelling it
   * would name a cycle the decomposition does not have.
   */
  it('stops at the last real cycle, not the append column', () => {
    const circuit = twoCycles();
    const layout = layoutCircuit(circuit, deriveCycles(circuit));
    const { container } = draw(circuit, { showCycleLabels: true });

    expect(layout.columnCount).toBe(3);
    expect(labels(container)).toHaveLength(2);
  });

  it('draws none for a circuit of bare wires', () => {
    const { container } = draw(circuitWith(2), { showCycleLabels: true });

    expect(labels(container)).toEqual([]);
  });

  /**
   * A barrier occupies no cycle of its own, so it gets no label -- but it can
   * raise depth by levelling an unequal frontier, and the labels must follow
   * the depth that results rather than the operation count.
   */
  it('follows the depth a barrier produces', () => {
    const levelled = insertOperation(
      insertOperation(
        insertOperation(circuitWith(2), gate('op_0', 'h', ['q_0']), 0),
        gate('op_1', 'x', ['q_0']),
        1,
      ),
      barrier('op_b', ['q_0', 'q_1']),
      2,
    );
    const withTrailing = insertOperation(
      levelled,
      gate('op_2', 'y', ['q_1']),
      3,
    );
    const { container } = draw(withTrailing, { showCycleLabels: true });

    expect(deriveCycles(withTrailing).depth).toBe(3);
    expect(labels(container)).toEqual(['0', '1', '2']);
  });

  it('centres each label on its column', () => {
    const circuit = twoCycles();
    const metrics = layoutCircuit(circuit, deriveCycles(circuit)).metrics;
    const { container } = draw(circuit, { showCycleLabels: true });

    const xs = [
      ...container.querySelectorAll('g[aria-hidden="true"] text'),
    ].map((node) => Number(node.getAttribute('x')));

    expect(xs).toEqual([columnCenter(0, metrics), columnCenter(1, metrics)]);
  });
});

/**
 * The band is what attaches a label to its column. A tint rather than an
 * outline, deliberately: a barrier is a dashed vertical rule on a column
 * boundary, and boxing every cycle would put a rule on every boundary.
 */
describe('cycle bands', () => {
  function bands(container: HTMLElement): Element[] {
    return [...container.querySelectorAll('g[aria-hidden="true"] rect')];
  }

  function threeCycles(): Circuit {
    return insertOperation(
      insertOperation(
        insertOperation(circuitWith(2), gate('op_0', 'h', ['q_0']), 0),
        gate('op_1', 'x', ['q_0']),
        1,
      ),
      gate('op_2', 'y', ['q_0']),
      2,
    );
  }

  it('draws none when the toggle is off', () => {
    const { container } = draw(threeCycles(), { showCycleLabels: false });

    expect(bands(container)).toHaveLength(0);
  });

  /** Alternating, so adjacent cycles are told apart by contrast, not by a rule. */
  it('bands every other cycle', () => {
    const { container } = draw(threeCycles(), { showCycleLabels: true });

    expect(bands(container)).toHaveLength(2);
  });

  it('aligns each band with its column', () => {
    const circuit = threeCycles();
    const { metrics } = layoutCircuit(circuit, deriveCycles(circuit));
    const { container } = draw(circuit, { showCycleLabels: true });

    const xs = bands(container).map((node) => Number(node.getAttribute('x')));

    expect(xs).toEqual([
      columnCenter(0, metrics) - metrics.column / 2,
      columnCenter(2, metrics) - metrics.column / 2,
    ]);
    expect(bands(container)[0]?.getAttribute('width')).toBe(
      String(metrics.column),
    );
  });

  /**
   * Behind the circuit, not over it. An SVG paints in document order, so a band
   * emitted after the wires would cover them.
   */
  it('paints behind the wires', () => {
    const { container } = draw(threeCycles(), { showCycleLabels: true });

    // By node identity, not by class: a gate's box carries the same fill token,
    // so matching on the class found gates and called them bands.
    const svg = container.querySelector('svg');
    const all = [...(svg?.querySelectorAll('*') ?? [])];
    const lastBand = Math.max(
      ...bands(container).map((node) => all.indexOf(node)),
    );
    const firstLine = all.findIndex((node) => node.tagName === 'line');

    expect(lastBand).toBeGreaterThanOrEqual(0);
    expect(firstLine).toBeGreaterThanOrEqual(0);
    expect(lastBand).toBeLessThan(firstLine);
  });

  it('uses a surface token rather than a hardcoded colour', () => {
    const { container } = draw(threeCycles(), { showCycleLabels: true });

    for (const band of bands(container)) {
      expect(band.getAttribute('class')).toContain('fill-surface-raised');
      expect(band.getAttribute('fill')).toBeNull();
    }
  });

  it('stops at the last real cycle, like the labels', () => {
    const circuit = insertOperation(
      circuitWith(2),
      gate('op_0', 'h', ['q_0']),
      0,
    );
    const { container } = draw(circuit, { showCycleLabels: true });

    expect(layoutCircuit(circuit, deriveCycles(circuit)).columnCount).toBe(2);
    expect(bands(container)).toHaveLength(1);
  });
});
