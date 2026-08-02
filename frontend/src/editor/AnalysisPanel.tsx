/**
 * What the backend says about the circuit: counts, depth, and the gate mix.
 *
 * Sits under the inspector in the right column. The two answer different
 * questions -- the inspector is what the selected operation *is*, this is what
 * the whole circuit *amounts to* -- and Milestone 4's simulation results will
 * join them rather than replace either.
 *
 * **Every number here comes from the backend, and that is the point.** The
 * status line under the canvas already shows a locally derived depth, and it
 * must, because a render cannot wait on a network call. Showing the backend's
 * answer beside it is how a disagreement between the two `deriveCycles`
 * implementations becomes visible to a person rather than only to the fixture
 * suite.
 *
 * **A failure is never phrased as the user's fault unless it is.** UI.md and
 * Frontend.md both draw that line: `CIRCUIT_INVALID` means the circuit has
 * problems the strip is already listing, and anything else means the backend
 * is unreachable or broken, which is not something to blame a person for.
 */

import type { AnalysisState } from './useAnalysis';

export interface AnalysisPanelProps {
  readonly state: AnalysisState;
}

export function AnalysisPanel({
  state,
}: AnalysisPanelProps): React.JSX.Element {
  return (
    <section aria-label="Analysis" className="flex w-56 flex-col gap-2 text-sm">
      <h2 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
        Analysis
      </h2>
      <Body state={state} />
    </section>
  );
}

function Body({ state }: AnalysisPanelProps): React.JSX.Element {
  if (state.status === 'loading') {
    return <p className="text-ink-muted">Analysing…</p>;
  }

  if (state.status === 'rejected') {
    return (
      <p className="text-ink-muted">
        Not analysed while the circuit has problems.
      </p>
    );
  }

  if (state.status === 'unavailable') {
    return <p className="text-ink-muted">{state.message}</p>;
  }

  const { analysis } = state;
  const breakdown = Object.entries(analysis.gateBreakdown).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  return (
    <>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
        <Row label="Qubits" value={analysis.qubitCount} />
        <Row label="Gates" value={analysis.gateCount} />
        <Row label="Measurements" value={analysis.measurementCount} />
        <Row label="Depth" value={analysis.depth} />
      </dl>

      {breakdown.length > 0 && (
        <>
          <h3 className="mt-1 text-xs font-semibold tracking-wide text-ink-muted uppercase">
            Gates
          </h3>
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
            {breakdown.map(([name, count]) => (
              <Row key={name} label={name} value={count} mono />
            ))}
          </dl>
        </>
      )}
    </>
  );
}

function Row({
  label,
  value,
  mono = false,
}: {
  readonly label: string;
  readonly value: number;
  readonly mono?: boolean;
}): React.JSX.Element {
  return (
    <>
      <dt className={mono ? 'font-mono text-ink-muted' : 'text-ink-muted'}>
        {label}
      </dt>
      <dd className="text-right font-mono tabular-nums">{String(value)}</dd>
    </>
  );
}
