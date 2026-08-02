/**
 * What the canvas draws, as opposed to what the circuit contains.
 *
 * A region of its own rather than controls in the canvas, for the reason
 * `StructureControls` is: the canvas is a `role="grid"` composite widget with a
 * single tab stop and `aria-activedescendant`, and a focusable control inside
 * it breaks that contract.
 *
 * Separate from `StructureControls` too, and that line is worth holding.
 * Structure controls change the *document* -- every one of them is an edit with
 * an undo step. Nothing here touches the circuit at all, so nothing here is
 * undoable. Two kinds of control that look alike and behave completely
 * differently should not sit under one heading.
 */

export interface ViewControlsProps {
  readonly showCycleLabels: boolean;
  readonly onShowCycleLabelsChange: (show: boolean) => void;
  /**
   * Why cycle labels cannot be shown, or undefined when they can.
   *
   * A reason rather than a boolean, because the control announces it -- the
   * same shape `GatePalette` uses for an unavailable entry. Required and
   * explicitly `| undefined` rather than optional, which is what
   * `exactOptionalPropertyTypes` asks for and what the palette already does.
   */
  readonly cycleLabelsUnavailable: string | undefined;
}

export function ViewControls({
  showCycleLabels,
  onShowCycleLabelsChange,
  cycleLabelsUnavailable,
}: ViewControlsProps): React.JSX.Element {
  const unavailable = cycleLabelsUnavailable !== undefined;

  return (
    <section aria-label="View" className="flex items-center gap-2">
      <h2 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
        View
      </h2>

      {/*
        `aria-disabled` rather than `disabled`, following UI.md's rule and the
        palette's precedent: an unavailable control with something to teach is
        announced, not removed. "There are no cycles to label yet" tells you
        what a cycle label is for; a control that silently vanishes teaches
        nothing and looks like a bug.

        It keeps focus, so the change has to be refused in the handler -- a
        `disabled` input cannot be focused, and this region holds one control,
        so disabling it would drop the whole region out of the tab order.
      */}
      <label className="flex items-center gap-1.5 text-sm">
        <input
          type="checkbox"
          checked={showCycleLabels && !unavailable}
          aria-disabled={unavailable}
          title={cycleLabelsUnavailable}
          onChange={(event) => {
            if (unavailable) return;
            onShowCycleLabelsChange(event.target.checked);
          }}
          className={unavailable ? 'opacity-40' : ''}
        />
        <span className={unavailable ? 'text-ink-muted' : ''}>
          Cycle labels
        </span>
      </label>

      {/*
        The reason, where a screen reader reaches it. `title` alone is a tooltip
        and is not reliably announced; `aria-disabled` says a control is
        unavailable but never says why.
      */}
      <p role="status" className="text-sm text-ink-muted">
        {cycleLabelsUnavailable ?? ''}
      </p>
    </section>
  );
}
