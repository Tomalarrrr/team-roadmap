import { z } from 'zod';
import { dateStringSchema, colorSchema } from './primitives';

// Milestone schema
export const milestoneSchema = z.object({
  id: z.string().min(1, 'Milestone ID is required').max(100),
  title: z.string().min(1, 'Milestone title is required').max(200),
  description: z.string().max(1000).optional().default(''),
  startDate: dateStringSchema,
  endDate: dateStringSchema,
  tags: z.array(z.string().max(50)).max(20).default([]),
  statusColor: colorSchema
}).refine(
  (data) => data.startDate <= data.endDate,
  { message: 'Start date must be before or equal to end date', path: ['startDate'] }
);

// Project schema
export const projectSchema = z.object({
  id: z.string().min(1, 'Project ID is required').max(100),
  title: z.string().min(1, 'Project title is required').max(200),
  owner: z.string().min(1, 'Project owner is required').max(100),
  startDate: dateStringSchema,
  endDate: dateStringSchema,
  statusColor: colorSchema,
  // Historic projects predate sizing — default them to small (a 1-slot starting
  // point) so an unsized backlog doesn't silently eat capacity.
  size: z.enum(['full-time', 'large', 'medium', 'small']).default('small'),
  // Capacity Scoring Matrix answers (utils/scoring.ts). Optional so legacy
  // projects validate; must be declared here or Zod would strip it on load.
  scoring: z.object({
    scores: z.record(z.string(), z.number().min(0).max(3)),
    total: z.number().min(0).max(21),
  }).optional(),
  milestones: z.array(milestoneSchema).max(100).default([]),
  dependencies: z.array(z.string().max(100)).optional().default([])
}).refine(
  (data) => data.startDate <= data.endDate,
  { message: 'Start date must be before or equal to end date', path: ['startDate'] }
);

// Team member schema
export const teamMemberSchema = z.object({
  id: z.string().min(1, 'Member ID is required').max(100),
  name: z.string().min(1, 'Member name is required').max(100),
  jobTitle: z.string().max(100).default(''),
  nameColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid color format').optional(),
  order: z.number().min(0).max(200).optional()
});

// Waypoint schema (for dependency paths)
const waypointSchema = z.object({
  x: z.number(),
  y: z.number()
});

// Dependency type enum
const dependencyTypeSchema = z.enum([
  'finish-to-start',
  'start-to-start',
  'finish-to-finish'
]);

// Dependency schema
export const dependencySchema = z.object({
  id: z.string().min(1, 'Dependency ID is required').max(100),
  fromProjectId: z.string().min(1, 'From project ID is required').max(100),
  fromMilestoneId: z.string().max(100).optional(),
  toProjectId: z.string().min(1, 'To project ID is required').max(100),
  toMilestoneId: z.string().max(100).optional(),
  type: dependencyTypeSchema,
  waypoints: z.array(waypointSchema).max(50).optional()
});

// Leave type enum
const leaveTypeSchema = z.enum([
  'annual-leave',
  'training',
  'conference',
  'other'
]);

// Leave coverage enum
const leaveCoverageSchema = z.enum([
  'quarter',
  'half',
  'full'
]);

// Leave block schema
export const leaveBlockSchema = z.object({
  id: z.string().min(1, 'Leave block ID is required').max(100),
  memberId: z.string().min(1, 'Member ID is required').max(100),
  startDate: dateStringSchema,
  endDate: dateStringSchema,
  coverage: leaveCoverageSchema,
  type: leaveTypeSchema,
  label: z.string().max(200).optional()
}).refine(
  (data) => data.startDate <= data.endDate,
  { message: 'Start date must be before or equal to end date', path: ['startDate'] }
);

// Period marker color enum
const periodMarkerColorSchema = z.enum([
  'grey',
  'yellow',
  'orange',
  'red',
  'green'
]);

// Period marker schema
export const periodMarkerSchema = z.object({
  id: z.string().min(1, 'Period marker ID is required').max(100),
  startDate: dateStringSchema,
  endDate: dateStringSchema,
  color: periodMarkerColorSchema,
  label: z.string().max(200).optional()
}).refine(
  (data) => data.startDate <= data.endDate,
  { message: 'Start date must be before or equal to end date', path: ['startDate'] }
);

// Complete roadmap data schema
const roadmapDataSchema = z.object({
  projects: z.array(projectSchema).default([]),
  teamMembers: z.array(teamMemberSchema).default([]),
  dependencies: z.array(dependencySchema).optional().default([]),
  leaveBlocks: z.array(leaveBlockSchema).optional().default([]),
  periodMarkers: z.array(periodMarkerSchema).optional().default([])
});

// Type exports derived from schemas
export type ValidatedRoadmapData = z.infer<typeof roadmapDataSchema>;

/**
 * Safely validate roadmap data, returning a result object instead of throwing.
 */
export function safeValidateRoadmapData(data: unknown): {
  success: true;
  data: ValidatedRoadmapData;
} | {
  success: false;
  error: z.ZodError;
} {
  const result = roadmapDataSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

/**
 * Format Zod errors into user-friendly messages.
 */
export function formatValidationErrors(error: z.ZodError<unknown>): string[] {
  // Zod v4 uses .issues array
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    return `${path}${issue.message}`;
  });
}
