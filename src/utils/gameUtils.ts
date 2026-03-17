// Shared game utilities: cryptographically safe IDs and game code generation

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 to avoid confusion

/**
 * Generate a cryptographically random game code.
 * Uses 4 characters from a 30-char alphabet for ~810K combinations.
 */
export function generateGameCode(length = 4): string {
  // Rejection sampling: discard values >= largest multiple of alphabet size
  // to eliminate modular bias (256 % 30 = 16 biased values)
  const maxUnbiased = Math.floor(256 / CODE_CHARS.length) * CODE_CHARS.length;
  let code = '';
  while (code.length < length) {
    const array = new Uint8Array(length * 2); // request extra to reduce retries
    crypto.getRandomValues(array);
    for (let i = 0; i < array.length && code.length < length; i++) {
      if (array[i] < maxUnbiased) {
        code += CODE_CHARS[array[i] % CODE_CHARS.length];
      }
    }
  }
  return code;
}

/**
 * Generate a cryptographically secure session ID.
 * Uses crypto.randomUUID() when available, falls back to crypto.getRandomValues.
 */
export function generateSessionId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `user-${crypto.randomUUID()}`;
  }
  // Fallback for older browsers
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  const hex = Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
  return `user-${hex}`;
}
