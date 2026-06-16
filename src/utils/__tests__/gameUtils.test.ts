import { describe, it, expect } from 'vitest';
import { generateGameCode, generateSessionId } from '../gameUtils';

describe('generateGameCode', () => {
  it('generates a code of default length 4', () => {
    const code = generateGameCode();
    expect(code).toHaveLength(4);
  });

  it('generates a code of custom length', () => {
    const code = generateGameCode(8);
    expect(code).toHaveLength(8);
  });

  it('only contains allowed characters (no I/O/0/1)', () => {
    const allowed = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let i = 0; i < 100; i++) {
      const code = generateGameCode();
      for (const char of code) {
        expect(allowed).toContain(char);
      }
    }
  });

  it('generates unique codes (statistical check)', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      codes.add(generateGameCode());
    }
    // The alphabet is 32 chars, so 32^4 ≈ 1.05M combinations. For 1000 draws the
    // expected number of birthday-paradox collisions is ~0.48, and 2–3 collisions
    // occur in a non-trivial fraction of runs — so a `>= 999` bound is flaky.
    // Allow up to 10 collisions: the Poisson tail P(>=10 | mean 0.48) is
    // effectively zero, so this still fails loudly if the generator is broken
    // (e.g. a constant or tiny alphabet) without flaking on healthy randomness.
    expect(codes.size).toBeGreaterThanOrEqual(990);
  });
});

describe('generateSessionId', () => {
  it('generates an ID with the user- prefix', () => {
    const id = generateSessionId();
    expect(id).toMatch(/^user-/);
  });

  it('generates unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateSessionId());
    }
    expect(ids.size).toBe(100);
  });

  it('generates a sufficiently long ID', () => {
    const id = generateSessionId();
    // "user-" + UUID (36 chars) or hex (32 chars) = at least 37 chars
    expect(id.length).toBeGreaterThanOrEqual(37);
  });
});
