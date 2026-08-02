/**
 * What the circuit does: its final state, and what measuring it produces.
 *
 * The region UI.md reserved through Milestone 3 and deliberately left
 * undesigned -- "designing a results panel before results exist is the
 * speculation that kept this document empty through two milestones". Results
 * exist now.
 *
 * **Exact and sampled probabilities share one list**, which is the whole point.
 * Shot noise is hard to convey any other way: 1024 shots of a Bell state give
 * 51.6% rather than 50%, and seeing the two numbers on one row -- then seeing
 * them converge as shots rise -- is the explanation. Two separate panels would
 * make the reader hold both lists in their head to do the comparison
 * themselves.
 *
 * **A bar is never the only carrier of meaning.** UI.md's rule. Every row
 * states its percentage as text, and the bar is a second reading of the same
 * number rather than the only one.
 */

import type { SampleState, StatevectorState } from './useSimulation';
import { exactProbabilities, mergeOutcomes, type Outcome } from './outcomes';
import { DEFAULT_SHOTS } from '../api/simulation';

export interface ResultsPanelProps {
  readonly statevector: StatevectorState;
  readonly sample: SampleState;
  readonly onRunSample: () => void;
  /** Why sampling cannot run, or undefined when it can. */
  readonly samplingUnavailable: string | undefined;
}

export function ResultsPanel({
  statevector,
  sample,
  onRunSample,
  samplingUnavailable,
}: ResultsPanelProps): React.JSX.Element {
  return (
    <section aria-label="Results" className="flex w-56 flex-col gap-2 text-sm">
      <h2 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
        Results
      </h2>

      <Outcomes statevector={statevector} sample={sample} />

      <RunControl
        sample={sample}
        onRunSample={onRunSample}
        samplingUnavailable={samplingUnavailable}
      />
    </section>
  );
}

function Outcomes({
  statevector,
  sample,
}: {
  readonly statevector: StatevectorState;
  readonly sample: SampleState;
}): React.JSX.Element {
  if (statevector.status === 'loading') {
    return <p className="text-ink-muted">Simulating…</p>;
  }
  if (statevector.status === 'rejected') {
    return (
      <p className="text-ink-muted">
        Not simulated while the circuit has problems.
      </p>
    );
  }
  if (statevector.status === 'tooLarge') {
    // Not an error and not the user's fault: the circuit is fine, there is
    // simply more state than a response can carry.
    return <p className="text-ink-muted">{statevector.message}</p>;
  }
  if (statevector.status === 'unavailable') {
    return <p className="text-ink-muted">{statevector.message}</p>;
  }

  const exact = exactProbabilities(statevector.result.probabilities);
  const sampled = sample.status === 'ready' ? sample.result.probabilities : {};
  const { shown, hidden, hiddenBelow } = mergeOutcomes(exact, sampled);

  if (shown.length === 0) {
    return <p className="text-ink-muted">No outcomes to show.</p>;
  }

  return (
    <>
      <ol className="flex flex-col gap-1">
        {shown.map((outcome) => (
          <OutcomeRow
            key={outcome.basisState}
            outcome={outcome}
            comparing={sample.status === 'ready'}
          />
        ))}
      </ol>

      {hidden > 0 && (
        <p className="text-xs text-ink-muted">
          and {hidden} more, each below {percent(hiddenBelow)}
        </p>
      )}
    </>
  );
}

/**
 * One outcome: its bit string, its exact probability, and its sampled one.
 *
 * The sampled column appears only once a sample exists, so the panel does not
 * show an empty column implying a missing number before anything has been run.
 */
function OutcomeRow({
  outcome,
  comparing,
}: {
  readonly outcome: Outcome;
  readonly comparing: boolean;
}): React.JSX.Element {
  return (
    <li className="flex flex-col gap-0.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-xs">{outcome.basisState}</span>
        <span className="font-mono text-xs tabular-nums text-ink-muted">
          {percent(outcome.exact)}
          {comparing && <> · {percent(outcome.sampled)}</>}
        </span>
      </div>

      <Bar
        exact={outcome.exact}
        sampled={outcome.sampled}
        showSampled={comparing}
      />
    </li>
  );
}

/**
 * Two stacked bars: the exact probability, and the sampled one beneath it.
 *
 * Stacked rather than overlaid, because an overlay needs colour or opacity to
 * tell the two apart and UI.md forbids colour as the only carrier of meaning.
 * Stacked, position carries it -- and the difference between the two lengths is
 * the shot noise, read directly.
 *
 * aria-hidden: the row already states both numbers as text, and a screen reader
 * announcing a bar as well would repeat one value twice.
 */
function Bar({
  exact,
  sampled,
  showSampled,
}: {
  readonly exact: number | undefined;
  readonly sampled: number | undefined;
  readonly showSampled: boolean;
}): React.JSX.Element {
  return (
    <span aria-hidden="true" className="flex flex-col gap-px">
      <span className="h-1.5 w-full rounded-sm bg-surface-raised">
        <span
          className="block h-full rounded-sm bg-ink-muted"
          style={{ width: `${String((exact ?? 0) * 100)}%` }}
        />
      </span>
      {showSampled && (
        <span className="h-1 w-full rounded-sm bg-surface-raised">
          <span
            className="block h-full rounded-sm bg-ink-muted/50"
            style={{ width: `${String((sampled ?? 0) * 100)}%` }}
          />
        </span>
      )}
    </span>
  );
}

/**
 * Running the circuit, which is an action rather than something that happens.
 *
 * Unavailable when nothing is measured, announced with a reason rather than
 * hidden -- the same treatment the palette gives a measurement with no register
 * to write into, and the cycle-label toggle with no cycles.
 */
function RunControl({
  sample,
  onRunSample,
  samplingUnavailable,
}: {
  readonly sample: SampleState;
  readonly onRunSample: () => void;
  readonly samplingUnavailable: string | undefined;
}): React.JSX.Element {
  const unavailable = samplingUnavailable !== undefined;

  return (
    <div className="mt-1 flex flex-col gap-1">
      <button
        type="button"
        aria-disabled={unavailable || sample.status === 'running'}
        title={samplingUnavailable}
        onClick={() => {
          if (unavailable || sample.status === 'running') return;
          onRunSample();
        }}
        className={`rounded border border-ink-muted/40 px-2 py-1 text-sm ${
          unavailable ? 'opacity-40' : 'hover:border-ink'
        }`}
      >
        {sample.status === 'running'
          ? 'Running…'
          : `Run ${String(DEFAULT_SHOTS)} shots`}
      </button>

      <p role="status" className="text-xs text-ink-muted">
        {samplingUnavailable ??
          (sample.status === 'failed'
            ? sample.message
            : sample.status === 'ready'
              ? `${String(sample.result.shots)} shots${
                  sample.result.seed === null
                    ? ''
                    : `, seed ${String(sample.result.seed)}`
                }`
              : '')}
      </p>
    </div>
  );
}

/** A probability as a percentage, or an em dash when there is none. */
function percent(value: number | undefined): string {
  return value === undefined ? '—' : `${(value * 100).toFixed(1)}%`;
}
