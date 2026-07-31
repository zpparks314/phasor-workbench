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
import { layoutCircuit } from './layout';
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
    onCursorChange: vi.fn(),
    onActivate: vi.fn(),
    onSelectOperation: vi.fn(),
    onRemoveSelection: vi.fn(),
    onCancel: vi.fn(),
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
