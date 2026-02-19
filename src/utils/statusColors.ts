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

export const STATUS_COLORS: StatusColor[] = [
  { hex: '#4A82BE', name: 'Complete', slug: 'complete' },
  { hex: '#457028', name: 'On Track', slug: 'on-track' },
  { hex: '#A67A00', name: 'At Risk', slug: 'at-risk' },
  { hex: '#B5444A', name: 'Off Track', slug: 'off-track' },
  { hex: '#7558A6', name: 'On Hold', slug: 'on-hold' },
  { hex: '#6E7D89', name: 'To Start', slug: 'to-start' },
  { hex: '#B571C0', name: 'Planning', slug: 'planning' },
  { hex: '#3E95AD', name: 'Review', slug: 'review' },
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

// Normalize a hex color: if it's a legacy value, return the new equivalent.
export function normalizeStatusColor(hex: string): string {
  if (!hex) return DEFAULT_STATUS_COLOR;
  const lower = hex.toLowerCase();
  return LEGACY_COLOR_MAP[lower] ?? hex;
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

// Default status color (To Start)
export const DEFAULT_STATUS_COLOR = STATUS_COLORS[5].hex;

// Auto-complete color for past projects/milestones
export const AUTO_COMPLETE_COLOR = '#4A82BE';
