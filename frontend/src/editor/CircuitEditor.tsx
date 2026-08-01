/**
 * The editor: one store, one circuit, everything else derived on every render.
 *
 * This is where the derivation-drives-layout constraint is enforced. Nothing here
 * stores a column, a coordinate, or a copy of the circuit -- `deriveCycles`,
 * `layoutCircuit`, `describeCells`, and `validateCircuit` all run from the single
 * circuit the store holds, and their output is handed to the components and
 * discarded. See docs/Architecture.md and ADR-0001.
 *
 * The three regions are from UI.md. The right column is reserved for Milestone
 * 4's results panel and is not rendered, so adding it is not a re-layout.
 *
 * Interaction state that is *not* the circuit -- what is armed, where the cell
 * cursor is -- lives in component state deliberately. ADR-0007 section 4 keeps it
 * out of history: undo restores the document, not where you were looking.
 */

import { useMemo, useRef, useState } from 'react';

import { deriveCycles } from '../cycles';
import type { Circuit, GateName, Operation } from '../model/circuit';
import { GATE_SIGNATURES } from '../model/spec';
import { createCircuitStore, insertOperation, newIdentifier } from '../state';
import {
  isRetargetable,
  moveOperation,
  removeOperation,
  retargetOperation,
} from '../state/edits';
import { useCircuitStore } from '../state/useCircuitStore';
import { validateCircuit } from '../validation';
import {
  CircuitCanvas,
  type CellPosition,
  type PendingPreview,
  type Settle,
} from './CircuitCanvas';
import { GatePalette } from './GatePalette';
import { ProblemsStrip } from './ProblemsStrip';
import { columnCenter, layoutCircuit, pendingConnector } from './layout';
import {
  assignQubit,
  beginPending,
  canAssign,
  describeRemaining,
  isSatisfied,
  nextRole,
  pendingAnchors,
  pendingOperation,
  type PendingOperation,
} from './pending';
import {
  describeCells,
  insertionIndexFor,
  moveDestinationIndex,
  operationAt,
  operationIdFromPath,
  qubitsOf,
} from './placement';

export interface CircuitEditorProps {
  readonly initialCircuit: Circuit;
}

