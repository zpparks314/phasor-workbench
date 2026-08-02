import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AnalysisPanel } from './AnalysisPanel';
import type { AnalysisState } from './useAnalysis';

function show(state: AnalysisState) {
  return render(<AnalysisPanel state={state} />);
}

const ready: AnalysisState = {
  status: 'ready',
  analysis: {
    qubitCount: 2,
    gateCount: 2,
    measurementCount: 2,
    depth: 3,
    gateBreakdown: { h: 1, cx: 1 },
  },
};

describe('AnalysisPanel', () => {
  it('shows the counts and the depth', () => {
    show(ready);

    const panel = screen.getByRole('region', { name: 'Analysis' });
    expect(panel).toHaveTextContent(/Qubits\s*2/);
    expect(panel).toHaveTextContent(/Gates\s*2/);
    expect(panel).toHaveTextContent(/Measurements\s*2/);
    expect(panel).toHaveTextContent(/Depth\s*3/);
  });

  it('lists the gate breakdown', () => {
    show(ready);

    const panel = screen.getByRole('region', { name: 'Analysis' });
    expect(panel).toHaveTextContent(/cx\s*1/);
    expect(panel).toHaveTextContent(/h\s*1/);
  });

  it('omits the breakdown when there are no gates', () => {
    show({
      status: 'ready',
      analysis: {
        qubitCount: 1,
        gateCount: 0,
        measurementCount: 0,
        depth: 0,
        gateBreakdown: {},
      },
    });

    expect(screen.queryByRole('heading', { name: 'Gates' })).toBeNull();
  });

  it('says it is working while the request is out', () => {
    show({ status: 'loading' });

    expect(screen.getByText(/analysing/i)).toBeInTheDocument();
  });

  /**
   * The line Frontend.md draws: an invalid circuit is the user's to fix and the
   * problems strip is already naming the reasons, so this must not restate them
   * -- but it also must not imply the backend broke.
   */
  it('defers to the problems strip when the circuit is at fault', () => {
    show({ status: 'rejected' });

    expect(
      screen.getByText(/while the circuit has problems/i),
    ).toBeInTheDocument();
  });

  /**
   * And the other side of that line: infrastructure failing is never phrased as
   * something the user did.
   */
  it('reports a backend failure without blaming the user', () => {
    show({
      status: 'unavailable',
      message: 'Could not reach the backend. Is it running?',
    });

    expect(
      screen.getByText(/could not reach the backend/i),
    ).toBeInTheDocument();
  });
});
