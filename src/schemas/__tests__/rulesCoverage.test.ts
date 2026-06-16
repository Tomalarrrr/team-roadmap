/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import {
  projectSchema,
  milestoneSchema,
  teamMemberSchema,
  dependencySchema,
  leaveBlockSchema,
  periodMarkerSchema,
} from '../roadmap';

// ---------------------------------------------------------------------------
// Guard against the class of bug where a field is added to the data model but
// NOT to the Firebase security rules. Because every entity node in the rules
// ends with `"$other": { ".validate": false }`, any field the app writes that
// the rules don't explicitly allow is rejected by Firebase with a 401
// "Permission denied" — silently breaking saves in production (this is exactly
// what happened with the `size` field). This test fails CI if the rules ever
// fall out of sync with the Zod schemas (the canonical writable shape).
// ---------------------------------------------------------------------------

type RuleNode = Record<string, unknown>;

// Vitest runs from the project root, where database.rules.json lives.
const rules = JSON.parse(
  readFileSync(resolve(process.cwd(), 'database.rules.json'), 'utf-8'),
) as { rules: RuleNode };

// Pull the field keys out of a Zod object schema, transparently unwrapping the
// ZodEffects produced by `.refine()` so refined schemas work too.
function schemaKeys(schema: z.ZodTypeAny): string[] {
  let s: z.ZodTypeAny | undefined = schema;
  // Walk inner types until we find one exposing `.shape` (the ZodObject).
  for (let i = 0; i < 10 && s; i++) {
    const shape = (s as unknown as { shape?: Record<string, unknown> }).shape;
    if (shape) return Object.keys(shape);
    const def = (s as unknown as { _def?: { schema?: z.ZodTypeAny; innerType?: z.ZodTypeAny }; def?: { schema?: z.ZodTypeAny; innerType?: z.ZodTypeAny } });
    const inner = def._def?.schema ?? def._def?.innerType ?? def.def?.schema ?? def.def?.innerType;
    s = inner;
  }
  throw new Error('Could not extract shape from schema');
}

// The explicitly-allowed child field names declared in a rules node (everything
// that isn't a `.meta`/`$wildcard` key).
function allowedFields(node: RuleNode): string[] {
  return Object.keys(node).filter((k) => !k.startsWith('.') && !k.startsWith('$'));
}

const roadmap = rules.rules.roadmap as RuleNode;
const projectNode = (roadmap.projects as RuleNode).$projectId as RuleNode;
const milestoneNode = (projectNode.milestones as RuleNode).$milestoneId as RuleNode;

const CASES: { name: string; schema: z.ZodTypeAny; node: RuleNode }[] = [
  { name: 'projects', schema: projectSchema, node: projectNode },
  { name: 'projects/milestones', schema: milestoneSchema, node: milestoneNode },
  { name: 'teamMembers', schema: teamMemberSchema, node: (roadmap.teamMembers as RuleNode).$memberId as RuleNode },
  { name: 'dependencies', schema: dependencySchema, node: (roadmap.dependencies as RuleNode).$depId as RuleNode },
  { name: 'leaveBlocks', schema: leaveBlockSchema, node: (roadmap.leaveBlocks as RuleNode).$leaveId as RuleNode },
  { name: 'periodMarkers', schema: periodMarkerSchema, node: (roadmap.periodMarkers as RuleNode).$markerId as RuleNode },
];

describe('Firebase security rules cover every schema field', () => {
  it.each(CASES)('$name: every schema field is permitted by the rules', ({ schema, node }) => {
    const allowed = new Set(allowedFields(node));
    const missing = schemaKeys(schema).filter((k) => !allowed.has(k));
    // If this fails: a model field is missing from database.rules.json, so
    // writing it will be rejected with 401 in production. Add it to the rules.
    expect(missing).toEqual([]);
  });

  it.each(CASES)('$name: has the strict "$other" guard (so extra fields are caught)', ({ node }) => {
    // The guard only bites if `$other` denies unlisted fields. If this is ever
    // relaxed, the coverage check above stops being meaningful.
    expect((node.$other as RuleNode)?.['.validate']).toBe(false);
  });

  it('the project "size" field specifically is allowed (regression: prod 401)', () => {
    expect(allowedFields(projectNode)).toContain('size');
  });
});
