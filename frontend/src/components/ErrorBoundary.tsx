/**
 * The one thing that stands between a render error and a blank page.
 *
 * A React component that throws while rendering unmounts its whole tree, and
 * with nothing above it that means an empty `#root` -- every check in the
 * Definition of Done passing while the browser shows white. That is the failure
 * the browser check was added for, and this is what catches it.
 *
 * **Mechanism only.** It knows how to catch and nothing about what to say; the
 * caller supplies the fallback. Keeping the two apart is what lets a second
 * boundary later -- around a panel rather than the application -- reuse this
 * without dragging the recovery screen along with it.
 *
 * **A class, because there is no hook for this.** `getDerivedStateFromError` and
 * `componentDidCatch` have no function-component equivalent in React 19, and
 * this is the one place in the frontend that needs them.
 *
 * **It does not log.** React's root already reports a caught error to the
 * console, so a `console.error` here would print everything twice and teach
 * whoever reads it to distrust the count. `onError` is the seam for a real
 * reporter, and is deliberately not filled with a second logger in the meantime.
 *
 * **There is no retry.** Re-rendering the same tree from the same state runs the
 * same code and throws again, so a "try again" button would be a control that
 * looks like a way out and is not. What the caller offers instead is a change of
 * state -- see `./RecoveryScreen`.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

export interface ErrorBoundaryProps {
  readonly children: ReactNode;
  /** What to show instead of the children once one of them has thrown. */
  readonly fallback: (error: Error) => ReactNode;
  /** A reporting seam. Nothing is logged here by default -- see above. */
  readonly onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  readonly error: Error | null;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(thrown: unknown): ErrorBoundaryState {
    return { error: asError(thrown) };
  }

  override componentDidCatch(thrown: unknown, info: ErrorInfo): void {
    this.props.onError?.(asError(thrown), info);
  }

  override render(): ReactNode {
    const { error } = this.state;
    return error === null ? this.props.children : this.props.fallback(error);
  }
}

/**
 * Whatever was thrown, as an `Error`.
 *
 * `throw` takes any value, and a string or an object reaches a boundary exactly
 * as an `Error` does. Normalising here means the fallback is handed one shape
 * and never has to decide whether `.message` exists -- which is the point at
 * which a recovery screen would itself throw.
 */
function asError(thrown: unknown): Error {
  if (thrown instanceof Error) return thrown;
  return new Error(typeof thrown === 'string' ? thrown : String(thrown));
}
