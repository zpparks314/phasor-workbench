/**
 * What is wrong with the circuit, from `validateCircuit`.
 *
 * Renders violations; it never re-derives them. Selecting one focuses the
 * operation it names, which is also the only way to reach an operation the canvas
 * could not draw -- an operation whose every qubit reference is dangling has no
 * cell to click.
 *
 * A violation is never held across an edit. Paths are positional
 * (`operations[3].targets[0]`) and per ADR-0002 positions shift, so a violation
 * kept past an edit points at the wrong operation. The caller recomputes.
 */

import type { Violation } from '../validation';

export interface ProblemsStripProps {
  readonly violations: readonly Violation[];
  readonly onSelect: (path: string) => void;
}

export function ProblemsStrip({
  violations,
  onSelect,
}: ProblemsStripProps): React.JSX.Element {
  if (violations.length === 0) {
    return (
      <section aria-label="Problems" className="text-sm text-ink-muted">
        <p role="status">No problems.</p>
      </section>
    );
  }

  return (
    <section aria-label="Problems" className="text-sm">
      <p role="status" className="mb-1 text-ink-muted">
        {`${String(violations.length)} ${violations.length === 1 ? 'problem' : 'problems'}`}
      </p>
      <ul className="flex flex-col gap-1">
        {violations.map((violation) => (
          <li key={`${violation.code}:${violation.path}`}>
            <button
              type="button"
              onClick={() => {
                onSelect(violation.path);
              }}
              className="flex w-full items-baseline gap-2 rounded px-2 py-1 text-left hover:bg-ink/5"
            >
              {/* Never colour alone: the marker, the code, and the path all carry it. */}
              <span aria-hidden="true">▲</span>
              <span className="font-mono text-xs text-ink-muted">
                {violation.code}
              </span>
              <span className="flex-1">{violation.message}</span>
              <span className="font-mono text-xs text-ink-muted">
                {violation.path}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
