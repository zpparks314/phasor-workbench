/**
 * Circuit builders for this module's tests.
 *
 * The fixtures in shared/fixtures/ are whole documents with declared outcomes,
 * which is what validation and the cycle derivation need. Editing tests need the
 * opposite -- small circuits assembled inline so an assertion can name exactly
 * what changed -- so they are built here rather than read from disk.
 *
 * Identifiers are short and readable. Nothing may parse them (ADR-0002), so if a
 * readable identifier ever changes behaviour, something has parsed one.
 */

import type {
  BarrierOperation,
  Circuit,
  GateName,
  GateOperation,
  MeasurementOperation,
} from '../model/circuit';
import { SCHEMA_VERSION } from '../model/spec';

/** A circuit with `qubitCount` wires, one register, and no operations. */
export function circuitWith(qubitCount: number, registerSize = 2): Circuit {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: 'circ_test',
    qubits: Array.from({ length: qubitCount }, (_, index) => ({
      id: `q_${String(index)}`,
      index,
    })),
    classicalRegisters: [{ id: 'c_0', size: registerSize }],
    operations: [],
  };
}

export function gate(
  id: string,
  name: GateName,
  targets: [string, ...string[]],
  controls: string[] = [],
): GateOperation {
  return { id, kind: 'gate', name, targets, controls, parameters: {} };
}

export function measurement(
  id: string,
  target: string,
  register: string,
  bit: number,
): MeasurementOperation {
  return {
    id,
    kind: 'measurement',
    targets: [target],
    classicalTarget: { register, bit },
  };
}

export function barrier(
  id: string,
  targets: [string, ...string[]],
): BarrierOperation {
  return { id, kind: 'barrier', targets };
}
