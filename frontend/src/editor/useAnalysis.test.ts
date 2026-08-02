import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAnalysis } from './useAnalysis';
import { circuitWith, gate } from '../state/testCircuits';
import { insertOperation } from '../state/edits';
import { ApiError } from '../api/client';

const analyzeCircuit = vi.hoisted(() => vi.fn());
vi.mock('../api/analysis', () => ({ analyzeCircuit }));

const response = {
  qubitCount: 1,
  gateCount: 0,
  measurementCount: 0,
  depth: 0,
  gateBreakdown: {},
};

beforeEach(() => {
  vi.useFakeTimers();
  analyzeCircuit.mockReset();
  analyzeCircuit.mockResolvedValue(response);
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Fire the debounce, then let the mocked promise settle.
 *
 * `waitFor` is deliberately not used: it polls on real timers, which these
 * tests have replaced, so it can only ever time out.
 */
async function settle(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(300);
    await Promise.resolve();
  });
}

describe('useAnalysis', () => {
  it('waits before asking, so a keystroke is not a request', () => {
    renderHook(() => useAnalysis(circuitWith(1)));

    expect(analyzeCircuit).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(analyzeCircuit).toHaveBeenCalledTimes(1);
  });

  /**
   * The reason the debounce exists. Dragging the angle slider produces a new
   * circuit per pointer move; without this, each is a request that is obsolete
   * before it returns.
   */
  it('makes one request for a burst of edits', () => {
    const first = circuitWith(1);
    const second = insertOperation(first, gate('op_0', 'h', ['q_0']), 0);
    const third = insertOperation(second, gate('op_1', 'x', ['q_0']), 1);

    const { rerender } = renderHook(({ circuit }) => useAnalysis(circuit), {
      initialProps: { circuit: first },
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });
    rerender({ circuit: second });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    rerender({ circuit: third });
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(analyzeCircuit).toHaveBeenCalledTimes(1);
    expect(analyzeCircuit.mock.calls[0]?.[0]).toBe(third);
  });

  it('reports the analysis once it arrives', async () => {
    const { result } = renderHook(() => useAnalysis(circuitWith(1)));

    await settle();

    expect(result.current).toEqual({ status: 'ready', analysis: response });
  });

  /**
   * An invalid circuit is the user's to fix and the problems strip already
   * names the reasons, so this is a distinct state from the backend failing.
   */
  it('separates an invalid circuit from an unreachable backend', async () => {
    analyzeCircuit.mockRejectedValue(
      new ApiError('CIRCUIT_INVALID', 'The circuit is not valid.', 422),
    );

    const { result } = renderHook(() => useAnalysis(circuitWith(1)));

    await settle();

    expect(result.current).toEqual({ status: 'rejected' });
  });

  it('reports an unreachable backend as unavailable', async () => {
    analyzeCircuit.mockRejectedValue(
      new ApiError('BACKEND_UNAVAILABLE', 'Could not reach the backend.', 0),
    );

    const { result } = renderHook(() => useAnalysis(circuitWith(1)));

    await settle();

    expect(result.current.status).toBe('unavailable');
  });

  /**
   * Aborting rather than ignoring: a slow answer about an old circuit must not
   * overwrite a fast answer about the current one.
   */
  it('aborts the request in flight when the circuit changes again', () => {
    const first = circuitWith(1);
    const second = insertOperation(first, gate('op_0', 'h', ['q_0']), 0);

    const { rerender } = renderHook(({ circuit }) => useAnalysis(circuit), {
      initialProps: { circuit: first },
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    const signal = analyzeCircuit.mock.calls[0]?.[1] as AbortSignal;
    expect(signal.aborted).toBe(false);

    rerender({ circuit: second });

    expect(signal.aborted).toBe(true);
  });
});
