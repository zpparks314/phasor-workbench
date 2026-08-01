/**
 * Turning a circuit and its decomposition into geometry.
 *
 * A pure function of `(circuit, decomposition, metrics)`, deliberately separate
 * from the components so it is testable without a DOM. It is recomputed on every
 * render and never stored -- ADR-0001 makes the operation list canonical and the
 * decomposition a derived view, and a coordinate held in component state is the
 * duplicated state Architecture.md forbids.
 *
 * **This module decides where a column sits on screen. It never decides which
 * column an operation occupies.** That is `deriveCycles`, and the distinction is
 * the whole reason this project renders with direct SVG rather than a node-graph
 * library that would own positions itself. See docs/Frontend.md.
 *
 * **It must tolerate an invalid circuit.** Edits do not validate (ADR-0007
 * section 7), so the editor renders semantically invalid intermediate states as a
 * matter of course, and `deriveCycles` documents that it does not throw on one.
 * Two consequences are handled here rather than left to crash:
 *
 * - A qubit reference that does not resolve is dropped from an operation's
 *   anchors. An operation with no resolvable anchor is omitted from the layout
 *   entirely; `validateCircuit` is what tells the user why, in the problems strip.
 * - Qubits are laid out in ascending `index` order but positioned by their place
 *   in that order, not by the index value, so a gap in the sequence does not open
 *   an empty lane. The gap is a violation to report, not a hole to draw.
 */

import type { Circuit, GateName, Operation } from '../model/circuit';
import type { Decomposition } from '../cycles';

export interface LayoutMetrics {
  /** Vertical distance between wire centers. */
  readonly lane: number;
  /** Horizontal distance between cycle centers. */
  readonly column: number;
  /** Edge length of a gate's square. */
  readonly glyph: number;
  /** Width of the sticky qubit label column. */
  readonly gutter: number;
  /** Radius of a control dot. */
  readonly control: number;
  readonly padding: number;
  /** Space between the last qubit wire and the first register lane. */
  readonly registerGap: number;
  /**
   * Break left in a connector where it crosses an *empty* wire it does not act
   * on.
   *
   * Semantically load-bearing rather than decorative: only `targets` and
   * `controls` are resources in the derivation, so an intervening wire is
   * genuinely untouched and stays free for concurrent operations. A connector
   * drawn straight through would read as contact.
   */
  readonly crossingGap: number;
  /**
   * Clearance left around a glyph the connector passes.
   *
   * A wire that is untouched by this operation may still be *occupied* by
   * another one in the same cycle -- that is the whole point of the intervening
   * wire being free. Stopping the line at the glyph's edge makes it look
   * attached, so it stops clear of it instead. Wider than `glyph` by design.
   */
  readonly glyphClearance: number;
}

export const DEFAULT_METRICS: LayoutMetrics = {
  lane: 56,
  column: 56,
  glyph: 40,
  gutter: 96,
  control: 5,
  padding: 28,
  registerGap: 24,
  crossingGap: 12,
  glyphClearance: 52,
};

export interface Segment {
  readonly y1: number;
  readonly y2: number;
}

export interface WireLayout {
  readonly qubitId: string;
  readonly label: string;
  readonly y: number;
}

export interface RegisterLaneLayout {
  readonly registerId: string;
  readonly label: string;
  readonly size: number;
  readonly y: number;
}

export type QubitRole = 'target' | 'control';

export interface AnchorLayout {
  readonly qubitId: string;
  readonly role: QubitRole;
  readonly y: number;
}

export interface GateLayout {
  readonly kind: 'gate';
  readonly operationId: string;
  readonly name: GateName;
  readonly x: number;
  readonly anchors: readonly AnchorLayout[];
  /** Already split around wires the operation does not act on. */
  readonly connector: readonly Segment[];
}

export interface MeasurementLayout {
  readonly kind: 'measurement';
  readonly operationId: string;
  readonly x: number;
  readonly anchors: readonly AnchorLayout[];
  readonly connector: readonly Segment[];
  readonly registerY: number;
  readonly bit: number;
}

export interface BarrierLayout {
  readonly operationId: string;
  readonly x: number;
  /**
   * One segment per contiguous run of involved wires.
   *
   * A barrier over q0 and q2 but not q1 draws two segments rather than one line
   * through q1, for the same reason a connector breaks at a wire it does not act
   * on: the barrier constrains only the qubits it names.
   */
  readonly segments: readonly Segment[];
}

export interface CircuitLayout {
  readonly metrics: LayoutMetrics;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  /**
   * Columns the canvas offers, which is `depth + 1`.
   *
   * The extra one is the empty column past the end of the circuit. Without it
   * there is nowhere to drop an operation that should run last, and appending
   * would be the one placement the editor could not express.
   */
  readonly columnCount: number;
  readonly wires: readonly WireLayout[];
  readonly registers: readonly RegisterLaneLayout[];
  readonly operations: readonly (GateLayout | MeasurementLayout)[];
  readonly barriers: readonly BarrierLayout[];
  /** Where the wires stop: one half-column past the last cycle. */
  readonly wireEnd: number;
}

