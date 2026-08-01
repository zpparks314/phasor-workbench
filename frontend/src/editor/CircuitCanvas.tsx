/**
 * The circuit canvas: direct SVG over a grid.
 *
 * Draws whatever `layoutCircuit` produced and nothing more. It holds no circuit
 * state, derives no positions of its own, and stores no coordinates -- geometry
 * and cell contents both arrive as props, recomputed by the caller on every
 * render. See docs/Frontend.md and docs/UI.md.
 *
 * **Accessibility is a grid with `aria-activedescendant`, not one tab stop per
 * cell.** UI.md requires `role="grid"`, a row per qubit and a cell per position,
 * and a forty-gate circuit must not put forty stops in the tab order. The
 * container is the single focusable element and the cursor moves between cells
 * inside it, which is the standard composite-widget pattern and needs only one
 * focusable node. The `<svg>` carries `role="none"` so the rows it contains are
 * owned by the grid rather than hidden behind an image.
 *
 * This must be verified against a real screen reader rather than assumed correct;
 * SVG accessibility mapping is inconsistent enough that markup being right on
 * paper proves little.
 */

import type { GateName } from '../model/circuit';
import type { CellContent } from './placement';
import type {
  AnchorLayout,
  BarrierLayout,
  CircuitLayout,
  GateLayout,
  LayoutMetrics,
  MeasurementLayout,
  QubitRole,
  RegisterLaneLayout,
  Segment,
  WireLayout,
} from './layout';
import { columnCenter } from './layout';
import { targetGlyph, type TargetGlyph } from './glyphs';

export interface CellPosition {
  readonly row: number;
  readonly column: number;
}

/**
 * An operation that should slide from where it was requested to where the
 * derivation put it. `nonce` changes per settle so the element remounts and the
 * animation runs again; a CSS animation does not restart on re-render alone.
 */
export interface Settle {
  readonly operationId: string;
  readonly fromColumn: number;
  readonly nonce: number;
}

/**
 * A gate whose wires are being assigned, already resolved to geometry.
 *
 * Built by the caller from `./pending` and the layout, so the canvas keeps
 * having nothing to decide. `nextRole` is what the cursor preview should show,
 * and is null only in the instant before the operation commits.
 */
export interface PendingPreview {
  readonly name: GateName;
  readonly x: number;
  readonly anchors: readonly AnchorLayout[];
  readonly connector: readonly Segment[];
  readonly nextRole: QubitRole | null;
}

export interface CircuitCanvasProps {
  readonly layout: CircuitLayout;
  readonly cells: readonly (readonly CellContent[])[];
  readonly cursor: CellPosition;
  readonly selection: string | null;
  readonly armed: GateName | null;
  readonly pending: PendingPreview | null;
  readonly dragging: string | null;
  readonly settle: Settle | null;
  readonly onCursorChange: (cell: CellPosition) => void;
  readonly onActivate: (cell: CellPosition) => void;
  readonly onSelectOperation: (operationId: string) => void;
  readonly onRemoveSelection: () => void;
  readonly onCancel: () => void;
  readonly onPickUp: (operationId: string) => void;
  readonly onDropDrag: () => void;
  readonly onNudgeSelection: (rows: number, columns: number) => void;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onCycleBarriers: (direction: 1 | -1) => void;
}

