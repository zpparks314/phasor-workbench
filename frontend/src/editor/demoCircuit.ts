/**
 * A circuit to look at until the palette exists.
 *
 * **Temporary scaffolding.** Once placement lands, the editor opens on an empty
 * circuit the user builds themselves, or on whatever local storage restored, and
 * this file goes away. It exists so the renderer has something to draw that
 * exercises every glyph: single-qubit gates, a control, a barrier levelling the
 * frontier, measurements, and a connector crossing an uninvolved wire.
 *
 * Built through the edit vocabulary rather than as a literal, so it cannot drift
 * from what the editor itself can produce.
 */

import type { Circuit, Operation } from '../model/circuit';
import { SCHEMA_VERSION } from '../model/spec';
import {
  addClassicalRegister,
  addQubit,
  insertOperation,
  newIdentifier,
} from '../state';

const OPERATIONS: readonly Operation[] = [
  { id: 'op_0', kind: 'gate', name: 'h', targets: ['q_0'], controls: [] },
  {
    id: 'op_1',
    kind: 'gate',
    name: 'cx',
    targets: ['q_1'],
    controls: ['q_0'],
  },
  {
    id: 'op_2',
    kind: 'gate',
    name: 'rx',
    targets: ['q_2'],
    controls: [],
    parameters: { theta: Math.PI / 2 },
  },
  // Spans an idle wire: the connector must break where it crosses q_1.
  {
    id: 'op_3',
    kind: 'gate',
    name: 'cz',
    targets: ['q_2'],
    controls: ['q_0'],
  },
  { id: 'op_4', kind: 'barrier', targets: ['q_0', 'q_1', 'q_2'] },
  {
    id: 'op_5',
    kind: 'measurement',
    targets: ['q_0'],
    classicalTarget: { register: 'c_0', bit: 0 },
  },
  {
    id: 'op_6',
    kind: 'measurement',
    targets: ['q_1'],
    classicalTarget: { register: 'c_0', bit: 1 },
  },
];

export function createDemoCircuit(): Circuit {
  const empty: Circuit = {
    schemaVersion: SCHEMA_VERSION,
    id: newIdentifier(),
    name: 'Demo circuit',
    qubits: [],
    classicalRegisters: [],
    operations: [],
  };

  const withWires = ['q_0', 'q_1', 'q_2'].reduce(
    (circuit, id) => addQubit(circuit, { id }),
    empty,
  );

  return OPERATIONS.reduce(
    (circuit, operation, index) => insertOperation(circuit, operation, index),
    addClassicalRegister(withWires, { id: 'c_0', size: 2 }),
  );
}
