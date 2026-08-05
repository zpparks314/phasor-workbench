/**
 * What a person can do once the editor has stopped.
 *
 * The interesting case is the loop: the editor opens on whatever browser storage
 * restored, so a saved circuit that crashes the renderer crashes it again on
 * every reload. Reload alone is not an escape from that, and the escape that
 * exists destroys the user's only copy -- which is why the download comes first
 * and why these tests check that it hands over the stored bytes untouched.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Mocked at the seam rather than shimmed at the DOM.
 *
 * `downloadFile` is `files/`'s and is tested there, blob and anchor and all.
 * What matters here is *what is handed to it*: the stored text, not a circuit
 * put back through the serializer that may be what failed.
 */
const { downloadFile } = vi.hoisted(() => ({ downloadFile: vi.fn() }));
vi.mock('../files', () => ({ downloadFile }));

import { STORAGE_KEY } from '../persistence';
import { RecoveryScreen } from './RecoveryScreen';

const BOOM = new Error('Cannot read properties of undefined (reading "x")');

beforeEach(() => {
  localStorage.clear();
  downloadFile.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('what it says', () => {
  it('names the error rather than saying something went wrong', () => {
    render(<RecoveryScreen error={BOOM} reload={vi.fn()} />);

    expect(screen.getByRole('alert')).toHaveTextContent(BOOM.message);
  });

  it('says the saved circuit was not touched', () => {
    render(<RecoveryScreen error={BOOM} reload={vi.fn()} />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      /has not been changed/i,
    );
  });

  /** A person reporting a circuit that will not draw needs the stack. */
  it('keeps the stack one disclosure away rather than behind a build flag', () => {
    render(<RecoveryScreen error={BOOM} reload={vi.fn()} />);

    expect(
      screen.getByText('Technical detail', { selector: 'summary' }),
    ).toBeInTheDocument();
  });

  /**
   * A caught error unmounts the tree that held focus, so focus falls to `body`.
   * Without this a keyboard user meets the screen from the top of the document
   * with nothing announcing that anything changed.
   */
  it('moves focus to the heading', () => {
    render(<RecoveryScreen error={BOOM} reload={vi.fn()} />);

    expect(
      screen.getByRole('heading', { name: /stopped unexpectedly/i }),
    ).toHaveFocus();
  });
});

describe('with nothing stored', () => {
  it('offers a reload and no recovery it cannot perform', () => {
    const reload = vi.fn();
    render(<RecoveryScreen error={BOOM} reload={reload} />);

    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledOnce();

    // Nothing stored means neither the loop nor the rescue exists.
    expect(screen.queryByRole('region', { name: /recover/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /discard/i })).toBeNull();
  });
});

describe('with a saved circuit behind the crash', () => {
  const STORED = '{"schemaVersion":"0.1.0","this":"is what was stored"}';

  beforeEach(() => {
    localStorage.setItem(STORAGE_KEY, STORED);
  });

  it('explains the loop and offers the way out of it', () => {
    render(<RecoveryScreen error={BOOM} reload={vi.fn()} />);

    expect(
      screen.getByRole('region', { name: /recover the saved circuit/i }),
    ).toHaveTextContent(/straight back here/i);
  });

  /**
   * The bytes as stored. Anything else here would run the document through the
   * code whose failure put this screen on the screen.
   */
  it('downloads the stored document verbatim', () => {
    render(<RecoveryScreen error={BOOM} reload={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /download/i }));

    expect(downloadFile).toHaveBeenCalledOnce();
    expect(downloadFile.mock.calls[0]?.[0]).toMatchObject({ text: STORED });
  });

  /**
   * Two presses, as every destructive control in the editor takes. This one has
   * no history behind it and no second copy, so it is the most irreversible
   * button in the application.
   */
  it('does not discard on the first press', () => {
    const reload = vi.fn();
    render(<RecoveryScreen error={BOOM} reload={reload} />);

    fireEvent.click(screen.getByRole('button', { name: /discard/i }));

    expect(localStorage.getItem(STORAGE_KEY)).toBe(STORED);
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(/press again/i);
  });

  it('discards and reloads on the second', () => {
    const reload = vi.fn();
    render(<RecoveryScreen error={BOOM} reload={reload} />);

    const discard = screen.getByRole('button', { name: /discard/i });
    fireEvent.click(discard);
    fireEvent.click(screen.getByRole('button', { name: /discard/i }));

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('cancels the confirmation on Escape', () => {
    render(<RecoveryScreen error={BOOM} reload={vi.fn()} />);

    const discard = screen.getByRole('button', { name: /discard/i });
    fireEvent.click(discard);
    fireEvent.keyDown(screen.getByRole('button', { name: /discard/i }), {
      key: 'Escape',
    });

    expect(screen.queryByRole('status')).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBe(STORED);
  });
});
