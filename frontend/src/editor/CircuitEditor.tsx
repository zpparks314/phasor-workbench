/**
 * The editor: one store, one circuit, everything else derived on every render.
 *
 * This is where the derivation-drives-layout constraint is enforced. Nothing here
 * stores a column, a coordinate, or a copy of the circuit -- `deriveCycles`,
 * `layoutCircuit`, `describeCells`, and `validateCircuit` all run from the single
 * circuit the store holds, and their output is handed to the components and
 * discarded. See docs/Architecture.md and ADR-0001.
 *
 * The regions are from UI.md. The right column was reserved and unrendered
 * through Milestone 3 so that filling it would not be a re-layout; the inspector
 * fills it, and Milestone 4's results panel joins it below rather than
 * displacing it.
 *
 * Interaction state that is *not* the circuit -- what is armed, where the cell
 * cursor is -- lives in component state deliberately. ADR-0007 section 4 keeps it
 * out of history: undo restores the document, not where you were looking.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { deriveCycles } from '../cycles';
import type {
  Circuit,
  ClassicalTarget,
  GateName,
  Operation,
} from '../model/circuit';
import { GATE_SIGNATURES } from '../model/spec';
import { createCircuitStore, insertOperation, newIdentifier } from '../state';
import {
  addClassicalRegister,
  addQubit,
  clearOperations,
  isRetargetable,
  moveOperation,
  operationsLostWithQubit,
  operationsLostWithRegister,
  removeClassicalRegister,
  removeOperation,
  removeQubit,
  retargetOperation,
  setClassicalTarget,
  setParameters,
  setRegisterSize,
} from '../state/edits';
import { downloadCircuit, downloadQasm, importCircuitFile } from '../files';
import { fetchExample, type ExampleEntry } from '../api/examples';
import { saveCircuit } from '../persistence';
import { useCircuitStore } from '../state/useCircuitStore';
import { validateCircuit } from '../validation';
import {
  CircuitCanvas,
  type CellPosition,
  type PendingPreview,
  type Settle,
} from './CircuitCanvas';
import { AnalysisPanel } from './AnalysisPanel';
import { EditorHeader } from './EditorHeader';
import { ExamplePicker } from './ExamplePicker';
import { useExamples } from './useExamples';
import { GatePalette } from './GatePalette';
import { Inspector } from './Inspector';
import { ResultsPanel } from './ResultsPanel';
import { useSimulation } from './useSimulation';
import { useAnalysis } from './useAnalysis';
import { ProblemsStrip } from './ProblemsStrip';
import { ShortcutReference } from './ShortcutReference';
import { isTypingTarget, resolveShortcut } from './shortcuts';
import { StructureControls } from './StructureControls';
import { ViewControls } from './ViewControls';
import { columnCenter, layoutCircuit, pendingConnector } from './layout';
import { isGateName, type PaletteItem } from './palette';
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
  const { circuit, selection, canUndo, canRedo, undoLabel, redoLabel } =
    useCircuitStore(store);

  const [armed, setArmed] = useState<PaletteItem | null>(null);
  const [cursor, setCursor] = useState<CellPosition>({ row: 0, column: 0 });
  const [dragging, setDragging] = useState<string | null>(null);
  const [settle, setSettle] = useState<Settle | null>(null);

  /**
   * Whether the canvas numbers its cycles.
   *
   * Component state, beside `armed` and `cursor` and for the same reason:
   * ADR-0007 section 4 keeps the history stack to circuit values, and undo
   * restores the document rather than what you were looking at. Turning labels
   * on must not be undoable, and must not make the previous edit un-undoable.
   *
   * Off by default -- the labels are opt-in, and the numbering itself is
   * derived from `deriveCycles` with nothing hand-authored.
   */
  const [showCycleLabels, setShowCycleLabels] = useState(false);

  /**
   * Whether the `?` reference is open.
   *
   * Component state beside `showCycleLabels`, and for the same reason: ADR-0007
   * section 4 keeps history to circuit values, so reading the shortcut list must
   * not be undoable and must not make the previous edit un-undoable.
   */
  const [showShortcuts, setShowShortcuts] = useState(false);

  /**
   * `?`, from wherever you are.
   *
   * The editor's only document-level listener, and the only shortcut not scoped
   * to the canvas. It was canvas-scoped at first, on the reasoning that it
   * should match the other ten — which was backwards: those need a cell cursor,
   * and this one needs to work when you have no idea where you are. In practice
   * it did nothing until you had clicked the canvas, which is how the mistake
   * was found.
   *
   * Guarded against firing while you type. `?` is `Shift` + `/`, so without
   * `isTypingTarget` it would swallow a question mark meant for a field.
   */
  useEffect(() => {
    function handleGlobalKey(event: KeyboardEvent): void {
      if (isTypingTarget(event.target)) return;
      if (resolveShortcut(event, 'global')?.kind !== 'shortcuts') return;

      event.preventDefault();
      setShowShortcuts((open) => !open);
    }

    globalThis.addEventListener('keydown', handleGlobalKey);
    return () => {
      globalThis.removeEventListener('keydown', handleGlobalKey);
    };
  }, []);

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
   * When the working set was last written, and why the last attempt failed.
   *
   * Not in history: ADR-0007 section 4 keeps the stack to circuit values, and
   * undoing an edit does not un-save a file.
   */
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

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

  /**
   * Undo and redo drop any settle in flight.
   *
   * The animation describes a move that just happened; replaying it against a
   * circuit that has been rewound would animate a journey the operation is no
   * longer making. Shared by the header buttons and the keyboard so the two
   * cannot diverge.
   */
  function undo(): void {
    setSettle(null);
    store.undo();
  }

  function redo(): void {
    setSettle(null);
    store.redo();
  }

  /**
   * Write the working set.
   *
   * Goes through `dumpCircuit`, not `dumpResult`: the circuit here has been
   * edited by definition, and preserved fields are keyed to positions editing
   * moves. ADR-0008 section 3.
   *
   * A failure is stated rather than swallowed, and says the circuit is still in
   * memory — silence would let someone close the tab believing otherwise.
   */
  function save(): void {
    const outcome = saveCircuit(circuit);

    if (outcome.ok) {
      setSavedAt(outcome.savedAt);
      setSaveError(null);
      return;
    }

    setSaveError(
      outcome.reason === 'full'
        ? 'Could not save: browser storage is full.'
        : 'Could not save: browser storage is unavailable.',
    );
  }

  /**
   * Hand the circuit to the browser as a file.
   *
   * Same `dumpCircuit` reasoning as `save`, and for the same reason: an edited
   * circuit has nothing to preserve that could be restored faithfully.
   */
  function exportFile(): void {
    downloadCircuit(circuit);
  }

  /**
   * Hand the circuit to the browser as an OpenQASM file.
   *
   * The only export that can fail, because the writer is on the backend. It
   * reports through the same surface as a failed import: both are file
   * operations that leave the canvas exactly as it was.
   */
  async function exportQasmFile(): Promise<void> {
    const outcome = await downloadQasm(circuit);

    setFileError(outcome.ok ? null : outcome.message);
  }

  /**
   * Replace the circuit with one read from a file.
   *
   * One `store.apply`, so it is a single undo step whose label names the file
   * that displaced the previous circuit — which is what makes it safe to do
   * without a confirmation, per UI.md's *Files*.
   *
   * A rejected file leaves the circuit alone. Every reason is reported, not the
   * first, because a file with three problems fixed one at a time is three
   * round trips.
   */
  async function importFile(file: File): Promise<void> {
    const outcome = await importCircuitFile(file);

    if (!outcome.ok) {
      // Two failures with different remedies. A file that cannot be read needs
      // the user to change the file; a backend that cannot be reached needs
      // nothing from them at all, and saying "could not import" for both would
      // send them to fix something that is not broken.
      const reason =
        outcome.reason === 'unreachable'
          ? outcome.message
          : outcome.violations.map((violation) => violation.message).join(' ');

      setFileError(
        `Could not import ${file.name}: ${reason} The circuit on the canvas is unchanged.`,
      );
      return;
    }

    setFileError(null);
    store.apply(`Import ${file.name}`, () => outcome.circuit);
  }

  /**
   * Replace the circuit with a built-in example.
   *
   * The same shape as `importFile`, and deliberately: both replace the whole
   * circuit in one undo step whose label names where it came from, and both
   * leave the canvas untouched when they fail. An example is a circuit that
   * arrived over the network rather than from a file, and nothing else.
   */
  async function loadExample(entry: ExampleEntry): Promise<void> {
    let loaded;
    try {
      loaded = await fetchExample(entry.id);
    } catch {
      setFileError(
        `Could not load ${entry.name}: the backend could not be reached. ` +
          'The circuit on the canvas is unchanged.',
      );
      return;
    }

    setFileError(null);
    store.apply(`Load ${entry.name}`, () => loaded);
  }

  const examples = useExamples();

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
   * The selected operation itself, for the inspector and the status line.
   *
   * Looked up from the circuit on every render rather than held beside the
   * selection. The store keeps an identifier for the reason ADR-0007 section 4
   * gives, and a cached operation object would be the second copy of circuit
   * state this project forbids -- stale the moment any edit lands.
   */
  const selected = useMemo(
    () =>
      selection === null
        ? null
        : (circuit.operations.find((candidate) => candidate.id === selection) ??
          null),
    [circuit, selection],
  );

  /**
   * The backend's own analysis, debounced and abortable.
   *
   * The only network call the editor makes. It is deliberately not what the
   * status line reads -- that stays local, because a render must never wait on
   * the network -- so the editor keeps working exactly as before when the
   * backend is down.
   */
  const analysis = useAnalysis(circuit);

  /**
   * The state, live; and the counts, when asked for.
   *
   * Two triggers rather than one, because the operations differ in kind: a
   * statevector is a property the circuit has, sampling is an experiment it is
   * put through. See `./useSimulation`.
   */
  const simulation = useSimulation(circuit);

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

    // Gates run the control-assignment sequence; the other two kinds are a
    // single click, so they place outright rather than through `./pending`.
    if (isGateName(armed)) assignWire(armed, qubitId, cell.column);
    else if (armed === 'measurement') placeMeasurement(qubitId, cell.column);
    else placeBarrier(cell.column);
  }

  /**
   * Place a measurement, writing into the first register's first free bit.
   *
   * **Choosing the register and bit is deferred**, and this default is the whole
   * of it: the first declared register, and the lowest bit no other measurement
   * writes to. A circuit with two registers therefore cannot reach the second,
   * which is a missing feature rather than a wrong one -- the circuit produced is
   * valid, just not necessarily the one a user with two registers wanted.
   * Roadmap.md tracks it.
   *
   * When every bit is taken the next one is out of range, and the circuit is
   * invalid until the user grows the register. That is deliberate rather than
   * clamped: `CLASSICAL_BIT_OUT_OF_RANGE` says exactly what is wrong, the size
   * control fixes it, and clamping instead would silently write two measurements
   * to one bit -- legal, but it makes them contend for that bit and serialises
   * two operations the user expected to be concurrent.
   */
  function placeMeasurement(qubitId: string, column: number): void {
    const register = circuit.classicalRegisters[0];
    if (register === undefined) return;

    const taken = new Set(
      circuit.operations.flatMap((operation) =>
        operation.kind === 'measurement' &&
        operation.classicalTarget.register === register.id
          ? [operation.classicalTarget.bit]
          : [],
      ),
    );
    let bit = 0;
    while (taken.has(bit)) bit += 1;

    const id = newIdentifier();
    const index = insertionIndexFor(circuit, decomposition, [qubitId], column);
    scheduleSettle(id, column);

    store.apply(`Measure ${describeWire(qubitId)}`, (current) =>
      insertOperation(
        current,
        {
          id,
          kind: 'measurement',
          targets: [qubitId],
          classicalTarget: { register: register.id, bit },
        },
        index,
      ),
    );
    store.select(id);
  }

  /**
   * Place a barrier across every wire currently in the circuit.
   *
   * **All wires, captured now rather than tracked.** A barrier's targets are
   * authored data, and CircuitModel.md rules out an implicit "all qubits"
   * barrier precisely because its meaning would change when a qubit is added.
   * Expanding at placement time is what OpenQASM's bare `barrier;` does on
   * import, and it leaves the document saying exactly what it means: a barrier
   * over these wires, which nothing later rewrites.
   *
   * Removing a qubit still shrinks it, and that is not the mirror of this. A
   * removed qubit takes its reference with it, so the shrink is forced by
   * referential integrity; a new qubit is referenced by nothing and forces
   * nothing.
   */
  function placeBarrier(column: number): void {
    const [first, ...rest] = layout.wires.map((wire) => wire.qubitId);
    if (first === undefined) return;

    const id = newIdentifier();
    const index = insertionIndexFor(
      circuit,
      decomposition,
      [first, ...rest],
      column,
    );

    store.apply('Place barrier', (current) =>
      insertOperation(
        current,
        { id, kind: 'barrier', targets: [first, ...rest] },
        index,
      ),
    );
    store.select(id);
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

  const selectedLabel = selected === null ? null : describeOperation(selected);

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

  function describeRegister(registerId: string): string {
    return (
      layout.registers.find((lane) => lane.registerId === registerId)?.label ??
      registerId
    );
  }

  /**
   * The circuit's structure, with what each removal would cost.
   *
   * The cost is computed by `state/edits.ts` running the edit rather than
   * restated here: a barrier over a qubit is shrunk rather than removed, so
   * counting every operation that merely touches the wire would overstate the
   * damage in the one message whose whole job is to be accurate.
   */
  const structure = useMemo(
    () => ({
      qubits: layout.wires.map((wire) => ({
        id: wire.qubitId,
        label: wire.label,
        operationCount: operationsLostWithQubit(circuit, wire.qubitId),
      })),
      registers: layout.registers.map((lane) => ({
        id: lane.registerId,
        label: lane.label,
        size: lane.size,
        operationCount: operationsLostWithRegister(circuit, lane.registerId),
      })),
    }),
    [circuit, layout],
  );

  function addWire(): void {
    const id = newIdentifier();
    // Labelled by position on render, not stored -- `layout.ts` falls back to
    // `q{index}`, so a wire cannot carry a label that disagrees with its index.
    store.apply(`Add q${String(circuit.qubits.length)}`, (current) =>
      addQubit(current, { id }),
    );
  }

  function addRegister(): void {
    const id = newIdentifier();
    store.apply(
      `Add c${String(circuit.classicalRegisters.length)}`,
      (current) => addClassicalRegister(current, { id, size: 1 }),
    );
  }

  function removeSelected(): void {
    if (selection === null) return;
    store.apply('Remove operation', (current) =>
      removeOperation(current, selection),
    );
  }

  /**
   * Write one parameter, coalescing until the interaction ends.
   *
   * Every call merges into the same history entry, so dragging the angle slider
   * across a hundred values costs one undo step rather than a hundred -- the
   * mechanism ADR-0007 built for gate drags, applied unchanged.
   *
   * The key names the operation *and* the parameter: a two-parameter gate
   * should not have an edit to the second silently absorb the first.
   *
   * Not clamped, not validated. A NaN from an emptied field reaches the circuit
   * and `validateCircuit` reports `PARAMETER_NOT_FINITE`, which is UI.md's rule
   * for every input the editor has.
   */
  function changeParameter(parameter: string, radians: number): void {
    if (selected?.kind !== 'gate') return;
    const operationId = selected.id;

    store.apply(
      `Set ${selected.name} ${parameter}`,
      (current) =>
        setParameters(current, operationId, {
          ...selected.parameters,
          [parameter]: radians,
        }),
      { coalescingKey: `parameter:${operationId}:${parameter}` },
    );
  }

  /**
   * Point the selected measurement at a register and bit.
   *
   * Not coalesced: each choice is a discrete decision rather than a step in a
   * continuous gesture, so each is its own undo step.
   */
  function changeClassicalTarget(target: ClassicalTarget): void {
    if (selected?.kind !== 'measurement') return;
    const operationId = selected.id;

    store.apply(
      `Measure into ${describeRegister(target.register)}[${String(target.bit)}]`,
      (current) => setClassicalTarget(current, operationId, target),
    );
  }

  return (
    <div className="flex h-full flex-col gap-4">
      {/*
        The header spans both columns, per UI.md's region diagram. Undo and redo
        are here as well as on the keyboard; `Ctrl/Cmd + Z` stays the accelerator.
      */}
      <EditorHeader
        canUndo={canUndo}
        canRedo={canRedo}
        undoLabel={undoLabel}
        redoLabel={redoLabel}
        operationCount={circuit.operations.length}
        savedAt={savedAt}
        saveError={saveError}
        fileError={fileError}
        onUndo={undo}
        onRedo={redo}
        onSave={save}
        /*
          One callback, one format argument. The header collects the choice
          because that is where the control lives; which writer runs is this
          module's business, and only one of them can fail.
        */
        onExport={(format) => {
          if (format === 'json') exportFile();
          else void exportQasmFile();
        }}
        onImport={(file) => {
          void importFile(file);
        }}
        onClear={() => {
          store.apply(
            `Clear ${String(circuit.operations.length)} operations`,
            clearOperations,
          );
        }}
      />

      {/*
        Three columns, which is what UI.md's region diagram always described --
        the right one was reserved and unrendered through Milestone 3 so that
        filling it would not be a re-layout. This is that fill, and it was
        exactly the change the reservation promised: one grid template, one
        `aside`, and nothing else moved.
      */}
      {/*
        One grid template, collapsed in two steps -- which is the change
        Frontend.md promised the three-column layout was built for, and it was:
        the components below are untouched by it.

        Three columns at `lg`, palette and canvas at `sm` with the inspector
        spanning both beneath them, and a single stack below that. The DOM order
        is already the reading order UI.md specifies, so collapsing needs no
        `order` and the tab sequence is the same at every width.
      */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 sm:grid-cols-[auto_1fr] lg:grid-cols-[auto_1fr_auto]">
        <aside className="min-w-0 sm:w-44">
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
            /*
            A measurement has nowhere to write with no register declared, which
            is the one entry the circuit can currently refuse. Announced rather
            than hidden -- the model supports measurement, this circuit is not
            ready for one, and those are different statements.
          */
            unavailable={(item) =>
              item === 'measurement' && circuit.classicalRegisters.length === 0
                ? 'Unavailable: add a classical register to measure into.'
                : undefined
            }
          />
        </aside>

        <div className="flex min-w-0 flex-col gap-4">
          {/*
          Above the canvas and aligned with its gutter. Qubits and registers are
          properties of the circuit rather than things placed in it, which is why
          they are here and not in the palette.
        */}
          <StructureControls
            qubits={structure.qubits}
            registers={structure.registers}
            onAddQubit={addWire}
            onAddRegister={addRegister}
            onRemoveQubit={(qubitId) => {
              store.apply(`Remove ${describeWire(qubitId)}`, (current) =>
                removeQubit(current, qubitId),
              );
            }}
            onRemoveRegister={(registerId) => {
              store.apply(`Remove ${describeRegister(registerId)}`, (current) =>
                removeClassicalRegister(current, registerId),
              );
            }}
            onResizeRegister={(registerId, size) => {
              store.apply(
                `Resize ${describeRegister(registerId)} to ${String(size)} bits`,
                (current) => setRegisterSize(current, registerId, size),
              );
            }}
          />

          {/*
            Unavailable when the decomposition has no cycles, which covers both
            the empty circuit and a circuit of wires with nothing on them. One
            rule rather than two, and it is the honest one: the question is
            whether there is anything to label, not whether there are qubits.
          */}
          <ExamplePicker
            examples={examples}
            onLoad={(entry) => {
              void loadExample(entry);
            }}
          />

          <ViewControls
            showCycleLabels={showCycleLabels}
            onShowCycleLabelsChange={setShowCycleLabels}
            cycleLabelsUnavailable={
              decomposition.depth === 0
                ? 'No cycles to label yet: place an operation.'
                : undefined
            }
          />

          <CircuitCanvas
            layout={layout}
            cells={cells}
            cursor={cursor}
            selection={selection}
            armed={armed}
            pending={pendingPreview}
            dragging={dragging}
            settle={settle}
            showCycleLabels={showCycleLabels}
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
            onUndo={undo}
            onRedo={redo}
            onCycleBarriers={cycleBarriers}
            onSave={save}
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

          {/*
            Last in the column and collapsed by default: a shortcut list is read
            once and then not again, so it costs one line of chrome until asked
            for. Its rows come from the same `./shortcuts` the canvas dispatches
            through, which is what stops it drifting from behaviour.
          */}
          <ShortcutReference
            open={showShortcuts}
            onOpenChange={setShowShortcuts}
          />
        </div>

        {/*
          The inspector takes the reserved column, and Milestone 4's results
          panel will sit beneath it rather than replace it: one is what the
          selected operation *is*, the other what the whole circuit *does*, and
          they are read at different moments.
        */}
        <aside className="flex min-w-0 flex-col gap-6 sm:col-span-2 lg:col-span-1 lg:w-56">
          <Inspector
            operation={selected}
            registers={layout.registers.map((lane) => ({
              id: lane.registerId,
              label: lane.label,
              size: lane.size,
            }))}
            onParameterChange={changeParameter}
            onParameterCommit={() => {
              store.endCoalescing();
            }}
            onClassicalTargetChange={changeClassicalTarget}
          />

          <AnalysisPanel state={analysis} />

          {/*
            Sampling needs something measured, and says so rather than failing
            when pressed -- the same treatment the palette gives a measurement
            with no register to write into.
          */}
          <ResultsPanel
            statevector={simulation.statevector}
            sample={simulation.sample}
            onRunSample={simulation.runSample}
            samplingUnavailable={
              circuit.operations.some(
                (operation) => operation.kind === 'measurement',
              )
                ? undefined
                : 'Add a measurement to sample this circuit.'
            }
          />
        </aside>
      </div>
    </div>
  );
}
