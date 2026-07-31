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
import { removeOperation } from '../state/edits';
import { useCircuitStore } from '../state/useCircuitStore';
import { validateCircuit } from '../validation';
import { CircuitCanvas, type CellPosition } from './CircuitCanvas';
import { GatePalette } from './GatePalette';
import { ProblemsStrip } from './ProblemsStrip';
import { layoutCircuit } from './layout';
import { defaultParameters } from './palette';
import {
  describeCells,
  insertionIndexFor,
  operationAt,
  operationIdFromPath,
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

  function place(name: GateName, qubitId: string, column: number): void {
    const signature = GATE_SIGNATURES[name];
    const id = newIdentifier();
    const index = insertionIndexFor(circuit, decomposition, qubitId, column);

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
          onCursorChange={moveCursor}
          onActivate={activate}
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
