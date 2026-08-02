import { describe, expect, it } from 'vitest';

import { mockAnalysis } from './analysis';
import { circuitWith, gate, measurement, barrier } from '../state/testCircuits';
import { insertOperation } from '../state/edits';

/**
 * The mock is computed rather than recorded, because this response is a pure
 * function of the request -- see the note in `analysis.ts`. These assertions
 * are the same ones `backend/tests/test_analysis.py` makes, which is what makes
 * the mock a usable stand-in rather than a fiction.
 */
describe('mockAnalysis', () => {
  it('reports zeroes for an empty circuit', () => {
    expect(mockAnalysis(circuitWith(2))).toEqual({
      qubitCount: 2,
      gateCount: 0,
      measurementCount: 0,
      depth: 0,
      gateBreakdown: {},
    });
  });

  it('counts gates by name and measurements apart from them', () => {
    let circuit = circuitWith(2);
    circuit = insertOperation(circuit, gate('op_0', 'h', ['q_0']), 0);
    circuit = insertOperation(circuit, gate('op_1', 'h', ['q_1']), 1);
    circuit = insertOperation(circuit, gate('op_2', 'cx', ['q_1'], ['q_0']), 2);
    circuit = insertOperation(circuit, measurement('op_3', 'q_0', 'c_0', 0), 3);

    const analysis = mockAnalysis(circuit);

    expect(analysis.gateCount).toBe(3);
    expect(analysis.measurementCount).toBe(1);
    expect(analysis.gateBreakdown).toEqual({ h: 2, cx: 1 });
  });

  /**
   * A barrier is an authoring constraint, not something the circuit does, so
   * the two counts deliberately do not sum to the operation count. Counting it
   * as a gate would inflate the count of every circuit that schedules.
   */
  it('counts a barrier as neither a gate nor a measurement', () => {
    let circuit = circuitWith(2);
    circuit = insertOperation(circuit, gate('op_0', 'h', ['q_0']), 0);
    circuit = insertOperation(circuit, barrier('op_1', ['q_0', 'q_1']), 1);

    const analysis = mockAnalysis(circuit);

    expect(analysis.gateCount).toBe(1);
    expect(analysis.measurementCount).toBe(0);
    expect(circuit.operations).toHaveLength(2);
  });

  /**
   * Depth is `deriveCycles`, not a count -- the same function the canvas uses.
   * Two gates on one wire are two cycles; two on separate wires are one.
   */
  it('takes depth from the derivation rather than the operation count', () => {
    let sequential = circuitWith(2);
    sequential = insertOperation(sequential, gate('op_0', 'h', ['q_0']), 0);
    sequential = insertOperation(sequential, gate('op_1', 'x', ['q_0']), 1);

    let parallel = circuitWith(2);
    parallel = insertOperation(parallel, gate('op_0', 'h', ['q_0']), 0);
    parallel = insertOperation(parallel, gate('op_1', 'x', ['q_1']), 1);

    expect(mockAnalysis(sequential).depth).toBe(2);
    expect(mockAnalysis(parallel).depth).toBe(1);
  });
});
