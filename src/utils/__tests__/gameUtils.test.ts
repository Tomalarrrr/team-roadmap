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
    // With 30^4 = ~810K combinations, 1000 codes should all be unique
    expect(codes.size).toBe(1000);
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
