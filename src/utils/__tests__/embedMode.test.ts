import { describe, it, expect } from 'vitest';
import { isEmbedMode } from '../embedMode';

// Embed mode is what a framed SharePoint viewer runs in: locked, no unlock
// path. It must be off by default and impossible to trigger accidentally, but
// robust to the harmless variations a person might type into the URL.
describe('isEmbedMode', () => {
  it('is off when no embed param is present', () => {
    expect(isEmbedMode('')).toBe(false);
    expect(isEmbedMode('?foo=bar')).toBe(false);
    expect(isEmbedMode('?embedded=1')).toBe(false); // not a prefix match
  });

  it('is on for the documented forms', () => {
    expect(isEmbedMode('?embed')).toBe(true);
    expect(isEmbedMode('?embed=1')).toBe(true);
    expect(isEmbedMode('?embed=true')).toBe(true);
  });

  it('is on regardless of case, surrounding params, or whitespace', () => {
    expect(isEmbedMode('?embed=TRUE')).toBe(true);
    expect(isEmbedMode('?zoom=30&embed=1')).toBe(true);
    expect(isEmbedMode('?embed=%20yes%20')).toBe(true);
  });

  it('can be explicitly disabled so a stray param cannot lock the app', () => {
    expect(isEmbedMode('?embed=0')).toBe(false);
    expect(isEmbedMode('?embed=false')).toBe(false);
    expect(isEmbedMode('?embed=off')).toBe(false);
  });
});