export function layoutCircuit(
  circuit: Circuit,
  decomposition: Decomposition,
  metrics: LayoutMetrics = DEFAULT_METRICS,
): CircuitLayout {
  const wires = layoutWires(circuit, metrics);
  const registers = layoutRegisters(circuit, wires.length, metrics);
  const laneOf = new Map<string, number>([
    ...wires.map((wire): [string, number] => [wire.qubitId, wire.y]),
    ...registers.map((lane): [string, number] => [lane.registerId, lane.y]),
  ]);
  const columnOf = columnsByOperation(decomposition);
  const occupancy = occupancyByCycle(circuit, decomposition);

  const operations = circuit.operations
    .flatMap((operation) =>
      layoutOperation(
        operation,
        columnOf,
        laneOf,
        wires,
        registers,
        occupancy,
        metrics,
      ),
    )
    .filter((layout) => layout.anchors.length > 0);

  const barriers = decomposition.barriers.map((placement) => ({
    operationId: placement.operationId,
    x: metrics.gutter + placement.beforeCycle * metrics.column,
    segments: barrierSegments(placement.qubits, wires, metrics),
  }));

  const columnCount = decomposition.depth + 1;
  const lastLane = registers.at(-1)?.y ?? wires.at(-1)?.y ?? metrics.padding;
  const end = metrics.gutter + (columnCount + 0.5) * metrics.column;

  return {
    metrics,
    depth: decomposition.depth,
    columnCount,
    width: end,
    height: lastLane + metrics.lane / 2 + metrics.padding,
    wireEnd: end,
    wires,
    registers,
    operations,
    barriers,
  };
}

/** Centre of a cycle's column. */
export function columnCenter(cycle: number, metrics: LayoutMetrics): number {
  return metrics.gutter + (cycle + 0.5) * metrics.column;
}

/**
 * The provisional connector for a gate that is still being placed.
 *
 * Breaks at every wire the pending operation does not name, for the reason the
 * committed connector does: only the qubits it names are its resources, and a
 * line drawn straight through an uninvolved wire reads as contact. That signal
 * is worth as much mid-placement as after it -- more, since assigning the wrong
 * control is the mistake this sequence exists to make visible.
 *
 * **The empty-wire gap is used throughout, including where a glyph sits.** The
 * wider clearance distinguishes an occupied crossing from an empty one, and a
 * pending operation has no cycle yet -- `deriveCycles` has not seen it, because
 * it is not in the circuit. Which wires are occupied *in its eventual column* is
 * therefore not yet a question with an answer. The committed render, one click
 * later, is where the distinction becomes real.
 */
export function pendingConnector(
  anchors: readonly AnchorLayout[],
  layout: CircuitLayout,
): Segment[] {
  return connectorFor(
    anchors.map((anchor) => anchor.y),
    new Set(anchors.map((anchor) => anchor.qubitId)),
    layout.wires,
    layout.registers,
    new Set<string>(),
    layout.metrics,
  );
}

function layoutWires(circuit: Circuit, metrics: LayoutMetrics): WireLayout[] {
  return [...circuit.qubits]
    .sort((a, b) => a.index - b.index)
    .map((qubit, position) => ({
      qubitId: qubit.id,
      label: qubit.label ?? `q${String(qubit.index)}`,
      y: metrics.padding + (position + 0.5) * metrics.lane,
    }));
}

function layoutRegisters(
  circuit: Circuit,
  wireCount: number,
  metrics: LayoutMetrics,
): RegisterLaneLayout[] {
  const top = metrics.padding + wireCount * metrics.lane + metrics.registerGap;

  return circuit.classicalRegisters.map((register, position) => ({
    registerId: register.id,
    label: register.label ?? register.id,
    size: register.size,
    y: top + (position + 0.5) * metrics.lane,
  }));
}

function columnsByOperation(decomposition: Decomposition): Map<string, number> {
  const columns = new Map<string, number>();
  decomposition.cycles.forEach((cycle, index) => {
    for (const operationId of cycle) columns.set(operationId, index);
  });
  return columns;
}

