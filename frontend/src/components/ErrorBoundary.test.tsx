/**
 * The boundary between a throwing component and a blank page.
 *
 * `console.error` is silenced in every case that throws: React reports a caught
 * error itself, and the point of these tests is what the *user* is left looking
 * at. Left unsilenced the suite prints a stack per assertion and the real output
 * becomes unreadable.
 */

import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ErrorBoundary } from './ErrorBoundary';

function Throwing({ thrown }: { readonly thrown: unknown }): React.JSX.Element {
  throw thrown;
}

function quiet(): void {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('when nothing throws', () => {
  it('renders its children and nothing of its own', () => {
    render(
      <ErrorBoundary fallback={() => <p>fallback</p>}>
        <p>the application</p>
      </ErrorBoundary>,
    );

    expect(screen.getByText('the application')).toBeInTheDocument();
    expect(screen.queryByText('fallback')).toBeNull();
  });
});

describe('when a child throws', () => {
  /**
   * The Definition of Done's browser check exists for exactly this: every other
   * check passes while the page renders nothing.
   */
  it('shows the fallback rather than an empty tree', () => {
    quiet();

    const { container } = render(
      <ErrorBoundary fallback={(error) => <p>{`Caught: ${error.message}`}</p>}>
        <Throwing thrown={new Error('layout exploded')} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Caught: layout exploded')).toBeInTheDocument();
    expect(container).not.toBeEmptyDOMElement();
  });

  /**
   * `throw` takes any value. A fallback handed a string would read `.message`
   * off it, get `undefined`, and the recovery screen would be the second thing
   * to fail.
   */
  it('hands the fallback an Error even when something else was thrown', () => {
    quiet();

    render(
      <ErrorBoundary
        fallback={(error) => (
          <p>{`${String(error instanceof Error)}: ${error.message}`}</p>
        )}
      >
        <Throwing thrown="a bare string" />
      </ErrorBoundary>,
    );

    expect(screen.getByText('true: a bare string')).toBeInTheDocument();
  });

  it('reports through onError, with the component stack', () => {
    quiet();
    const onError = vi.fn();

    render(
      <ErrorBoundary fallback={() => <p>fallback</p>} onError={onError}>
        <Throwing thrown={new Error('boom')} />
      </ErrorBoundary>,
    );

    expect(onError).toHaveBeenCalled();
    const [error, info] = onError.mock.calls[0] as [
      Error,
      { componentStack?: string },
    ];
    expect(error.message).toBe('boom');
    expect(info).toHaveProperty('componentStack');
  });

  /*
   * There is deliberately no test that this does not log a second time. React
   * reports caught errors to the console itself, and no assertion available here
   * can tell one of its calls from one of ours -- a test that cannot detect its
   * own vacuity is not evidence, which AGENTS.md learned the hard way. The
   * reasoning is in the module comment, where it can be read by whoever is about
   * to add a `console.error`.
   */
});
