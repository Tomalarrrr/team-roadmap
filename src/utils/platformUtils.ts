/**
 * Platform detection utilities for cross-platform keyboard shortcuts
 * and UI adaptations.
 */

/**
 * Detect if the current platform is macOS.
 * Uses navigator.platform which is deprecated but still widely supported.
 * Falls back safely on server-side rendering.
 */
export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return navigator.platform.toUpperCase().indexOf('MAC') >= 0;
}

/**
 * Get the appropriate modifier key symbol for the current platform.
 * Returns Command symbol on Mac, 'Ctrl' on other platforms.
 */
export function getModifierKeySymbol(): string {
  return isMacPlatform() ? '\u2318' : 'Ctrl';
}

/**
 * Get the modifier key name for keyboard event checking.
 * Returns 'metaKey' on Mac, 'ctrlKey' on other platforms.
 */
export function getModifierKeyName(): 'metaKey' | 'ctrlKey' {
  return isMacPlatform() ? 'metaKey' : 'ctrlKey';
}

/**
 * Check if a keyboard event has the platform-appropriate modifier key pressed.
 */
export function hasModifierKey(event: KeyboardEvent | React.KeyboardEvent): boolean {
  return isMacPlatform() ? event.metaKey : event.ctrlKey;
}
