/**
 * What the gate palette offers, and how it is grouped.
 *
 * **The gate list comes from `model/spec.ts`**, generated from
 * shared/spec/circuit.spec.json, so adding a gate to the shared spec makes it
 * appear here. Never hand-write a gate list; the `EVERY_GATE_IS_GROUPED` check
 * below fails the test suite if a new gate arrives without a home.
 *
 * The *grouping* is editorial and lives here, because it is the one thing a gate
 * signature cannot express. Groups are by what a gate does, since that is the
 * teaching structure -- see UI.md.
 *
 * Descriptions are here for the same reason. They are interface copy, not model
 * facts, and putting them in the shared spec would make every gate addition a
 * cross-language change for the sake of a sentence.
 */

import type { GateName } from '../model/circuit';
import { GATE_SIGNATURES, type GateSignature } from '../model/spec';

export interface PaletteEntry {
  readonly name: GateName;
  readonly description: string;
  readonly signature: GateSignature;
}

export interface PaletteGroup {
  readonly title: string;
  readonly entries: readonly PaletteEntry[];
}

const DESCRIPTIONS: Readonly<Record<GateName, string>> = {
  i: 'Identity. Leaves the qubit unchanged.',
  h: 'Hadamard. Puts a basis state into equal superposition.',
  x: 'Pauli-X. A bit flip, rotating half a turn about X.',
  y: 'Pauli-Y. Half a turn about Y.',
  z: 'Pauli-Z. A phase flip, half a turn about Z.',
  s: 'Phase. A quarter turn about Z.',
  sdg: 'Phase adjoint. A quarter turn about Z, the other way.',
  t: 'T. An eighth turn about Z.',
  tdg: 'T adjoint. An eighth turn about Z, the other way.',
  rx: 'Rotate about X by theta.',
  ry: 'Rotate about Y by theta.',
  rz: 'Rotate about Z by theta.',
  p: 'Phase shift by lambda.',
  cx: 'Controlled-X. Flips the target when the control is set.',
  cy: 'Controlled-Y.',
  cz: 'Controlled-Z. Phase flips when both qubits are set.',
  swap: 'Swap. Exchanges the states of two qubits.',
  ccx: 'Toffoli. Flips the target when both controls are set.',
};

const GROUPS: readonly {
  readonly title: string;
  readonly gates: readonly GateName[];
}[] = [
  { title: 'Identity and Pauli', gates: ['i', 'x', 'y', 'z'] },
  { title: 'Superposition', gates: ['h'] },
  { title: 'Phase', gates: ['s', 'sdg', 't', 'tdg', 'p'] },
  { title: 'Rotation', gates: ['rx', 'ry', 'rz'] },
  { title: 'Two-qubit', gates: ['cx', 'cy', 'cz', 'swap'] },
  { title: 'Three-qubit', gates: ['ccx'] },
];

export const PALETTE: readonly PaletteGroup[] = GROUPS.map((group) => ({
  title: group.title,
  entries: group.gates.map((name) => ({
    name,
    signature: GATE_SIGNATURES[name],
    description: DESCRIPTIONS[name],
  })),
}));

/**
 * A gate's arity in words, for the tooltip UI.md specifies.
 *
 * Read from the signature rather than written per gate, so it cannot disagree
 * with the sequence `./pending` drives from that same signature.
 */
export function describeSignature(signature: GateSignature): string {
  return [
    `${String(signature.targets)} ${plural(signature.targets, 'target')}`,
    `${String(signature.controls)} ${plural(signature.controls, 'control')}`,
  ].join(', ');
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}

/** Every gate in the spec appears in exactly one group. Asserted in the tests. */
export function groupedGateNames(): GateName[] {
  return PALETTE.flatMap((group) => group.entries.map((entry) => entry.name));
}

/** Parameters a freshly placed gate carries, defaulted rather than prompted for. */
export function defaultParameters(
  signature: GateSignature,
): Record<string, number> {
  return Object.fromEntries(
    signature.parameters.map((parameter) => [parameter, Math.PI / 2]),
  );
}
