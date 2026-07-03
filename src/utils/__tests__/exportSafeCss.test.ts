import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The PDF and "For report" exports rasterise the timeline with html2canvas
// (v1.4.x), whose CSS colour parser predates the modern colour functions. When
// it meets one in a captured element's computed style it THROWS mid-capture and
// the whole export fails — exactly how "For report" broke in production when the
// today-line used `color-mix(in srgb, …)` (Chrome serialises that computed value
// as `color(srgb …)`, which html2canvas can't parse).
//
// html2canvas walks the whole subtree, so any offending declaration anywhere in
// the app's CSS is a latent export failure. This guard fails the build if one is
// reintroduced. If html2canvas is ever upgraded to a version that supports these,
// delete this test.
const UNSUPPORTED = [
  { name: 'color-mix()', re: /color-mix\(/i },
  { name: 'oklch()', re: /\boklch\(/i },
  { name: 'oklab()', re: /\boklab\(/i },
  { name: 'lab()', re: /(^|[^-\w])lab\(/i },
  { name: 'lch()', re: /(^|[^-\w])lch\(/i },
  // The CSS color() function — but not `background-color(`-style false hits or
  // the many JS `…Color(` calls (those live in .ts/.tsx, not scanned here).
  { name: 'color()', re: /(^|[^-\w])color\(/i },
];

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...cssFiles(full));
    else if (entry.name.endsWith('.css')) out.push(full);
  }
  return out;
}

describe('CSS stays html2canvas-safe (PDF / report export)', () => {
  it('uses no colour functions html2canvas cannot parse', () => {
    const offenders: string[] = [];
    for (const file of cssFiles(join(process.cwd(), 'src'))) {
      // Blank out /* … */ comments (html2canvas never sees them) while keeping
      // newlines so reported line numbers stay accurate — otherwise a comment
      // that merely *names* an unsupported function would trip the guard.
      const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (m) =>
        m.replace(/[^\n]/g, ' '),
      );
      const lines = src.split('\n');
      lines.forEach((line, i) => {
        for (const fn of UNSUPPORTED) {
          if (fn.re.test(line)) {
            offenders.push(`${file}:${i + 1} uses ${fn.name} — ${line.trim()}`);
          }
        }
      });
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});
