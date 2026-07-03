/**
 * Centralized status color definitions used across the application.
 * These map to project/milestone health states.
 *
 * Palette inspired by Outlook calendar pill colors (slightly deeper
 * variants for white-text readability on narrow project bars).
 */

export interface StatusColor {
  hex: string;
  name: string;
  slug: string;
}

// Listed in lifecycle order (Discovery → Complete): pre-delivery stages, then the
// in-flight health states (On Track / At Risk / Off Track), then the parked
// states (On Hold / Deferred), then closed. The pickers and filter chips render
// them in this order.
export const STATUS_COLORS: StatusColor[] = [
  { hex: '#3E95AD', name: 'Discovery', slug: 'discovery' },
  { hex: '#B571C0', name: 'Initiation', slug: 'initiation' },
  { hex: '#6E7D89', name: 'Ready to Start', slug: 'ready-to-start' },
  { hex: '#457028', name: 'On Track', slug: 'on-track' },
  { hex: '#A67A00', name: 'At Risk', slug: 'at-risk' },
  { hex: '#B5444A', name: 'Off Track', slug: 'off-track' },
  { hex: '#7558A6', name: 'On Hold', slug: 'on-hold' },
  { hex: '#8A6D5B', name: 'Deferred', slug: 'deferred' },
  { hex: '#4A82BE', name: 'Complete', slug: 'complete' },
];

// For SearchFilter's STATUS_CONFIG format
export const STATUS_CONFIG: Record<string, { label: string; color: string }> = Object.fromEntries(
  STATUS_COLORS.map(s => [s.slug, { label: s.name, color: s.hex }])
);

// Legacy color map for backward compatibility with existing Firebase data.
// Old hex values are mapped to their new equivalents so existing projects
// continue to display correct status names, filter correctly, and show
// the right swatch selected when editing.
const LEGACY_COLOR_MAP: Record<string, string> = {
  '#0070c0': '#4A82BE',
  '#04b050': '#457028',
  '#ffc002': '#A67A00',
  '#ff0100': '#B5444A',
  '#7612c3': '#7558A6',
  '#9ca3af': '#6E7D89',
};

// Convert "rgb(r, g, b)" / "rgba(r, g, b, a)" → "#RRGGBB". Returns null if the
// input isn't an rgb()/rgba() string so callers can fall through to other formats.
function rgbToHex(value: string): string | null {
  const match = value.match(
    /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+\s*)?\)$/i
  );
  if (!match) return null;
  const toHex = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
  const [, r, g, b] = match;
  return `#${toHex(Number(r))}${toHex(Number(g))}${toHex(Number(b))}`.toUpperCase();
}

// Normalize any supported color input to a canonical "#RRGGBB" (uppercase) value.
//
// Handles every format that has reached persisted data over the app's lifetime:
//   - rgb()/rgba() strings (older seed/import format) → hex
//   - 3-digit shorthand hex (#abc) → 6-digit
//   - legacy palette hex → current palette equivalent
//   - already-canonical hex → uppercased (so exact swatch matching works)
//
// This is the single choke point that lets the rest of the app assume hex:
// forms validate against a hex-only schema, and swatch selection compares hex
// exactly. Unrecognized input falls back to the default rather than persisting
// a value the validation schema would later reject.
export function normalizeStatusColor(color: string): string {
  if (!color) return DEFAULT_STATUS_COLOR;
  let hex = color.trim();

  // rgb()/rgba() → hex
  const fromRgb = rgbToHex(hex);
  if (fromRgb) hex = fromRgb;

  // Expand 3-digit shorthand (#abc → #aabbcc)
  if (/^#[0-9A-Fa-f]{3}$/.test(hex)) {
    hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }

  // Map legacy palette values to their current equivalents (case-insensitive)
  const legacy = LEGACY_COLOR_MAP[hex.toLowerCase()];
  if (legacy) return legacy;

  // Canonicalize valid hex to uppercase; reject anything else.
  if (/^#[0-9A-Fa-f]{6}$/.test(hex)) return hex.toUpperCase();
  return DEFAULT_STATUS_COLOR;
}

// Helper to get status name from hex color (handles legacy colors)
export function getStatusNameByHex(hex: string): string | undefined {
  const normalized = normalizeStatusColor(hex);
  return STATUS_COLORS.find(c => c.hex.toLowerCase() === normalized.toLowerCase())?.name;
}

// Helper to get status slug from hex color (handles legacy colors)
export function getStatusSlugByHex(hex: string): string | undefined {
  const normalized = normalizeStatusColor(hex);
  return STATUS_COLORS.find(c => c.hex.toLowerCase() === normalized.toLowerCase())?.slug;
}

// True when a status color represents "On Hold". On-hold projects are paused, so
// callers exclude them from a member's capacity load — they don't consume any of
// the 4 slots until taken off hold. Resolves legacy hex via getStatusSlugByHex.
export function isOnHold(statusColor: string | undefined): boolean {
  return !!statusColor && getStatusSlugByHex(statusColor) === 'on-hold';
}

// Statuses that opt out of the "auto-complete when the today line passes the end
// date" rule. These are pre-delivery or parked stages where an elapsed end date
// doesn't mean the work finished — a Discovery/Initiation/Ready-to-Start project
// simply hasn't kicked off, and On Hold/Deferred are intentionally paused. Their
// chosen status is honoured even once today passes the pill's end date.
const AUTO_COMPLETE_EXEMPT_SLUGS = new Set([
  'discovery',
  'initiation',
  'ready-to-start',
  'on-hold',
  'deferred',
]);

// True when a project's status should NOT be overridden to "Complete" once the
// today line passes its end date. Resolves legacy hex via getStatusSlugByHex.
export function isAutoCompleteExempt(statusColor: string | undefined): boolean {
  if (!statusColor) return false;
  const slug = getStatusSlugByHex(statusColor);
  return !!slug && AUTO_COMPLETE_EXEMPT_SLUGS.has(slug);
}

// Default status color (Discovery — the first lifecycle stage)
export const DEFAULT_STATUS_COLOR = STATUS_COLORS[0].hex;

// Auto-complete color for past projects/milestones
export const AUTO_COMPLETE_COLOR = '#4A82BE';
