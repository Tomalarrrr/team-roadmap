// Shared game utilities: cryptographically safe IDs and game code generation

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 to avoid confusion

/**
 * Generate a cryptographically random game code.
 * Uses 4 characters from a 30-char alphabet for ~810K combinations.
 */
export function generateGameCode(length = 4): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CODE_CHARS[array[i] % CODE_CHARS.length];
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
