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

/**
 * What the palette can arm.
 *
 * Gate names come from the spec; `measurement` and `barrier` are operation
 * *kinds* from the schema and are named here rather than read from
 * `GATE_SIGNATURES`, because they are genuinely not gates -- CircuitModel.md is
 * explicit that `barrier` "is an operation kind, not a gate name". That is why
 * this union is safe to discriminate by value: neither string can ever collide
 * with a gate name.
 *
 * Measurement and barrier sit in the palette rather than in a mode of their own.
 * They are operations, they are placed the same way, and giving them separate
 * machinery would obscure that.
 */
export type PaletteItem = GateName | 'measurement' | 'barrier';

export function isGateName(item: PaletteItem): item is GateName {
  return item in GATE_SIGNATURES;
}

export interface PaletteEntry {
  readonly name: PaletteItem;
  readonly description: string;
  /** Absent for measurement and barrier, which have no gate signature. */
  readonly signature: GateSignature | undefined;
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

/**
 * The two non-gate operation kinds, named here because they are not in the spec's
 * gate table and cannot be derived from it.
 *
 * This is the one hand-written part of the palette, and it is hand-written for a
 * reason rather than by omission: `barrier` and `measurement` are operation kinds
 * in the schema, not gates, so there is no generated list they could come from.
 */
const NON_UNITARY: readonly PaletteEntry[] = [
  {
    name: 'measurement',
    signature: undefined,
    description:
      'Measure into a classical register. Ends the qubit: nothing may follow it.',
  },
  {
    name: 'barrier',
    signature: undefined,
    description:
      'Scheduling constraint across every wire. Nothing is reordered past it.',
  },
];

export const PALETTE: readonly PaletteGroup[] = [
  ...GROUPS.map((group) => ({
    title: group.title,
    entries: group.gates.map((name) => ({
      name,
      signature: GATE_SIGNATURES[name],
      description: DESCRIPTIONS[name],
    })),
  })),
  { title: 'Non-unitary', entries: NON_UNITARY },
];

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

/**
 * Every gate in the spec appears in exactly one group. Asserted in the tests.
 *
 * Non-gate entries are filtered out rather than counted. A gate missing from the
 * groups still fails the assertion, because it compares against the spec's own
 * gate table -- the filter removes measurement and barrier, not evidence.
 */
export function groupedGateNames(): GateName[] {
  return PALETTE.flatMap((group) =>
    group.entries.map((entry) => entry.name).filter(isGateName),
  );
}

/** Parameters a freshly placed gate carries, defaulted rather than prompted for. */
export function defaultParameters(
  signature: GateSignature,
): Record<string, number> {
  return Object.fromEntries(
    signature.parameters.map((parameter) => [parameter, Math.PI / 2]),
  );
}
