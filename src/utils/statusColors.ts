/**
 * Centralized status color definitions used across the application.
 * These map to project/milestone health states.
 */

export interface StatusColor {
  hex: string;
  name: string;
  slug: string;
}

export const STATUS_COLORS: StatusColor[] = [
  { hex: '#0070c0', name: 'Complete', slug: 'complete' },
  { hex: '#04b050', name: 'On Track', slug: 'on-track' },
  { hex: '#ffc002', name: 'At Risk', slug: 'at-risk' },
  { hex: '#ff0100', name: 'Off Track', slug: 'off-track' },
  { hex: '#7612c3', name: 'On Hold', slug: 'on-hold' },
  { hex: '#9ca3af', name: 'To Start', slug: 'to-start' },
];

// For SearchFilter's STATUS_CONFIG format
export const STATUS_CONFIG: Record<string, { label: string; color: string }> = Object.fromEntries(
  STATUS_COLORS.map(s => [s.slug, { label: s.name, color: s.hex }])
);

// Helper to get status name from hex color
export function getStatusNameByHex(hex: string): string | undefined {
  return STATUS_COLORS.find(c => c.hex.toLowerCase() === hex.toLowerCase())?.name;
}

// Default status color (To Start)
export const DEFAULT_STATUS_COLOR = STATUS_COLORS[5].hex;