export function CircuitCanvas({
  layout,
  cells,
  cursor,
  selection,
  armed,
  pending,
  dragging,
  settle,
  onCursorChange,
  onActivate,
  onSelectOperation,
  onRemoveSelection,
  onCancel,
  onPickUp,
  onDropDrag,
  onNudgeSelection,
  onUndo,
  onRedo,
  onCycleBarriers,
}: CircuitCanvasProps): React.JSX.Element {
  const { lane, column: columnWidth } = layout.metrics;

  /**
   * The cursor is clamped on read, not stored clamped.
   *
   * Removing an operation or undoing a placement shrinks `columnCount`, which can
   * leave the cursor pointing past the end -- and an `aria-activedescendant`
   * naming a cell that does not exist is worse than a wrong one, because assistive
   * technology has nothing to announce. Same treatment as a stale selection in
   * ADR-0007 section 4, and for the same reason: derived on read cannot go stale.
   */
  const active = clampCursor(cursor, layout);
  const removeAt = removePosition(layout, selection);

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) onRedo();
      else onUndo();
      return;
    }

    /*
      Barriers are in no cell, so no amount of arrowing reaches one. A command
      rather than a cursor position: `b` steps forward through them from wherever
      the cursor is, Shift+B backwards. Shift+arrow was the obvious alternative
      and is left alone -- it conventionally extends selection, which multi-select
      will want -- and Alt+arrow is Back/Forward in two browsers.
    */
    if (event.key.toLowerCase() === 'b' && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      onCycleBarriers(event.shiftKey ? -1 : 1);
      return;
    }

    // Ctrl/Cmd + arrow moves the selected operation; a bare arrow moves the
    // cursor. Each press is a complete action, so unlike a drag it declares no
    // coalescing -- one press, one undo step.
    const nudge = NUDGES[event.key];
    if (nudge !== undefined && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      onNudgeSelection(nudge.rows, nudge.columns);
      return;
    }

    const moved = nextCursor(event.key, active, layout);
    if (moved !== undefined) {
      event.preventDefault();
      onCursorChange(moved);
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onActivate(active);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      onRemoveSelection();
    } else if (event.key === 'Escape') {
      onCancel();
    }
  }

  /*
    A circuit with no qubits has nowhere to put anything, so there is no grid to
    render and nothing for a cursor to point at. UI.md requires a prompt here
    rather than a blank rectangle -- and an empty `role="grid"` is worse than
    blank, because `aria-activedescendant` would name a cell that does not exist.

    Reachable from the moment qubits can be removed, and the state the editor
    opens in once it no longer opens on scaffolding.
  */
  if (layout.wires.length === 0) {
    return (
      <p
        data-testid="empty-canvas"
        className="rounded border border-dashed border-ink-muted/40 px-6 py-10 text-sm text-ink-muted"
      >
        No qubits yet. Add one to start building a circuit.
      </p>
    );
  }

  return (
    <div
      role="grid"
      aria-label={describe(layout)}
      aria-activedescendant={cellId(active)}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onPointerUp={onDropDrag}
      onPointerLeave={onDropDrag}
      className={`inline-block overflow-x-auto rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current ${
        dragging === null ? '' : 'cursor-grabbing'
      }`}
    >
      <svg
        role="none"
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${String(layout.width)} ${String(layout.height)}`}
        className="text-ink"
      >
        <g role="none">
          {layout.wires.map((wire) => (
            <Wire
              key={wire.qubitId}
              wire={wire}
              gutter={layout.metrics.gutter}
              end={layout.wireEnd}
            />
          ))}

          {layout.registers.map((registerLane) => (
            <RegisterLane
              key={registerLane.registerId}
              lane={registerLane}
              gutter={layout.metrics.gutter}
              end={layout.wireEnd}
              gap={layout.metrics.crossingGap / 4}
            />
          ))}

          {layout.barriers.map((barrier) => (
            <Barrier
              key={barrier.operationId}
              barrier={barrier}
              selected={selection === barrier.operationId}
            />
          ))}

          {/* Every connector, beneath every glyph. See OperationLines. */}
          {layout.operations.map((operation) => (
            <Settling
              key={operation.operationId}
              offset={settleOffset(
                settle,
                operation.operationId,
                operation.x,
                layout,
              )}
              nonce={settle?.nonce ?? 0}
            >
              <OperationLines operation={operation} layout={layout} />
            </Settling>
          ))}

          {layout.operations.map((operation) => (
            <Settling
              key={operation.operationId}
              offset={settleOffset(
                settle,
                operation.operationId,
                operation.x,
                layout,
              )}
              nonce={settle?.nonce ?? 0}
            >
              {operation.kind === 'gate' ? (
                <Gate
                  gate={operation}
                  layout={layout}
                  selected={selection === operation.operationId}
                />
              ) : (
                <Measurement
                  measurement={operation}
                  layout={layout}
                  selected={selection === operation.operationId}
                />
              )}
            </Settling>
          ))}

          {/*
            The wires already assigned, then what the next click would add. Both
            sit above the committed operations so a pending gate is not hidden
            behind whatever occupies the column it is being assembled over.
          */}
          {pending !== null && (
            <PendingPlacement pending={pending} metrics={layout.metrics} />
          )}

          {armed !== null &&
            (pending === null || pending.nextRole !== null) && (
              <Preview
                x={
                  pending === null
                    ? columnCenter(active.column, layout.metrics)
                    : pending.x
                }
                y={layout.wires[active.row]?.y ?? 0}
                metrics={layout.metrics}
                name={armed}
                role={pending?.nextRole ?? 'target'}
              />
            )}
        </g>

        {layout.wires.map((wire, row) => (
          <g key={wire.qubitId} role="row" aria-label={wire.label}>
            {(cells[row] ?? []).map((content, column) => (
              <rect
                key={column}
                role="gridcell"
                id={cellId({ row, column })}
                aria-label={`${wire.label}, column ${String(column + 1)}, ${content.description}`}
                aria-selected={
                  content.operationId !== undefined &&
                  content.operationId === selection
                }
                x={columnCenter(column, layout.metrics) - columnWidth / 2}
                y={wire.y - lane / 2}
                width={columnWidth}
                height={lane}
                className={[
                  isCursor(active, row, column)
                    ? 'fill-current opacity-10'
                    : 'fill-transparent',
                  content.operationId === undefined ? '' : 'cursor-grab',
                ].join(' ')}
                onPointerDown={() => {
                  if (content.operationId !== undefined) {
                    onPickUp(content.operationId);
                  }
                }}
                onPointerEnter={() => {
                  onCursorChange({ row, column });
                }}
                onPointerMove={() => {
                  onCursorChange({ row, column });
                }}
                onClick={() => {
                  onCursorChange({ row, column });
                  onActivate({ row, column });
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  onCursorChange({ row, column });
                  onActivate({ row, column });
                }}
              />
            ))}
          </g>
        ))}

        {/*
          Above the cells, because the cells are transparent rectangles covering
          the whole canvas and would otherwise swallow every click aimed at
          something drawn underneath them.
        */}
        {layout.barriers.map((barrier) => (
          <BarrierHitTarget
            key={barrier.operationId}
            barrier={barrier}
            onSelect={onSelectOperation}
            onPickUp={onPickUp}
          />
        ))}

        {removeAt !== undefined && (
          <RemoveAffordance
            x={removeAt.x}
            y={removeAt.y}
            onRemove={onRemoveSelection}
          />
        )}
      </svg>
    </div>
  );
}

/**
 * Where the remove button sits for whatever is selected.
 *
 * Rendered once at the canvas level rather than inside each glyph, so it is
 * guaranteed to be above the cell layer and there is one implementation instead
 * of three.
 */
function removePosition(
  layout: CircuitLayout,
  selection: string | null,
): { readonly x: number; readonly y: number } | undefined {
  if (selection === null) return undefined;
  const { glyph } = layout.metrics;

  const operation = layout.operations.find(
    (candidate) => candidate.operationId === selection,
  );
  if (operation !== undefined) {
    const anchor =
      operation.anchors.find((candidate) => candidate.role === 'target') ??
      operation.anchors[0];
    if (anchor === undefined) return undefined;
    return { x: operation.x + glyph / 2, y: anchor.y - glyph / 2 };
  }

  const barrier = layout.barriers.find(
    (candidate) => candidate.operationId === selection,
  );
  const segment = barrier?.segments[0];
  if (barrier === undefined || segment === undefined) return undefined;

  return { x: barrier.x, y: segment.y1 };
}

/**
 * A redundant mouse path to removal, so deleting never requires the keyboard.
 *
 * `aria-hidden` deliberately: `Delete` on the selected operation is the
 * accessible route and is already announced, so exposing this too would put a
 * second control for one action into the grid and break its single tab stop.
 */
function RemoveAffordance({
  x,
  y,
  onRemove,
}: {
  readonly x: number;
  readonly y: number;
  readonly onRemove: () => void;
}): React.JSX.Element {
  const radius = 8;

  return (
    <g
      aria-hidden="true"
      data-testid="remove-affordance"
      className="cursor-pointer"
      onClick={onRemove}
    >
      <title>Remove</title>
      <circle
        cx={x}
        cy={y}
        r={radius}
        className="fill-surface stroke-current"
        strokeWidth={1.5}
      />
      <path
        d={`M ${String(x - 3.5)} ${String(y - 3.5)} L ${String(x + 3.5)} ${String(y + 3.5)} M ${String(x + 3.5)} ${String(y - 3.5)} L ${String(x - 3.5)} ${String(y + 3.5)}`}
        className="stroke-current"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
    </g>
  );
}

/**
 * An invisible, generously wide stroke so a 2px dashed rule can be clicked.
 *
 * Also where a barrier is picked up for dragging. A barrier sits on the boundary
 * *between* columns and is in no cycle, so `describeCells` cannot put it in a
 * cell and the cell layer can never hand one back. This is the only surface that
 * knows where a barrier is.
 */
function BarrierHitTarget({
  barrier,
  onSelect,
  onPickUp,
}: {
  readonly barrier: BarrierLayout;
  readonly onSelect: (operationId: string) => void;
  readonly onPickUp: (operationId: string) => void;
}): React.JSX.Element {
  return (
    <g data-barrier-hit={barrier.operationId} className="cursor-grab">
      {barrier.segments.map((segment) => (
        <line
          key={`${String(segment.y1)}-${String(segment.y2)}`}
          x1={barrier.x}
          y1={segment.y1}
          x2={barrier.x}
          y2={segment.y2}
          stroke="transparent"
          strokeWidth={10}
          onPointerDown={() => {
            onPickUp(barrier.operationId);
          }}
          onClick={() => {
            onSelect(barrier.operationId);
          }}
        />
      ))}
    </g>
  );
}

function nextCursor(
  key: string,
  cursor: CellPosition,
  layout: CircuitLayout,
): CellPosition | undefined {
  const lastRow = layout.wires.length - 1;
  const lastColumn = layout.columnCount - 1;
  const clamp = (value: number, highest: number): number =>
    Math.max(0, Math.min(value, highest));

  switch (key) {
    case 'ArrowUp':
      return { ...cursor, row: clamp(cursor.row - 1, lastRow) };
    case 'ArrowDown':
      return { ...cursor, row: clamp(cursor.row + 1, lastRow) };
    case 'ArrowLeft':
      return { ...cursor, column: clamp(cursor.column - 1, lastColumn) };
    case 'ArrowRight':
      return { ...cursor, column: clamp(cursor.column + 1, lastColumn) };
    case 'Home':
      return { ...cursor, column: 0 };
    case 'End':
      return { ...cursor, column: clamp(lastColumn, lastColumn) };
    default:
      return undefined;
  }
}

function clampCursor(
  cursor: CellPosition,
  layout: CircuitLayout,
): CellPosition {
  const clamp = (value: number, count: number): number =>
    Math.max(0, Math.min(value, count - 1));

  return {
    row: clamp(cursor.row, layout.wires.length),
    column: clamp(cursor.column, layout.columnCount),
  };
}

const NUDGES: Readonly<
  Record<string, { readonly rows: number; readonly columns: number }>
> = {
  ArrowUp: { rows: -1, columns: 0 },
  ArrowDown: { rows: 1, columns: 0 },
  ArrowLeft: { rows: 0, columns: -1 },
  ArrowRight: { rows: 0, columns: 1 },
};

/**
 * How far an operation should appear to travel, and nothing if it should not.
 *
 * Zero when the derivation put the operation exactly where it was requested,
 * which is the common case -- animating a move of no distance would flash for no
 * reason.
 */
function settleOffset(
  settle: Settle | null,
  operationId: string,
  x: number,
  layout: CircuitLayout,
): number {
  if (settle === null || settle.operationId !== operationId) return 0;
  return columnCenter(settle.fromColumn, layout.metrics) - x;
}

/** Applies the settle animation, remounting per nonce so it replays. */
function Settling({
  offset,
  nonce,
  children,
}: {
  readonly offset: number;
  readonly nonce: number;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  if (offset === 0) return <g>{children}</g>;

  return (
    <g
      key={nonce}
      className="settling"
      style={{ '--settle-from': `${String(offset)}px` } as React.CSSProperties}
    >
      {children}
    </g>
  );
}

const cellId = (cell: CellPosition): string =>
  `cell-${String(cell.row)}-${String(cell.column)}`;

const isCursor = (cursor: CellPosition, row: number, column: number): boolean =>
  cursor.row === row && cursor.column === column;

/** The label sits in the gutter; the wire starts where the gutter ends. */
const LABEL_INSET = 12;

function Wire({
  wire,
  gutter,
  end,
}: {
  readonly wire: WireLayout;
  readonly gutter: number;
  readonly end: number;
}): React.JSX.Element {
  return (
    <g>
      <text
        x={gutter - LABEL_INSET}
        y={wire.y}
        textAnchor="end"
        dominantBaseline="middle"
        className="fill-current font-mono text-sm"
      >
        {wire.label}
      </text>
      <line
        x1={gutter}
        y1={wire.y}
        x2={end}
        y2={wire.y}
        className="stroke-current"
        strokeWidth={1.5}
      />
    </g>
  );
}

/** Classical lanes are drawn as a double line, so the kind reads without colour. */
function RegisterLane({
  lane,
  gutter,
  end,
  gap,
}: {
  readonly lane: RegisterLaneLayout;
  readonly gutter: number;
  readonly end: number;
  readonly gap: number;
}): React.JSX.Element {
  return (
    <g>
      <text
        x={gutter - LABEL_INSET}
        y={lane.y}
        textAnchor="end"
        dominantBaseline="middle"
        className="fill-current font-mono text-sm"
      >
        {lane.label}
        <tspan className="opacity-60">/{lane.size}</tspan>
      </text>
      {[-gap, gap].map((offset) => (
        <line
          key={offset}
          x1={gutter}
          y1={lane.y + offset}
          x2={end}
          y2={lane.y + offset}
          className="stroke-current"
          strokeWidth={1}
        />
      ))}
    </g>
  );
}

/**
 * An operation's vertical run and its control dots, drawn beneath every glyph.
 *
 * Separated from the glyph so that layering is decided once for the whole canvas
 * rather than by the order operations happen to appear in. A gate spanning q0 to
 * q2 packs into the same cycle as an unrelated gate on q1 -- the intervening wire
 * is not one of its resources -- so the two genuinely occupy the same column, and
 * whichever drew last would otherwise cross the other.
 *
 * The crossing gap in `layout.ts` is what marks an *empty* intervening wire as
 * untouched. Where a glyph sits there instead, the glyph's own fill is the break,
 * and it has to be on top for that to be true.
 */
function OperationLines({
  operation,
  layout,
}: {
  readonly operation: GateLayout | MeasurementLayout;
  readonly layout: CircuitLayout;
}): React.JSX.Element {
  const { control } = layout.metrics;

  return (
    <g data-operation-lines={operation.operationId}>
      {operation.connector.map((segment) => (
        <line
          key={`${String(segment.y1)}-${String(segment.y2)}`}
          x1={operation.x}
          y1={segment.y1}
          x2={operation.x}
          y2={segment.y2}
          className="stroke-current"
          strokeWidth={operation.kind === 'gate' ? 1.5 : 1}
        />
      ))}

      {operation.anchors
        .filter((anchor) => anchor.role === 'control')
        .map((anchor) => (
          <circle
            key={anchor.qubitId}
            cx={operation.x}
            cy={anchor.y}
            r={control}
            className="fill-current"
          />
        ))}
    </g>
  );
}

/**
 * A gate's targets, in conventional notation.
 *
 * A box means one thing only -- a single-qubit gate -- which is what keeps an
 * unrelated gate sharing a column from reading as part of this operation. The
 * symbol table and its reasoning are in `./glyphs`.
 */
function Gate({
  gate,
  layout,
  selected,
}: {
  readonly gate: GateLayout;
  readonly layout: CircuitLayout;
  readonly selected: boolean;
}): React.JSX.Element {
  return (
    <g data-operation-id={gate.operationId} data-selected={selected}>
      {gate.anchors
        .filter((anchor) => anchor.role === 'target')
        .map((anchor) => (
          <TargetSymbol
            key={anchor.qubitId}
            symbol={targetGlyph(gate.name)}
            x={gate.x}
            y={anchor.y}
            metrics={layout.metrics}
            emphasised={selected}
          />
        ))}
    </g>
  );
}

/**
 * One gate target, in conventional notation.
 *
 * Shared by the committed gate and the placement preview rather than drawn twice.
 * A preview that renders a `cx` as a labelled box -- which is what a generic
 * box-and-name preview does -- would break the rule the whole notation rests on,
 * that a box means exactly one thing, and would teach the user to expect a glyph
 * they are not about to get.
 */
function TargetSymbol({
  symbol,
  x,
  y,
  metrics,
  emphasised,
}: {
  readonly symbol: TargetGlyph;
  readonly x: number;
  readonly y: number;
  readonly metrics: LayoutMetrics;
  readonly emphasised: boolean;
}): React.JSX.Element {
  const { glyph, control } = metrics;
  const stroke = emphasised ? 3 : 1.5;
  const radius = glyph * 0.28;
  const arm = glyph * 0.2;

  return (
    <g data-glyph={symbol.kind}>
      {symbol.kind === 'box' && (
        <>
          <rect
            x={x - glyph / 2}
            y={y - glyph / 2}
            width={glyph}
            height={glyph}
            rx={6}
            className="fill-surface-raised stroke-current"
            strokeWidth={stroke}
          />
          <text
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="central"
            className="fill-current font-mono text-sm"
          >
            {symbol.label}
          </text>
        </>
      )}

      {/*
        Unfilled, so the connector runs into it rather than stopping at its
        edge. The cross is drawn in full rather than borrowing the connector
        for its vertical bar -- the connector terminates at the anchor centre,
        which would draw only the upper half.
      */}
      {symbol.kind === 'crossed-circle' && (
        <>
          <circle
            cx={x}
            cy={y}
            r={radius}
            className="fill-none stroke-current"
            strokeWidth={stroke}
          />
          <line
            x1={x - radius}
            y1={y}
            x2={x + radius}
            y2={y}
            className="stroke-current"
            strokeWidth={stroke}
          />
          <line
            x1={x}
            y1={y - radius}
            x2={x}
            y2={y + radius}
            className="stroke-current"
            strokeWidth={stroke}
          />
        </>
      )}

      {/* CZ is symmetric, so its target is drawn like its control. */}
      {symbol.kind === 'dot' && (
        <circle
          cx={x}
          cy={y}
          r={emphasised ? control + 1.5 : control}
          className="fill-current"
        />
      )}

      {symbol.kind === 'swap' && (
        <>
          <line
            x1={x - arm}
            y1={y - arm}
            x2={x + arm}
            y2={y + arm}
            className="stroke-current"
            strokeWidth={stroke}
            strokeLinecap="round"
          />
          <line
            x1={x + arm}
            y1={y - arm}
            x2={x - arm}
            y2={y + arm}
            className="stroke-current"
            strokeWidth={stroke}
            strokeLinecap="round"
          />
        </>
      )}
    </g>
  );
}

function Measurement({
  measurement,
  layout,
  selected,
}: {
  readonly measurement: MeasurementLayout;
  readonly layout: CircuitLayout;
  readonly selected: boolean;
}): React.JSX.Element {
  const { glyph } = layout.metrics;
  const anchor = measurement.anchors[0];
  if (anchor === undefined) return <g />;

  return (
    <g data-operation-id={measurement.operationId} data-selected={selected}>
      <rect
        x={measurement.x - glyph / 2}
        y={anchor.y - glyph / 2}
        width={glyph}
        height={glyph}
        rx={6}
        className="fill-surface-raised stroke-current"
        strokeWidth={selected ? 3 : 1.5}
      />
      {/* A meter: an arc with a needle, the conventional measurement glyph. */}
      <path
        d={dial(measurement.x, anchor.y, glyph)}
        className="fill-none stroke-current"
        strokeWidth={1.5}
      />
      <line
        x1={measurement.x}
        y1={anchor.y + glyph * 0.16}
        x2={measurement.x + glyph * 0.24}
        y2={anchor.y - glyph * 0.2}
        className="stroke-current"
        strokeWidth={1.5}
      />
      <text
        x={measurement.x + glyph * 0.45}
        y={measurement.registerY - 8}
        className="fill-current font-mono text-xs"
      >
        {measurement.bit}
      </text>
    </g>
  );
}

/** Visual only. Clicks arrive through `BarrierHitTarget`, above the cell layer. */
function Barrier({
  barrier,
  selected,
}: {
  readonly barrier: BarrierLayout;
  readonly selected: boolean;
}): React.JSX.Element {
  return (
    <g data-operation-id={barrier.operationId} data-selected={selected}>
      {barrier.segments.map((segment) => (
        <line
          key={`${String(segment.y1)}-${String(segment.y2)}`}
          x1={barrier.x}
          y1={segment.y1}
          x2={barrier.x}
          y2={segment.y2}
          className={`stroke-current ${selected ? 'opacity-100' : 'opacity-50'}`}
          strokeWidth={selected ? 4 : 2}
          strokeDasharray="4 4"
        />
      ))}
    </g>
  );
}

/**
 * What the next click would assign, drawn under the cursor.
 *
 * The glyph is the one the gate will actually render, not a generic labelled
 * box, so the preview cannot promise a shape the commit will not deliver. A
 * control previews as the filled dot a control always is.
 */
function Preview({
  x,
  y,
  metrics,
  name,
  role,
}: {
  readonly x: number;
  readonly y: number;
  readonly metrics: LayoutMetrics;
  readonly name: GateName;
  readonly role: QubitRole;
}): React.JSX.Element {
  return (
    <g className="opacity-40" data-testid="placement-preview" data-role={role}>
      {role === 'control' ? (
        <circle
          cx={x}
          cy={y}
          r={metrics.control}
          className="fill-current"
          data-glyph="control"
        />
      ) : (
        <TargetSymbol
          symbol={targetGlyph(name)}
          x={x}
          y={y}
          metrics={metrics}
          emphasised={false}
        />
      )}
    </g>
  );
}

/**
 * A multi-qubit gate part-way through being placed.
 *
 * Drawn at full strength rather than as a preview: these wires are decided, and
 * UI.md asks for assigned controls solid. What is still provisional is the one
 * under the cursor, which `Preview` draws faintly, and the column -- the
 * derivation has not seen this operation yet, so where it settles is not decided
 * until it commits.
 */
function PendingPlacement({
  pending,
  metrics,
}: {
  readonly pending: PendingPreview;
  readonly metrics: LayoutMetrics;
}): React.JSX.Element {
  return (
    <g data-testid="pending-placement" data-gate={pending.name}>
      {pending.connector.map((segment) => (
        <line
          key={`${String(segment.y1)}-${String(segment.y2)}`}
          x1={pending.x}
          y1={segment.y1}
          x2={pending.x}
          y2={segment.y2}
          className="stroke-current"
          strokeWidth={1.5}
        />
      ))}

      {pending.anchors.map((anchor) =>
        anchor.role === 'control' ? (
          <circle
            key={anchor.qubitId}
            cx={pending.x}
            cy={anchor.y}
            r={metrics.control}
            className="fill-current"
            data-glyph="control"
          />
        ) : (
          <TargetSymbol
            key={anchor.qubitId}
            symbol={targetGlyph(pending.name)}
            x={pending.x}
            y={anchor.y}
            metrics={metrics}
            emphasised={false}
          />
        ),
      )}
    </g>
  );
}

function dial(x: number, y: number, glyph: number): string {
  const radius = glyph * 0.28;
  return `M ${String(x - radius)} ${String(y + glyph * 0.16)} A ${String(radius)} ${String(radius)} 0 0 1 ${String(x + radius)} ${String(y + glyph * 0.16)}`;
}

function describe(layout: CircuitLayout): string {
  const wires = layout.wires.length;
  const operations = layout.operations.length;
  const barriers = layout.barriers.length;

  return [
    `Quantum circuit with ${String(wires)} ${plural(wires, 'qubit')}`,
    `${String(layout.registers.length)} classical ${plural(layout.registers.length, 'register')}`,
    `${String(operations)} ${plural(operations, 'operation')}`,
    `${String(barriers)} ${plural(barriers, 'barrier')}`,
    `depth ${String(layout.depth)}`,
  ].join(', ');
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}
