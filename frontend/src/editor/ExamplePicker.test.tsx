import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ExampleEntry } from '../api/examples';
import { ExamplePicker } from './ExamplePicker';
import type { ExamplesState } from './useExamples';

const ENTRIES: ExampleEntry[] = [
  {
    id: 'bell-state',
    name: 'Bell State',
    summary: 'The simplest entangled pair.',
    qubitCount: 2,
    operationCount: 5,
  },
  {
    id: 'ghz-state',
    name: 'GHZ State',
    summary: "Bell's three-qubit cousin.",
    qubitCount: 3,
    operationCount: 7,
  },
];

const READY: ExamplesState = { status: 'ready', entries: ENTRIES };

function show(examples: ExamplesState = READY) {
  const onLoad = vi.fn();
  render(<ExamplePicker examples={examples} onLoad={onLoad} />);

  return { onLoad };
}

const select = () => screen.getByRole('combobox', { name: 'Example circuit' });
const loadButton = () => screen.getByRole('button', { name: /^Load/ });

describe('offering the catalogue', () => {
  it('lists what the backend returned', () => {
    show();

    expect(
      screen.getByRole('option', { name: 'Bell State' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: 'GHZ State' }),
    ).toBeInTheDocument();
  });

  it('shows the summary of the chosen example rather than a tooltip', () => {
    // The summary is the part that teaches, and a title attribute is
    // unreachable by keyboard and unread by most screen readers.
    show();

    expect(
      screen.getByText('The simplest entangled pair.'),
    ).toBeInTheDocument();
  });

  it('starts on the first entry without needing an effect to set it', () => {
    show();

    expect(select()).toHaveValue('bell-state');
  });
});

describe('loading', () => {
  /**
   * The rule the control exists to enforce. Loading on change would let an
   * arrow key replace the circuit on the canvas -- which is the one thing a
   * keyboard user does to read through a list.
   */
  it('does not load when the choice changes', () => {
    const { onLoad } = show();

    fireEvent.change(select(), { target: { value: 'ghz-state' } });

    expect(onLoad).not.toHaveBeenCalled();
  });

  it('loads the chosen example when the button is pressed', () => {
    const { onLoad } = show();

    fireEvent.change(select(), { target: { value: 'ghz-state' } });
    fireEvent.click(loadButton());

    expect(onLoad).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ghz-state' }),
    );
  });

  it('names what will be replaced, where a screen reader hears it', () => {
    show();

    expect(
      screen.getByRole('button', {
        name: 'Load Bell State, replacing the circuit',
      }),
    ).toBeInTheDocument();
  });
});

describe('before the catalogue arrives', () => {
  it('says it is loading and refuses to load anything', () => {
    show({ status: 'loading' });

    expect(
      screen.getByRole('option', { name: 'Loading…' }),
    ).toBeInTheDocument();
    expect(loadButton()).toBeDisabled();
  });
});

describe('when the catalogue cannot be reached', () => {
  it('says so rather than showing an empty list', () => {
    // "Nothing answered" is not "there is nothing" -- the same distinction
    // import draws, and for the same reason.
    show({ status: 'unavailable' });

    expect(screen.getByText(/could not be reached/)).toBeInTheDocument();
    expect(select()).toBeDisabled();
    expect(loadButton()).toBeDisabled();
  });
});
