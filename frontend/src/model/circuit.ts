/**
 * Opaque stable identifier, generated client-side. Nothing may parse meaning out of it. See ADR-0002.
 */
export type Identifier = string;
/**
 * Anything occupying a position in execution order, discriminated on kind.
 */
export type Operation = GateOperation | MeasurementOperation | BarrierOperation;
/**
 * Lowercase, following OpenQASM convention. Arity is validated in code -- expressing it here would require one branch per gate.
 */
export type GateName =
  | 'i'
  | 'h'
  | 'x'
  | 'y'
  | 'z'
  | 's'
  | 'sdg'
  | 't'
  | 'tdg'
  | 'rx'
  | 'ry'
  | 'rz'
  | 'p'
  | 'cx'
  | 'cy'
  | 'cz'
  | 'swap'
  | 'ccx';
/**
 * A reference to an identifier declared elsewhere in the circuit.
 */
export type IdentifierRef = string;

/**
 * The canonical Phasor Workbench circuit. Specified in docs/CircuitModel.md; shaped by ADR-0001 (flat operation list, derived cycles), ADR-0002 (stable opaque identifiers), and ADR-0004 (this schema is the source of truth for the wire format). Structural rules only -- referential, semantic, and order-dependent validation is hand-written in both languages. The cycle decomposition is derived and never appears here.
 */
export interface Circuit {
  /**
   * Semantic version of the model. Migration policy lives in docs/CircuitModel.md.
   */
  schemaVersion: string;
  id: Identifier;
  name?: string;
  qubits: Qubit[];
  /**
   * Required, but may be empty. There is no implicit default register; every measurement names a register declared here.
   */
  classicalRegisters: ClassicalRegister[];
  /**
   * Flat and in execution order. Concurrency is derived, never stored -- see ADR-0001.
   */
  operations: Operation[];
  metadata?: Metadata;
}
/**
 * A single quantum wire.
 */
export interface Qubit {
  id: Identifier;
  /**
   * Position on the wire stack. Contiguity from 0 is validated in code, not here.
   */
  index: number;
  label?: string;
}
/**
 * A named group of classical bits that measurement results are written into.
 */
export interface ClassicalRegister {
  id: Identifier;
  size: number;
  label?: string;
}
/**
 * A unitary operation on one or more qubits.
 */
export interface GateOperation {
  id: Identifier;
  kind: 'gate';
  name: GateName;
  /**
   * @minItems 1
   */
  targets: [IdentifierRef, ...IdentifierRef[]];
  /**
   * Control qubits. Control count is never encoded into the gate name.
   */
  controls?: IdentifierRef[];
  /**
   * Angles in radians. Which parameters a given gate requires is validated in code.
   */
  parameters?: {
    [k: string]: number;
  };
}
/**
 * A projective measurement writing into a classical bit. While mid-circuit measurement is deferred, a measured qubit is terminal -- enforced in code, not here.
 */
export interface MeasurementOperation {
  id: Identifier;
  kind: 'measurement';
  /**
   * @minItems 1
   * @maxItems 1
   */
  targets: [IdentifierRef];
  classicalTarget: ClassicalTarget;
}
/**
 * A single bit within a declared classical register. Contention is tracked per bit -- see ADR-0003.
 */
export interface ClassicalTarget {
  register: IdentifierRef;
  /**
   * Index within the register. Bounds against the register's size are validated in code.
   */
  bit: number;
}
/**
 * An authoring constraint preventing operations from being scheduled across it. Occupies no cycle and does not contribute to depth -- see ADR-0003. Carries no controls, parameters, or classical target.
 */
export interface BarrierOperation {
  id: Identifier;
  kind: 'barrier';
  /**
   * Required and non-empty. There is no implicit all-qubits barrier; importers expand OpenQASM's bare barrier at import time.
   *
   * @minItems 1
   */
  targets: [IdentifierRef, ...IdentifierRef[]];
}
/**
 * Descriptive only. If the simulator would behave differently based on a field here, that field belongs in the model proper.
 */
export interface Metadata {
  description?: string;
  author?: string;
  createdAt?: string;
  updatedAt?: string;
}
