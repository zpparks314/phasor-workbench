import { describe, expect, it } from 'vitest';

import { deriveCycles } from '../cycles';
import type { Circuit } from '../model/circuit';
import { insertOperation } from '../state/edits';
import { barrier, circuitWith, gate, measurement } from '../state/testCircuits';
import { DEFAULT_METRICS, columnCenter, layoutCircuit } from './layout';

function layoutOf(circuit: Circuit) {
  return layoutCircuit(circuit, deriveCycles(circuit));
}

describe('wires and lanes', () => {
  it('orders wires by qubit index, top to bottom', () => {
    const layout = layoutOf(circuitWith(3));

    expect(layout.wires.map((w) => w.qubitId)).toEqual(['q_0', 'q_1', 'q_2']);
    expect(layout.wires.map((w) => w.y)).toEqual([28 + 28, 28 + 84, 28 + 140]);
  });

  it('falls back to the qubit index for an unlabelled wire', () => {
    expect(layoutOf(circuitWith(2)).wires.map((w) => w.label)).toEqual([
      'q0',
      'q1',
    ]);
  });

  /**
   * Contiguity is a validation rule, not a rendering one. A gap in the indices is
   * reported by validateCircuit; drawing an empty lane for it would imply a wire
   * that does not exist.
   */
  it('does not open an empty lane for a gap in the qubit indices', () => {
    const gapped: Circuit = {
      ...circuitWith(0),
      qubits: [
        { id: 'q_0', index: 0 },
        { id: 'q_5', index: 5 },
      ],
    };

    const [first, second] = layoutOf(gapped).wires;

    expect(second?.y).toBe((first?.y ?? 0) + DEFAULT_METRICS.lane);
  });

  it('places register lanes below the wires, past the gap', () => {
    const layout = layoutOf(circuitWith(2));
    const lastWire = layout.wires.at(-1)?.y ?? 0;

    expect(layout.registers).toHaveLength(1);
    expect(layout.registers[0]?.y).toBeGreaterThan(
      lastWire + DEFAULT_METRICS.registerGap,
    );
  });

  it('reserves a column of width even for an empty circuit', () => {
    const layout = layoutOf(circuitWith(1));

    expect(layout.depth).toBe(0);
    expect(layout.wireEnd).toBeGreaterThan(
      DEFAULT_METRICS.gutter + DEFAULT_METRICS.column,
    );
  });
});

describe('columns come from the derivation', () => {
  it('places independent operations in the same column', () => {
    const circuit = insertOperation(
      insertOperation(circuitWith(2), gate('op_0', 'h', ['q_0']), 0),
      gate('op_1', 'x', ['q_1']),
      1,
    );

    const [first, second] = layoutOf(circuit).operations;

    expect(first?.x).toBe(second?.x);
    expect(first?.x).toBe(columnCenter(0, DEFAULT_METRICS));
  });

  it('advances a dependent operation to the next column', () => {
    const circuit = insertOperation(
      insertOperation(circuitWith(2), gate('op_0', 'h', ['q_0']), 0),
      gate('op_1', 'cx', ['q_1'], ['q_0']),
      1,
    );

    const [first, second] = layoutOf(circuit).operations;

    expect(first?.x).toBe(columnCenter(0, DEFAULT_METRICS));
    expect(second?.x).toBe(columnCenter(1, DEFAULT_METRICS));
  });
});

describe('anchors and connectors', () => {
  it('marks targets and controls distinctly', () => {
    const circuit = insertOperation(
      circuitWith(2),
      gate('op_0', 'cx', ['q_1'], ['q_0']),
      0,
    );

    expect(layoutOf(circuit).operations[0]?.anchors).toEqual([
      { qubitId: 'q_1', role: 'target', y: expect.any(Number) as number },
      { qubitId: 'q_0', role: 'control', y: expect.any(Number) as number },
    ]);
  });

  it('draws no connector for a single-qubit gate', () => {
    const circuit = insertOperation(
      circuitWith(2),
      gate('op_0', 'h', ['q_0']),
      0,
    );

    expect(layoutOf(circuit).operations[0]?.connector).toEqual([]);
  });

  it('joins adjacent wires with one unbroken segment', () => {
    const circuit = insertOperation(
      circuitWith(2),
      gate('op_0', 'cx', ['q_1'], ['q_0']),
      0,
    );

    expect(layoutOf(circuit).operations[0]?.connector).toHaveLength(1);
  });

  /**
   * The case shared/fixtures/decomposition/multi_qubit_spans_idle_wire.json
   * exists for. Only targets and controls are resources in the derivation, so the
   * intervening wire is genuinely untouched and stays free for concurrent
   * operations -- a connector drawn straight through would read as contact.
   */
  it('breaks the connector where it crosses an uninvolved wire', () => {
    const circuit = insertOperation(
      circuitWith(3),
      gate('op_0', 'cx', ['q_2'], ['q_0']),
      0,
    );

    const connector = layoutOf(circuit).operations[0]?.connector ?? [];
    const middle = layoutOf(circuit).wires[1]?.y ?? 0;

    expect(connector).toHaveLength(2);
    expect(connector[0]?.y2).toBe(middle - DEFAULT_METRICS.crossingGap / 2);
    expect(connector[1]?.y1).toBe(middle + DEFAULT_METRICS.crossingGap / 2);
  });

  /**
   * The intervening wire being free is the whole point -- an unrelated gate packs
   * into the same cycle there. Stopping the connector at that glyph's edge makes
   * it look attached, so it stops clear of it instead.
   */
  it('leaves glyph-sized clearance where the crossed wire is occupied', () => {
    const spanning = insertOperation(
      circuitWith(3),
      gate('op_0', 'cz', ['q_2'], ['q_0']),
      0,
    );
    const circuit = insertOperation(spanning, gate('op_1', 'h', ['q_1']), 1);

    const layout = layoutOf(circuit);
    const connector = layout.operations[0]?.connector ?? [];
    const middle = layout.wires[1]?.y ?? 0;

    expect(connector).toHaveLength(2);
    expect(connector[0]?.y2).toBe(middle - DEFAULT_METRICS.glyphClearance / 2);
    expect(connector[1]?.y1).toBe(middle + DEFAULT_METRICS.glyphClearance / 2);
  });

  it('leaves only the small gap where the crossed wire is empty', () => {
    const circuit = insertOperation(
      circuitWith(3),
      gate('op_0', 'cz', ['q_2'], ['q_0']),
      0,
    );

    const layout = layoutOf(circuit);
    const connector = layout.operations[0]?.connector ?? [];
    const middle = layout.wires[1]?.y ?? 0;

    expect(connector[0]?.y2).toBe(middle - DEFAULT_METRICS.crossingGap / 2);
  });

  it('does not break where the crossed wire is a control', () => {
    const circuit = insertOperation(
      circuitWith(3),
      gate('op_0', 'ccx', ['q_2'], ['q_0', 'q_1']),
      0,
    );

    expect(layoutOf(circuit).operations[0]?.connector).toHaveLength(1);
  });
});

