import { z } from 'zod';

// Date string format: YYYY-MM-DD
export const dateStringSchema = z.string().regex(
  /^\d{4}-\d{2}-\d{2}$/,
  'Invalid date format. Expected YYYY-MM-DD'
);

// Hex color (#RRGGBB format)
export const colorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid color format');
