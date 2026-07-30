/**
 * The React binding for the circuit store.
 *
 * The only file in `state/` that imports React. Everything else here is plain
 * TypeScript so it can be tested without a DOM, which is what makes the undo
 * property test in `store.test.ts` possible. Keeping the adapter this thin is
 * what keeps that true -- see ADR-0007 section 8.
 */

import { useSyncExternalStore } from 'react';

import type { CircuitStore, CircuitStoreState } from './store';

export function useCircuitStore(store: CircuitStore): CircuitStoreState {
  return useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.getState(),
  );
}