describe('measurements', () => {
  const circuit = insertOperation(
    circuitWith(2),
    measurement('op_0', 'q_0', 'c_0', 1),
    0,
  );

  it('runs a connector down to its register lane', () => {
    const layout = layoutOf(circuit);
    const measured = layout.operations[0];

    expect(measured?.kind).toBe('measurement');
    expect(measured?.connector.length).toBeGreaterThan(0);
    if (measured?.kind === 'measurement') {
      expect(measured.registerY).toBe(layout.registers[0]?.y);
      expect(measured.bit).toBe(1);
    }
  });

  it('breaks the connector at the wire it passes', () => {
    expect(layoutOf(circuit).operations[0]?.connector).toHaveLength(2);
  });
});

describe('barriers', () => {
  it('sits on the boundary before its cycle', () => {
    const circuit = insertOperation(
      insertOperation(circuitWith(2), gate('op_0', 'h', ['q_0']), 0),
      barrier('op_1', ['q_0', 'q_1']),
      1,
    );

    expect(layoutOf(circuit).barriers[0]?.x).toBe(
      DEFAULT_METRICS.gutter + 1 * DEFAULT_METRICS.column,
    );
  });

  /**
   * beforeCycle may equal depth. trailing_barrier.json is the fixture; a renderer
   * that special-cased it away would drop a barrier the user placed.
   */
  it('draws a trailing barrier at the edge of the circuit', () => {
    const circuit = insertOperation(
      insertOperation(circuitWith(1), gate('op_0', 'h', ['q_0']), 0),
      barrier('op_1', ['q_0']),
      1,
    );

    const layout = layoutOf(circuit);

    expect(layout.depth).toBe(1);
    expect(layout.barriers[0]?.x).toBe(
      DEFAULT_METRICS.gutter + layout.depth * DEFAULT_METRICS.column,
    );
    expect(layout.barriers[0]?.x).toBeLessThan(layout.width);
  });

  it('spans a contiguous run as one segment', () => {
    const circuit = insertOperation(
      circuitWith(3),
      barrier('op_0', ['q_0', 'q_1', 'q_2']),
      0,
    );

    expect(layoutOf(circuit).barriers[0]?.segments).toHaveLength(1);
  });

  /** A barrier constrains only the qubits it names, so it does not draw through q1. */
  it('splits into separate segments across an uninvolved wire', () => {
    const circuit = insertOperation(
      circuitWith(3),
      barrier('op_0', ['q_0', 'q_2']),
      0,
    );

    expect(layoutOf(circuit).barriers[0]?.segments).toHaveLength(2);
  });
});

/**
 * Edits do not validate (ADR-0007 section 7), so the editor renders invalid
 * intermediate states routinely. Layout must degrade rather than throw.
 */
describe('invalid circuits', () => {
  it('drops an anchor whose qubit does not resolve', () => {
    const circuit = insertOperation(
      circuitWith(2),
      gate('op_0', 'cx', ['q_1'], ['q_ghost']),
      0,
    );

    expect(layoutOf(circuit).operations[0]?.anchors).toEqual([
      { qubitId: 'q_1', role: 'target', y: expect.any(Number) as number },
    ]);
  });

  it('omits an operation with no resolvable anchor at all', () => {
    const circuit = insertOperation(
      circuitWith(1),
      gate('op_0', 'h', ['q_ghost']),
      0,
    );

    expect(layoutOf(circuit).operations).toEqual([]);
  });

  it('does not throw on a measurement naming a register that is gone', () => {
    const circuit = insertOperation(
      circuitWith(1),
      measurement('op_0', 'q_0', 'c_ghost', 0),
      0,
    );

    expect(() => layoutOf(circuit)).not.toThrow();
    expect(layoutOf(circuit).operations[0]?.connector).toEqual([]);
  });
});

describe('purity', () => {
  it('produces identical geometry for the same inputs', () => {
    const circuit = insertOperation(
      circuitWith(3),
      gate('op_0', 'ccx', ['q_2'], ['q_0', 'q_1']),
      0,
    );

    expect(layoutOf(circuit)).toEqual(layoutOf(circuit));
  });

  it('stores nothing between calls', () => {
    const one = layoutOf(circuitWith(1));
    const two = layoutOf(circuitWith(4));

    expect(one.wires).toHaveLength(1);
    expect(two.wires).toHaveLength(4);
  });
});
