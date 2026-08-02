import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ResultsPanel, type ResultsPanelProps } from './ResultsPanel';

function show(overrides: Partial<ResultsPanelProps> = {}) {
  const props: ResultsPanelProps = {
    statevector: { status: 'loading' },
    sample: { status: 'idle' },
    onRunSample: vi.fn(),
    samplingUnavailable: undefined,
    ...overrides,
  };

  return { ...render(<ResultsPanel {...props} />), props };
}

const BELL: ResultsPanelProps['statevector'] = {
  status: 'ready',
  result: {
    qubitCount: 2,
    amplitudes: [],
    probabilities: [
      { basisState: '00', probability: 0.5 },
      { basisState: '11', probability: 0.5 },
    ],
  },
};

const SAMPLED: ResultsPanelProps['sample'] = {
  status: 'ready',
  result: {
    shots: 1024,
    seed: null,
    counts: { '00': 528, '11': 496 },
    probabilities: { '00': 0.515625, '11': 0.484375 },
  },
};

const rows = () => screen.getAllByRole('listitem');

describe('showing the state', () => {
  it('lists each outcome with its probability as text', () => {
    show({ statevector: BELL });

    const [first] = rows();
    expect(rows()).toHaveLength(2);
    expect(first).toBeDefined();
    expect(within(first as HTMLElement).getByText('00')).toBeInTheDocument();
    expect(first).toHaveTextContent('50.0%');
  });

  /**
   * UI.md: colour is never the only carrier of meaning, and neither is length.
   * The bars are aria-hidden precisely because the number is already text.
   */
  it('states every number as text, not only as a bar', () => {
    const { container } = show({ statevector: BELL });

    for (const bar of container.querySelectorAll('[aria-hidden="true"]')) {
      expect(bar).toBeInTheDocument();
    }
    expect(rows()[1]).toHaveTextContent('50.0%');
  });

  it('says it is working while the request is out', () => {
    show();

    expect(screen.getByText(/simulating/i)).toBeInTheDocument();
  });

  it('defers to the problems strip when the circuit is at fault', () => {
    show({ statevector: { status: 'rejected' } });

    expect(
      screen.getByText(/while the circuit has problems/i),
    ).toBeInTheDocument();
  });

  /**
   * A size limit is not an error and not the user's fault -- the circuit is
   * fine, there is simply more state than a response can carry.
   */
  it('reports a size limit without calling the circuit invalid', () => {
    show({
      statevector: {
        status: 'tooLarge',
        message: 'A 13-qubit state has 8192 amplitudes.',
      },
    });

    expect(screen.getByText(/8192 amplitudes/)).toBeInTheDocument();
    expect(screen.queryByText(/problems/i)).toBeNull();
  });

  it('reports a backend failure without blaming the user', () => {
    show({
      statevector: {
        status: 'unavailable',
        message: 'Could not reach the backend. Is it running?',
      },
    });

    expect(
      screen.getByText(/could not reach the backend/i),
    ).toBeInTheDocument();
  });
});

describe('comparing exact against sampled', () => {
  it('shows only the exact figure before a run', () => {
    show({ statevector: BELL });

    expect(rows()[0]).toHaveTextContent('50.0%');
    expect(rows()[0]).not.toHaveTextContent('51.6%');
  });

  /** The whole point of one list: shot noise, read directly off the row. */
  it('shows both figures once a sample exists', () => {
    show({ statevector: BELL, sample: SAMPLED });

    expect(rows()[0]).toHaveTextContent('50.0%');
    expect(rows()[0]).toHaveTextContent('51.6%');
  });

  it('reports the shot count of the run', () => {
    show({ statevector: BELL, sample: SAMPLED });

    expect(screen.getByRole('status')).toHaveTextContent('1024 shots');
  });
});

describe('running a sample', () => {
  const button = () => screen.getByRole('button', { name: /run|running/i });

  it('runs when pressed', () => {
    const { props } = show({ statevector: BELL });

    fireEvent.click(button());

    expect(props.onRunSample).toHaveBeenCalledTimes(1);
  });

  it('says so while running, and does not run twice', () => {
    const { props } = show({
      statevector: BELL,
      sample: { status: 'running' },
    });

    expect(button()).toHaveTextContent(/running/i);
    fireEvent.click(button());

    expect(props.onRunSample).not.toHaveBeenCalled();
  });

  /**
   * Announced with a reason rather than hidden -- the same treatment the
   * palette gives a measurement with no register to write into.
   */
  it('announces why it cannot run', () => {
    show({
      statevector: BELL,
      samplingUnavailable: 'Add a measurement to sample this circuit.',
    });

    expect(button()).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('status')).toHaveTextContent(/add a measurement/i);
  });

  it('refuses the press while unavailable', () => {
    const { props } = show({
      statevector: BELL,
      samplingUnavailable: 'Add a measurement to sample this circuit.',
    });

    fireEvent.click(button());

    expect(props.onRunSample).not.toHaveBeenCalled();
  });

  it('reports a failed run', () => {
    show({
      statevector: BELL,
      sample: { status: 'failed', message: 'Sampling needs a measurement.' },
    });

    expect(screen.getByRole('status')).toHaveTextContent(
      /needs a measurement/i,
    );
  });
});

describe('many outcomes', () => {
  it('shows the top sixteen and counts the rest', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      basisState: String(i).padStart(6, '0'),
      probability: 1 / 40,
    }));

    show({
      statevector: {
        status: 'ready',
        result: { qubitCount: 6, amplitudes: [], probabilities: many },
      },
    });

    expect(rows()).toHaveLength(16);
    expect(screen.getByText(/and 24 more/)).toBeInTheDocument();
  });
});
