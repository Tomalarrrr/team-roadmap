import { z } from 'zod';

// Date string format: YYYY-MM-DD. The regex only checks shape, so it would
// happily accept impossible dates like 2025-02-30 or 2025-13-45; the refine
// rejects those by reconstructing the date and confirming no month/day rollover
// occurred. Without this, a string-compare ordering refine (used in roadmap.ts)
// treats "2025-13-45" as valid and persists corrupt dates.
export const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format. Expected YYYY-MM-DD')
  .refine(
    (s) => {
      const [y, m, d] = s.split('-').map(Number);
      if (m < 1 || m > 12 || d < 1 || d > 31) return false;
      // Construct in local time and verify the components survived (no rollover).
      const dt = new Date(y, m - 1, d);
      return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
    },
    { message: 'Not a valid calendar date' }
  );

// Hex color (#RRGGBB format)
export const colorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid color format');
