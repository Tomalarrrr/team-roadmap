import { z } from 'zod';
import { dateStringSchema, colorSchema } from '../schemas/primitives';

// Form-level input validation schemas. These derive shared primitives (date format,
// color format) from schemas/primitives.ts — the single source of truth for field
// formats. Form schemas omit system-generated fields (id) and add user-facing
// constraints (max lengths) that don't apply to persisted data.

// Project form schema
export const projectSchema = z.object({
  title: z.string().min(1, 'Title is required').max(100, 'Title too long'),
  owner: z.string().min(1, 'Owner is required').max(50, 'Owner name too long'),
  startDate: dateStringSchema,
  endDate: dateStringSchema,
  statusColor: colorSchema,
  size: z.enum(['full-time', 'large', 'medium', 'small'], { message: 'Select a project size' })
}).refine(data => new Date(data.endDate) >= new Date(data.startDate), {
  message: 'End date must be on or after start date',
  path: ['endDate']
});

// Team member form schema
export const teamMemberSchema = z.object({
  name: z.string().min(1, 'Name is required').max(50, 'Name too long'),
  jobTitle: z.string().min(1, 'Job title is required').max(50, 'Job title too long')
});

// Validation helper
export function validateForm<T>(schema: z.ZodSchema<T>, data: unknown): { success: true; data: T } | { success: false; errors: Record<string, string> } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const errors: Record<string, string> = {};
  result.error.issues.forEach(issue => {
    const path = issue.path.join('.');
    errors[path] = issue.message;
  });
  return { success: false, errors };
}
