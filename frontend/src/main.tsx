import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { RecoveryScreen } from './components/RecoveryScreen';
import './index.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Root element #root was not found in index.html.');
}

/**
 * One boundary, at the root, and that is a decision rather than a starting
 * point.
 *
 * It goes here rather than around the editor because the shell is not worth
 * saving on its own: a title, a backend status line, and the alerts about what
 * was restored. Keeping those alive beside a crashed canvas would be a page that
 * looks half-working and offers nothing to do, and the recovery this needs to
 * present -- reload, or discard the saved circuit and reload -- is about the
 * whole application rather than one region of it.
 *
 * Boundaries around the individual panels are a different and additive change,
 * and the case for one is a panel that can fail while the canvas stays useful.
 * That case is not made by anything built yet, so it is not being pre-empted.
 */
createRoot(container).render(
  <StrictMode>
    <ErrorBoundary fallback={(error) => <RecoveryScreen error={error} />}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
