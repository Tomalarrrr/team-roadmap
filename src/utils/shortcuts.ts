import { isMacPlatform } from './platformUtils';

export interface Shortcut {
  id: string;
  key: string;
  modifiers: ('meta' | 'ctrl' | 'shift' | 'alt')[];
  description: string;
  category: 'navigation' | 'editing' | 'view' | 'general';
  action?: () => void;
}

// Get the modifier key for the current platform
export function getModKey(): 'meta' | 'ctrl' {
  return isMacPlatform() ? 'meta' : 'ctrl';
}

// Format shortcut for display
export function formatShortcut(shortcut: Shortcut): string {
  const isMac = isMacPlatform();
  const parts: string[] = [];

  if (shortcut.modifiers.includes('meta')) {
    parts.push(isMac ? '⌘' : 'Ctrl');
  }
  if (shortcut.modifiers.includes('ctrl') && isMac) {
    parts.push('⌃');
  }
  if (shortcut.modifiers.includes('shift')) {
    parts.push(isMac ? '⇧' : 'Shift');
  }
  if (shortcut.modifiers.includes('alt')) {
    parts.push(isMac ? '⌥' : 'Alt');
  }

  // Format the key
  let keyDisplay = shortcut.key.toUpperCase();
  if (shortcut.key === 'Escape') keyDisplay = 'Esc';
  if (shortcut.key === 'ArrowUp') keyDisplay = '↑';
  if (shortcut.key === 'ArrowDown') keyDisplay = '↓';
  if (shortcut.key === 'ArrowLeft') keyDisplay = '←';
  if (shortcut.key === 'ArrowRight') keyDisplay = '→';
  if (shortcut.key === ' ') keyDisplay = 'Space';

  parts.push(keyDisplay);

  return isMac ? parts.join('') : parts.join('+');
}

// Check if a keyboard event matches a shortcut
export function matchesShortcut(event: KeyboardEvent, shortcut: Shortcut): boolean {
  const isMac = isMacPlatform();

  // Check key (case-insensitive)
  if (event.key.toLowerCase() !== shortcut.key.toLowerCase()) {
    return false;
  }

  // Check modifiers
  const needsMeta = shortcut.modifiers.includes('meta');
  const needsCtrl = shortcut.modifiers.includes('ctrl');
  const needsShift = shortcut.modifiers.includes('shift');
  const needsAlt = shortcut.modifiers.includes('alt');

  // On Mac, meta is Cmd. On Windows/Linux, we map meta to Ctrl.
  const metaPressed = isMac ? event.metaKey : event.ctrlKey;
  const ctrlPressed = isMac ? event.ctrlKey : false; // Ctrl on Mac is separate

  if (needsMeta && !metaPressed) return false;
  if (!needsMeta && metaPressed) return false;
  if (needsCtrl && !ctrlPressed) return false;
  if (needsShift !== event.shiftKey) return false;
  if (needsAlt !== event.altKey) return false;

  return true;
}

// Default application shortcuts
export const DEFAULT_SHORTCUTS: Shortcut[] = [
  // General
  {
    id: 'show-shortcuts',
    key: '?',
    modifiers: [],
    description: 'Show keyboard shortcuts',
    category: 'general'
  },
  {
    id: 'search',
    key: 'k',
    modifiers: ['meta'],
    description: 'Open search / command palette',
    category: 'general'
  },
  {
    id: 'export',
    key: 'e',
    modifiers: ['meta'],
    description: 'Open export menu',
    category: 'general'
  },

  // Editing
  {
    id: 'undo',
    key: 'z',
    modifiers: ['meta'],
    description: 'Undo last action',
    category: 'editing'
  },
  {
    id: 'redo',
    key: 'z',
    modifiers: ['meta', 'shift'],
    description: 'Redo last action',
    category: 'editing'
  },
  {
    id: 'copy',
    key: 'c',
    modifiers: ['meta'],
    description: 'Copy selected item',
    category: 'editing'
  },
  {
    id: 'paste',
    key: 'v',
    modifiers: ['meta'],
    description: 'Paste copied item',
    category: 'editing'
  },
  {
    id: 'delete',
    key: 'Backspace',
    modifiers: [],
    description: 'Delete selected item',
    category: 'editing'
  },

  // View
  {
    id: 'fullscreen',
    key: 'F11',
    modifiers: [],
    description: 'Toggle fullscreen mode',
    category: 'view'
  },
  {
    id: 'toggle-lock',
    key: 'l',
    modifiers: ['meta'],
    description: 'Toggle edit lock',
    category: 'view'
  },
  {
    id: 'zoom-in',
    key: '=',
    modifiers: ['meta'],
    description: 'Zoom in',
    category: 'view'
  },
  {
    id: 'zoom-out',
    key: '-',
    modifiers: ['meta'],
    description: 'Zoom out',
    category: 'view'
  },
  {
    id: 'zoom-reset',
    key: '0',
    modifiers: ['meta'],
    description: 'Reset zoom',
    category: 'view'
  },

  // Navigation
  {
    id: 'escape',
    key: 'Escape',
    modifiers: [],
    description: 'Close modal / cancel action',
    category: 'navigation'
  },
  {
    id: 'go-today',
    key: 't',
    modifiers: [],
    description: 'Jump to today',
    category: 'navigation'
  },

  // Editing
  {
    id: 'quick-create',
    key: 'n',
    modifiers: [],
    description: 'New project (when hovering lane)',
    category: 'editing'
  },
  {
    id: 'duplicate',
    key: 'd',
    modifiers: ['meta'],
    description: 'Duplicate selected project (+1 week)',
    category: 'editing'
  },
  {
    id: 'shift-earlier',
    key: '[',
    modifiers: [],
    description: 'Shift selected project -1 week',
    category: 'editing'
  },
  {
    id: 'shift-later',
    key: ']',
    modifiers: [],
    description: 'Shift selected project +1 week',
    category: 'editing'
  },
  {
    id: 'nav-prev',
    key: 'ArrowLeft',
    modifiers: [],
    description: 'Select previous project',
    category: 'navigation'
  },
  {
    id: 'nav-next',
    key: 'ArrowRight',
    modifiers: [],
    description: 'Select next project',
    category: 'navigation'
  },
  {
    id: 'nav-up',
    key: 'ArrowUp',
    modifiers: [],
    description: 'Select project in lane above',
    category: 'navigation'
  },
  {
    id: 'nav-down',
    key: 'ArrowDown',
    modifiers: [],
    description: 'Select project in lane below',
    category: 'navigation'
  }
];

// Group shortcuts by category
export function groupShortcutsByCategory(shortcuts: Shortcut[]): Record<string, Shortcut[]> {
  return shortcuts.reduce((acc, shortcut) => {
    if (!acc[shortcut.category]) {
      acc[shortcut.category] = [];
    }
    acc[shortcut.category].push(shortcut);
    return acc;
  }, {} as Record<string, Shortcut[]>);
}

// Category display names
export const CATEGORY_NAMES: Record<string, string> = {
  general: 'General',
  editing: 'Editing',
  view: 'View',
  navigation: 'Navigation'
};