function layoutOperation(
  operation: Operation,
  columnOf: ReadonlyMap<string, number>,
  laneOf: ReadonlyMap<string, number>,
  wires: readonly WireLayout[],
  registers: readonly RegisterLaneLayout[],
  occupancy: ReadonlyMap<number, ReadonlySet<string>>,
  metrics: LayoutMetrics,
): (GateLayout | MeasurementLayout)[] {
  if (operation.kind === 'barrier') return [];

  const cycle = columnOf.get(operation.id);
  if (cycle === undefined) return [];
  const x = columnCenter(cycle, metrics);

  const anchors = resolveAnchors(operation, laneOf);
  if (anchors.length === 0) return [];
  const occupied = occupancy.get(cycle) ?? new Set<string>();

  if (operation.kind === 'measurement') {
    const registerY = laneOf.get(operation.classicalTarget.register);
    if (registerY === undefined) {
      return [
        {
          kind: 'measurement',
          operationId: operation.id,
          x,
          anchors,
          connector: [],
          registerY: anchors[0]?.y ?? 0,
          bit: operation.classicalTarget.bit,
        },
      ];
    }

    return [
      {
        kind: 'measurement',
        operationId: operation.id,
        x,
        anchors,
        connector: connectorFor(
          [...anchors.map((a) => a.y), registerY],
          new Set([
            ...anchors.map((a) => a.qubitId),
            operation.classicalTarget.register,
          ]),
          wires,
          registers,
          occupied,
          metrics,
        ),
        registerY,
        bit: operation.classicalTarget.bit,
      },
    ];
  }

  return [
    {
      kind: 'gate',
      operationId: operation.id,
      name: operation.name,
      x,
      anchors,
      connector: connectorFor(
        anchors.map((anchor) => anchor.y),
        new Set(anchors.map((anchor) => anchor.qubitId)),
        wires,
        registers,
        occupied,
        metrics,
      ),
    },
  ];
}

function resolveAnchors(
  operation: Operation,
  laneOf: ReadonlyMap<string, number>,
): AnchorLayout[] {
  const controls = operation.kind === 'gate' ? (operation.controls ?? []) : [];
  const named: readonly (readonly [string, QubitRole])[] = [
    ...operation.targets.map((id): [string, QubitRole] => [id, 'target']),
    ...controls.map((id): [string, QubitRole] => [id, 'control']),
  ];

  return named.flatMap(([qubitId, role]) => {
    const y = laneOf.get(qubitId);
    return y === undefined ? [] : [{ qubitId, role, y }];
  });
}

interface Crossing {
  readonly y: number;
  /** Wider where a glyph sits on the crossed lane in this same cycle. */
  readonly gap: number;
}

/**
 * The vertical run between the outermost anchors, broken at every lane in
 * between that this operation does not touch.
 *
 * The break is small over an empty wire, where it says "this wire is untouched",
 * and glyph-sized over an occupied one, where stopping at the glyph's edge would
 * make the connector look attached to it.
 */
function connectorFor(
  anchorYs: readonly number[],
  involved: ReadonlySet<string>,
  wires: readonly WireLayout[],
  registers: readonly RegisterLaneLayout[],
  occupied: ReadonlySet<string>,
  metrics: LayoutMetrics,
): Segment[] {
  const top = Math.min(...anchorYs);
  const bottom = Math.max(...anchorYs);
  if (top === bottom) return [];

  const crossed: Crossing[] = [
    ...wires
      .filter((wire) => !involved.has(wire.qubitId))
      .map((wire) => ({
        y: wire.y,
        gap: occupied.has(wire.qubitId)
          ? metrics.glyphClearance
          : metrics.crossingGap,
      })),
    ...registers
      .filter((lane) => !involved.has(lane.registerId))
      .map((lane) => ({ y: lane.y, gap: metrics.crossingGap })),
  ]
    .filter((crossing) => crossing.y > top && crossing.y < bottom)
    .sort((a, b) => a.y - b.y);

  const segments: Segment[] = [];
  let cursor = top;

  for (const crossing of crossed) {
    const half = crossing.gap / 2;
    if (crossing.y - half > cursor) {
      segments.push({ y1: cursor, y2: crossing.y - half });
    }
    cursor = Math.max(cursor, crossing.y + half);
  }
  if (bottom > cursor) segments.push({ y1: cursor, y2: bottom });

  return segments;
}

/** Which qubits carry a glyph in each cycle, for connector clearance. */
function occupancyByCycle(
  circuit: Circuit,
  decomposition: Decomposition,
): Map<number, Set<string>> {
  const byOperation = new Map(
    circuit.operations.map((operation) => [operation.id, operation]),
  );
  const occupancy = new Map<number, Set<string>>();

  decomposition.cycles.forEach((cycle, index) => {
    const qubits = new Set<string>();
    for (const id of cycle) {
      const operation = byOperation.get(id);
      if (operation !== undefined) {
        for (const target of operation.targets) qubits.add(target);
      }
    }
    occupancy.set(index, qubits);
  });

  return occupancy;
}

function barrierSegments(
  qubits: readonly string[],
  wires: readonly WireLayout[],
  metrics: LayoutMetrics,
): Segment[] {
  const involved = new Set(qubits);
  const reach = metrics.lane * 0.4;
  const segments: Segment[] = [];
  let run: WireLayout[] = [];

  const flush = (): void => {
    const first = run[0];
    const last = run.at(-1);
    if (first !== undefined && last !== undefined) {
      segments.push({ y1: first.y - reach, y2: last.y + reach });
    }
    run = [];
  };

  for (const wire of wires) {
    if (involved.has(wire.qubitId)) run.push(wire);
    else flush();
  }
  flush();

  return segments;
}
