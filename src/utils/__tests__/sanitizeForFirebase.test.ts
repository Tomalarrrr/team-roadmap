import { describe, it, expect } from 'vitest';
import { sanitizeForFirebase } from '../../hooks/useRoadmap';

describe('sanitizeForFirebase', () => {
  it('preserves null values (Firebase accepts null for deletion)', () => {
    expect(sanitizeForFirebase(null)).toBeNull();
  });

  it('converts top-level undefined to null', () => {
    expect(sanitizeForFirebase(undefined)).toBeNull();
  });

  it('strips undefined keys from objects', () => {
    const input = { a: 1, b: undefined, c: 'hello' };
    const result = sanitizeForFirebase(input);
    expect(result).toEqual({ a: 1, c: 'hello' });
    expect('b' in (result as Record<string, unknown>)).toBe(false);
  });

  it('preserves null values inside objects', () => {
    const input = { a: 1, b: null, c: 'hello' };
    const result = sanitizeForFirebase(input);
    expect(result).toEqual({ a: 1, b: null, c: 'hello' });
  });

  it('recursively sanitizes nested objects', () => {
    const input = { a: { b: undefined, c: { d: undefined, e: 42 } } };
    const result = sanitizeForFirebase(input);
    expect(result).toEqual({ a: { c: { e: 42 } } });
  });

  it('handles arrays correctly', () => {
    const input = [1, null, 'hello', undefined];
    const result = sanitizeForFirebase(input);
    expect(result).toEqual([1, null, 'hello', null]);
  });

  it('preserves primitive values', () => {
    expect(sanitizeForFirebase(42)).toBe(42);
    expect(sanitizeForFirebase('hello')).toBe('hello');
    expect(sanitizeForFirebase(true)).toBe(true);
    expect(sanitizeForFirebase(false)).toBe(false);
    expect(sanitizeForFirebase(0)).toBe(0);
  });

  it('handles empty objects and arrays', () => {
    expect(sanitizeForFirebase({})).toEqual({});
    expect(sanitizeForFirebase([])).toEqual([]);
  });
});
