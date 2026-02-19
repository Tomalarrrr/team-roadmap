import { z } from 'zod';

// Date string format: YYYY-MM-DD
const dateStringSchema = z.string().regex(
  /^\d{4}-\d{2}-\d{2}$/,
  'Invalid date format. Expected YYYY-MM-DD'
);

// Hex color (#RRGGBB format)
const colorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid color format');

// Milestone schema
export const milestoneSchema = z.object({
  id: z.string().min(1, 'Milestone ID is required'),
  title: z.string().min(1, 'Milestone title is required'),
  description: z.string().optional().default(''),
  startDate: dateStringSchema,
  endDate: dateStringSchema,
  tags: z.array(z.string()).default([]),
  statusColor: colorSchema
}).refine(
  (data) => data.startDate <= data.endDate,
  { message: 'Start date must be before or equal to end date', path: ['startDate'] }
);

// Project schema
export const projectSchema = z.object({
  id: z.string().min(1, 'Project ID is required'),
  title: z.string().min(1, 'Project title is required'),
  owner: z.string().min(1, 'Project owner is required'),
  startDate: dateStringSchema,
  endDate: dateStringSchema,
  statusColor: colorSchema,
  milestones: z.array(milestoneSchema).default([]),
  dependencies: z.array(z.string()).optional().default([])
}).refine(
  (data) => data.startDate <= data.endDate,
  { message: 'Start date must be before or equal to end date', path: ['startDate'] }
);

// Team member schema
export const teamMemberSchema = z.object({
  id: z.string().min(1, 'Member ID is required'),
  name: z.string().min(1, 'Member name is required'),
  jobTitle: z.string().default(''),
  nameColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid color format').optional(),
  order: z.number().optional()
});

// Waypoint schema (for dependency paths)
export const waypointSchema = z.object({
  x: z.number(),
  y: z.number()
});

// Dependency type enum
export const dependencyTypeSchema = z.enum([
  'finish-to-start',
  'start-to-start',
  'finish-to-finish'
]);

// Dependency schema
export const dependencySchema = z.object({
  id: z.string().min(1, 'Dependency ID is required'),
  fromProjectId: z.string().min(1, 'From project ID is required'),
  fromMilestoneId: z.string().optional(),
  toProjectId: z.string().min(1, 'To project ID is required'),
  toMilestoneId: z.string().optional(),
  type: dependencyTypeSchema,
  waypoints: z.array(waypointSchema).optional()
});

// Leave type enum
export const leaveTypeSchema = z.enum([
  'annual-leave',
  'training',
  'conference',
  'other'
]);

// Leave coverage enum
export const leaveCoverageSchema = z.enum([
  'quarter',
  'half',
  'full'
]);

// Leave block schema
export const leaveBlockSchema = z.object({
  id: z.string().min(1, 'Leave block ID is required'),
  memberId: z.string().min(1, 'Member ID is required'),
  startDate: dateStringSchema,
  endDate: dateStringSchema,
  coverage: leaveCoverageSchema,
  type: leaveTypeSchema,
  label: z.string().optional()
}).refine(
  (data) => data.startDate <= data.endDate,
  { message: 'Start date must be before or equal to end date', path: ['startDate'] }
);

// Period marker color enum
export const periodMarkerColorSchema = z.enum([
  'grey',
  'yellow',
  'orange',
  'red',
  'green'
]);

// Period marker schema
export const periodMarkerSchema = z.object({
  id: z.string().min(1, 'Period marker ID is required'),
  startDate: dateStringSchema,
  endDate: dateStringSchema,
  color: periodMarkerColorSchema,
  label: z.string().optional()
}).refine(
  (data) => data.startDate <= data.endDate,
  { message: 'Start date must be before or equal to end date', path: ['startDate'] }
);

// Complete roadmap data schema
export const roadmapDataSchema = z.object({
  projects: z.array(projectSchema).default([]),
  teamMembers: z.array(teamMemberSchema).default([]),
  dependencies: z.array(dependencySchema).optional().default([]),
  leaveBlocks: z.array(leaveBlockSchema).optional().default([]),
  periodMarkers: z.array(periodMarkerSchema).optional().default([])
});

// Type exports derived from schemas
export type ValidatedMilestone = z.infer<typeof milestoneSchema>;
export type ValidatedProject = z.infer<typeof projectSchema>;
export type ValidatedTeamMember = z.infer<typeof teamMemberSchema>;
export type ValidatedDependency = z.infer<typeof dependencySchema>;
export type ValidatedLeaveBlock = z.infer<typeof leaveBlockSchema>;
export type ValidatedPeriodMarker = z.infer<typeof periodMarkerSchema>;
export type ValidatedRoadmapData = z.infer<typeof roadmapDataSchema>;

/**
 * Validate and parse roadmap data, returning normalized data with defaults applied.
 * Throws ZodError if validation fails.
 */
export function validateRoadmapData(data: unknown): ValidatedRoadmapData {
  return roadmapDataSchema.parse(data);
}

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
 * Validate a single project.
 */
export function validateProject(data: unknown): ValidatedProject {
  return projectSchema.parse(data);
}

/**
 * Safely validate a single project.
 */
export function safeValidateProject(data: unknown): {
  success: true;
  data: ValidatedProject;
} | {
  success: false;
  error: z.ZodError;
} {
  const result = projectSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

/**
 * Validate a single milestone.
 */
export function validateMilestone(data: unknown): ValidatedMilestone {
  return milestoneSchema.parse(data);
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

/**
 * Normalize potentially malformed data by applying defaults and coercing types.
 * This is useful for loading data from Firebase that might have missing fields.
 */
export function normalizeRoadmapData(data: unknown): ValidatedRoadmapData {
  // First, try to parse with defaults
  const result = roadmapDataSchema.safeParse(data ?? {});

  if (result.success) {
    return result.data;
  }

  // If parsing fails, return empty defaults
  console.warn('Failed to normalize roadmap data, using defaults:', result.error);
  return {
    projects: [],
    teamMembers: [],
    dependencies: [],
    leaveBlocks: [],
    periodMarkers: []
  };
}
