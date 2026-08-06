/**
 * The design tokens in `index.css`.
 *
 * **These read the stylesheet as text, and that is the honest shape for them.**
 * jsdom applies no Tailwind and computes no cascade, so nothing here can assert
 * what a control *looks* like — the rendering was checked in a browser instead,
 * by reading computed styles off the running page. What a test can do is stop
 * the one declaration behind that fix from being deleted by someone who does not
 * know what it was for, which is the regression worth guarding.
 *
 * The precedent is `persistence.test.ts`'s module-boundary scan: a source-level
 * check nobody can argue with beats a rendering check that cannot run.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

import { describe, expect, it } from 'vitest';

const CSS = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8');

describe('native controls follow the page', () => {
  /**
   * Without this, the browser draws every select, number input, range and
   * scrollbar in its light palette while `--color-ink` flips to near-white
   * under the dark media query. The two then disagree in the one place the page
   * does not paint: an `option` list, drawn by the browser, inheriting the
   * near-white text onto a white popup. Reported on 2026-08-05 against the
   * examples picker — white font on a white dropdown.
   */
  it('declares a colour scheme', () => {
    expect(CSS).toMatch(/color-scheme:/);
  });

  /**
   * `light dark`, not a fixed value. The tokens key off `prefers-color-scheme`,
   * so pinning the controls to one scheme would put them back out of step with
   * the page — the same defect, arriving from the other direction.
   */
  it('lets the scheme follow the same preference the tokens do', () => {
    expect(CSS).toMatch(/color-scheme:\s*light dark/);
  });

  /**
   * And the part `color-scheme` alone did not fix. It gets the *computed*
   * values right — Chrome resolves an `option` to white on its own grey under a
   * dark preference — but how faithfully a browser paints a dark control varies
   * by engine and platform, and the picker was still reported hard to read.
   * Author-specified colours are painted the same way everywhere.
   */
  it('paints a dropdown from the tokens rather than trusting the browser', () => {
    const rule = /select,\s*\n?option\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '';

    expect(rule).toMatch(/background-color:\s*var\(--color-/);
    expect(rule).toMatch(/color:\s*var\(--color-/);
  });

  /** Tokens, never literals — the rule the whole file exists to keep. */
  it('uses no literal colour outside the token definitions', () => {
    const belowTokens = CSS.slice(CSS.indexOf('#root'));

    expect(belowTokens).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(belowTokens).not.toMatch(/\brgb\(|\bhsl\(/);
  });
});

describe('the token set', () => {
  /**
   * Every token defined in `@theme` has a dark counterpart. A new one added to
   * only the light block is invisible until someone opens the app in dark mode,
   * which is exactly how long the dropdown defect survived.
   */
  it('overrides every token in dark mode', () => {
    const declared = (block: string): string[] =>
      [...block.matchAll(/--color-[\w-]+:/g)].map((match) => match[0]);

    const theme = /@theme\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '';
    const dark =
      /@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(
        CSS,
      )?.[1] ?? '';

    expect(declared(theme)).not.toHaveLength(0);
    expect(declared(dark).sort()).toEqual(declared(theme).sort());
  });
});
