// @vitest-environment node
//
// esbuild refuses to run under jsdom, whose TextEncoder does not return a real
// Uint8Array. Nothing here touches the DOM, so the node environment costs
// nothing — and the file is about a module that must not depend on either.

/**
 * The generated validator is self-contained.
 *
 * ADR-0008 section 1 chose compiling the schema over shipping Ajv, and the whole
 * argument rests on one property: **nothing the generator produces is imported at
 * runtime.** This asserts that property directly rather than trusting it.
 *
 * It is asserted because trusting it failed. `standaloneCode` emits CommonJS
 * `require` calls for Ajv's runtime helpers — `ucs2length`, for the
 * `minLength`/`maxLength` on `Identifier` — and `require` does not exist in a
 * browser, so the module threw while being evaluated and the application rendered
 * a blank page. Every test still passed, because vitest runs in Node where
 * `require` is defined. A suite passing in one environment says nothing about
 * whether the module loads in another.
 *
 * The check is esbuild's own resolution rather than a search for the word
 * `require`: the bundled output legitimately contains that word, once in
 * esbuild's locally-defined interop shim and once inside a string literal. What
 * matters is not the spelling but whether anything outside the file is reachable.
 */

import { join } from 'node:path';
import process from 'node:process';

import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

import {
  OPERATION_DISCRIMINATOR,
  OPERATION_KINDS,
  validateBarrier,
  validateDocument,
  validateGate,
  validateMeasurement,
} from '../model/validator';

const VALIDATOR = join(process.cwd(), 'src', 'model', 'validator.ts');

describe('the compiled validator', () => {
  it('reaches nothing outside itself', async () => {
    const result = await build({
      entryPoints: [VALIDATOR],
      bundle: true,
      write: false,
      metafile: true,
      format: 'esm',
      platform: 'browser',
    });

    // One input: the validator. A second would mean a runtime dependency, which
    // is the thing ADR-0008 traded a generation step to avoid.
    expect(Object.keys(result.metafile.inputs)).toHaveLength(1);
  });

  it('exports one validator per operation kind, and one for the document', () => {
    expect(typeof validateDocument).toBe('function');
    expect(OPERATION_KINDS).toEqual(['gate', 'measurement', 'barrier']);
    expect(OPERATION_DISCRIMINATOR).toBe('kind');
  });
});

/**
 * The inlined helpers actually run.
 *
 * `minLength` is the keyword that pulled in `ucs2length`, so an empty identifier
 * is the case that proves the helper survived bundling rather than being stubbed.
 */
describe('the validators work', () => {
  const gate = {
    id: 'op_0',
    kind: 'gate',
    name: 'h',
    targets: ['q_0'],
    controls: [],
    parameters: {},
  };

  it('accepts a well-formed gate', () => {
    expect(validateGate(gate)).toBe(true);
  });

  it('rejects an identifier shorter than the schema allows', () => {
    expect(validateGate({ ...gate, id: '' })).toBe(false);
  });

  it('rejects an identifier longer than the schema allows', () => {
    expect(validateGate({ ...gate, id: 'q'.repeat(65) })).toBe(false);
  });

  it('rejects a gate carrying a field the schema does not declare', () => {
    expect(validateGate({ ...gate, duration: 3 })).toBe(false);
  });

  it('checks a measurement against its own subtype', () => {
    expect(
      validateMeasurement({
        id: 'op_0',
        kind: 'measurement',
        targets: ['q_0'],
        classicalTarget: { register: 'c_0', bit: 0 },
      }),
    ).toBe(true);
  });

  it('checks a barrier against its own subtype', () => {
    expect(
      validateBarrier({ id: 'op_0', kind: 'barrier', targets: ['q_0'] }),
    ).toBe(true);
  });

  /** The document validator leaves operations opaque; subtypes handle those. */
  it('accepts a document whose operations it does not inspect', () => {
    expect(
      validateDocument({
        schemaVersion: '0.1.0',
        id: 'circ_0',
        qubits: [{ id: 'q_0', index: 0 }],
        classicalRegisters: [],
        operations: [{ anything: true }],
      }),
    ).toBe(true);
  });
});
