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
import type { Circuit, GateName } from '../model/circuit';
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
import { CircuitCanvas, type CellPosition, type Settle } from './CircuitCanvas';
import { GatePalette } from './GatePalette';
import { ProblemsStrip } from './ProblemsStrip';
import { layoutCircuit } from './layout';
import { defaultParameters } from './palette';
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

    place(armed, qubitId, cell.column);
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

  function endDrag(): void {
    if (dragging === null) return;
    const operationId = dragging;
    const from = requested.current;

    setDragging(null);
    requested.current = null;
    store.endCoalescing();
    if (from !== null) scheduleSettle(operationId, from);
  }

  function describeOperation(operation: { readonly kind: string }): string {
    return operation.kind === 'gate' ? 'gate' : operation.kind;
  }

  function place(name: GateName, qubitId: string, column: number): void {
    const signature = GATE_SIGNATURES[name];
    const id = newIdentifier();
    const index = insertionIndexFor(circuit, decomposition, [qubitId], column);
    scheduleSettle(id, column);

    store.apply(`Place ${name} on ${describeWire(qubitId)}`, (current) =>
      insertOperation(
        current,
        {
          id,
          kind: 'gate',
          name,
          targets: [qubitId],
          controls: [],
          parameters: defaultParameters(signature),
        },
        index,
      ),
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
        <GatePalette armed={armed} onArm={setArmed} />
      </aside>

      <div className="flex min-w-0 flex-col gap-4">
        <CircuitCanvas
          layout={layout}
          cells={cells}
          cursor={cursor}
          selection={selection}
          armed={armed}
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
          onSelectOperation={(id) => {
            store.select(id);
          }}
          onRemoveSelection={removeSelected}
          onCancel={() => {
            setArmed(null);
            store.select(null);
          }}
        />

        <p className="text-sm text-ink-muted" role="status">
          {`Depth ${String(decomposition.depth)} · ${String(circuit.operations.length)} operations`}
          {armed !== null && ` · placing ${armed}`}
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
