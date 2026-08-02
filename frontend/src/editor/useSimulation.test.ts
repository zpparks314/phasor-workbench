import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSimulation } from './useSimulation';
import { circuitWith, gate, measurement } from '../state/testCircuits';
import { insertOperation } from '../state/edits';
import { ApiError } from '../api/client';

const simulateStatevector = vi.hoisted(() => vi.fn());
const sampleCircuit = vi.hoisted(() => vi.fn());
vi.mock('../api/simulation', () => ({
  simulateStatevector,
  sampleCircuit,
  DEFAULT_SHOTS: 1024,
}));

const EMPTY = circuitWith(1);

const STATE = {
  qubitCount: 1,
  amplitudes: [{ basisState: '0', real: 1, imaginary: 0 }],
  probabilities: [{ basisState: '0', probability: 1 }],
};

const COUNTS = {
  shots: 1024,
  seed: null,
  counts: { '0': 1024 },
  probabilities: { '0': 1 },
};

beforeEach(() => {
  vi.useFakeTimers();
  simulateStatevector.mockReset().mockResolvedValue(STATE);
  sampleCircuit.mockReset().mockResolvedValue(COUNTS);
});

afterEach(() => {
  vi.useRealTimers();
});

/** Fire the debounce, then let the mocked promise settle. */
async function settle(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(300);
    await Promise.resolve();
  });
}

const measured = (): ReturnType<typeof circuitWith> =>
  insertOperation(circuitWith(1), measurement('op_0', 'q_0', 'c_0', 0), 0);

describe('the statevector half', () => {
  it('follows the circuit, debounced', async () => {
    const { result } = renderHook(() => useSimulation(EMPTY));

    expect(simulateStatevector).not.toHaveBeenCalled();
    await settle();

    expect(result.current.statevector).toEqual({
      status: 'ready',
      result: STATE,
    });
  });

  /**
   * Too much state to return is not an error and not the user's fault. Telling
   * them the circuit is invalid would be false.
   */
  it('separates a size limit from an invalid circuit', async () => {
    simulateStatevector.mockRejectedValue(
      new ApiError(
        'LIMIT_EXCEEDED',
        'A 13-qubit state has 8192 amplitudes.',
        413,
      ),
    );
    const { result } = renderHook(() => useSimulation(EMPTY));

    await settle();

    expect(result.current.statevector.status).toBe('tooLarge');
  });

  it("reports an invalid circuit as the circuit's problem", async () => {
    simulateStatevector.mockRejectedValue(
      new ApiError('CIRCUIT_INVALID', 'The circuit is not valid.', 422),
    );
    const { result } = renderHook(() => useSimulation(EMPTY));

    await settle();

    expect(result.current.statevector).toEqual({ status: 'rejected' });
  });

  it('reports an unreachable backend as unavailable', async () => {
    simulateStatevector.mockRejectedValue(
      new ApiError('BACKEND_UNAVAILABLE', 'Could not reach the backend.', 0),
    );
    const { result } = renderHook(() => useSimulation(EMPTY));

    await settle();

    expect(result.current.statevector.status).toBe('unavailable');
  });
});

describe('the sampling half', () => {
  it('does not run on its own', async () => {
    const circuit = measured();
    renderHook(() => useSimulation(circuit));

    await settle();

    expect(sampleCircuit).not.toHaveBeenCalled();
  });

  it('runs when asked, and reports the counts', async () => {
    const circuit = measured();
    const { result } = renderHook(() => useSimulation(circuit));
    await settle();

    await act(async () => {
      result.current.runSample();
      await Promise.resolve();
    });

    expect(sampleCircuit).toHaveBeenCalledTimes(1);
    expect(result.current.sample).toEqual({ status: 'ready', result: COUNTS });
  });

  it('reports a failed run without losing the state', async () => {
    sampleCircuit.mockRejectedValue(
      new ApiError('CIRCUIT_INVALID', 'Sampling needs a measurement.', 422),
    );
    const circuit = measured();
    const { result } = renderHook(() => useSimulation(circuit));
    await settle();

    await act(async () => {
      result.current.runSample();
      await Promise.resolve();
    });

    expect(result.current.sample.status).toBe('failed');
    expect(result.current.statevector.status).toBe('ready');
  });

  /**
   * The part most likely to be got wrong. Counts from the previous circuit
   * shown beside a statevector from the current one is a comparison of two
   * different circuits presented as theory against experiment --
   * stale-but-plausible, which is worse than absent because nothing about it
   * looks wrong.
   */
  it('discards the sample when the circuit changes', async () => {
    const first = measured();
    const second = insertOperation(first, gate('op_1', 'h', ['q_0']), 0);

    const { result, rerender } = renderHook(
      ({ circuit }) => useSimulation(circuit),
      { initialProps: { circuit: first } },
    );
    await settle();

    await act(async () => {
      result.current.runSample();
      await Promise.resolve();
    });
    expect(result.current.sample.status).toBe('ready');

    rerender({ circuit: second });

    expect(result.current.sample).toEqual({ status: 'idle' });
  });

  it('keeps the sample while the circuit is unchanged', async () => {
    const circuit = measured();
    const { result, rerender } = renderHook(
      ({ circuit }) => useSimulation(circuit),
      { initialProps: { circuit } },
    );
    await settle();

    await act(async () => {
      result.current.runSample();
      await Promise.resolve();
    });

    rerender({ circuit });

    expect(result.current.sample.status).toBe('ready');
  });
});
