import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Static guards over the stylesheets. Neither `tsc` nor the test suite nor the
 * Vite build validates CSS *values*, so a declaration can be silently invalid —
 * the browser drops it and the style just doesn't apply, with nothing failing.
 * These cases have each already happened at least once in this codebase.
 */

function cssFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) cssFiles(full, acc);
    else if (entry.endsWith('.css')) acc.push(full);
  }
  return acc;
}

const SRC = join(process.cwd(), 'src');
const files = cssFiles(SRC).map(path => ({ path, css: readFileSync(path, 'utf-8') }));
const rel = (p: string) => p.slice(SRC.length + 1);

describe('CSS token integrity', () => {
  it('every custom property used is defined somewhere', () => {
    const defined = new Set<string>();
    for (const { css } of files) {
      for (const m of css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)) defined.add(m[1]);
    }
    const missing: string[] = [];
    for (const { path, css } of files) {
      for (const m of css.matchAll(/var\(\s*(--[a-z0-9-]+)\s*([,)])/g)) {
        // A var() with a fallback still renders if the token is absent.
        if (m[2] === ',') continue;
        if (!defined.has(m[1])) missing.push(`${rel(path)} uses ${m[1]}`);
      }
    }
    expect(missing, `undefined custom properties:\n${missing.join('\n')}`).toEqual([]);
  });

  it('no transition pairs a compound --transition-* token with a second easing', () => {
    // --transition-* already carries its own timing function, so a trailing
    // easing yields two timing functions and the browser drops the declaration.
    const easing = String.raw`(?:var\(--ease-[a-z-]+(?:,[^()]*)?\)|cubic-bezier\([^()]*\)|ease-in-out|ease-in|ease-out|ease|linear)`;
    const bad: string[] = [];
    for (const { path, css } of files) {
      for (const decl of css.matchAll(/transition(?:-duration)?:\s*([^;]+);/g)) {
        const re = new RegExp(String.raw`var\(--transition-(?:instant|fast|normal|slow)\)\s+` + easing);
        if (re.test(decl[1])) bad.push(`${rel(path)}: ${decl[1].trim().slice(0, 80)}`);
      }
    }
    expect(bad, `invalid transitions:\n${bad.join('\n')}`).toEqual([]);
  });

  it('no full-colour emoji in product chrome (games are exempt)', () => {
    // Deliberately narrow. Monochrome dingbats (⚠ U+26A0, ✓ U+2713) are the
    // convention here — they inherit `color` and sit on the type baseline. What
    // is banned is *emoji presentation*: the pictographic blocks, and any glyph
    // followed by U+FE0F, which forces a full-colour render in its own palette.
    const emoji = /[\u{1F300}-\u{1FAFF}]|️/u;
    const offenders: string[] = [];
    for (const { path, css } of files) {
      if (/Ludo/i.test(path)) continue;
      for (const m of css.matchAll(/content:\s*(["'])(.*?)\1/g)) {
        if (emoji.test(m[2])) offenders.push(`${rel(path)}: content: "${m[2]}"`);
      }
    }
    expect(offenders, `emoji in chrome:\n${offenders.join('\n')}`).toEqual([]);
  });
});
