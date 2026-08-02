/**
 * The application shell, which decides what the editor opens on.
 *
 * The three cases that matter are all about a stored document: absent, unreadable,
 * and written by a build ahead of this one. Each has to reach the user
 * differently, and none may be silent about losing work.
 */

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import App from './App';
import { STORAGE_KEY } from './persistence';
import { circuitWith, gate } from './state/testCircuits';
import { insertOperation } from './state/edits';

// The shell checks the backend on mount; the editor is what these tests are for.
vi.mock('./api/health', () => ({
  getHealth: () => new Promise(() => undefined),
}));

function store(document: unknown): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(document));
}

describe('what the editor opens on', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  /** First run. The canvas prompts for a first qubit; nothing is alarming. */
  it('opens empty with nothing stored, and says nothing about it', () => {
    render(<App />);

    expect(screen.getByTestId('empty-canvas')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('restores a stored circuit', () => {
    store(insertOperation(circuitWith(2), gate('op_0', 'h', ['q_0']), 0));

    render(<App />);

    expect(
      screen.getByRole('gridcell', { name: 'q0, cycle 0, h' }),
    ).toBeInTheDocument();
  });

  /**
   * A partial write, or a hand edit through devtools. Reported rather than
   * discarded quietly — the user is about to build over it.
   */
  it('reports a stored document it cannot read, and opens empty', () => {
    localStorage.setItem(STORAGE_KEY, '{ not json');

    render(<App />);

    expect(screen.getByRole('alert')).toHaveTextContent(/could not be read/i);
    expect(screen.getByTestId('empty-canvas')).toBeInTheDocument();
  });

  it('reports a document that is not a circuit', () => {
    store({ schemaVersion: '0.1.0', nonsense: true });

    render(<App />);

    expect(screen.getByRole('alert')).toHaveTextContent(/could not be read/i);
  });

  /**
   * ADR-0008 section 3: the warning comes before the first edit, not at save
   * time. Warning at save would be warning after the decision.
   */
  it('warns before editing that a newer circuit will lose what it cannot read', () => {
    store({
      ...circuitWith(1),
      schemaVersion: '0.99.0',
      flavour: 'from the future',
    });

    render(<App />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/newer version/i);
    expect(alert).toHaveTextContent(/dropped the next time you save/i);
    // And it opened rather than being refused.
    expect(screen.getByRole('grid')).toBeInTheDocument();
  });

  it('says nothing extra about a circuit at this version', () => {
    store(circuitWith(2));

    render(<App />);

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('grid')).toBeInTheDocument();
  });
});