export function CircuitEditor({
  initialCircuit,
}: CircuitEditorProps): React.JSX.Element {
  const store = useRef(createCircuitStore(initialCircuit)).current;
  const { circuit, selection } = useCircuitStore(store);

  const [armed, setArmed] = useState<GateName | null>(null);
  const [cursor, setCursor] = useState<CellPosition>({ row: 0, column: 0 });
  const [dragging, setDragging] = useState<string | null>(null);
  const [settle, setSettle] = useState<Settle | null>(null);

  /**
   * A multi-qubit gate part-way through having its wires assigned.
   *
   * Interaction state, not circuit state: nothing is in the circuit until the
   * signature is satisfied, so there is nothing for history to hold and nothing
   * for `validateCircuit` to report. UI.md makes that explicit -- reporting
   * "gate arity mismatch" between the first and second click of placing a `cx`
   * is accurate and useless.
   */
  const [pending, setPending] = useState<PendingOperation | null>(null);

  /**
   * The column the last drag step asked for, so the settle animation can play
   * once when the gesture ends rather than on every intermediate position.
   */
  const requested = useRef<number | null>(null);
  const settles = useRef(0);

  function scheduleSettle(operationId: string, fromColumn: number): void {
    settles.current += 1;
    setSettle({ operationId, fromColumn, nonce: settles.current });
  }

  const decomposition = useMemo(() => deriveCycles(circuit), [circuit]);
  const layout = useMemo(
    () => layoutCircuit(circuit, decomposition),
    [circuit, decomposition],
  );
  const cells = useMemo(
    () =>
      describeCells(
        circuit,
        decomposition,
        layout.wires.map((wire) => wire.qubitId),
        layout.columnCount,
      ),
    [circuit, decomposition, layout],
  );
  const violations = useMemo(
    () => validateCircuit(circuit).violations,
    [circuit],
  );

  /**
   * The pending placement resolved to geometry, so the canvas keeps having
   * nothing to decide.
   *
   * A wire that no longer resolves is dropped, on the same principle as
   * `layout.ts`: an assignment can outlive the qubit it names if the circuit
   * changes underneath it.
   */
  const pendingPreview = useMemo<PendingPreview | null>(() => {
    if (pending === null) return null;

    const anchors = pendingAnchors(pending).flatMap((anchor) => {
      const wire = layout.wires.find((w) => w.qubitId === anchor.qubitId);
      return wire === undefined ? [] : [{ ...anchor, y: wire.y }];
    });

    return {
      name: pending.name,
      x: columnCenter(pending.column, layout.metrics),
      anchors,
      connector: pendingConnector(anchors, layout),
      nextRole: nextRole(pending),
    };
  }, [pending, layout]);

  /**
   * Hovering moves the cursor, so the placement preview follows the mouse.
   *
   * Pointer and keyboard share one cursor rather than having a hover state
   * beside it: the cursor means "where the next action lands", and which device
   * put it there does not change that. Guarded because pointer-enter fires per
   * cell crossed and re-rendering on an unchanged position is pure waste.
   */
  function moveCursor(cell: CellPosition): void {
    setCursor((current) =>
      current.row === cell.row && current.column === cell.column
        ? current
        : cell,
    );
  }

  function activate(cell: CellPosition): void {
    const qubitId = layout.wires[cell.row]?.qubitId;
    if (qubitId === undefined) return;

    if (armed === null) {
      const existing = operationAt(
        circuit,
        decomposition,
        qubitId,
        cell.column,
      );
      if (existing !== undefined) store.select(existing.id);
      return;
    }

    assignWire(armed, qubitId, cell.column);
  }

  /**
   * Move an operation to a cell.
   *
   * Two changes a single gesture combines: `retargetOperation` moves it to
   * another wire, `moveOperation` changes its position in the canonical list.
   * A multi-qubit operation only does the second -- which of its qubits a drag
   * meant to move is ambiguous, and guessing would produce a circuit nobody
   * asked for.
   */
  function moveTo(
    operationId: string,
    cell: CellPosition,
    drag: boolean,
  ): void {
    const operation = circuit.operations.find(
      (candidate) => candidate.id === operationId,
    );
    const wire = layout.wires[cell.row]?.qubitId;
    if (operation === undefined || wire === undefined) return;

    const retarget =
      isRetargetable(operation) && !operation.targets.includes(wire);

    // Every qubit it uses, not just its target: a cx occupies its control wire
    // too, and an index computed from the target alone can place it before an
    // operation on the control that it has to follow.
    const qubitIds = retarget ? [wire] : qubitsOf(operation);

    store.apply(
      `Move ${describeOperation(operation)}`,
      (current) => {
        const index = moveDestinationIndex(
          current,
          operationId,
          qubitIds,
          cell.column,
        );
        const retargeted = retarget
          ? retargetOperation(current, operationId, wire)
          : current;
        return moveOperation(retargeted, operationId, index);
      },
      drag ? { coalescingKey: `move:${operationId}` } : {},
    );

    if (drag) requested.current = cell.column;
    else scheduleSettle(operationId, cell.column);
  }

  /**
   * Move the selection one cell, from wherever the derivation currently puts it.
   *
   * Its column is read from the decomposition rather than inverted out of a
   * pixel coordinate -- the cycle index *is* the column, and asking the geometry
   * to give it back would make the keyboard depend on the rendering constants.
   */
  function nudgeSelection(rows: number, columns: number): void {
    if (selection === null) return;

    const cycle = decomposition.cycles.findIndex((ids) =>
      ids.includes(selection),
    );
    const barrier = decomposition.barriers.find(
      (placement) => placement.operationId === selection,
    );
    const column = cycle >= 0 ? cycle : (barrier?.beforeCycle ?? 0);

    // Read the row from the operation's own first qubit rather than from the
    // rendered anchors: a barrier has no entry in `layout.operations`, and
    // defaulting its row to 0 made a vertical nudge silently retarget it.
    const operation = circuit.operations.find(
      (candidate) => candidate.id === selection,
    );
    const row = Math.max(
      0,
      layout.wires.findIndex((wire) => wire.qubitId === operation?.targets[0]),
    );

    const clamp = (value: number, count: number): number =>
      Math.max(0, Math.min(value, count - 1));

    moveTo(
      selection,
      {
        row: clamp(row + rows, layout.wires.length),
        column: clamp(column + columns, layout.columnCount),
      },
      false,
    );
  }

  /**
   * Begin dragging an operation.
   *
   * Called by whichever layer knows where the operation is: the cells for gates
   * and measurements, the barrier hit-target for barriers, which sit on the
   * boundary between columns and so are in no cell at all.
   *
   * Ignored while a palette gate is armed -- a press on an occupied cell then
   * means "place here", not "pick that up".
   */
  function pickUp(operationId: string): void {
    if (armed !== null) return;
    store.select(operationId);
    setDragging(operationId);
  }

  /**
   * Step the selection through the circuit's barriers.
   *
   * Barriers sit on the boundary *between* columns and appear in no cycle, so
   * `describeCells` cannot place one and no amount of arrowing reaches it. This
   * is the keyboard's only route to a barrier; without it they were selectable
   * by mouse alone, which UI.md forbids.
   *
   * Starts from the cursor rather than from the first barrier, so pressing it
   * while working at column 8 does not jump to column 0.
   */
  function cycleBarriers(direction: 1 | -1): void {
    const barriers = decomposition.barriers;
    if (barriers.length === 0) return;

    const current = barriers.findIndex(
      (placement) => placement.operationId === selection,
    );

    if (current >= 0) {
      const next = (current + direction + barriers.length) % barriers.length;
      store.select(barriers[next]?.operationId ?? null);
      return;
    }

    const ordered = [...barriers].sort((a, b) => a.beforeCycle - b.beforeCycle);
    const from =
      direction === 1
        ? (ordered.find((p) => p.beforeCycle >= cursor.column) ?? ordered[0])
        : ([...ordered].reverse().find((p) => p.beforeCycle <= cursor.column) ??
          ordered.at(-1));

    store.select(from?.operationId ?? null);
  }

  function endDrag(): void {
    if (dragging === null) return;
    const operationId = dragging;
    const from = requested.current;

    setDragging(null);
    requested.current = null;
    store.endCoalescing();
    if (from !== null) scheduleSettle(operationId, from);
  }

  function describeOperation(operation: Operation): string {
    return operation.kind === 'gate' ? operation.name : operation.kind;
  }

  const selectedLabel =
    selection === null
      ? null
      : (() => {
          const operation = circuit.operations.find(
            (candidate) => candidate.id === selection,
          );
          return operation === undefined ? null : describeOperation(operation);
        })();

  /**
   * One click of a placement, whatever stage it is at.
   *
   * **Single- and multi-qubit placement are the same code path**, which is the
   * point: a single-qubit gate's signature is satisfied by its first click, so
   * it commits immediately and never has a pending state to see. Two paths that
   * had to agree with each other would be two chances to disagree.
   *
   * Only the first click carries a column -- a gate occupies one column across
   * every wire it uses, so a later click has no column to contribute. See
   * `./pending`.
   */
  function assignWire(name: GateName, qubitId: string, column: number): void {
    if (pending === null) {
      advance(beginPending(name, GATE_SIGNATURES[name], qubitId, column));
      return;
    }

    // A wire already assigned is refused rather than taken twice, because the
    // operation it would commit -- a cx controlled by its own target -- is one
    // no edit in the vocabulary can repair. See `canAssign`.
    if (!canAssign(pending, qubitId)) return;
    advance(assignQubit(pending, qubitId));
  }

  function advance(next: PendingOperation): void {
    if (isSatisfied(next)) {
      commit(next);
      setPending(null);
      return;
    }
    setPending(next);
  }

  function commit(satisfied: PendingOperation): void {
    const id = newIdentifier();
    const operation = pendingOperation(satisfied, id);

    // Every qubit it uses, not just its target. A cx occupies its control wire
    // as surely as its target, and an index computed from the target alone puts
    // it before something on the control that it has to follow.
    const index = insertionIndexFor(
      circuit,
      decomposition,
      qubitsOf(operation),
      satisfied.column,
    );
    scheduleSettle(id, satisfied.column);

    store.apply(
      `Place ${satisfied.name} on ${satisfied.qubits.map(describeWire).join(', ')}`,
      (current) => insertOperation(current, operation, index),
    );
    store.select(id);
  }

  function describeWire(qubitId: string): string {
    return (
      layout.wires.find((wire) => wire.qubitId === qubitId)?.label ?? qubitId
    );
  }

  function removeSelected(): void {
    if (selection === null) return;
    store.apply('Remove operation', (current) =>
      removeOperation(current, selection),
    );
  }

  return (
    <div className="grid h-full grid-cols-[auto_1fr] gap-6">
      <aside className="w-44">
        {/*
          Arming a different gate abandons any placement in progress. Keeping it
          would leave a half-assigned cx waiting behind a swap the user has
          since armed, and the next canvas click would finish the wrong gate.
        */}
        <GatePalette
          armed={armed}
          onArm={(name) => {
            setArmed(name);
            setPending(null);
          }}
        />
      </aside>

      <div className="flex min-w-0 flex-col gap-4">
        <CircuitCanvas
          layout={layout}
          cells={cells}
          cursor={cursor}
          selection={selection}
          armed={armed}
          pending={pendingPreview}
          dragging={dragging}
          settle={settle}
          onCursorChange={(cell) => {
            const changed =
              cell.row !== cursor.row || cell.column !== cursor.column;
            moveCursor(cell);
            // A drag applies as it goes, coalescing into one undo step, so the
            // gate follows the pointer instead of jumping at the end. Guarded:
            // pointer-move fires continuously over a single cell.
            if (dragging !== null && changed) moveTo(dragging, cell, true);
          }}
          onActivate={activate}
          onPickUp={pickUp}
          onDropDrag={endDrag}
          onNudgeSelection={nudgeSelection}
          onUndo={() => {
            setSettle(null);
            store.undo();
          }}
          onRedo={() => {
            setSettle(null);
            store.redo();
          }}
          onCycleBarriers={cycleBarriers}
          onSelectOperation={(id) => {
            store.select(id);
          }}
          onRemoveSelection={removeSelected}
          /*
            One job per press, most specific first. Escape carries three
            meanings in UI.md's shortcut table, and doing all of them at once
            makes the two the user did not mean invisible -- cancelling a
            half-placed cx would silently drop the selection as well.

            Cancelling a placement leaves the gate armed, so retrying it costs
            no trip back to the palette. A second press disarms.
          */
          onCancel={() => {
            if (pending !== null) {
              setPending(null);
            } else if (armed !== null) {
              setArmed(null);
            } else {
              store.select(null);
            }
          }}
        />

        <p className="text-sm text-ink-muted" role="status">
          {`Depth ${String(decomposition.depth)} · ${String(circuit.operations.length)} operations`}
          {armed !== null && ` · placing ${armed}`}
          {/*
            The prompt for the next wire lives here rather than beside the
            cursor, because the cursor has not moved: a screen reader has no
            other way to learn that a placement is outstanding, or how many
            wires it still wants.
          */}
          {pending !== null && ` · ${describeRemaining(pending) ?? ''}`}
          {/*
            The cell cursor does not follow the selection, so for anything not
            announced by aria-activedescendant -- a barrier above all -- this
            live region is how a screen reader learns what is selected.
          */}
          {selectedLabel !== null && ` · ${selectedLabel} selected`}
        </p>

        <ProblemsStrip
          violations={violations}
          onSelect={(path) => {
            const id = operationIdFromPath(circuit, path);
            if (id !== undefined) store.select(id);
          }}
        />
      </div>
    </div>
  );
}
